import { randomUUID } from 'node:crypto';
import type { DB } from '../db/database.js';
import { nowIso } from '../db/database.js';
import { JevError } from '../jev/client.js';
import { tidyConcept, type SemanticCache } from '../jev/cache.js';
import { buildScheme, LockError, type ColourScheme, type RoleLocks } from '../palette/index.js';
import type { AccessibilityReport, ModeTokens, SemanticSummary } from '../palette/types.js';
import { AppError, badRequest, notFound } from '../util/errors.js';
import { slugify, uniqueSlug } from '../util/slug.js';

export interface Actor {
  id: string;
  role: 'admin' | 'user';
}

export const GENERATION_TTL_DAYS = 7;
export const MAX_NAME_LENGTH = 80;
export const MAX_NOTES_LENGTH = 2000;

export interface CacheInfo {
  source: 'cache' | 'jev';
  evaluationId: string;
  model: string | null;
  catalogueVersion: string;
  questionSetVersion: string;
  evaluatedAt: string;
  hitCount: number;
}

export interface GenerationResult {
  generationId: string;
  expiresAt: string;
  scheme: ColourScheme;
  cache: CacheInfo;
}

export interface SavedScheme {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  concept: string;
  light: ModeTokens;
  dark: ModeTokens;
  semantic: SemanticSummary;
  accessibility: Record<'light' | 'dark', AccessibilityReport>;
  details: ColourScheme['details'];
  evaluationId: string | null;
  generation: { generationId: string | null; variation: number; recommendedMode: 'light' | 'dark'; judgement: ColourScheme['judgement'] | null };
  notes: string | null;
  algorithmVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface SchemeSummary {
  id: string;
  name: string;
  slug: string;
  concept: string;
  preview: { light: Partial<ModeTokens>; dark: Partial<ModeTokens> };
  accessibility: { light: boolean; dark: boolean };
  createdAt: string;
  updatedAt: string;
}

interface SchemeRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  concept: string;
  light: string;
  dark: string;
  semantic: string;
  accessibility: string;
  details: string;
  evaluation_id: string | null;
  generation: string;
  notes: string | null;
  algorithm_version: string;
  created_at: string;
  updated_at: string;
}

interface GenerationRow {
  id: string;
  user_id: string;
  evaluation_id: string | null;
  concept: string;
  variation: number;
  options: string;
  scheme: string;
  algorithm_version: string;
  from_cache: number;
  created_at: string;
  expires_at: string;
}

const PREVIEW_TOKENS = ['background', 'surface', 'text', 'primary', 'secondary', 'accent'] as const;

function validateName(name: unknown): string {
  if (typeof name !== 'string') throw badRequest('Name is required.');
  const n = name.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!n) throw badRequest('Name is required.');
  if (n.length > MAX_NAME_LENGTH) throw badRequest(`Name must be at most ${MAX_NAME_LENGTH} characters.`);
  return n;
}

function validateNotes(notes: unknown): string | null {
  if (notes === undefined || notes === null) return null;
  if (typeof notes !== 'string') throw badRequest('Notes must be text.');
  const n = notes.trim();
  if (n.length > MAX_NOTES_LENGTH) throw badRequest(`Notes must be at most ${MAX_NOTES_LENGTH} characters.`);
  return n || null;
}

export function validateVariation(v: unknown): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw badRequest('variation must be an integer between 0 and 1000.');
  return n;
}

export function validateLocks(v: unknown): RoleLocks {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw badRequest('locks must be an object.');
  const out: RoleLocks = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!['primary', 'secondary', 'accent'].includes(k)) throw badRequest(`Unknown lock role "${k}".`);
    if (val === undefined || val === null || val === '') continue;
    if (typeof val !== 'string') throw badRequest(`Lock for ${k} must be a catalogue colour ID.`);
    out[k as keyof RoleLocks] = val;
  }
  return out;
}

/**
 * The single service used by the web UI, the HTTP API and the MCP server.
 * Generation goes through the semantic cache; saved schemes store final
 * values so later algorithm changes never alter them.
 */
export class SchemeService {
  constructor(
    private readonly db: DB,
    private readonly cache: SemanticCache,
  ) {}

  // ── Generation ──────────────────────────────────────────────────────────

  async generate(actor: Actor, input: { concept: unknown; variation?: unknown; locks?: unknown; refresh?: unknown }): Promise<GenerationResult> {
    const variation = validateVariation(input.variation);
    const locks = validateLocks(input.locks);
    // refresh: ask Jev again and replace the cached judgement (costs a credit).
    const lookup =
      input.refresh === true ? await this.cache.refresh(input.concept as string) : await this.cache.getOrEvaluate(input.concept as string);
    const ev = lookup.evaluation;
    let scheme: ColourScheme;
    try {
      scheme = buildScheme(tidyConcept(input.concept as string), ev.answers, { variation, locks });
    } catch (err) {
      if (err instanceof LockError) throw badRequest(err.message);
      throw err;
    }

    const id = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + GENERATION_TTL_DAYS * 86400_000).toISOString();
    this.db
      .prepare(
        `INSERT INTO generated_schemes (id, user_id, evaluation_id, concept, variation, options, scheme, algorithm_version, from_cache, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        actor.id,
        ev.id,
        scheme.concept,
        scheme.variation,
        JSON.stringify({ variation, locks }),
        JSON.stringify(scheme),
        scheme.algorithmVersion,
        lookup.source === 'cache' ? 1 : 0,
        now.toISOString(),
        expiresAt,
      );
    return {
      generationId: id,
      expiresAt,
      scheme,
      cache: {
        source: lookup.source,
        evaluationId: ev.id,
        model: ev.model,
        catalogueVersion: ev.catalogueVersion,
        questionSetVersion: ev.questionSetVersion,
        evaluatedAt: ev.createdAt,
        hitCount: ev.hitCount,
      },
    };
  }

  getGeneration(actor: Actor, generationId: string): (GenerationResult & { concept: string }) | null {
    const row = this.db
      .prepare('SELECT * FROM generated_schemes WHERE id = ? AND user_id = ? AND expires_at > ?')
      .get(generationId, actor.id, nowIso()) as GenerationRow | undefined;
    if (!row) return null;
    const scheme = JSON.parse(row.scheme) as ColourScheme;
    const ev = row.evaluation_id ? this.cache.getById(row.evaluation_id) : null;
    return {
      generationId: row.id,
      expiresAt: row.expires_at,
      concept: row.concept,
      scheme,
      cache: {
        source: row.from_cache ? 'cache' : 'jev',
        evaluationId: row.evaluation_id ?? '',
        model: ev?.model ?? null,
        catalogueVersion: ev?.catalogueVersion ?? '',
        questionSetVersion: ev?.questionSetVersion ?? '',
        evaluatedAt: ev?.createdAt ?? row.created_at,
        hitCount: ev?.hitCount ?? 0,
      },
    };
  }

  recentConcepts(actor: Actor, limit = 8): string[] {
    const rows = this.db
      .prepare(
        `SELECT concept, MAX(created_at) latest FROM generated_schemes WHERE user_id = ? GROUP BY lower(concept) ORDER BY latest DESC LIMIT ?`,
      )
      .all(actor.id, limit) as { concept: string }[];
    return rows.map((r) => r.concept);
  }

  purgeExpiredGenerations(): number {
    return this.db.prepare('DELETE FROM generated_schemes WHERE expires_at <= ?').run(nowIso()).changes;
  }

  // ── Saved schemes ───────────────────────────────────────────────────────

  async save(
    actor: Actor,
    input: { name: unknown; notes?: unknown; generationId?: unknown; concept?: unknown; variation?: unknown; locks?: unknown },
  ): Promise<SavedScheme> {
    const name = validateName(input.name);
    const notes = validateNotes(input.notes);
    let gen: GenerationResult | null = null;
    if (typeof input.generationId === 'string' && input.generationId) {
      gen = this.getGeneration(actor, input.generationId);
      if (!gen) throw notFound('Generated scheme (it may have expired; generate it again)');
    } else if (input.concept !== undefined) {
      gen = await this.generate(actor, { concept: input.concept, variation: input.variation, locks: input.locks });
    } else {
      throw badRequest('Provide generationId (from a generate call) or a concept.');
    }

    const s = gen.scheme;
    const id = randomUUID();
    const now = nowIso();
    const insert = this.db.transaction(() => {
      const slug = this.allocateSlug(actor.id, slugify(name));
      this.db
        .prepare(
          `INSERT INTO schemes (id, owner_id, name, slug, concept, light, dark, semantic, accessibility, details, evaluation_id, generation, notes, algorithm_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          actor.id,
          name,
          slug,
          s.concept,
          JSON.stringify(s.light),
          JSON.stringify(s.dark),
          JSON.stringify(s.semantic),
          JSON.stringify(s.accessibility),
          JSON.stringify(s.details),
          gen!.cache.evaluationId || null,
          JSON.stringify({
            generationId: gen!.generationId,
            variation: s.variation,
            recommendedMode: s.recommendedMode,
            judgement: s.judgement,
          }),
          notes,
          s.algorithmVersion,
          now,
          now,
        );
    });
    insert();
    return this.getOwned(actor, id)!;
  }

  private allocateSlug(ownerId: string, base: string, exceptId?: string): string {
    const stmt = this.db.prepare('SELECT id FROM schemes WHERE owner_id = ? AND slug = ?');
    return uniqueSlug(base, (slug) => {
      const row = stmt.get(ownerId, slug) as { id: string } | undefined;
      return !!row && row.id !== exceptId;
    });
  }

  list(actor: Actor, opts: { limit?: number; offset?: number } = {}): { items: SchemeSummary[]; total: number } {
    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
    const offset = Math.max(Number(opts.offset) || 0, 0);
    const rows = this.db
      .prepare('SELECT * FROM schemes WHERE owner_id = ? ORDER BY updated_at DESC, id LIMIT ? OFFSET ?')
      .all(actor.id, limit, offset) as SchemeRow[];
    const total = (this.db.prepare('SELECT COUNT(*) n FROM schemes WHERE owner_id = ?').get(actor.id) as { n: number }).n;
    return { items: rows.map((r) => summarise(hydrate(r))), total };
  }

  /** Own schemes only, by ID or slug. */
  getOwned(actor: Actor, ref: string): SavedScheme | null {
    const row = this.db
      .prepare('SELECT * FROM schemes WHERE owner_id = ? AND (id = ? OR slug = ?)')
      .get(actor.id, ref, ref) as SchemeRow | undefined;
    return row ? hydrate(row) : null;
  }

  /** Own schemes by exact (case-insensitive) name; null if none or ambiguous. */
  findByName(actor: Actor, name: string): { scheme: SavedScheme | null; ambiguous: boolean } {
    const rows = this.db
      .prepare('SELECT * FROM schemes WHERE owner_id = ? AND name = ? COLLATE NOCASE')
      .all(actor.id, name.trim()) as SchemeRow[];
    if (rows.length === 1) return { scheme: hydrate(rows[0]), ambiguous: false };
    return { scheme: null, ambiguous: rows.length > 1 };
  }

  /** Admin-only broader visibility (web UI), by ID. */
  getAny(actor: Actor, id: string): SavedScheme | null {
    if (actor.role !== 'admin') return this.getOwned(actor, id);
    const row = this.db.prepare('SELECT * FROM schemes WHERE id = ?').get(id) as SchemeRow | undefined;
    return row ? hydrate(row) : null;
  }

  update(actor: Actor, ref: string, changes: { name?: unknown; notes?: unknown }): SavedScheme {
    const existing = this.getOwned(actor, ref);
    if (!existing) throw notFound('Scheme');
    const name = changes.name !== undefined ? validateName(changes.name) : existing.name;
    const notes = changes.notes !== undefined ? validateNotes(changes.notes) : existing.notes;
    this.db.transaction(() => {
      const slug = name !== existing.name ? this.allocateSlug(actor.id, slugify(name), existing.id) : existing.slug;
      this.db
        .prepare('UPDATE schemes SET name = ?, slug = ?, notes = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
        .run(name, slug, notes, nowIso(), existing.id, actor.id);
    })();
    return this.getOwned(actor, existing.id)!;
  }

  duplicate(actor: Actor, ref: string, newName?: unknown): SavedScheme {
    const existing = this.getOwned(actor, ref);
    if (!existing) throw notFound('Scheme');
    const name = newName !== undefined && newName !== '' ? validateName(newName) : validateName(`${existing.name} copy`.slice(0, MAX_NAME_LENGTH));
    const id = randomUUID();
    const now = nowIso();
    this.db.transaction(() => {
      const slug = this.allocateSlug(actor.id, slugify(name));
      this.db
        .prepare(
          `INSERT INTO schemes (id, owner_id, name, slug, concept, light, dark, semantic, accessibility, details, evaluation_id, generation, notes, algorithm_version, created_at, updated_at)
           SELECT ?, owner_id, ?, ?, concept, light, dark, semantic, accessibility, details, evaluation_id, generation, notes, algorithm_version, ?, ?
           FROM schemes WHERE id = ? AND owner_id = ?`,
        )
        .run(id, name, slug, now, now, existing.id, actor.id);
    })();
    return this.getOwned(actor, id)!;
  }

  delete(actor: Actor, ref: string): SavedScheme {
    const existing = this.getOwned(actor, ref);
    if (!existing) throw notFound('Scheme');
    this.db.prepare('DELETE FROM schemes WHERE id = ? AND owner_id = ?').run(existing.id, actor.id);
    return existing;
  }
}

function hydrate(r: SchemeRow): SavedScheme {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    slug: r.slug,
    concept: r.concept,
    light: JSON.parse(r.light),
    dark: JSON.parse(r.dark),
    semantic: JSON.parse(r.semantic),
    accessibility: JSON.parse(r.accessibility),
    details: JSON.parse(r.details),
    evaluationId: r.evaluation_id,
    generation: JSON.parse(r.generation),
    notes: r.notes,
    algorithmVersion: r.algorithm_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function summarise(s: SavedScheme): SchemeSummary {
  const pick = (m: ModeTokens) => Object.fromEntries(PREVIEW_TOKENS.map((k) => [k, m[k]])) as Partial<ModeTokens>;
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    concept: s.concept,
    preview: { light: pick(s.light), dark: pick(s.dark) },
    accessibility: { light: s.accessibility.light.allPass, dark: s.accessibility.dark.allPass },
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** Map Jev failures to HTTP-friendly application errors. */
export function jevErrorToAppError(err: JevError): AppError {
  switch (err.code) {
    case 'empty_input':
      return new AppError(400, 'invalid_concept', err.message);
    case 'not_configured':
      return new AppError(503, 'jev_not_configured', err.message);
    case 'rate_limited':
      return new AppError(429, 'jev_rate_limited', err.message);
    case 'timeout':
      return new AppError(504, 'jev_timeout', err.message);
    case 'malformed_response':
      return new AppError(502, 'jev_malformed_response', err.message);
    case 'authentication':
      return new AppError(502, 'jev_authentication', 'The server could not authenticate with Jev.');
    default:
      return new AppError(502, 'jev_unavailable', err.message);
  }
}
