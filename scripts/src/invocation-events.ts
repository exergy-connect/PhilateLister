import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GenerateContentResponse } from '@google/genai';
import type { AppraisalInvocationTelemetry } from './appraisal-rate-limit-stats.js';

/** One provider completion worth of token fields (snake_case; Gemini mapped from API). */
export type TokenUsageRoundV1 = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  thoughts_tokens?: number;
  cached_content_tokens?: number;
  /** Gemini toolUsePromptTokenCount (field name shortened for xFrame model underscore limits). */
  tool_use_tokens?: number;
};

/** token_usage object as written to event JSON (xframe entity invocation_token_usage). */
export type InvocationEventTokenUsageWrittenV1 = {
  usage_anchor: 'aggregate';
  by_round: Array<TokenUsageRoundV1 & { round_index: number }>;
  totals: TokenUsageRoundV1;
};

/** Root object written to xframe/data/events/...json; aligns with xframe/model/invocation_event.json entity invocation_event_file. */
export type InvocationEventFileBodyV1 = {
  recorded_at_iso: string;
  status: 'ok' | 'error';
  client_kind: string;
  prompt_id: string;
  invocation_id: string;
  provider_id: string;
  requested_model: string;
  actual_model?: string;
  char_counts: { in: number; out: number };
  turn_count: number;
  function_calls: string[];
  token_usage?: InvocationEventTokenUsageWrittenV1;
  error_message?: string;
  output_text_chars?: number;
};

export type MutableTokenUsageCollector = {
  rounds: TokenUsageRoundV1[];
};

export function createTokenUsageCollector(): MutableTokenUsageCollector {
  return { rounds: [] };
}

function roundHasNumbers(r: TokenUsageRoundV1): boolean {
  return Object.values(r).some((v) => typeof v === 'number' && !Number.isNaN(v));
}

export function appendGeminiUsageRound(
  collector: MutableTokenUsageCollector | undefined,
  response: GenerateContentResponse
): void {
  if (!collector) return;
  const u = response.usageMetadata;
  if (!u) return;
  const round: TokenUsageRoundV1 = {
    prompt_tokens: u.promptTokenCount,
    completion_tokens: u.candidatesTokenCount,
    total_tokens: u.totalTokenCount,
    thoughts_tokens: u.thoughtsTokenCount,
    cached_content_tokens: u.cachedContentTokenCount,
    tool_use_tokens: u.toolUsePromptTokenCount,
  };
  if (roundHasNumbers(round)) collector.rounds.push(round);
}

export function appendOpenRouterUsageRound(
  collector: MutableTokenUsageCollector | undefined,
  response: Record<string, unknown>
): void {
  if (!collector) return;
  const usage = response.usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return;
  const u = usage as Record<string, unknown>;
  const num = (a: string, b: string) =>
    typeof u[a] === 'number' ? (u[a] as number) : typeof u[b] === 'number' ? (u[b] as number) : undefined;
  const round: TokenUsageRoundV1 = {
    prompt_tokens: num('prompt_tokens', 'promptTokens'),
    completion_tokens: num('completion_tokens', 'completionTokens'),
    total_tokens: num('total_tokens', 'totalTokens'),
  };
  if (roundHasNumbers(round)) collector.rounds.push(round);
}

const TOKEN_SUM_KEYS = [
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'thoughts_tokens',
  'cached_content_tokens',
  'tool_use_tokens',
] as const;

export function mergeTokenUsageTotals(rounds: TokenUsageRoundV1[]): TokenUsageRoundV1 {
  const totals: TokenUsageRoundV1 = {};
  for (const r of rounds) {
    for (const k of TOKEN_SUM_KEYS) {
      const v = r[k];
      if (typeof v === 'number' && !Number.isNaN(v)) {
        totals[k] = (totals[k] ?? 0) + v;
      }
    }
  }
  return totals;
}

export function sanitizeEventPathSegment(segment: string): string {
  const s = segment.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '');
  return s.slice(0, 180) || 'unknown';
}

function uniqueEventBasename(): string {
  return `${new Date().toISOString().replace(/:/g, '-')}_${randomBytes(4).toString('hex')}`;
}

export type InvocationEventFilePayload = {
  repoRoot: string;
  promptId: string;
  invocationId: string;
  providerId: string;
  requestedModel: string;
  actualModel?: string;
  clientKind: string;
  charCountsIn: number;
  telemetry: AppraisalInvocationTelemetry;
  tokens: MutableTokenUsageCollector;
  status: 'ok' | 'error';
  errorMessage?: string;
  outputText?: string;
};

/** Writes `xframe/data/events/<provider>/<requested_model>/<timestamp>.json`. */
export function writeInvocationEventFile(args: InvocationEventFilePayload): string {
  const providerSeg = sanitizeEventPathSegment(args.providerId);
  const modelSeg = sanitizeEventPathSegment(args.requestedModel);
  const dir = join(args.repoRoot, 'xframe', 'data', 'events', providerSeg, modelSeg);
  mkdirSync(dir, { recursive: true });
  const filepath = join(dir, `${uniqueEventBasename()}.json`);

  const outChars = args.status === 'ok' && args.outputText !== undefined ? args.outputText.length : 0;
  const rounds = args.tokens.rounds;
  const token_usage: InvocationEventTokenUsageWrittenV1 | undefined =
    rounds.length > 0
      ? {
          usage_anchor: 'aggregate',
          by_round: rounds.map((r, i) => ({ round_index: i, ...r })),
          totals: mergeTokenUsageTotals(rounds),
        }
      : undefined;

  const body: InvocationEventFileBodyV1 = {
    recorded_at_iso: new Date().toISOString(),
    status: args.status,
    client_kind: args.clientKind,
    prompt_id: args.promptId,
    invocation_id: args.invocationId,
    provider_id: args.providerId,
    requested_model: args.requestedModel,
    char_counts: { in: Math.max(0, Math.floor(args.charCountsIn)), out: outChars },
    turn_count: args.telemetry.turn_count,
    function_calls: [...args.telemetry.function_calls],
  };
  if (args.actualModel && args.actualModel.trim() && args.actualModel.trim() !== args.requestedModel.trim()) {
    body.actual_model = args.actualModel.trim();
  }
  if (token_usage) body.token_usage = token_usage;
  if (args.status === 'error' && args.errorMessage) body.error_message = args.errorMessage;
  if (args.status === 'ok') body.output_text_chars = outChars;

  writeFileSync(filepath, `${JSON.stringify(body, null, 2)}\n`, 'utf-8');
  return filepath;
}
