import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  RateLimitError,
  TypeSafeClient,
  TypeSafeError,
  UnprocessableEntityError,
} from '@typesafe-ai/sdk';
import { buildQuestions, buildState } from './questions.js';
import { parseJevAnswers, type JevAnswers } from './answers.js';

export interface JevResult {
  /** Versioned model ID reported by Jev (e.g. "jev-1.13.0"). */
  model: string | null;
  answers: JevAnswers;
  /** Raw answers as returned, kept for provenance. */
  raw: Record<string, unknown>;
  usage: { input_tokens?: number; output_tokens?: number } | null;
}

export type JevErrorCode =
  | 'not_configured'
  | 'empty_input'
  | 'authentication'
  | 'rate_limited'
  | 'timeout'
  | 'unavailable'
  | 'rejected'
  | 'malformed_response';

export class JevError extends Error {
  constructor(
    public readonly code: JevErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'JevError';
  }
}

/** The only thing the rest of the app knows about Jev. Tests inject a fake. */
export interface JevClient {
  readonly configured: boolean;
  evaluate(concept: string): Promise<JevResult>;
}

export interface TypeSafeJevOptions {
  apiKey: string | null;
  model: string;
  timeoutMs: number;
  baseUrl?: string | null;
}

/** Real client backed by TypeSafe's official SDK (server-side only). */
export class TypeSafeJevClient implements JevClient {
  private readonly client: TypeSafeClient | null;

  constructor(private readonly options: TypeSafeJevOptions) {
    this.client = options.apiKey
      ? new TypeSafeClient({
          apiKey: options.apiKey,
          defaultModel: options.model,
          timeout: options.timeoutMs,
          ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
          retry: { maxRetries: 2 },
          logLevel: 'off',
        })
      : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  async evaluate(concept: string): Promise<JevResult> {
    if (!this.client) {
      throw new JevError('not_configured', 'Jev is not configured: set TYPESAFE_API_KEY on the server.');
    }
    if (!concept.trim()) throw new JevError('empty_input', 'Concept must not be empty.');

    let response: { model?: unknown; answers?: unknown; usage?: unknown };
    try {
      response = (await this.client.systemOne({
        state: buildState(concept),
        // The SDK's question types are structurally identical to ours.
        questions: buildQuestions() as never,
      })) as typeof response;
    } catch (err) {
      throw mapSdkError(err);
    }
    return toResult(response);
  }
}

export function toResult(response: { model?: unknown; answers?: unknown; usage?: unknown }): JevResult {
  if (!response || typeof response !== 'object' || !response.answers || typeof response.answers !== 'object') {
    throw new JevError('malformed_response', 'Jev returned a response without answers.');
  }
  const raw = response.answers as Record<string, unknown>;
  let answers: JevAnswers;
  try {
    answers = parseJevAnswers(raw);
  } catch (err) {
    throw new JevError('malformed_response', `Jev returned an unexpected answer shape: ${(err as Error).message}`);
  }
  const usage =
    response.usage && typeof response.usage === 'object'
      ? (response.usage as { input_tokens?: number; output_tokens?: number })
      : null;
  return { model: typeof response.model === 'string' ? response.model : null, answers, raw, usage };
}

export function mapSdkError(err: unknown): JevError {
  if (err instanceof JevError) return err;
  if (err instanceof RateLimitError) return new JevError('rate_limited', 'Jev is rate limiting requests. Try again shortly.', true);
  if (err instanceof AuthenticationError) return new JevError('authentication', 'The Jev API key was rejected.');
  if (err instanceof APITimeoutError) return new JevError('timeout', 'Jev did not respond in time.', true);
  if (err instanceof UnprocessableEntityError) return new JevError('rejected', 'Jev rejected the request as invalid.');
  if (err instanceof APIConnectionError) return new JevError('unavailable', 'Could not reach Jev.', true);
  if (err instanceof APIError) {
    const status = (err as { status?: number }).status;
    if (status === 529 || (status !== undefined && status >= 500)) {
      return new JevError('unavailable', 'Jev is temporarily unavailable.', true);
    }
    return new JevError('rejected', `Jev returned an error${status ? ` (${status})` : ''}.`);
  }
  if (err instanceof TypeSafeError) return new JevError('unavailable', err.message);
  return new JevError('unavailable', 'Unexpected error while calling Jev.');
}
