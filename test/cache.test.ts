import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../src/db/database.js';
import { SemanticCache, normaliseConcept } from '../src/jev/cache.js';
import { JevError } from '../src/jev/client.js';
import { SchemeService } from '../src/schemes/service.js';
import { FakeJevClient } from './helpers/fakeJev.js';

function userRow(db: DB, id = 'u1') {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, status, email_verified_at, created_at, updated_at) VALUES (?, ?, 'x', 'user', 'active', 'now', 'now', 'now')`,
  ).run(id, `${id}@example.com`);
  return { id, role: 'user' as const };
}

describe('concept normalisation', () => {
  it('folds whitespace and case only', () => {
    expect(normaliseConcept('  Browser ')).toBe('browser');
    expect(normaliseConcept('BROWSER')).toBe('browser');
    expect(normaliseConcept('autumn\t  forest')).toBe('autumn forest');
    expect(normaliseConcept('brutalism')).not.toBe(normaliseConcept('brutalist'));
    expect(normaliseConcept('cafe')).not.toBe(normaliseConcept('café'));
  });
});

describe('semantic cache', () => {
  let db: DB;
  let jev: FakeJevClient;
  let cache: SemanticCache;

  beforeEach(() => {
    db = openDatabase(':memory:');
    jev = new FakeJevClient();
    cache = new SemanticCache(db, jev);
  });

  it('calls Jev on a miss and stores the structured result', async () => {
    const r = await cache.getOrEvaluate('browser');
    expect(r.source).toBe('jev');
    expect(jev.calls).toEqual(['browser']);
    const row = db.prepare('SELECT * FROM jev_evaluations').get() as Record<string, unknown>;
    expect(row.normalised_query).toBe('browser');
    expect(row.original_query).toBe('browser');
    expect(row.model).toBe('jev-1.13.0');
    expect(row.catalogue_version).toBeTruthy();
    expect(row.question_set_version).toBeTruthy();
    expect(JSON.parse(row.answers as string).colour_affinity.probabilities).toBeTypeOf('object');
  });

  it('serves hits without calling Jev, for equivalent normalised concepts', async () => {
    await cache.getOrEvaluate('browser');
    const a = await cache.getOrEvaluate('Browser');
    const b = await cache.getOrEvaluate('  BROWSER  ');
    expect(a.source).toBe('cache');
    expect(b.source).toBe('cache');
    expect(jev.calls).toHaveLength(1);
    const row = db.prepare('SELECT hit_count, request_count FROM jev_evaluations').get() as { hit_count: number; request_count: number };
    expect(row.hit_count).toBe(2);
    expect(row.request_count).toBe(3);
  });

  it('coalesces concurrent misses into one Jev request', async () => {
    jev.delayMs = 30;
    const [a, b] = await Promise.all([cache.getOrEvaluate('ocean'), cache.getOrEvaluate('Ocean')]);
    expect(jev.calls).toHaveLength(1);
    expect(a.evaluation.id).toBe(b.evaluation.id);
  });

  it('does not cache failures', async () => {
    jev.failWith = new JevError('rate_limited', 'slow down', true);
    await expect(cache.getOrEvaluate('forest')).rejects.toThrow('slow down');
    jev.failWith = null;
    const r = await cache.getOrEvaluate('forest');
    expect(r.source).toBe('jev');
    expect(jev.calls).toHaveLength(2);
  });

  it('rejects empty input without calling Jev', async () => {
    await expect(cache.getOrEvaluate('   ')).rejects.toBeInstanceOf(JevError);
    expect(jev.calls).toHaveLength(0);
  });

  it('invalidates entries from an older catalogue or question-set version', async () => {
    await cache.getOrEvaluate('browser');
    const bumped = new SemanticCache(db, jev, { catalogue: 'cat-999', questionSet: 'qs-3' });
    const r = await bumped.getOrEvaluate('browser');
    expect(r.source).toBe('jev');
    expect(jev.calls).toHaveLength(2);
    expect(bumped.stats().entries).toBe(2);
    expect(bumped.purgeStale()).toBe(1);
  });

  it('treats a malformed stored entry as a miss', async () => {
    await cache.getOrEvaluate('browser');
    db.prepare(`UPDATE jev_evaluations SET answers = '{"broken":true}'`).run();
    const fresh = new SemanticCache(openDatabase(':memory:'), jev);
    expect(fresh.find('browser')).toBeNull();
    expect(cache.find('browser')).toBeNull();
  });
});

describe('generation through the cache', () => {
  it('builds light and dark from one Jev call, and alternatives cost nothing', async () => {
    const db = openDatabase(':memory:');
    const jev = new FakeJevClient();
    const service = new SchemeService(db, new SemanticCache(db, jev));
    const user = userRow(db);
    const g0 = await service.generate(user, { concept: 'autumn forest' });
    expect(g0.cache.source).toBe('jev');
    expect(g0.scheme.light.primary).toBeTruthy();
    expect(g0.scheme.dark.primary).toBeTruthy();
    const g1 = await service.generate(user, { concept: 'Autumn Forest', variation: 1 });
    const g2 = await service.generate(user, { concept: 'autumn forest', variation: 2 });
    expect(g1.cache.source).toBe('cache');
    expect(g2.cache.source).toBe('cache');
    expect(jev.calls).toHaveLength(1);
    expect(g1.scheme.concept).toBe('Autumn Forest');
  });
});
