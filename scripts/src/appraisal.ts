/**
 * Stamp listing / xFrame catalog JSON from a local image (Gemini, OpenRouter, parallel invocations).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import process from 'node:process';
import { debuglog } from 'node:util';
import {
  GoogleGenAI,
  type GenerateContentConfig,
  type GenerateContentResponse,
  ThinkingLevel,
} from '@google/genai';
import { XFrameGeminiFunctionRuntime, type EntityStore } from './xframe-gemini-functions.js';

/** Repository root: GitHub Actions and `node scripts/dist/appraisal.cjs` use repo cwd; `npm run appraisal` uses `cd ..` first. */
const repoRoot = process.cwd();

const CONSOLIDATED_SCHEMA_PATH = join(repoRoot, 'xframe', 'output', 'consolidated.schema.json');
/** Single source for prompts, providers, prompt_invocation (no xframe/data/*.json reads). */
const CONSOLIDATED_DATA_PATH = join(repoRoot, 'xframe', 'output', 'consolidated_data.json');

const debugAppraisal = debuglog('appraisal');

/** Vision on large inline images can exceed default client limits; allow longer than the default window. */
const LARGE_IMAGE_BYTES = 1024 * 1024;
/** Every appraisal HTTP call gets a bounded wait so CI does not hang on a stuck or very slow upstream. */
const AI_TIMEOUT_DEFAULT_MS = 1 * 60 * 1000;
/** Same ceiling as before this file had a default for small payloads (>1 MiB inline vision). */
const AI_TIMEOUT_LARGE_IMAGE_MS = 2 * 60 * 1000;

const PROMPT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;

function aiHttpTimeoutMsForImage(imageBytes: number): number {
  if (imageBytes > LARGE_IMAGE_BYTES) return AI_TIMEOUT_LARGE_IMAGE_MS;
  return AI_TIMEOUT_DEFAULT_MS;
}

type ListingOutputFormat = 'json' | 'txt';

type Meta = Record<string, unknown>;

type ProviderKind = 'google_gemini' | 'openrouter';

type ProviderRow = {
  provider_id: string;
  api_base_url: string;
};

/** Appraisal client is implied by provider_id (not stored on the row). */
function clientKindForProviderId(providerId: string): ProviderKind {
  const id = providerId.toLowerCase();
  if (id === 'google_gemini') return 'google_gemini';
  if (id === 'openrouter') return 'openrouter';
  throw new Error(
    `Unknown provider_id ${JSON.stringify(providerId)}; appraisal supports google_gemini and openrouter.`
  );
}

type PromptInvocationRow = {
  invocation_id: string;
  prompt_id: string;
  provider_id: string;
  model: string;
  sort_order: number;
  primary_for_listing: boolean;
};

type EffectiveInvocation = {
  invocationId: string;
  primary: boolean;
  model: string;
  provider: ProviderRow;
};

const promptPackCache = new Map<
  string,
  { preferredModel: string; template: string; geminiOutputJoin: string; outputFormat: ListingOutputFormat }
>();

let providersCache: Map<string, ProviderRow> | null = null;
let invocationsCache: PromptInvocationRow[] | null = null;
let consolidatedDataRoot: ConsolidatedDataRoot | null = null;

type ConsolidatedDataRoot = {
  data?: EntityStore;
};

function loadConsolidatedDataRoot(): ConsolidatedDataRoot {
  if (consolidatedDataRoot) return consolidatedDataRoot;
  if (!existsSync(CONSOLIDATED_DATA_PATH)) {
    throw new Error(
      `Missing ${CONSOLIDATED_DATA_PATH}; run the xFrame consolidator with --working-dir pointing at this repo's xframe/ directory first.`
    );
  }
  const st = statSync(CONSOLIDATED_DATA_PATH);
  debugAppraisal(
    'load consolidated_data path=%s mtime=%s size=%d',
    CONSOLIDATED_DATA_PATH,
    st.mtime.toISOString(),
    st.size
  );
  try {
    consolidatedDataRoot = JSON.parse(readFileSync(CONSOLIDATED_DATA_PATH, 'utf-8')) as ConsolidatedDataRoot;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid JSON in ${CONSOLIDATED_DATA_PATH}: ${msg}`);
  }
  return consolidatedDataRoot;
}

function getEntityStore(): EntityStore {
  const root = loadConsolidatedDataRoot();
  const d = root.data;
  if (!d || typeof d !== 'object') {
    throw new Error(`${CONSOLIDATED_DATA_PATH} missing top-level "data" object`);
  }
  return d;
}

function parseOutputFormat(row: Record<string, unknown>, promptPath: string): ListingOutputFormat {
  const raw = row.output_format;
  if (raw === undefined || raw === null) {
    return 'txt';
  }
  const s = String(raw).trim().toLowerCase();
  if (s === 'json') return 'json';
  if (s === 'txt') return 'txt';
  throw new Error(`${promptPath}: output_format must be "json" or "txt", got ${JSON.stringify(raw)}`);
}

function loadProvidersMap(): Map<string, ProviderRow> {
  if (providersCache) {
    debugAppraisal('loadProvidersMap cache hit count=%d ids=%s', providersCache.size, [...providersCache.keys()].join(', '));
    return providersCache;
  }
  const map = new Map<string, ProviderRow>();
  const store = getEntityStore();
  const bucket = store.provider;
  if (!bucket || typeof bucket !== 'object') {
    debugAppraisal('loadProvidersMap no provider bucket in consolidated data');
    providersCache = map;
    return map;
  }
  const skippedUnsupported: string[] = [];
  for (const row of Object.values(bucket)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const id = String(r.provider_id ?? '').trim();
    if (!id) continue;
    try {
      clientKindForProviderId(id);
    } catch {
      skippedUnsupported.push(id);
      continue;
    }
    map.set(id, {
      provider_id: id,
      api_base_url: String(r.api_base_url ?? '').trim(),
    });
  }
  debugAppraisal(
    'loadProvidersMap loaded count=%d ids=%s skipped_unsupported=%s',
    map.size,
    [...map.keys()].join(', '),
    skippedUnsupported.length ? skippedUnsupported.join(', ') : '(none)'
  );
  providersCache = map;
  return map;
}

function loadPromptInvocations(): PromptInvocationRow[] {
  if (invocationsCache) return invocationsCache;
  const store = getEntityStore();
  const bucket = store.prompt_invocation;
  if (!bucket || typeof bucket !== 'object') {
    invocationsCache = [];
    return invocationsCache;
  }
  const out: PromptInvocationRow[] = [];
  for (const row of Object.values(bucket)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    out.push({
      invocation_id: String(r.invocation_id ?? '').trim(),
      prompt_id: String(r.prompt_id ?? '').trim(),
      provider_id: String(r.provider_id ?? '').trim(),
      model: String(r.model ?? '').trim(),
      sort_order: typeof r.sort_order === 'number' ? r.sort_order : Number(r.sort_order) || 0,
      primary_for_listing: Boolean(r.primary_for_listing),
    });
  }
  invocationsCache = out;
  return invocationsCache;
}

function getEffectiveInvocations(promptId: string, preferredModel: string): EffectiveInvocation[] {
  const providers = loadProvidersMap();
  const rows = loadPromptInvocations()
    .filter((r) => r.prompt_id === promptId && r.invocation_id)
    .sort((a, b) => a.sort_order - b.sort_order);

  if (rows.length === 0) {
    const gem = providers.get('google_gemini');
    const model = (process.env.GEMINI_MODEL ?? '').trim() || preferredModel;
    if (!gem) {
      return [
        {
          invocationId: `${promptId}_fallback_gemini`,
          primary: true,
          model,
          provider: {
            provider_id: 'google_gemini',
            api_base_url: 'https://generativelanguage.googleapis.com/v1beta',
          },
        },
      ];
    }
    return [
      {
        invocationId: `${promptId}_fallback_gemini`,
        primary: true,
        model,
        provider: gem,
      },
    ];
  }

  const effective: EffectiveInvocation[] = [];
  for (const r of rows) {
    const p = providers.get(r.provider_id);
    if (!p) {
      throw new Error(`prompt_invocation ${r.invocation_id}: unknown provider_id ${JSON.stringify(r.provider_id)}`);
    }
    effective.push({
      invocationId: r.invocation_id,
      primary: r.primary_for_listing,
      model: r.model,
      provider: p,
    });
  }

  const primaries = effective.filter((e) => e.primary);
  if (primaries.length !== 1) {
    throw new Error(
      `prompt_invocation for prompt_id ${JSON.stringify(promptId)}: expected exactly one primary_for_listing true, got ${primaries.length}`
    );
  }
  return effective;
}

function invocationHasRequiredApiKey(inv: EffectiveInvocation): boolean {
  const kind = clientKindForProviderId(inv.provider.provider_id);
  if (kind === 'google_gemini') {
    return Boolean(String(process.env.GEMINI_API_KEY ?? '').trim());
  }
  if (kind === 'openrouter') {
    return Boolean(String(process.env.OPENROUTER_API_KEY ?? '').trim());
  }
  return false;
}

function promptIdFromMeta(meta: Meta): string {
  const raw = String(meta.prompt ?? '').trim();
  if (!raw) return 'stamp_listing';
  if (!PROMPT_ID_RE.test(raw)) {
    throw new Error(`Invalid prompt id in commit metadata: ${JSON.stringify(raw)}`);
  }
  return raw;
}

function loadPromptPack(promptBasename: string): {
  preferredModel: string;
  template: string;
  geminiOutputJoin: string;
  outputFormat: ListingOutputFormat;
} {
  const hit = promptPackCache.get(promptBasename);
  if (hit) return hit;

  if (!PROMPT_ID_RE.test(promptBasename)) {
    throw new Error(`Invalid prompt id: ${JSON.stringify(promptBasename)}`);
  }
  const store = getEntityStore();
  const promptBucket = store.prompt;
  if (!promptBucket || typeof promptBucket !== 'object') {
    throw new Error(`${CONSOLIDATED_DATA_PATH} missing data.prompt`);
  }
  const data = promptBucket[promptBasename] as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      `${CONSOLIDATED_DATA_PATH} has no prompt row with prompt_id ${JSON.stringify(promptBasename)} (re-run xFrame consolidate).`
    );
  }
  const ctx = `${CONSOLIDATED_DATA_PATH} prompt ${promptBasename}`;
  const model = String(data.preferred_model ?? 'gemini-3-flash-preview').trim();
  const outputFormat = parseOutputFormat(data, ctx);
  let template: string;
  if ('template_lines' in data) {
    const lines = data.template_lines;
    if (!Array.isArray(lines)) {
      throw new TypeError('template_lines must be a JSON array of strings');
    }
    template = lines.map((line) => String(line)).join('\n');
  } else if ('template' in data && data.template != null) {
    template = String(data.template);
  } else {
    throw new Error(`${ctx}: prompt row needs template_lines or template`);
  }
  let geminiOutputJoin = '';
  if (data.gemini_output_lines != null) {
    const gl = data.gemini_output_lines;
    if (!Array.isArray(gl)) {
      throw new TypeError(`${ctx}: gemini_output_lines must be a JSON array of strings`);
    }
    geminiOutputJoin = gl.map((line) => String(line)).join('\n');
  }
  const pack = { preferredModel: model, template, geminiOutputJoin, outputFormat };
  promptPackCache.set(promptBasename, pack);
  return pack;
}

function generateConfigForModel(model: string): GenerateContentConfig | undefined {
  if (!model.toLowerCase().includes('gemini-3')) return undefined;
  return {
    thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
  };
}

function parsePhilatelisterCommit(message: string | undefined): {
  raw: string;
  firstLine: string;
  meta: Meta;
} {
  const raw = (message ?? '').trim();
  const out = { raw: message ?? '', firstLine: '', meta: {} as Meta };
  if (!raw) return out;
  const sep = raw.indexOf('\n\n');
  if (sep !== -1) {
    out.firstLine = raw.slice(0, sep).trim();
    try {
      out.meta = JSON.parse(raw.slice(sep + 2).trim()) as Meta;
    } catch {
      out.meta = {};
    }
  } else {
    out.firstLine = raw;
  }
  return out;
}

function fileMismatchGap(imageBasename: string, meta: Meta): string {
  const fileMeta = meta.file;
  if (typeof fileMeta === 'string' && fileMeta && fileMeta !== imageBasename) {
    return `\nNote: Commit metadata file field is ${JSON.stringify(fileMeta)} but this run is for ${JSON.stringify(imageBasename)}; still apply target price and notes if they are relevant.\n`;
  }
  return '\n';
}

let cachedStampCatalogResponseJsonSchema: Record<string, unknown> | null = null;
const geminiFunctionRuntime = new XFrameGeminiFunctionRuntime({
  consolidatedSchemaPath: CONSOLIDATED_SCHEMA_PATH,
  getEntityStore,
  providerId: 'google_gemini',
  functionCallEntity: 'gemini_function_call',
  functionParameterEntity: 'gemini_function_parameter',
});

/**
 * Shared JSON Schema root for catalog JSON: `{ "stamp": [ …$defs.stamp… ] }`.
 * Used for OpenRouter `response_format` and Gemini `responseMimeType` + `responseJsonSchema`
 * (https://ai.google.dev/gemini-api/docs/structured-output).
 */
function stampCatalogResponseJsonSchema(): Record<string, unknown> {
  if (cachedStampCatalogResponseJsonSchema) return cachedStampCatalogResponseJsonSchema;
  const stampSchema = JSON.parse(JSON.stringify(geminiFunctionRuntime.schemaDef('stamp'))) as Record<string, unknown>;
  stampSchema.additionalProperties = false;
  const root: Record<string, unknown> = {
    type: 'object',
    properties: {
      stamp: {
        type: 'array',
        description: 'Stamp catalog rows for this image (one per stamp).',
        minItems: 1,
        items: stampSchema,
      },
    },
    required: ['stamp'],
    additionalProperties: false,
  };
  cachedStampCatalogResponseJsonSchema = root;
  return root;
}

function buildGeminiGenerateConfig(model: string, outputFormat: ListingOutputFormat): GenerateContentConfig {
  const base = generateConfigForModel(model) ?? {};
  if (outputFormat !== 'json') return base;
  return {
    ...base,
    responseMimeType: 'application/json',
    responseJsonSchema: stampCatalogResponseJsonSchema(),
  };
}

/**
 * @param forGemini Appends gemini_output_lines only for txt prompts (json uses API structured output for both Gemini and OpenRouter).
 */
function buildUserPromptText(
  imageBasename: string,
  parsed: ReturnType<typeof parsePhilatelisterCommit>,
  forGemini: boolean,
  outputFormat: ListingOutputFormat
): string {
  const meta = parsed.meta ?? {};
  const promptId = promptIdFromMeta(meta);
  const { template: tmpl, geminiOutputJoin } = loadPromptPack(promptId);
  const firstLine = parsed.firstLine || '';
  const metaJson = JSON.stringify(meta, null, 2);
  const target = meta.targetPrice;
  const notes = meta.notes;
  const gap = fileMismatchGap(imageBasename, meta);
  const firstDisplay = firstLine || '(none)';
  const stampSuggestedId = basename(imageBasename, extname(imageBasename));

  let text = tmpl;
  if (forGemini && outputFormat === 'txt' && geminiOutputJoin) {
    text = `${tmpl}${geminiOutputJoin.startsWith('\n') ? '' : '\n'}${geminiOutputJoin}`;
  }
  text = text.replaceAll('__IMAGE_BASENAME__', imageBasename);
  text = text.replaceAll('__FILE_MISMATCH_GAP__', gap);
  text = text.replaceAll('__FIRST_LINE__', firstDisplay);
  text = text.replaceAll('__META_JSON__', metaJson);
  text = text.replaceAll('__TARGET_JSON__', JSON.stringify(target));
  text = text.replaceAll('__NOTES_JSON__', JSON.stringify(notes));
  text = text.replaceAll('__STAMP_SUGGESTED_ID__', stampSuggestedId);
  return text;
}

function guessMime(fileName: string): string {
  const lower = fileName.toLowerCase();
  const ext = extname(lower);
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return map[ext] ?? 'image/jpeg';
}

function stripMarkdownJsonFence(text: string): string {
  const t = text.trim();
  if (!t.startsWith('```')) return t;
  const lines = t.split('\n');
  if (lines.length && lines[0].startsWith('```')) lines.shift();
  if (lines.length && lines[lines.length - 1].trim() === '```') lines.pop();
  return lines.join('\n').trim();
}

function responseText(response: GenerateContentResponse): string {
  const t = response.text;
  if (t) return t;
  const parts: string[] = [];
  const candidates = response.candidates;
  if (!candidates) return '';
  for (const c of candidates) {
    const content = c.content;
    if (!content?.parts) continue;
    for (const p of content.parts) {
      if (p.text) parts.push(p.text);
    }
  }
  return parts.join('\n');
}

function logGeminiFunctionResult(name: unknown, response: Record<string, unknown>): Record<string, unknown> {
  const matchCount = typeof response.match_count === 'number' ? ` match_count=${response.match_count}` : '';
  const ok = typeof response.ok === 'boolean' ? ` ok=${response.ok}` : '';
  const error = typeof response.error === 'string' ? ` error=${JSON.stringify(response.error)}` : '';
  console.error(`Gemini function response ${String(name ?? '(unnamed)')}:${ok}${matchCount}${error}`);
  return response;
}

async function runGeminiInvocation(
  model: string,
  apiKey: string,
  userPrompt: string,
  imgBytes: Buffer,
  mime: string,
  outputFormat: ListingOutputFormat
): Promise<string> {
  const baseConfig = buildGeminiGenerateConfig(model, outputFormat);
  const timeoutMs = aiHttpTimeoutMsForImage(imgBytes.length);
  const functionDeclarations = geminiFunctionRuntime.functionDeclarations();
  const config: GenerateContentConfig = {
    ...baseConfig,
    ...(functionDeclarations.length ? { tools: [{ functionDeclarations }] } : {}),
    httpOptions: { timeout: timeoutMs, headers: {} },
  } as GenerateContentConfig;
  const ai = new GoogleGenAI({ apiKey });
  const contents: unknown[] = [
    {
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: mime,
            data: imgBytes.toString('base64'),
          },
        },
        { text: userPrompt },
      ],
    },
  ];

  let response = await ai.models.generateContent({
    model,
    contents: contents as never,
    config,
  });

  for (let turn = 0; turn < 4; turn += 1) {
    const calls = geminiFunctionRuntime.functionCalls(response);
    if (calls.length === 0) return responseText(response);
    console.error(
      `Gemini requested ${calls.length} function call${calls.length === 1 ? '' : 's'} on turn ${turn + 1}: ${calls
        .map((call) => String(call.name ?? '(unnamed)'))
        .join(', ')}`
    );

    const replayModelParts = geminiFunctionRuntime.functionCallModelPartsForReplay(response);
    contents.push({
      role: 'model',
      parts:
        replayModelParts ??
        (calls.map((call) => ({
          functionCall: {
            name: call.name,
            args: call.args ?? {},
          },
        })) as unknown[]),
    });
    contents.push({
      role: 'user',
      parts: calls.map((call) => ({
        functionResponse: {
          name: call.name,
          response: logGeminiFunctionResult(call.name, geminiFunctionRuntime.executeFunctionCall(call)),
        },
      })),
    });
    response = await ai.models.generateContent({
      model,
      contents: contents as never,
      config,
    });
  }
  return responseText(response);
}

function openRouterMessageContent(text: string, dataUrl: string): unknown[] {
  return [
    { type: 'text', text },
    { type: 'image_url', image_url: { url: dataUrl } },
  ];
}

async function runOpenRouterInvocation(
  baseUrl: string,
  apiKey: string,
  model: string,
  userPrompt: string,
  imgBytes: Buffer,
  mime: string,
  outputFormat: ListingOutputFormat
): Promise<string> {
  const root = baseUrl.replace(/\/$/, '');
  const url = `${root}/chat/completions`;
  const dataUrl = `data:${mime};base64,${imgBytes.toString('base64')}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const referer = String(process.env.OPENROUTER_HTTP_REFERER ?? '').trim();
  const title = String(process.env.OPENROUTER_TITLE ?? '').trim();
  if (referer) headers['HTTP-Referer'] = referer;
  if (title) headers['X-OpenRouter-Title'] = title;

  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'user',
        content: openRouterMessageContent(userPrompt, dataUrl),
      },
    ],
  };

  if (outputFormat === 'json') {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'philatelister_stamps',
        strict: false,
        schema: stampCatalogResponseJsonSchema(),
      },
    };
  }

  const timeoutMs = aiHttpTimeoutMsForImage(imgBytes.length);
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status}: ${raw.slice(0, 500)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('OpenRouter response is not JSON');
  }
  const o = json as Record<string, unknown>;
  const choices = o.choices as unknown[] | undefined;
  const c0 = choices?.[0] as Record<string, unknown> | undefined;
  const msg = c0?.message as Record<string, unknown> | undefined;
  const content = msg?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .map((part) => {
        if (part && typeof part === 'object' && !Array.isArray(part) && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .filter(Boolean);
    if (texts.length) return texts.join('\n');
  }
  throw new Error('OpenRouter response missing message content');
}

async function runOneInvocation(
  inv: EffectiveInvocation,
  userPrompt: string,
  imgBytes: Buffer,
  mime: string,
  outputFormat: ListingOutputFormat
): Promise<{ invocationId: string; text: string; error?: string }> {
  try {
    const kind = clientKindForProviderId(inv.provider.provider_id);
    debugAppraisal(
      'runOneInvocation start invocationId=%s provider_id=%s kind=%s model=%s mime=%s outputFormat=%s imageBytes=%d userPromptChars=%d',
      inv.invocationId,
      inv.provider.provider_id,
      kind,
      inv.model,
      mime,
      outputFormat,
      imgBytes.length,
      userPrompt.length
    );
    let text: string;
    if (kind === 'google_gemini') {
      const key = String(process.env.GEMINI_API_KEY ?? '').trim();
      if (!key) throw new Error('GEMINI_API_KEY not set');
      text = await runGeminiInvocation(inv.model, key, userPrompt, imgBytes, mime, outputFormat);
    } else if (kind === 'openrouter') {
      const key = String(process.env.OPENROUTER_API_KEY ?? '').trim();
      if (!key) throw new Error('OPENROUTER_API_KEY not set');
      const base = inv.provider.api_base_url || 'https://openrouter.ai/api/v1';
      debugAppraisal('runOneInvocation openrouter api_base=%s', base);
      text = await runOpenRouterInvocation(base, key, inv.model, userPrompt, imgBytes, mime, outputFormat);
    } else {
      throw new Error(`Unreachable: unknown client for ${JSON.stringify(inv.provider.provider_id)}`);
    }
    debugAppraisal(
      'runOneInvocation ok invocationId=%s kind=%s responseChars=%d',
      inv.invocationId,
      kind,
      text.length
    );
    return { invocationId: inv.invocationId, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    debugAppraisal('runOneInvocation error invocationId=%s: %s', inv.invocationId, msg);
    return { invocationId: inv.invocationId, text: '', error: msg };
  }
}

function writeListingOutput(
  baseName: string,
  outputFormat: ListingOutputFormat,
  text: string,
  invocationId: string,
  primary: boolean
): string {
  const listingsDir = join(process.cwd(), 'listings');
  mkdirSync(listingsDir, { recursive: true });
  const ext = outputFormat === 'json' ? 'json' : 'txt';
  const fileName = primary ? `${baseName}.${ext}` : `${baseName}__${invocationId.replace(/[^a-zA-Z0-9._-]+/g, '_')}.${ext}`;
  const outPath = join(listingsDir, fileName);

  if (outputFormat === 'json') {
    const body = stripMarkdownJsonFence(text);
    try {
      const parsedJson = JSON.parse(body) as unknown;
      writeFileSync(outPath, `${JSON.stringify(parsedJson, null, 2)}\n`, 'utf-8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Warning: ${fileName} is not valid JSON (${msg}); writing raw text.`);
      writeFileSync(outPath, body, 'utf-8');
    }
  } else {
    writeFileSync(outPath, text, 'utf-8');
  }
  return outPath;
}

function parseArgs(): { imagePath: string; commitMessage: string } {
  const argv = process.argv.slice(2);
  let commitMessage = process.env.COMMIT_MESSAGE ?? '';
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--commit-message' && argv[i + 1]) {
      commitMessage = argv[++i];
    } else if (!argv[i].startsWith('-')) {
      positional.push(argv[i]);
    }
  }
  return { imagePath: positional[0] ?? '', commitMessage };
}

async function runAppraisal(imagePath: string, commitMessage: string | undefined): Promise<void> {
  const path = join(process.cwd(), imagePath);
  if (!existsSync(path)) {
    console.error(`Error: File ${imagePath} not found.`);
    process.exit(1);
  }

  const parsed = parsePhilatelisterCommit(commitMessage);
  const imageBase = basename(imagePath);

  const meta = parsed.meta ?? {};
  const promptId = promptIdFromMeta(meta);
  let preferredModel: string;
  let outputFormat: ListingOutputFormat;
  try {
    ({ preferredModel, outputFormat } = loadPromptPack(promptId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }

  let invocations = getEffectiveInvocations(promptId, preferredModel);
  invocations = invocations.filter((inv) => {
    if (invocationHasRequiredApiKey(inv)) return true;
    console.error(
      `Skipping invocation ${inv.invocationId} (${inv.provider.provider_id}): missing API key (GEMINI_API_KEY or OPENROUTER_API_KEY).`
    );
    return false;
  });

  if (invocations.length === 0) {
    console.error('Error: No invocations could run — set GEMINI_API_KEY and/or OPENROUTER_API_KEY for configured providers.');
    process.exit(1);
  }

  const primaries = invocations.filter((i) => i.primary);
  if (primaries.length !== 1) {
    console.error(`Error: After filtering by API keys, expected exactly one primary invocation, got ${primaries.length}.`);
    process.exit(1);
  }

  const imgBytes = readFileSync(path);
  const mime = guessMime(imagePath);

  let promptWithGeminiOutput: string;
  let promptWithoutGeminiOutput: string;
  try {
    promptWithGeminiOutput = buildUserPromptText(imageBase, parsed, true, outputFormat);
    promptWithoutGeminiOutput = buildUserPromptText(imageBase, parsed, false, outputFormat);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }

  const results = await Promise.all(
    invocations.map((inv) => {
      const forGemini = clientKindForProviderId(inv.provider.provider_id) === 'google_gemini';
      const userPrompt = forGemini ? promptWithGeminiOutput : promptWithoutGeminiOutput;
      return runOneInvocation(inv, userPrompt, imgBytes, mime, outputFormat);
    })
  );

  const failed = results.filter((r) => r.error || !String(r.text ?? '').trim());
  const ok = results.filter((r) => !r.error && String(r.text ?? '').trim());
  if (ok.length === 0) {
    for (const r of failed) {
      console.error(`Invocation ${r.invocationId} failed: ${r.error ?? 'empty response'}`);
    }
    process.exit(1);
  }

  const primaryId = primaries[0]!.invocationId;
  const primaryResult = results.find((r) => r.invocationId === primaryId);
  if (!primaryResult || primaryResult.error || !String(primaryResult.text).trim()) {
    console.error(`Error: Primary invocation ${primaryId} failed; refusing to write listing.`);
    for (const r of failed) {
      console.error(`  ${r.invocationId}: ${r.error ?? 'empty'}`);
    }
    process.exit(1);
  }

  const baseName = basename(imagePath, extname(imagePath));
  for (const inv of invocations) {
    const r = results.find((x) => x.invocationId === inv.invocationId);
    if (!r || r.error || !String(r.text).trim()) continue;
    const out = writeListingOutput(baseName, outputFormat, r.text, inv.invocationId, inv.primary);
    console.log(`Written: ${out} (${inv.invocationId}, ${inv.provider.provider_id}, ${inv.model})`);
  }

  for (const r of failed) {
    console.error(`Warning: invocation ${r.invocationId} failed: ${r.error ?? 'empty response'}`);
  }
}

const { imagePath, commitMessage } = parseArgs();
if (!imagePath) {
  console.error('Usage: node appraisal.cjs <image_path> [--commit-message TEXT]');
  console.error('Env: GEMINI_API_KEY (required for google_gemini), OPENROUTER_API_KEY (for openrouter invocations), optional OPENROUTER_HTTP_REFERER, OPENROUTER_TITLE.');
  process.exit(1);
}

void runAppraisal(imagePath, commitMessage);
