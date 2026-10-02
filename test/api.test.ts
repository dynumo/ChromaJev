import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, loginAgent, makeApp, type TestApp } from './helpers/app.js';
import { JevError } from '../src/jev/client.js';

let t: TestApp;
let key: string;
let readOnlyKey: string;
let bobKey: string;

beforeEach(async () => {
  t = await makeApp();
  const admin = t.ctx.accounts.getUserByEmail('admin@example.com')!;
  key = t.ctx.accounts.createApiKey(admin, 'full', ['schemes:read', 'schemes:generate', 'schemes:write']).key;
  readOnlyKey = t.ctx.accounts.createApiKey(admin, 'ro', ['schemes:read']).key;
  const bob = await createUser(t, 'bob@example.com');
  bobKey = t.ctx.accounts.createApiKey(bob, 'bob', ['schemes:read', 'schemes:generate', 'schemes:write']).key;
});

const api = (k: string) => ({
  get: (p: string) => request(t.app).get(`/api${p}`).set('Authorization', `Bearer ${k}`),
  post: (p: string, body?: object) => request(t.app).post(`/api${p}`).set('Authorization', `Bearer ${k}`).send(body ?? {}),
  patch: (p: string, body: object) => request(t.app).patch(`/api${p}`).set('Authorization', `Bearer ${k}`).send(body),
  delete: (p: string) => request(t.app).delete(`/api${p}`).set('Authorization', `Bearer ${k}`),
});

describe('re-running a cached judgement', () => {
  it('refresh: true asks Jev again, replaces the cached entry and is rate limited', async () => {
    const first = await api(key).post('/schemes/generate', { concept: 'autumn forest' });
    expect(first.body.cache.fromCache).toBe(false);
    const cached = await api(key).post('/schemes/generate', { concept: 'autumn forest' });
    expect(cached.body.cache.fromCache).toBe(true);
    expect(t.jev.calls).toHaveLength(1);

    t.jev.model = 'jev-2.0.0';
    const again = await api(key).post('/schemes/generate', { concept: 'autumn forest', refresh: true });
    expect(again.status).toBe(200);
    expect(again.body.cache).toMatchObject({ fromCache: false, source: 'jev', model: 'jev-2.0.0', evaluationId: first.body.cache.evaluationId });
    expect(t.jev.calls).toHaveLength(2);
    expect((await api(key).post('/schemes/generate', { concept: 'autumn forest' })).body.cache.model).toBe('jev-2.0.0');

    // only a literal boolean true refreshes
    await api(key).post('/schemes/generate', { concept: 'autumn forest', refresh: 'yes' });
    expect(t.jev.calls).toHaveLength(2);

    for (let i = 0; i < 9; i++) expect((await api(key).post('/schemes/generate', { concept: 'autumn forest', refresh: true })).status).toBe(200);
    const limited = await api(key).post('/schemes/generate', { concept: 'autumn forest', refresh: true });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    // ordinary generation is unaffected by the refresh limit
    expect((await api(key).post('/schemes/generate', { concept: 'autumn forest' })).status).toBe(200);
  });

  it('shows the Run again button only for cached results in the generator', async () => {
    const { agent } = await loginAgent(t);
    const page = await agent.get('/');
    expect(page.text).toContain('data-rerun');
    expect(page.text.indexOf('data-rerun')).toBeLessThan(page.text.indexOf('data-another'));
  });
});

describe('HTTP API', () => {
  it('requires authentication', async () => {
    const res = await request(t.app).get('/api/schemes');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorised');
    expect((await api('cj_not_a_real_key').get('/schemes')).status).toBe(401);
  });

  it('stores API keys hashed', () => {
    const rows = t.db.prepare('SELECT key_hash, prefix FROM api_keys').all() as { key_hash: string; prefix: string }[];
    for (const r of rows) expect(r.key_hash).not.toContain(r.prefix.slice(3));
  });

  it('generates paired light/dark schemes and reports cache use', async () => {
    const first = await api(key).post('/schemes/generate', { concept: 'autumn forest' });
    expect(first.status).toBe(200);
    expect(first.body.cache.fromCache).toBe(false);
    expect(first.body.light.primary).toMatch(/^#[0-9a-f]{6}$/);
    expect(first.body.light.primaryForeground).toMatch(/^#/);
    expect(first.body.dark.background).toMatch(/^#/);
    expect(first.body.accessibility.light.allPass).toBe(true);
    expect(first.body.generationId).toBeTruthy();
    const second = await api(key).post('/schemes/generate', { concept: 'Autumn  Forest' });
    expect(second.body.cache.fromCache).toBe(true);
    expect(t.jev.calls).toHaveLength(1);
  });

  it('validates input and maps Jev failures', async () => {
    expect((await api(key).post('/schemes/generate', { concept: '' })).status).toBe(400);
    expect((await api(key).post('/schemes/generate', { concept: 'x'.repeat(500) })).status).toBe(400);
    t.jev.failWith = new JevError('rate_limited', 'Jev is rate limiting requests.', true);
    const rl = await api(key).post('/schemes/generate', { concept: 'new thing' });
    expect(rl.status).toBe(429);
    expect(rl.body.error.code).toBe('jev_rate_limited');
    t.jev.failWith = new JevError('not_configured', 'Jev is not configured');
    expect((await api(key).post('/schemes/generate', { concept: 'another' })).status).toBe(503);
    t.jev.failWith = new JevError('malformed_response', 'bad');
    expect((await api(key).post('/schemes/generate', { concept: 'third' })).status).toBe(502);
    t.jev.failWith = new JevError('timeout', 'slow');
    expect((await api(key).post('/schemes/generate', { concept: 'fourth' })).status).toBe(504);
  });

  it('saves, retrieves, lists, renames, duplicates, exports and deletes', async () => {
    const gen = await api(key).post('/schemes/generate', { concept: 'trustworthy fintech' });
    const saved = await api(key).post('/schemes', { name: 'Dynumo', generationId: gen.body.generationId });
    expect(saved.status).toBe(201);
    expect(saved.body.slug).toBe('dynumo');
    expect(saved.body.light).toEqual(gen.body.light);
    expect(saved.body.dark).toEqual(gen.body.dark);

    const bySlug = await api(key).get('/schemes/dynumo');
    expect(bySlug.body.id).toBe(saved.body.id);
    expect((await api(key).get(`/schemes/${saved.body.id}`)).body.name).toBe('Dynumo');

    const list = await api(key).get('/schemes');
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].preview.dark.primary).toMatch(/^#/);

    const renamed = await api(key).patch('/schemes/dynumo', { name: 'Brief NI' });
    expect(renamed.body.slug).toBe('brief-ni');

    const dup = await api(key).post('/schemes/brief-ni/duplicate');
    expect(dup.status).toBe(201);

    const css = await api(key).get('/schemes/brief-ni/export?format=css');
    expect(css.text).toContain('[data-theme="dark"]');
    const tw = await api(key).get('/schemes/brief-ni/export?format=tailwind');
    expect(tw.text).toContain('@theme inline');

    expect((await api(key).delete('/schemes/brief-ni')).body.deleted).toBe(true);
    expect((await api(key).get('/schemes/brief-ni')).status).toBe(404);
  });

  it('enforces ownership', async () => {
    const gen = await api(key).post('/schemes/generate', { concept: 'browser' });
    const saved = await api(key).post('/schemes', { name: 'Private', generationId: gen.body.generationId });
    expect((await api(bobKey).get(`/schemes/${saved.body.id}`)).status).toBe(404);
    expect((await api(bobKey).get('/schemes/private')).status).toBe(404);
    expect((await api(bobKey).delete(`/schemes/${saved.body.id}`)).status).toBe(404);
    expect((await api(bobKey).patch(`/schemes/${saved.body.id}`, { name: 'x' })).status).toBe(404);
    expect((await api(bobKey).get('/schemes')).body.total).toBe(0);
    // Bob cannot save Alice's generation either.
    expect((await api(bobKey).post('/schemes', { name: 'Stolen', generationId: gen.body.generationId })).status).toBe(404);
  });

  it('protects write operations with scopes', async () => {
    expect((await api(readOnlyKey).get('/schemes')).status).toBe(200);
    const gen = await api(readOnlyKey).post('/schemes/generate', { concept: 'browser' });
    expect(gen.status).toBe(403);
    expect(gen.body.error.code).toBe('insufficient_scope');
    expect((await api(readOnlyKey).post('/schemes', { name: 'x', generationId: 'y' })).status).toBe(403);
    expect((await api(readOnlyKey).delete('/schemes/anything')).status).toBe(403);
  });

  it('rejects keys of disabled users and revoked keys', async () => {
    const admin = t.ctx.accounts.getUserByEmail('admin@example.com')!;
    const bob = t.ctx.accounts.getUserByEmail('bob@example.com')!;
    t.ctx.accounts.setStatus(admin, bob.id, 'disabled');
    expect((await api(bobKey).get('/schemes')).status).toBe(401);
    const k = t.ctx.accounts.listApiKeys(admin).find((x) => x.name === 'ro')!;
    t.ctx.accounts.revokeApiKey(admin, k.id);
    expect((await api(readOnlyKey).get('/schemes')).status).toBe(401);
  });

  it('accepts the web session with a CSRF token, and refuses it without', async () => {
    const { agent, csrf } = await loginAgent(t);
    expect((await agent.post('/api/schemes/generate').send({ concept: 'browser' })).status).toBe(403);
    const ok = await agent.post('/api/schemes/generate').set('X-CSRF-Token', csrf).send({ concept: 'browser' });
    expect(ok.status).toBe(200);
    const cross = await agent.post('/api/schemes/generate').set('X-CSRF-Token', csrf).set('Origin', 'https://evil.example').send({ concept: 'browser' });
    expect(cross.status).toBe(403);
  });

  it('serves an OpenAPI document', async () => {
    const res = await request(t.app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/schemes/generate'].post).toBeDefined();
  });
});

describe('web pages for saved schemes', () => {
  it('renders library and scheme pages, and hides other users’ schemes', async () => {
    const admin = t.ctx.accounts.getUserByEmail('admin@example.com')!;
    const g = await t.ctx.schemes.generate(admin, { concept: 'warm bakery' });
    await t.ctx.schemes.save(admin, { name: 'Bakery', generationId: g.generationId });
    const { agent } = await loginAgent(t);
    const lib = await agent.get('/schemes');
    expect(lib.text).toContain('Bakery');
    const page = await agent.get('/schemes/bakery');
    expect(page.status).toBe(200);
    expect(page.text).toContain('scheme-data');
    expect((await agent.get('/schemes/bakery/export.json')).body.name ?? JSON.parse((await agent.get('/schemes/bakery/export.json')).text).name).toBe('Bakery');

    const bob = await loginAgent(t, 'bob@example.com', 'user password 123');
    expect((await bob.agent.get('/schemes/bakery')).status).toBe(404);
    expect((await bob.agent.get('/schemes')).text).not.toContain('Bakery');
  });
});
