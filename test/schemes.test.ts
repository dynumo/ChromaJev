import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../src/db/database.js';
import { SemanticCache } from '../src/jev/cache.js';
import { SchemeService } from '../src/schemes/service.js';
import { FakeJevClient } from './helpers/fakeJev.js';
import { AppError } from '../src/util/errors.js';

function addUser(db: DB, id: string, role: 'admin' | 'user' = 'user') {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, status, email_verified_at, created_at, updated_at) VALUES (?, ?, 'x', ?, 'active', 'now', 'now', 'now')`,
  ).run(id, `${id}@example.com`, role);
  return { id, role };
}

describe('saved schemes', () => {
  let db: DB;
  let service: SchemeService;
  let alice: { id: string; role: 'user' | 'admin' };
  let bob: { id: string; role: 'user' | 'admin' };

  beforeEach(() => {
    db = openDatabase(':memory:');
    service = new SchemeService(db, new SemanticCache(db, new FakeJevClient()));
    alice = addUser(db, 'alice');
    bob = addUser(db, 'bob');
  });

  async function saveAs(actor: typeof alice, name: string, concept = 'browser') {
    const g = await service.generate(actor, { concept });
    return service.save(actor, { name, generationId: g.generationId });
  }

  it('creates, retrieves by id and slug, and persists both modes', async () => {
    const s = await saveAs(alice, 'Dynumo');
    expect(s.slug).toBe('dynumo');
    expect(s.light.primary).toMatch(/^#/);
    expect(s.dark.primary).toMatch(/^#/);
    expect(s.accessibility.light.checks.length).toBeGreaterThan(0);
    expect(s.evaluationId).toBeTruthy();
    expect(service.getOwned(alice, s.id)?.name).toBe('Dynumo');
    expect(service.getOwned(alice, 'dynumo')?.dark).toEqual(s.dark);
  });

  it('lists only the owner’s schemes', async () => {
    await saveAs(alice, 'One');
    await saveAs(alice, 'Two');
    await saveAs(bob, 'Bob’s');
    const list = service.list(alice);
    expect(list.total).toBe(2);
    expect(list.items.map((i) => i.name).sort()).toEqual(['One', 'Two']);
    expect(list.items[0].preview.light.primary).toMatch(/^#/);
    expect(list.items[0].preview.dark.primary).toMatch(/^#/);
  });

  it('handles slug collisions', async () => {
    const a = await saveAs(alice, 'Forest');
    const b = await saveAs(alice, 'Forest');
    const c = await saveAs(alice, 'forest!');
    expect([a.slug, b.slug, c.slug]).toEqual(['forest', 'forest-2', 'forest-3']);
    // Different owners may reuse the slug.
    expect((await saveAs(bob, 'Forest')).slug).toBe('forest');
  });

  it('renames (slug follows) and edits notes', async () => {
    const s = await saveAs(alice, 'Draft');
    const r = service.update(alice, s.id, { name: 'Brief NI', notes: 'For the newsletter' });
    expect(r.name).toBe('Brief NI');
    expect(r.slug).toBe('brief-ni');
    expect(r.notes).toBe('For the newsletter');
    expect(r.light).toEqual(s.light);
  });

  it('duplicates', async () => {
    const s = await saveAs(alice, 'Redback');
    const d = service.duplicate(alice, 'redback');
    expect(d.id).not.toBe(s.id);
    expect(d.name).toBe('Redback copy');
    expect(d.light).toEqual(s.light);
    expect(d.dark).toEqual(s.dark);
  });

  it('deletes', async () => {
    const s = await saveAs(alice, 'Gone');
    service.delete(alice, s.slug);
    expect(service.getOwned(alice, s.id)).toBeNull();
  });

  it('enforces ownership on every operation', async () => {
    const s = await saveAs(alice, 'Private');
    expect(service.getOwned(bob, s.id)).toBeNull();
    expect(service.getOwned(bob, s.slug)).toBeNull();
    expect(() => service.update(bob, s.id, { name: 'Hijack' })).toThrow(AppError);
    expect(() => service.duplicate(bob, s.id)).toThrow(AppError);
    expect(() => service.delete(bob, s.id)).toThrow(AppError);
    expect(service.getOwned(alice, s.id)?.name).toBe('Private');
  });

  it('does not let one user save another user’s generation', async () => {
    const g = await service.generate(alice, { concept: 'browser' });
    await expect(service.save(bob, { name: 'Stolen', generationId: g.generationId })).rejects.toThrow(/not found/);
  });

  it('validates names', async () => {
    const g = await service.generate(alice, { concept: 'browser' });
    await expect(service.save(alice, { name: '   ', generationId: g.generationId })).rejects.toThrow(/Name/);
    await expect(service.save(alice, { name: 'x'.repeat(200), generationId: g.generationId })).rejects.toThrow(/at most/);
  });

  it('stores final values so algorithm changes cannot alter saved schemes', async () => {
    const s = await saveAs(alice, 'Stable');
    // Simulate a later algorithm release rewriting how palettes are built:
    // nothing in a saved row depends on re-running it.
    db.prepare(`DELETE FROM jev_evaluations`).run();
    db.prepare(`DELETE FROM generated_schemes`).run();
    const later = service.getOwned(alice, s.id)!;
    expect(later.light).toEqual(s.light);
    expect(later.dark).toEqual(s.dark);
    expect(later.algorithmVersion).toBe(s.algorithmVersion);
    const row = db.prepare('SELECT light, dark FROM schemes WHERE id = ?').get(s.id) as { light: string; dark: string };
    expect(JSON.parse(row.light).primary).toBe(s.light.primary);
  });

  it('gives admins broader read visibility only through getAny', async () => {
    const admin = addUser(db, 'root', 'admin');
    const s = await saveAs(alice, 'Visible to admin');
    expect(service.getOwned(admin, s.id)).toBeNull();
    expect(service.getAny(admin, s.id)?.id).toBe(s.id);
    expect(service.getAny(bob, s.id)).toBeNull();
  });
});
