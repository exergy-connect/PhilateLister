import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_EVENTS = 200;

/** UTF-16 code unit counts: user prompt text in; model completion text out. */
export type AppraisalCharCounts = {
  in: number;
  out: number;
};

/** Mutated during an invocation; read when logging rate-limit / quota failures. */
export type AppraisalInvocationTelemetry = {
  /** Successful provider completions (each returned model message) before the failing call. */
  turn_count: number;
  /** Function/tool names executed in order (may repeat). */
  function_calls: string[];
};

export function emptyInvocationTelemetry(): AppraisalInvocationTelemetry {
  return { turn_count: 0, function_calls: [] };
}

export type AppraisalRateLimitStatEvent = {
  at_iso: string;
  /** Prompt template id (xframe/data/prompts/<prompt_id>.json). */
  prompt_id: string;
  invocation_id: string;
  provider_id: string;
  /** Vendor model that returned the limit or error (e.g. google/gemma-4-31b-it:free). */
  model: string;
  /** Request/route model when it differs from `model` (e.g. openrouter/free). */
  requested_model?: string;
  /** Prompt `in` length and model text `out` for this attempt (out is 0 when no body). */
  char_counts: AppraisalCharCounts;
  /** Completed model/provider rounds before failure (each successful completion). */
  turn_count: number;
  /** Tool/function names invoked in order. */
  function_calls: string[];
  message_preview: string;
};

export type AppraisalRateLimitStatsFile = {
  schema_version: 1;
  updated_at_iso: string;
  total_events: number;
  /** Counts keyed by `${provider_id}|${model}|${reason}` where `model` is the actual upstream model. */
  counts_by_key: Record<string, number>;
  events: AppraisalRateLimitStatEvent[];
};

function emptyStats(): AppraisalRateLimitStatsFile {
  return {
    schema_version: 1,
    updated_at_iso: new Date().toISOString(),
    total_events: 0,
    counts_by_key: {},
    events: [],
  };
}

export function isAppraisalRateLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    /\b429\b/.test(message) ||
    m.includes('rate limit') ||
    m.includes('rate-limit') ||
    m.includes('too many requests') ||
    m.includes('resource_exhausted') ||
    m.includes('resource exhausted')
  );
}

function rateLimitReasonFromMessage(message: string): string {
  if (/\b429\b/.test(message)) return 'http_429';
  if (/resource_exhausted/i.test(message)) return 'resource_exhausted';
  if (/rate.?limit/i.test(message)) return 'rate_limit_text';
  return 'other';
}

/**
 * Best-effort parse of OpenRouter error JSON bodies: `error.metadata.raw` often starts with the
 * concrete free-tier model id (e.g. "google/gemma-4-31b-it:free is temporarily rate-limited…").
 */
export function extractActualModelFromOpenRouterErrorMessage(message: string): string | undefined {
  const jsonStart = message.indexOf('{');
  if (jsonStart === -1) return undefined;
  try {
    const parsed = JSON.parse(message.slice(jsonStart)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const err = (parsed as Record<string, unknown>).error;
    if (!err || typeof err !== 'object' || Array.isArray(err)) return undefined;
    const meta = (err as Record<string, unknown>).metadata;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined;
    const raw = (meta as Record<string, unknown>).raw;
    if (typeof raw !== 'string') return undefined;
    const first = raw.trim().match(/^(\S+)/);
    const token = first?.[1];
    if (!token || !token.includes('/')) return undefined;
    return token;
  } catch {
    return undefined;
  }
}

function resolveActualModel(part: {
  requested_model: string;
  message: string;
  actual_model?: string;
}): string {
  const fromArg = part.actual_model?.trim();
  if (fromArg) return fromArg;
  const fromOpenRouter = extractActualModelFromOpenRouterErrorMessage(part.message);
  if (fromOpenRouter) return fromOpenRouter;
  return part.requested_model.trim();
}

const INVOCATION_STATS_FILENAME = 'invocation_stats.json';

/** Persists to `xframe/data/invocation_stats.json` under the process cwd (repo root). */
export function recordAppraisalRateLimitEvent(part: {
  prompt_id: string;
  invocation_id: string;
  provider_id: string;
  /** Model id sent on the request (invocation model / router slug). */
  requested_model: string;
  message: string;
  /** When already known (e.g. OpenRouter `response.model` on success paths; rarely on errors). */
  actual_model?: string;
  /** `in`: user prompt string length; `out`: model reply length (0 on failure before text). */
  char_counts: AppraisalCharCounts;
  telemetry: AppraisalInvocationTelemetry;
}): void {
  if (!isAppraisalRateLimitError(part.message)) return;
  const requested = part.requested_model.trim();
  const actual = resolveActualModel(part);
  const dataDir = join(process.cwd(), 'xframe', 'data');
  const path = join(dataDir, INVOCATION_STATS_FILENAME);
  const legacyPath = join(dataDir, 'appraisal_rate_limit_stats.json');
  const readPath = existsSync(path) ? path : legacyPath;
  let root = emptyStats();
  if (existsSync(readPath)) {
    try {
      const parsed = JSON.parse(readFileSync(readPath, 'utf-8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const o = parsed as Record<string, unknown>;
        root = {
          schema_version: 1,
          updated_at_iso: typeof o.updated_at_iso === 'string' ? o.updated_at_iso : root.updated_at_iso,
          total_events: typeof o.total_events === 'number' ? o.total_events : 0,
          counts_by_key: o.counts_by_key && typeof o.counts_by_key === 'object' && !Array.isArray(o.counts_by_key)
            ? (o.counts_by_key as Record<string, number>)
            : {},
          events: Array.isArray(o.events) ? (o.events as AppraisalRateLimitStatEvent[]) : [],
        };
      }
    } catch {
      root = emptyStats();
    }
  }
  const reason = rateLimitReasonFromMessage(part.message);
  const key = `${part.provider_id}|${actual}|${reason}`;
  root.counts_by_key[key] = (root.counts_by_key[key] ?? 0) + 1;
  root.total_events += 1;
  root.updated_at_iso = new Date().toISOString();
  const preview = part.message.length > 400 ? `${part.message.slice(0, 400)}…` : part.message;
  const event: AppraisalRateLimitStatEvent = {
    at_iso: root.updated_at_iso,
    prompt_id: part.prompt_id.trim(),
    invocation_id: part.invocation_id,
    provider_id: part.provider_id,
    model: actual,
    char_counts: {
      in: Math.max(0, Math.floor(part.char_counts.in)),
      out: Math.max(0, Math.floor(part.char_counts.out)),
    },
    turn_count: Math.max(0, Math.floor(part.telemetry.turn_count)),
    function_calls: [...part.telemetry.function_calls],
    message_preview: preview,
  };
  if (requested !== actual) event.requested_model = requested;
  root.events.push(event);
  if (root.events.length > MAX_EVENTS) root.events.splice(0, root.events.length - MAX_EVENTS);
  writeFileSync(path, `${JSON.stringify(root, null, 2)}\n`, 'utf-8');
}

