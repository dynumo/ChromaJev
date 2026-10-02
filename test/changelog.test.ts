import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, loginAgent, makeApp, type TestApp } from './helpers/app.js';
import { renderEntryBody } from '../src/web/views/changelog.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
});

const post = (agent: request.Agent, csrf: string, path: string, body: Record<string, string>) =>
  agent.post(path).type('form').send({ _csrf: csrf, ...body });

describe('changelog', () => {
  it('is linked from every footer and publicly readable, even signed out', async () => {
    const res = await request(t.app).get('/changelog');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Nothing has been posted yet.');
    expect(res.text).toContain('<a href="/changelog">Changelog</a>');
    expect((await request(t.app).get('/login')).text).toContain('href="/changelog"');
  });

  it('lets an admin post, edit and delete entries from the admin page', async () => {
    const { agent, csrf } = await loginAgent(t);
    const adminPage = await agent.get('/admin');
    expect(adminPage.text).toContain('action="/admin/changelog"');

    const created = await post(agent, csrf, '/admin/changelog', { title: 'Run again', body: 'You can re-run a cached judgement.\n\n- one\n- two', published_at: '2026-10-01' });
    expect(created.status).toBe(303);
    const [entry] = t.ctx.changelog.list();
    expect(entry).toMatchObject({ title: 'Run again', publishedAt: '2026-10-01T12:00:00.000Z' });

    const pub = await request(t.app).get('/changelog');
    expect(pub.text).toContain('Run again');
    expect(pub.text).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(pub.text).toContain('1 October 2026');

    await post(agent, csrf, `/admin/changelog/${entry.id}/edit`, { title: 'Run again (edited)', body: 'Updated.', published_at: '' });
    expect(t.ctx.changelog.get(entry.id)).toMatchObject({ title: 'Run again (edited)', body: 'Updated.', publishedAt: entry.publishedAt });

    await post(agent, csrf, `/admin/changelog/${entry.id}/delete`, {});
    expect(t.ctx.changelog.list()).toHaveLength(0);
  });

  it('lists newest first', () => {
    t.ctx.changelog.create(null, { title: 'Old', body: 'x', publishedAt: '2026-01-01' });
    t.ctx.changelog.create(null, { title: 'New', body: 'x', publishedAt: '2026-06-01' });
    expect(t.ctx.changelog.list().map((e) => e.title)).toEqual(['New', 'Old']);
  });

  it('rejects invalid input', () => {
    expect(() => t.ctx.changelog.create(null, { title: '  ', body: 'x' })).toThrow(/title/);
    expect(() => t.ctx.changelog.create(null, { title: 'x', body: '' })).toThrow(/text/);
    expect(() => t.ctx.changelog.create(null, { title: 'x'.repeat(200), body: 'x' })).toThrow(/at most/);
    expect(() => t.ctx.changelog.create(null, { title: 'x', body: 'x', publishedAt: '2026-02-31' })).toThrow(/real date/);
    expect(() => t.ctx.changelog.create(null, { title: 'x', body: 'x', publishedAt: 'tomorrow' })).toThrow(/YYYY-MM-DD/);
  });

  it('is admin-only to change, and CSRF-protected', async () => {
    await createUser(t, 'bob@example.com');
    const bob = await loginAgent(t, 'bob@example.com', 'user password 123');
    const denied = await post(bob.agent, bob.csrf, '/admin/changelog', { title: 'Hax', body: 'x' });
    expect(denied.status).toBe(403);
    expect(t.ctx.changelog.list()).toHaveLength(0);
    expect((await request(t.app).post('/admin/changelog').type('form').send({ title: 'Hax', body: 'x' })).status).not.toBe(303);

    const admin = await loginAgent(t);
    const noCsrf = await admin.agent.post('/admin/changelog').type('form').send({ title: 'No token', body: 'x' });
    expect(noCsrf.status).toBe(403);
    expect(t.ctx.changelog.list()).toHaveLength(0);
  });

  it('escapes everything an admin types', async () => {
    t.ctx.changelog.create(null, { title: '<script>alert(1)</script>', body: '<img src=x onerror=alert(1)>\n- <b>bold</b>' });
    const text = (await request(t.app).get('/changelog')).text;
    expect(text).not.toContain('<script>alert(1)');
    expect(text).not.toContain('<img src=x');
    expect(text).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(renderEntryBody('a\nb').value).toBe('<p>a<br>b</p>');
  });
});
