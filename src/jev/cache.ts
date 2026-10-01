import { randomUUID } from 'node:crypto';
import type { DB } from '../db/database.js';
import { nowIso } from '../db/database.js';
import { CATALOGUE_VERSION } from '../colour/catalogue.js';
import { QUESTION_SET_VERSION } from './questions.js';
import { parseJevAnswers, type JevAnswers } from './answers.js';
import { JevError, type JevClient } from './client.js';

export const MAX_CONCEPT_LENGTH = 120;

/**
 * Normalise a concept for cache lookup. Deliberately conservative: Unicode
 * compatibility form, trimmed, internal whitespace collapsed, lower-cased.
 * No stemming, punctuation stripping or synonym folding — "brutalist" and
 * "brutalism" are different prompts.
 */
export function normaliseConcept(input: string): string {
  return input.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-GB');
}

/** Tidy user input for display/storage without changing its meaning. */
export function tidyConcept(input: string): string {
  return input.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

export function validateConcept(input: unknown): string {
  if (typeof input !== 'string') throw new JevError('empty_input', 'Concept must be a string.');
  const tidy = tidyConcept(input);
  if (!tidy) throw new JevError('empty_input', 'Enter a word or short phrase.');
  if (tidy.length > MAX_CONCEPT_LENGTH) {
    throw new JevError('empty_input', `Concept must be at most ${MAX_CONCEPT_LENGTH} characters.`);
  }
  return tidy;
}

export interface Evaluation {
  id: string;
  originalQuery: string;
  normalisedQuery: string;
  catalogueVersion: string;
  questionSetVersion: string;
  model: string | null;
  answers: JevAnswers;
  rawAnswers: Record<string, unknown>;
  usage: unknown;
  createdAt: string;
  lastRequestedAt: string;
  requestCount: number;
  hitCount: number;
}

export interface EvaluationLookup {
  evaluation: Evaluation;
  /** "cache" when no Jev request was made for this call. */
  source: 'cache' | 'jev';
}

interface Row {
  id: string;
  normalised_query: string;
  original_query: string;
  catalogue_version: string;
  question_set_version: string;
  model: string | null;
  answers: string;
  usage: string | null;
  created_at: string;
  last_requested_at: string;
  request_count: number;
  hit_count: number;
}

export interface CacheVersions {
  catalogue: string;
  questionSet: string;
}

export const CURRENT_VERSIONS: CacheVersions = { catalogue: CATALOGUE_VERSION, questionSet: QUESTION_SET_VERSION };

/**
 * Semantic cache of Jev judgements. Stores the structured answers (not the
 * palette), keyed by normalised concept + catalogue + question-set version.
 */
export class SemanticCache {
  private readonly inFlight = new Map<string, Promise<EvaluationLookup>>();

  constructor(
    private readonly db: DB,
    private readonly jev: JevClient,
    private readonly versions: CacheVersions = CURRENT_VERSIONS,
  ) {}

  get jevConfigured(): boolean {
    return this.jev.configured;
  }

  /** Return a cached evaluation or ask Jev exactly once on a miss. */
  async getOrEvaluate(concept: string): Promise<EvaluationLookup> {
    const tidy = validateConcept(concept);
    const key = normaliseConcept(tidy);

    const cached = this.find(key);
    if (cached) {
      this.recordHit(cached.id);
      return { evaluation: { ...cached, hitCount: cached.hitCount + 1, requestCount: cached.requestCount + 1 }, source: 'cache' };
    }

    // Coalesce concurrent misses so a double-submit costs one request.
    const pending = this.inFlight.get(key);
    if (pending) {
      const result = await pending;
      return { evaluation: result.evaluation, source: 'cache' };
    }
    const promise = this.evaluateAndStore(tidy, key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private async evaluateAndStore(tidy: string, key: string): Promise<EvaluationLookup> {
    const result = await this.jev.evaluate(tidy);
    const now = nowIso();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO jev_evaluations
          (id, normalised_query, original_query, catalogue_version, question_set_version, model, answers, usage,
           created_at, last_requested_at, request_count, hit_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
         ON CONFLICT (normalised_query, catalogue_version, question_set_version) DO NOTHING`,
      )
      .run(
        id,
        key,
        tidy,
        this.versions.catalogue,
        this.versions.questionSet,
        result.model,
        JSON.stringify(result.raw),
        result.usage ? JSON.stringify(result.usage) : null,
        now,
        now,
      );
    const stored = this.find(key);
    if (!stored) throw new Error('Failed to persist Jev evaluation');
    return { evaluation: stored, source: 'jev' };
  }

  find(normalisedQuery: string): Evaluation | null {
    const row = this.db
      .prepare(
        `SELECT * FROM jev_evaluations WHERE normalised_query = ? AND catalogue_version = ? AND question_set_version = ?`,
      )
      .get(normalisedQuery, this.versions.catalogue, this.versions.questionSet) as Row | undefined;
    return row ? this.hydrate(row) : null;
  }

  getById(id: string): Evaluation | null {
    const row = this.db.prepare('SELECT * FROM jev_evaluations WHERE id = ?').get(id) as Row | undefined;
    if (!row) return null;
    if (row.catalogue_version !== this.versions.catalogue || row.question_set_version !== this.versions.questionSet) {
      return null; // incompatible with the current palette builder
    }
    return this.hydrate(row);
  }

  private recordHit(id: string): void {
    this.db
      .prepare(
        `UPDATE jev_evaluations SET hit_count = hit_count + 1, request_count = request_count + 1, last_requested_at = ? WHERE id = ?`,
      )
      .run(nowIso(), id);
  }

  private hydrate(row: Row): Evaluation | null {
    let rawAnswers: Record<string, unknown>;
    let answers: JevAnswers;
    try {
      rawAnswers = JSON.parse(row.answers);
      answers = parseJevAnswers(rawAnswers);
    } catch {
      return null; // corrupt or incompatible entry behaves as a miss
    }
    return {
      id: row.id,
      originalQuery: row.original_query,
      normalisedQuery: row.normalised_query,
      catalogueVersion: row.catalogue_version,
      questionSetVersion: row.question_set_version,
      model: row.model,
      answers,
      rawAnswers,
      usage: row.usage ? JSON.parse(row.usage) : null,
      createdAt: row.created_at,
      lastRequestedAt: row.last_requested_at,
      requestCount: row.request_count,
      hitCount: row.hit_count,
    };
  }

  stats(): { entries: number; current: number; hits: number; requests: number } {
    const all = this.db
      .prepare('SELECT COUNT(*) n, COALESCE(SUM(hit_count),0) hits, COALESCE(SUM(request_count),0) reqs FROM jev_evaluations')
      .get() as { n: number; hits: number; reqs: number };
    const current = this.db
      .prepare('SELECT COUNT(*) n FROM jev_evaluations WHERE catalogue_version = ? AND question_set_version = ?')
      .get(this.versions.catalogue, this.versions.questionSet) as { n: number };
    return { entries: all.n, current: current.n, hits: all.hits, requests: all.reqs };
  }

  /** Remove entries made against older catalogue/question versions. */
  purgeStale(): number {
    return this.db
      .prepare('DELETE FROM jev_evaluations WHERE catalogue_version != ? OR question_set_version != ?')
      .run(this.versions.catalogue, this.versions.questionSet).changes;
  }
}
