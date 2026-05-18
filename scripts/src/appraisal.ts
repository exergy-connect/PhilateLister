/**
 * Refactored stamp appraisal script.
 *
 * Keeps the existing data contract from xframe/output/consolidated_data.json, while
 * centralizing provider-specific behavior in PROVIDERS so invocation selection,
 * prompt building, API-key filtering, execution, and output writing use one path.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import process from 'node:process';
import { debuglog } from 'node:util';
import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentConfig,
  type GenerateContentResponse,
} from '@google/genai';
import {
  appendGeminiUsageRound,
  appendOpenRouterUsageRound,
  createTokenUsageCollector,
  writeInvocationEventFile,
  type MutableTokenUsageCollector,
} from './invocation-events.js';
import {
  emptyInvocationTelemetry,
  recordInvocationStatsEvent,
  type AppraisalInvocationTelemetry,
} from './appraisal-rate-limit-stats.js';
import { XFrameGeminiFunctionRuntime, type EntityStore } from './xframe-gemini-functions.js';

const repoRoot = process.cwd();
const CONSOLIDATED_SCHEMA_PATH = join(repoRoot, 'xframe', 'output', 'consolidated.schema.json');
const CONSOLIDATED_DATA_PATH = join(repoRoot, 'xframe', 'output', 'consolidated_data.json');
const debug = debuglog('appraisal');

const PROMPT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;
const LARGE_IMAGE_BYTES = 1024 * 1024;
const AI_TIMEOUT_DEFAULT_MS = 60_000;
const AI_TIMEOUT_LARGE_IMAGE_MS = 120_000;
/** Max characters per stderr log block (full logs may be huge). Override with APPRAISAL_CONSOLE_LOG_MAX. */
const APPRAISAL_CONSOLE_LOG_MAX = Math.max(
  1024,
  Number.parseInt(String(process.env.APPRAISAL_CONSOLE_LOG_MAX ?? ''), 10) || 2 * 1024 * 1024
);

function replacerForLog(key: string, value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('data:') && value.includes('base64,')) {
      const i = value.indexOf('base64,') + 7;
      return `${value.slice(0, i)}<${value.length - i} base64 chars>`;
    }
    if (key === 'data' && value.length > 200) {
      return `<${value.length} base64 chars>`;
    }
  }
  return value;
}

function logConsoleBlock(title: string, body: string): void {
  if (body.length <= APPRAISAL_CONSOLE_LOG_MAX) {
    console.error(`${title}\n${body}`);
  } else {
    console.error(
      `${title}\n${body.slice(0, APPRAISAL_CONSOLE_LOG_MAX)}\n...<truncated ${body.length - APPRAISAL_CONSOLE_LOG_MAX} chars> (raise APPRAISAL_CONSOLE_LOG_MAX to see more)`
    );
  }
}

function logJsonConsole(title: string, value: unknown): void {
  try {
    const s = JSON.stringify(value, replacerForLog, 2);
    logConsoleBlock(title, s ?? 'null');
  } catch (e) {
    console.error(`${title}\n[JSON.stringify failed: ${e instanceof Error ? e.message : String(e)}]`);
  }
}

type OutputFormat = 'json' | 'txt';
type Meta = Record<string, unknown>;
type ProviderKind = 'google_gemini' | 'openrouter';

type ProviderRow = {
  provider_id: string;
  api_base_url: string;
};

type PromptInvocationRow = {
  invocation_id: string;
  prompt_id: string;
  provider_id: string;
  model: string;
  sort_order: number;
  primary_for_listing: boolean;
  enabled: boolean;
};

type Invocation = {
  id: string;
  primary: boolean;
  model: string;
  provider: ProviderRow;
};

type PromptPack = {
  preferredModel: string;
  template: string;
  geminiOutputJoin: string;
  outputFormat: OutputFormat;
};

type ConsolidatedDataRoot = {
  data?: EntityStore;
};

type ProviderContext = {
  invocation: Invocation;
  apiKey: string;
  prompt: string;
  image: Buffer;
  mime: string;
  outputFormat: OutputFormat;
  telemetry: AppraisalInvocationTelemetry;
  tokenUsage: MutableTokenUsageCollector;
};

type ProviderResult = {
  text: string;
  servedModel?: string;
};

type ProviderSpec = {
  id: ProviderKind;
  apiKeyEnv: string;
  defaultBaseUrl: string;
  includeGeminiOutputLines: boolean;
  run(ctx: ProviderContext): Promise<ProviderResult>;
};

const providerRows = new Map<string, ProviderRow>();
const promptPacks = new Map<string, PromptPack>();
let consolidatedData: ConsolidatedDataRoot | undefined;
let invocationRows: PromptInvocationRow[] | undefined;
let cachedStampSchema: Record<string, unknown> | undefined;

const geminiFunctionRuntime = new XFrameGeminiFunctionRuntime({
  consolidatedSchemaPath: CONSOLIDATED_SCHEMA_PATH,
  getEntityStore,
  providerId: 'google_gemini',
  functionCallEntity: 'gemini_function_call',
  functionParameterEntity: 'gemini_function_parameter',
});

const PROVIDERS: Record<ProviderKind, ProviderSpec> = {
  google_gemini: {
    id: 'google_gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    includeGeminiOutputLines: true,
    run: runGemini,
  },
  openrouter: {
    id: 'openrouter',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    includeGeminiOutputLines: false,
    run: runOpenRouter,
  },
};

function providerKind(providerId: string): ProviderKind {
  const id = providerId.toLowerCase();
  if (id === 'google_gemini' || id === 'openrouter') return id;
  throw new Error(`Unsupported provider_id ${JSON.stringify(providerId)}; supported: ${Object.keys(PROVIDERS).join(', ')}`);
}

function providerFor(providerId: string): ProviderSpec {
  return PROVIDERS[providerKind(providerId)];
}

function timeoutMs(imageBytes: number): number {
  return imageBytes > LARGE_IMAGE_BYTES ? AI_TIMEOUT_LARGE_IMAGE_MS : AI_TIMEOUT_DEFAULT_MS;
}

function loadDataRoot(): ConsolidatedDataRoot {
  if (consolidatedData) return consolidatedData;
  if (!existsSync(CONSOLIDATED_DATA_PATH)) {
    throw new Error(`Missing ${CONSOLIDATED_DATA_PATH}; run the xFrame consolidator first.`);
  }
  const st = statSync(CONSOLIDATED_DATA_PATH);
  debug('load consolidated_data path=%s mtime=%s size=%d', CONSOLIDATED_DATA_PATH, st.mtime.toISOString(), st.size);
  consolidatedData = JSON.parse(readFileSync(CONSOLIDATED_DATA_PATH, 'utf-8')) as ConsolidatedDataRoot;
  return consolidatedData;
}

function getEntityStore(): EntityStore {
  const data = loadDataRoot().data;
  if (!data || typeof data !== 'object') throw new Error(`${CONSOLIDATED_DATA_PATH} missing top-level data object`);
  return data;
}

function rowObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function loadProviderRows(): Map<string, ProviderRow> {
  if (providerRows.size) return providerRows;
  const bucket = getEntityStore().provider;
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return providerRows;
  for (const value of Object.values(bucket)) {
    const row = rowObject(value);
    if (!row) continue;
    const id = String(row.provider_id ?? '').trim();
    if (!id) continue;
    try {
      const spec = providerFor(id);
      providerRows.set(id, {
        provider_id: id,
        api_base_url: String(row.api_base_url ?? spec.defaultBaseUrl).trim() || spec.defaultBaseUrl,
      });
    } catch {
      debug('skipping unsupported provider_id=%s', id);
    }
  }
  return providerRows;
}

function readPromptInvocations(): PromptInvocationRow[] {
  if (invocationRows) return invocationRows;
  const out: PromptInvocationRow[] = [];
  const promptBucket = getEntityStore().prompt;
  if (!promptBucket || typeof promptBucket !== 'object' || Array.isArray(promptBucket)) return (invocationRows = out);

  for (const [promptKey, value] of Object.entries(promptBucket)) {
    const prompt = rowObject(value);
    if (!prompt || !Array.isArray(prompt.prompt_invocations)) continue;
    const promptId = String(prompt.prompt_id ?? promptKey).trim();
    for (const raw of prompt.prompt_invocations) {
      const row = rowObject(raw);
      if (!row) continue;
      out.push({
        invocation_id: String(row.invocation_id ?? '').trim(),
        prompt_id: String(row.prompt_id ?? promptId).trim(),
        provider_id: String(row.provider_id ?? '').trim(),
        model: String(row.model ?? '').trim(),
        sort_order: Number(row.sort_order) || 0,
        primary_for_listing: Boolean(row.primary_for_listing),
        enabled: row.enabled !== false,
      });
    }
  }
  return (invocationRows = out);
}

function outputFormatFrom(row: Record<string, unknown>, context: string): OutputFormat {
  const raw = row.output_format;
  if (raw == null) return 'txt';
  const value = String(raw).trim().toLowerCase();
  if (value === 'json' || value === 'txt') return value;
  throw new Error(`${context}: output_format must be "json" or "txt", got ${JSON.stringify(raw)}`);
}

function promptIdFrom(meta: Meta): string {
  const id = String(meta.prompt ?? '').trim();
  if (!id) return 'stamp_listing';
  if (!PROMPT_ID_RE.test(id)) throw new Error(`Invalid prompt id in commit metadata: ${JSON.stringify(id)}`);
  return id;
}

function loadPromptPack(promptId: string): PromptPack {
  const cached = promptPacks.get(promptId);
  if (cached) return cached;
  if (!PROMPT_ID_RE.test(promptId)) throw new Error(`Invalid prompt id: ${JSON.stringify(promptId)}`);

  const prompt = rowObject(getEntityStore().prompt?.[promptId]);
  if (!prompt) throw new Error(`${CONSOLIDATED_DATA_PATH} has no prompt row ${JSON.stringify(promptId)}`);

  const context = `${CONSOLIDATED_DATA_PATH} prompt ${promptId}`;
  const lines = prompt.template_lines;
  const template =
    Array.isArray(lines) ? lines.map(String).join('\n') : prompt.template != null ? String(prompt.template) : '';
  if (!template) throw new Error(`${context}: prompt row needs template_lines or template`);

  const geminiLines = prompt.gemini_output_lines;
  if (geminiLines != null && !Array.isArray(geminiLines)) {
    throw new TypeError(`${context}: gemini_output_lines must be an array`);
  }

  const pack = {
    preferredModel: String(prompt.preferred_model ?? 'gemini-3-flash-preview').trim(),
    template,
    geminiOutputJoin: Array.isArray(geminiLines) ? geminiLines.map(String).join('\n') : '',
    outputFormat: outputFormatFrom(prompt, context),
  };
  promptPacks.set(promptId, pack);
  return pack;
}

function effectiveInvocations(promptId: string, preferredModel: string): Invocation[] {
  const providers = loadProviderRows();
  const rows = readPromptInvocations()
    .filter((row) => row.prompt_id === promptId && row.invocation_id)
    .filter((row) => {
      if (row.enabled) return true;
      console.error(`Skipping invocation ${row.invocation_id}: prompt_invocation enabled is false.`);
      return false;
    })
    .sort((a, b) => a.sort_order - b.sort_order);

  if (!rows.length) {
    const fallback = providers.get('google_gemini') ?? {
      provider_id: 'google_gemini',
      api_base_url: PROVIDERS.google_gemini.defaultBaseUrl,
    };
    return [
      {
        id: `${promptId}_fallback_gemini`,
        primary: true,
        model: String(process.env.GEMINI_MODEL ?? '').trim() || preferredModel,
        provider: fallback,
      },
    ];
  }

  const invocations = rows.map((row) => {
    const provider = providers.get(row.provider_id);
    if (!provider) throw new Error(`prompt_invocation ${row.invocation_id}: unknown provider_id ${JSON.stringify(row.provider_id)}`);
    return {
      id: row.invocation_id,
      primary: row.primary_for_listing,
      model: row.model,
      provider,
    };
  });

  const primaryCount = invocations.filter((inv) => inv.primary).length;
  if (primaryCount !== 1) {
    throw new Error(`prompt_id ${JSON.stringify(promptId)} expected exactly one enabled primary invocation, got ${primaryCount}`);
  }
  return invocations;
}

function apiKeyFor(invocation: Invocation): string {
  return String(process.env[providerFor(invocation.provider.provider_id).apiKeyEnv] ?? '').trim();
}

function parseCommit(message: string | undefined): { raw: string; firstLine: string; meta: Meta } {
  const raw = message ?? '';
  const trimmed = raw.trim();
  if (!trimmed) return { raw, firstLine: '', meta: {} };
  const split = trimmed.indexOf('\n\n');
  if (split === -1) return { raw, firstLine: trimmed, meta: {} };
  try {
    return {
      raw,
      firstLine: trimmed.slice(0, split).trim(),
      meta: JSON.parse(trimmed.slice(split + 2).trim()) as Meta,
    };
  } catch {
    return { raw, firstLine: trimmed.slice(0, split).trim(), meta: {} };
  }
}

function buildPrompt(
  parsed: ReturnType<typeof parseCommit>,
  pack: PromptPack,
  includeGeminiOutputLines: boolean
): string {
  const meta = parsed.meta ?? {};

  let text = pack.template;
  if (includeGeminiOutputLines && pack.outputFormat === 'txt' && pack.geminiOutputJoin) {
    text = `${text}${pack.geminiOutputJoin.startsWith('\n') ? '' : '\n'}${pack.geminiOutputJoin}`;
  }
  return text
    .replaceAll('__FIRST_LINE__', parsed.firstLine || '(none)')
    .replaceAll('__META_JSON__', JSON.stringify(meta, null, 2))
    .replaceAll('__TARGET_JSON__', JSON.stringify(meta.targetPrice))
    .replaceAll('__NOTES_JSON__', JSON.stringify(meta.notes));
}

function guessMime(path: string): string {
  const byExt: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return byExt[extname(path).toLowerCase()] ?? 'image/jpeg';
}

function stampCatalogSchema(): Record<string, unknown> {
  if (cachedStampSchema) return cachedStampSchema;
  const stamp = JSON.parse(JSON.stringify(geminiFunctionRuntime.schemaDef('stamp'))) as Record<string, unknown>;
  stamp.additionalProperties = false;
  cachedStampSchema = {
    type: 'object',
    properties: {
      stamp: {
        type: 'array',
        description: 'Stamp catalog rows for this image (one per stamp).',
        minItems: 1,
        items: stamp,
      },
    },
    required: ['stamp'],
    additionalProperties: false,
  };
  return cachedStampSchema;
}

function geminiBaseConfig(model: string, outputFormat: OutputFormat): GenerateContentConfig {
  const config: GenerateContentConfig = model.toLowerCase().includes('gemini-3')
    ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } }
    : {};
  if (outputFormat === 'json') {
    config.responseMimeType = 'application/json';
    config.responseJsonSchema = stampCatalogSchema();
  }
  return config;
}

function geminiText(response: GenerateContentResponse): string {
  if (response.text) return response.text;
  const parts: string[] = [];
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.text) parts.push(part.text);
    }
  }
  return parts.join('\n');
}

function logToolResult(providerName: string, name: unknown, result: Record<string, unknown>): Record<string, unknown> {
  try {
    logConsoleBlock(
      `${providerName} function response ${String(name ?? '(unnamed)')} (full JSON)`,
      JSON.stringify(result, replacerForLog, 2)
    );
  } catch (e) {
    console.error(
      `${providerName} function response ${String(name ?? '(unnamed)')} [could not stringify: ${e instanceof Error ? e.message : String(e)}]`
    );
  }
  return result;
}

async function runGemini(ctx: ProviderContext): Promise<ProviderResult> {
  const ai = new GoogleGenAI({ apiKey: ctx.apiKey });
  const declarations = geminiFunctionRuntime.functionDeclarations();
  const excluded = new Set<string>();
  const contents: unknown[] = [
    {
      role: 'user',
      parts: [
        { inlineData: { mimeType: ctx.mime, data: ctx.image.toString('base64') } },
        { text: ctx.prompt },
      ],
    },
  ];

  const geminiConfig = (
    availableDeclarations: Record<string, unknown>[]
  ): GenerateContentConfig => {
    const disableFurtherFunctionCalls =
      availableDeclarations.length === 0 && declarations.length > 0;
    return {
      ...geminiBaseConfig(ctx.invocation.model, ctx.outputFormat),
      ...(availableDeclarations.length ? { tools: [{ functionDeclarations: availableDeclarations }] } : {}),
      ...(disableFurtherFunctionCalls
        ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } }
        : {}),
      httpOptions: { timeout: timeoutMs(ctx.image.length), headers: {} },
    } as GenerateContentConfig;
  };

  console.error(
    `[appraisal] Gemini invocation=${ctx.invocation.id} model=${ctx.invocation.model} mime=${ctx.mime} image_bytes=${ctx.image.length} (request JSON below shortens base64 fields)`
  );

  const initialConfig = geminiConfig(declarations);
  logJsonConsole(`[appraisal] Gemini generateContent REQUEST invocation=${ctx.invocation.id} round=0`, {
    model: ctx.invocation.model,
    config: initialConfig,
    contents,
  });

  let response = await ai.models.generateContent({
    model: ctx.invocation.model,
    contents: contents as never,
    config: initialConfig,
  });
  logJsonConsole(`[appraisal] Gemini generateContent RESPONSE invocation=${ctx.invocation.id} round=0`, response);
  appendGeminiUsageRound(ctx.tokenUsage, response);
  ctx.telemetry.turn_count++;

  /** True iff the request that produced the current `response` included non-empty `tools`. */
  let lastRequestOfferedFunctionDeclarations = declarations.length > 0;

  for (let round = 1; ; round += 1) {
    const calls = geminiFunctionRuntime.functionCalls(response);
    if (!calls.length) {
      const out = geminiText(response);
      logConsoleBlock(`[appraisal] Gemini FINAL MODEL TEXT invocation=${ctx.invocation.id}`, out);
      return { text: out };
    }
    if (!lastRequestOfferedFunctionDeclarations) {
      throw new Error(
        `Gemini returned function calls after function calling was disabled (functionCallingConfig NONE; no remaining tools). Calls: ${calls
          .map((c) => String(c.name ?? '(unnamed)'))
          .join(', ')}`
      );
    }

    logJsonConsole(
      `[appraisal] Gemini FUNCTION CALL REQUESTS invocation=${ctx.invocation.id} tool_round=${round}`,
      calls.map((c) => ({ name: c.name, args: c.args ?? {} }))
    );
    contents.push({
      role: 'model',
      parts:
        geminiFunctionRuntime.functionCallModelPartsForReplay(response) ??
        calls.map((call) => ({ functionCall: { name: call.name, args: call.args ?? {} } })),
    });
    contents.push({
      role: 'user',
      parts: calls.map((call) => ({
        functionResponse: {
          name: call.name,
          response: logToolResult('Gemini', call.name, geminiFunctionRuntime.executeFunctionCall(call)),
        },
      })),
    });

    for (const call of calls) {
      const name = String(call.name ?? '').trim();
      if (name) {
        excluded.add(name);
        ctx.telemetry.function_calls.push(name);
      }
    }
    const declarationsForNext = declarations.filter((decl) => !excluded.has(String(decl.name ?? '').trim()));
    lastRequestOfferedFunctionDeclarations = declarationsForNext.length > 0;
    const followConfig = geminiConfig(declarationsForNext);
    logJsonConsole(`[appraisal] Gemini generateContent REQUEST invocation=${ctx.invocation.id} tool_round=${round}`, {
      model: ctx.invocation.model,
      config: followConfig,
      contents,
    });
    response = await ai.models.generateContent({
      model: ctx.invocation.model,
      contents: contents as never,
      config: followConfig,
    });
    logJsonConsole(`[appraisal] Gemini generateContent RESPONSE invocation=${ctx.invocation.id} tool_round=${round}`, response);
    appendGeminiUsageRound(ctx.tokenUsage, response);
    ctx.telemetry.turn_count++;
  }
}

function openRouterSchema(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(openRouterSchema);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      key === 'type' && typeof child === 'string' ? child.toLowerCase() : openRouterSchema(child),
    ])
  );
}

function openRouterTools(declarations: Record<string, unknown>[]): Record<string, unknown>[] {
  const tools: Record<string, unknown>[] = [];
  for (const decl of declarations) {
    const name = String(decl.name ?? '').trim();
    if (!name) continue;
    const fn: Record<string, unknown> = { name, parameters: openRouterSchema(decl.parameters) };
    const description = String(decl.description ?? '').trim();
    if (description) fn.description = description;
    tools.push({ type: 'function', function: fn });
  }
  return tools;
}

function messageText(message: Record<string, unknown> | undefined): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (rowObject(part) && 'text' in (part as Record<string, unknown>) ? String((part as { text?: unknown }).text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

function firstMessage(response: Record<string, unknown>): Record<string, unknown> | undefined {
  const choices = response.choices;
  if (!Array.isArray(choices)) return undefined;
  return rowObject(rowObject(choices[0])?.message);
}

type OpenRouterCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  raw: Record<string, unknown>;
};

function parseToolArgs(rawArgs: unknown, name: string): Record<string, unknown> {
  if (rowObject(rawArgs)) return rawArgs as Record<string, unknown>;
  if (typeof rawArgs !== 'string' || !rawArgs.trim()) return {};
  try {
    const parsed = JSON.parse(rawArgs) as unknown;
    return rowObject(parsed) ?? {};
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { __parse_error: `Invalid JSON arguments for ${name}: ${msg}`, __raw_arguments: rawArgs };
  }
}

function openRouterCalls(message: Record<string, unknown> | undefined): OpenRouterCall[] {
  const rawCalls = message?.tool_calls;
  if (!Array.isArray(rawCalls)) return [];
  return rawCalls.flatMap((raw, index) => {
    const call = rowObject(raw);
    const fn = rowObject(call?.function);
    const name = String(fn?.name ?? '').trim();
    if (!call || !fn || !name) return [];
    return [{
      id: String(call.id ?? '').trim() || `call_${index + 1}`,
      name,
      args: parseToolArgs(fn.arguments, name),
      raw: call,
    }];
  });
}

async function postJson(url: string, headers: Record<string, string>, body: Record<string, unknown>, timeout: number): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const raw = await res.text();
  if (!res.ok) {
    logConsoleBlock(`[appraisal] OpenRouter HTTP ${res.status} FULL raw response body`, raw);
    throw new Error(`OpenRouter HTTP ${res.status}: ${raw.slice(0, 500)}`);
  }
  const parsed = JSON.parse(raw) as unknown;
  const object = rowObject(parsed);
  if (!object) throw new Error('OpenRouter response is not a JSON object');
  return object;
}

async function runOpenRouter(ctx: ProviderContext): Promise<ProviderResult> {
  const baseUrl = (ctx.invocation.provider.api_base_url || PROVIDERS.openrouter.defaultBaseUrl).replace(/\/$/, '');
  const declarations = geminiFunctionRuntime.functionDeclarations();
  const excluded = new Set<string>();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ctx.apiKey}`,
    'Content-Type': 'application/json',
  };
  const referer = String(process.env.OPENROUTER_HTTP_REFERER ?? '').trim();
  const title = String(process.env.OPENROUTER_TITLE ?? '').trim();
  if (referer) headers['HTTP-Referer'] = referer;
  if (title) headers['X-OpenRouter-Title'] = title;

  const messages: Record<string, unknown>[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: ctx.prompt },
        { type: 'image_url', image_url: { url: `data:${ctx.mime};base64,${ctx.image.toString('base64')}` } },
      ],
    },
  ];
  const body: Record<string, unknown> = { model: ctx.invocation.model, messages };
  const applyTools = () => {
    const tools = openRouterTools(declarations.filter((decl) => !excluded.has(String(decl.name ?? '').trim())));
    if (tools.length) body.tools = tools;
    else delete body.tools;
  };
  applyTools();
  if (ctx.outputFormat === 'json') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'philatelister_stamps', strict: false, schema: stampCatalogSchema() },
    };
  }

  console.error(
    `[appraisal] OpenRouter invocation=${ctx.invocation.id} model=${ctx.invocation.model} (request JSON below shortens data URLs)`
  );
  logJsonConsole(`[appraisal] OpenRouter chat/completions REQUEST invocation=${ctx.invocation.id} round=0`, body);

  let response = await postJson(`${baseUrl}/chat/completions`, headers, body, timeoutMs(ctx.image.length));
  logJsonConsole(`[appraisal] OpenRouter chat/completions RESPONSE invocation=${ctx.invocation.id} round=0`, response);
  appendOpenRouterUsageRound(ctx.tokenUsage, response);
  ctx.telemetry.turn_count++;
  for (let round = 1; ; round += 1) {
    const message = firstMessage(response);
    const calls = openRouterCalls(message);
    if (!calls.length) {
      const text = messageText(message);
      if (!text) throw new Error('OpenRouter response missing message content');
      logConsoleBlock(`[appraisal] OpenRouter FINAL MODEL TEXT invocation=${ctx.invocation.id}`, text);
      return { text, servedModel: typeof response.model === 'string' && response.model.trim() ? response.model.trim() : ctx.invocation.model };
    }

    logJsonConsole(`[appraisal] OpenRouter assistant message (full) invocation=${ctx.invocation.id} tool_round=${round}`, message);
    logJsonConsole(
      `[appraisal] OpenRouter FUNCTION CALL REQUESTS invocation=${ctx.invocation.id} tool_round=${round}`,
      calls.map((c) => ({ id: c.id, name: c.name, args: c.args, raw_tool_call: c.raw }))
    );
    messages.push({ role: 'assistant', content: message?.content ?? null, tool_calls: calls.map((c) => c.raw) });
    for (const call of calls) {
      const payload = call.args.__parse_error
        ? logToolResult('OpenRouter', call.name, {
            success: false,
            retryable: false,
            final: true,
            error: String(call.args.__parse_error),
          })
        : logToolResult('OpenRouter', call.name, geminiFunctionRuntime.executeFunctionCall({ name: call.name, args: call.args }));
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify(payload) });
      excluded.add(call.name);
      ctx.telemetry.function_calls.push(call.name);
    }
    applyTools();
    logJsonConsole(`[appraisal] OpenRouter chat/completions REQUEST invocation=${ctx.invocation.id} tool_round=${round}`, body);
    response = await postJson(`${baseUrl}/chat/completions`, headers, body, timeoutMs(ctx.image.length));
    logJsonConsole(`[appraisal] OpenRouter chat/completions RESPONSE invocation=${ctx.invocation.id} tool_round=${round}`, response);
    appendOpenRouterUsageRound(ctx.tokenUsage, response);
    ctx.telemetry.turn_count++;
  }
}

async function runInvocation(
  invocation: Invocation,
  promptId: string,
  prompt: string,
  image: Buffer,
  mime: string,
  outputFormat: OutputFormat
): Promise<{ invocationId: string; text: string; error?: string; servedModel?: string }> {
  const provider = providerFor(invocation.provider.provider_id);
  const telemetry = emptyInvocationTelemetry();
  const tokenUsage = createTokenUsageCollector();
  let text = '';
  let servedModel: string | undefined;
  let clientKind = provider.id;
  let status: 'ok' | 'error' = 'ok';
  let errorMessage: string | undefined;
  try {
    debug('run invocation=%s provider=%s model=%s imageBytes=%d promptChars=%d', invocation.id, provider.id, invocation.model, image.length, prompt.length);
    logConsoleBlock(
      `[appraisal] FULL USER PROMPT invocation=${invocation.id} prompt_id=${promptId} provider=${provider.id}`,
      prompt
    );
    console.error(
      `[appraisal] runInvocation image mime=${mime} bytes=${image.length} invocation=${invocation.id} (image body in provider request logs)`
    );
    const apiKey = apiKeyFor(invocation);
    if (!apiKey) throw new Error(`${provider.apiKeyEnv} not set`);
    const result = await provider.run({
      invocation,
      apiKey,
      prompt,
      image,
      mime,
      outputFormat,
      telemetry,
      tokenUsage,
    });
    text = result.text;
    servedModel = result.servedModel;
  } catch (e) {
    status = 'error';
    errorMessage = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      recordInvocationStatsEvent({
        prompt_id: promptId,
        invocation_id: invocation.id,
        provider_id: invocation.provider.provider_id,
        requested_model: invocation.model,
        actual_model: servedModel,
        status,
        char_counts: { in: prompt.length, out: status === 'ok' ? text.length : 0 },
        telemetry,
        error_message: errorMessage,
      });
    } catch (statsErr) {
      console.error(
        `Warning: could not update invocation_stats.json (${statsErr instanceof Error ? statsErr.message : String(statsErr)})`
      );
    }
    try {
      writeInvocationEventFile({
        repoRoot,
        promptId,
        invocationId: invocation.id,
        providerId: invocation.provider.provider_id,
        requestedModel: invocation.model,
        actualModel: servedModel,
        clientKind,
        charCountsIn: prompt.length,
        telemetry,
        tokens: tokenUsage,
        status,
        errorMessage,
        outputText: status === 'ok' ? text : undefined,
      });
    } catch (writeErr) {
      console.error(
        `Warning: could not write invocation event (${writeErr instanceof Error ? writeErr.message : String(writeErr)})`
      );
    }
  }
  if (status === 'error') {
    return { invocationId: invocation.id, text: '', error: errorMessage ?? 'error' };
  }
  return { invocationId: invocation.id, text, servedModel };
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  if (lines[0]?.startsWith('```')) lines.shift();
  if (lines.at(-1)?.trim() === '```') lines.pop();
  return lines.join('\n').trim();
}

function safeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function writeListing(
  imageBase: string,
  format: OutputFormat,
  text: string,
  invocation: Invocation,
  servedModel?: string
): string {
  const listingsDir = join(process.cwd(), 'listings');
  mkdirSync(listingsDir, { recursive: true });
  const ext = format === 'json' ? 'json' : 'txt';
  const openRouterSuffix =
    providerFor(invocation.provider.provider_id).id === 'openrouter'
      ? `__${safeToken((servedModel || invocation.model).trim())}`
      : '';
  const invocationSuffix = invocation.primary ? '' : `__${safeToken(invocation.id)}`;
  const outPath = join(listingsDir, `${imageBase}${invocationSuffix}${openRouterSuffix}.${ext}`);

  if (format === 'json') {
    const body = stripJsonFence(text);
    try {
      writeFileSync(outPath, `${JSON.stringify(JSON.parse(body) as unknown, null, 2)}\n`, 'utf-8');
    } catch (e) {
      console.error(`Warning: ${basename(outPath)} is not valid JSON (${e instanceof Error ? e.message : String(e)}); writing raw text.`);
      writeFileSync(outPath, body, 'utf-8');
    }
  } else {
    writeFileSync(outPath, text, 'utf-8');
  }
  return outPath;
}

function listingOutputBase(name: string): string {
  const stem = basename(name.trim(), extname(name.trim()));
  if (!stem || stem === '.' || stem === '..') {
    throw new Error(`Invalid listing basename: ${JSON.stringify(name)}`);
  }
  return stem;
}

function parseArgs(): { imagePath: string; commitMessage: string; listingBasename?: string } {
  const positional: string[] = [];
  let commitMessage = process.env.COMMIT_MESSAGE ?? '';
  let listingBasename = process.env.LISTING_BASENAME?.trim() || undefined;
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === '--commit-message' && process.argv[i + 1]) commitMessage = process.argv[++i];
    else if (arg === '--listing-basename' && process.argv[i + 1]) listingBasename = process.argv[++i];
    else if (!arg.startsWith('-')) positional.push(arg);
  }
  return { imagePath: positional[0] ?? '', commitMessage, listingBasename };
}

async function main(
  imagePath: string,
  commitMessage: string | undefined,
  listingBasename?: string
): Promise<void> {
  const absImage = join(process.cwd(), imagePath);
  if (!existsSync(absImage)) throw new Error(`File ${imagePath} not found.`);

  const parsed = parseCommit(commitMessage);
  const promptId = promptIdFrom(parsed.meta);
  const pack = loadPromptPack(promptId);
  const image = readFileSync(absImage);
  const mime = guessMime(imagePath);
  const outputBase = listingBasename
    ? listingOutputBase(listingBasename)
    : listingOutputBase(imagePath);

  const invocations = effectiveInvocations(promptId, pack.preferredModel).filter((invocation) => {
    const provider = providerFor(invocation.provider.provider_id);
    if (apiKeyFor(invocation)) return true;
    console.error(`Skipping invocation ${invocation.id} (${provider.id}): missing API key ${provider.apiKeyEnv}.`);
    return false;
  });
  if (!invocations.length) throw new Error('No invocations could run; set GEMINI_API_KEY and/or OPENROUTER_API_KEY.');
  const primaryCount = invocations.filter((invocation) => invocation.primary).length;
  if (primaryCount !== 1) throw new Error(`After API-key filtering, expected exactly one primary invocation, got ${primaryCount}.`);

  const prompts = new Map<boolean, string>();
  const promptFor = (spec: ProviderSpec): string => {
    const key = spec.includeGeminiOutputLines;
    const cached = prompts.get(key);
    if (cached) return cached;
    const prompt = buildPrompt(parsed, pack, key);
    prompts.set(key, prompt);
    return prompt;
  };

  const results = await Promise.all(
    invocations.map((invocation) => {
      const provider = providerFor(invocation.provider.provider_id);
      return runInvocation(invocation, promptId, promptFor(provider), image, mime, pack.outputFormat);
    })
  );
  const successful = results.filter((result) => !result.error && result.text.trim());
  if (!successful.length) {
    for (const result of results) console.error(`Invocation ${result.invocationId} failed: ${result.error ?? 'empty response'}`);
    process.exit(1);
  }

  for (const invocation of invocations) {
    const result = results.find((r) => r.invocationId === invocation.id);
    if (!result || result.error || !result.text.trim()) continue;
    const out = writeListing(outputBase, pack.outputFormat, result.text, invocation, result.servedModel);
    const modelNote = result.servedModel && result.servedModel !== invocation.model ? `${invocation.model} -> ${result.servedModel}` : invocation.model;
    console.log(`Written: ${out} (${invocation.id}, ${invocation.provider.provider_id}, ${modelNote})`);
  }
  for (const result of results.filter((r) => r.error || !r.text.trim())) {
    console.error(`Warning: invocation ${result.invocationId} failed: ${result.error ?? 'empty response'}`);
  }
}

const { imagePath, commitMessage, listingBasename } = parseArgs();
if (!imagePath) {
  console.error('Usage: node appraisal.cjs <image_path> [--commit-message TEXT] [--listing-basename STEM]');
  console.error('Env: GEMINI_API_KEY, OPENROUTER_API_KEY, optional OPENROUTER_HTTP_REFERER, OPENROUTER_TITLE, LISTING_BASENAME.');
  process.exit(1);
}

void main(imagePath, commitMessage, listingBasename).catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
