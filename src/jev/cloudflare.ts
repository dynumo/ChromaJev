import { buildQuestions, buildState } from './questions.js';
import { JevError, toResult, type JevClient, type JevResult } from './client.js';

export interface CloudflareJevOptions {
  accountId: string;
  apiToken: string;
  /** Named AI Gateway to route through; omitted → the account's default gateway. */
  gatewayId?: string | null;
  /** Cloudflare catalogue ID for Jev. */
  model?: string;
  baseUrl?: string;
  timeoutMs: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  /** Injected for tests so retries do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

/**
 * Jev through Cloudflare's REST API (`POST /accounts/{id}/ai/run`), which
 * applies AI Gateway features (logging, rate limits, analytics) and bills
 * through Cloudflare Unified Billing — no TypeSafe key needed. The request
 * body is Cloudflare's envelope `{ model, input }` where `input` is exactly
 * TypeSafe's `{ state, questions }`, so answers are validated by the same
 * code as the direct TypeSafe route.
 *
 * Docs: https://developers.cloudflare.com/ai-gateway/usage/rest-api/
 *       https://developers.cloudflare.com/ai/models/typesafe/jev/
 */
export class CloudflareJevClient implements JevClient {
  readonly provider: string;
  readonly configured = true;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: CloudflareJevOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.provider = options.gatewayId ? `Cloudflare AI Gateway (${options.gatewayId})` : 'Cloudflare AI Gateway (default)';
  }

  get endpoint(): string {
    const base = (this.options.baseUrl ?? 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '');
    return `${base}/accounts/${encodeURIComponent(this.options.accountId)}/ai/run`;
  }

  async evaluate(concept: string): Promise<JevResult> {
    if (!concept.trim()) throw new JevError('empty_input', 'Concept must not be empty.');
    const body = JSON.stringify({
      model: this.options.model ?? 'typesafe/jev',
      input: { state: buildState(concept), questions: buildQuestions() },
    });
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Our own semantic cache already deduplicates; label gateway logs.
      'cf-aig-metadata': JSON.stringify({ app: 'chromajev' }),
    };
    if (this.options.gatewayId) headers['cf-aig-gateway-id'] = this.options.gatewayId;

    const maxRetries = this.options.maxRetries ?? 2;
    let lastError: JevError | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(lastError?.retryAfterMs ?? Math.min(500 * 2 ** (attempt - 1), 5000));
      let res: Response;
      try {
        res = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
      } catch (err) {
        const timedOut = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError';
        lastError = timedOut
          ? new JevError('timeout', 'Jev (via Cloudflare) did not respond in time.', true)
          : new JevError('unavailable', 'Could not reach Cloudflare.', true);
        continue;
      }
      if (res.ok) {
        try {
          return toResult(unwrap(await readJson(res)));
        } catch (err) {
          // Visible in container logs; contains structure only, never content.
          console.warn(`Cloudflare Jev response not understood: ${(err as Error).message}`);
          throw err;
        }
      }
      lastError = await errorFor(res);
      if (!RETRYABLE.has(res.status)) throw lastError;
    }
    throw lastError ?? new JevError('unavailable', 'Jev (via Cloudflare) failed.');
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new JevError('malformed_response', 'Cloudflare returned a non-JSON response.');
  }
}

type JevPayload = { model?: unknown; answers?: unknown; usage?: unknown };

/** Wrapper keys Cloudflare may nest a model's output under. */
const WRAPPERS = ['result', 'response', 'output', 'data', 'body'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** JSON-encoded strings (e.g. a text-generation style `response`) are decoded. */
function decode(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!t.startsWith('{')) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

/** Normalise usage from TypeSafe ({input_tokens}) or Workers AI ({prompt_tokens}) style. */
function normaliseUsage(u: unknown): { input_tokens?: number; output_tokens?: number } | undefined {
  if (!isRecord(u)) return undefined;
  const input = u.input_tokens ?? u.prompt_tokens;
  const output = u.output_tokens ?? u.completion_tokens;
  return {
    ...(typeof input === 'number' ? { input_tokens: input } : {}),
    ...(typeof output === 'number' ? { output_tokens: output } : {}),
  };
}

/**
 * Find Jev's `{ model, answers, usage }` inside whatever Cloudflare wraps it
 * in: bare, the v4 envelope `{ success, result }`, a text-generation style
 * `{ result: { response } }` (object or JSON string), or similar nesting.
 */
export function unwrap(body: unknown): JevPayload {
  if (isRecord(body) && body.success === false) {
    throw new JevError('rejected', `Cloudflare reported an error: ${describeErrors(body.errors)}`);
  }
  let outerUsage: unknown;
  let outerModel: unknown;
  let level: unknown[] = [body];
  for (let depth = 0; depth < 5 && level.length; depth++) {
    const next: unknown[] = [];
    for (const raw of level) {
      const node = decode(raw);
      if (!isRecord(node)) continue;
      outerUsage ??= node.usage;
      if (typeof node.model === 'string') outerModel ??= node.model;
      if (isRecord(node.answers)) {
        return {
          model: typeof node.model === 'string' ? node.model : outerModel,
          answers: node.answers,
          usage: normaliseUsage(node.usage ?? outerUsage),
        };
      }
      for (const k of WRAPPERS) if (k in node) next.push(node[k]);
    }
    level = next;
  }
  throw new JevError(
    'malformed_response',
    `Cloudflare returned a response without Jev answers. Response shape: ${describeShape(body)}`,
  );
}

/** Structure only (keys and types, never values), safe to log and show. */
export function describeShape(v: unknown, depth = 0): string {
  const d = decode(v);
  if (d !== v && typeof v === 'string') return `json-string(${describeShape(d, depth)})`;
  if (Array.isArray(v)) return depth > 2 ? 'array' : `array[${v.length}]${v.length ? `<${describeShape(v[0], depth + 1)}>` : ''}`;
  if (isRecord(v)) {
    if (depth > 2) return 'object';
    const keys = Object.keys(v).slice(0, 12);
    return `{${keys.map((k) => `${k}: ${describeShape(v[k], depth + 1)}`).join(', ')}${Object.keys(v).length > 12 ? ', …' : ''}}`;
  }
  if (typeof v === 'string') return `string(${v.length})`;
  return v === null ? 'null' : typeof v;
}

function describeErrors(errors: unknown): string {
  if (!Array.isArray(errors) || errors.length === 0) return 'unknown error';
  return errors
    .map((e) => {
      const o = e as { code?: unknown; message?: unknown };
      return `${typeof o.message === 'string' ? o.message : 'error'}${o.code !== undefined ? ` (${String(o.code)})` : ''}`;
    })
    .join('; ')
    .slice(0, 300);
}

async function errorFor(res: Response): Promise<JevError> {
  let detail = '';
  try {
    const body = (await res.json()) as { errors?: unknown };
    detail = describeErrors(body?.errors);
  } catch {
    /* body is optional */
  }
  const suffix = detail && detail !== 'unknown error' ? `: ${detail}` : '';
  let err: JevError;
  if (res.status === 401 || res.status === 403) {
    err = new JevError('authentication', `Cloudflare rejected the API token (HTTP ${res.status})${suffix}. It needs Account > Workers AI > Read.`);
  } else if (res.status === 429) {
    err = new JevError('rate_limited', 'Jev (via Cloudflare) is rate limiting requests. Try again shortly.', true);
  } else if (res.status === 408) {
    err = new JevError('timeout', 'Jev (via Cloudflare) did not respond in time.', true);
  } else if (res.status >= 500) {
    err = new JevError('unavailable', `Jev (via Cloudflare) is temporarily unavailable (HTTP ${res.status}).`, true);
  } else if (res.status === 404) {
    err = new JevError('rejected', `Cloudflare could not find the endpoint (HTTP 404)${suffix}. Check CLOUDFLARE_ACCOUNT_ID.`);
  } else if (res.status === 402) {
    err = new JevError('rejected', `Cloudflare refused the request (HTTP 402)${suffix}. Check your AI Gateway credit balance.`);
  } else {
    err = new JevError('rejected', `Cloudflare rejected the request (HTTP ${res.status})${suffix}.`);
  }
  const ra = res.headers.get('retry-after');
  if (ra) {
    const secs = Number(ra);
    const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(ra) - Date.now();
    if (ms > 0) err.retryAfterMs = Math.min(ms, 60_000);
  }
  return err;
}
