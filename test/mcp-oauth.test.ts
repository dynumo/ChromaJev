import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { SignJWT, importJWK } from 'jose';
import { makeApp, createUser, ADMIN, type TestApp } from './helpers/app.js';
import { loadSigningJwks } from '../src/oauth/keys.js';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

/** Minimal browser: follows nothing automatically, keeps cookies. */
class Browser {
  jar = new Map<string, string>();
  constructor(private base: string) {}
  async go(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.jar.size) headers.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await fetch(new URL(url, this.base), { ...init, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a.trim())) || value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }
  async form(url: string, data: Record<string, string>) {
    return this.go(url, { method: 'POST', body: new URLSearchParams(data), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: this.base } });
  }
}

const csrfOf = (html: string) => /name="_csrf" value="([^"]+)"/.exec(html)![1];

let t: TestApp;
let server: Server;
let base: string;
let mcpUrl: string;

beforeAll(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  mcpUrl = `${base}/mcp`;
  t = await makeApp({ PUBLIC_BASE_URL: base, PORT: String(port) });
  await new Promise<void>((r) => (server = t.app.listen(port, '127.0.0.1', () => r())));
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

interface Tokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

async function authorise(scope: string, email = ADMIN.email, password = ADMIN.password): Promise<{ tokens: Tokens; clientId: string; iss: string | null }> {
  // 1. Discovery from the MCP server's protected resource metadata.
  const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
  expect(prm.resource).toBe(mcpUrl);
  const asUrl = prm.authorization_servers[0];
  const meta = await (await fetch(`${asUrl}/.well-known/oauth-authorization-server`)).json();
  expect(meta.issuer).toBe(asUrl);
  expect(meta.code_challenge_methods_supported).toContain('S256');

  // 2. Dynamic client registration (public client).
  const reg = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Test MCP Client',
      redirect_uris: ['http://127.0.0.1:9999/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
    }),
  });
  expect(reg.status).toBe(201);
  const client = await reg.json();

  // 3. Authorisation request with PKCE and resource indicator.
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const browser = new Browser(base);
  const authUrl = new URL(meta.authorization_endpoint);
  authUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: 'http://127.0.0.1:9999/callback',
    scope,
    state: 'xyz',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: mcpUrl,
  }).toString();
  let res = await browser.go(authUrl.href);
  expect(res.status).toBe(303);
  let loc = res.headers.get('location')!;
  expect(loc).toMatch(/^\/interaction\//);

  // 4. Log in with the normal ChromaJev account.
  res = await browser.go(loc);
  let html = await res.text();
  expect(html).toContain('Test MCP Client');
  res = await browser.form(`${loc}/login`, { _csrf: csrfOf(html), email, password });
  if (res.status !== 303) throw Object.assign(new Error(`login step failed ${res.status}`), { html: await res.text() });
  // 5. Follow the resume redirect to consent.
  for (let i = 0; i < 4 && res.status >= 300 && res.status < 400; i++) {
    loc = res.headers.get('location')!;
    if (loc.startsWith('http://127.0.0.1:9999')) break;
    res = await browser.go(loc);
    if (res.status === 200) {
      html = await res.text();
      if (html.includes('/confirm')) {
        const uidPath = /action="(\/interaction\/[^/]+)\/confirm"/.exec(html)![1];
        res = await browser.form(`${uidPath}/confirm`, { _csrf: csrfOf(html) });
      }
    }
  }
  loc = res.headers.get('location')!;
  const cb = new URL(loc);
  expect(cb.origin).toBe('http://127.0.0.1:9999');
  expect(cb.searchParams.get('state')).toBe('xyz');
  const code = cb.searchParams.get('code');
  if (!code) throw new Error(`no code: ${loc}`);

  // 6. Token exchange.
  const tok = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://127.0.0.1:9999/callback',
      client_id: client.client_id,
      code_verifier: verifier,
      resource: mcpUrl,
    }),
  });
  const tokens = (await tok.json()) as Tokens;
  expect(tok.status, JSON.stringify(tokens)).toBe(200);
  return { tokens, clientId: client.client_id, iss: cb.searchParams.get('iss') };
}

async function mcpClient(token: string) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

async function forgeToken(claims: Record<string, unknown>, expSecondsFromNow = 3600) {
  const jwks = await loadSigningJwks(t.db);
  const key = await importJWK(jwks.keys[0], 'RS256');
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: jwks.keys[0].kid })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSecondsFromNow)
    .sign(key);
}

describe('MCP discovery and challenge', () => {
  it('answers unauthenticated calls with 401 and a resource_metadata challenge', async () => {
    const res = await fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
  });

  it('publishes protected-resource and authorisation-server metadata', async () => {
    const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
    expect(prm.scopes_supported).toEqual(['schemes:read', 'schemes:generate', 'schemes:write']);
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    const oidc = await (await fetch(`${base}/.well-known/openid-configuration`)).json();
    expect(as).toEqual(oidc);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
    expect(as.client_id_metadata_document_supported).toBe(true);
    expect(as.response_types_supported).toEqual(['code']);
  });
});

describe('MCP with OAuth', () => {
  let full: Tokens;

  beforeAll(async () => {
    const out = await authorise('schemes:read schemes:generate schemes:write');
    full = out.tokens;
    expect(out.iss).toBe(base); // RFC 9207
  });

  it('issues audience-bound JWT access tokens and refresh tokens', () => {
    const payload = JSON.parse(Buffer.from(full.access_token.split('.')[1], 'base64url').toString());
    expect(payload.aud).toBe(mcpUrl);
    expect(payload.iss).toBe(base);
    expect(payload.scope.split(' ').sort()).toEqual(['schemes:generate', 'schemes:read', 'schemes:write']);
    expect(full.refresh_token).toBeTruthy();
  });

  it('discovers tools and resources', async () => {
    const client = await mcpClient(full.access_token);
    const tools = await client.listTools();
    const names = tools.tools.map((x) => x.name).sort();
    expect(names).toEqual(['delete_colour_scheme', 'generate_colour_scheme', 'get_colour_scheme', 'list_colour_schemes', 'rename_colour_scheme', 'save_colour_scheme']);
    expect(tools.tools.find((x) => x.name === 'delete_colour_scheme')!.annotations?.destructiveHint).toBe(true);
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates[0].uriTemplate).toBe('chromajev://schemes/{slug}');
    await client.close();
  });

  it('generates (via the cache), saves, lists, gets and reads resources', async () => {
    const client = await mcpClient(full.access_token);
    const before = t.jev.calls.length;
    const gen = await client.callTool({ name: 'generate_colour_scheme', arguments: { concept: 'autumn forest' } });
    expect(gen.isError).toBeFalsy();
    const g = gen.structuredContent as { generationId: string; light: Record<string, string>; dark: Record<string, string>; cache: { fromCache: boolean }; accessibility: { light: { allPass: boolean } } };
    expect(g.light.primary).toMatch(/^#/);
    expect(g.dark.primary).toMatch(/^#/);
    expect(g.accessibility.light.allPass).toBe(true);
    const again = await client.callTool({ name: 'generate_colour_scheme', arguments: { concept: 'Autumn Forest', variation: 1 } });
    expect((again.structuredContent as { cache: { fromCache: boolean } }).cache.fromCache).toBe(true);
    expect(t.jev.calls.length - before).toBeLessThanOrEqual(1);

    const saved = await client.callTool({ name: 'save_colour_scheme', arguments: { name: 'Forest', generation_id: g.generationId } });
    expect(saved.isError).toBeFalsy();
    const s = saved.structuredContent as { slug: string; light: Record<string, string>; dark: Record<string, string> };
    expect(s.slug).toBe('forest');
    expect(s.light).toEqual(g.light);
    expect(s.dark).toEqual(g.dark);

    const list = await client.callTool({ name: 'list_colour_schemes', arguments: {} });
    expect((list.structuredContent as { total: number }).total).toBeGreaterThanOrEqual(1);
    const got = await client.callTool({ name: 'get_colour_scheme', arguments: { name: 'forest' } });
    expect((got.structuredContent as { slug: string }).slug).toBe('forest');

    const resource = await client.readResource({ uri: 'chromajev://schemes/forest' });
    const content = resource.contents[0] as { text: string };
    expect(JSON.parse(content.text).dark.background).toBe(s.dark.background);
    await client.close();
  });

  it('only exposes the authorised user’s schemes', async () => {
    const bob = await createUser(t, 'bob-mcp@example.com', 'bob password 123');
    const g = await t.ctx.schemes.generate(bob, { concept: 'calm healthcare' });
    await t.ctx.schemes.save(bob, { name: 'Bob Secret', generationId: g.generationId });
    const client = await mcpClient(full.access_token);
    const got = await client.callTool({ name: 'get_colour_scheme', arguments: { slug: 'bob-secret' } });
    expect(got.isError).toBe(true);
    const list = await client.callTool({ name: 'list_colour_schemes', arguments: {} });
    expect(JSON.stringify(list.structuredContent)).not.toContain('Bob Secret');
    await client.close();
  });

  it('refuses write tools to a read-only token (insufficient scope)', async () => {
    const { tokens } = await authorise('schemes:read');
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tokens.access_token}`, 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_colour_scheme', arguments: { id_or_slug: 'forest' } } }),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toContain('error="insufficient_scope"');
    expect(res.headers.get('www-authenticate')).toContain('scope="schemes:write"');
    expect(t.ctx.schemes.getOwned(t.ctx.accounts.getUserByEmail(ADMIN.email)!, 'forest')).not.toBeNull();
  });

  it('rejects invalid, expired and wrong-audience tokens', async () => {
    const call = (token: string) =>
      fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect((await call('not-a-jwt')).status).toBe(401);
    const admin = t.ctx.accounts.getUserByEmail(ADMIN.email)!;
    const base_claims = { iss: base, sub: admin.id, scope: 'schemes:read', client_id: 'x' };
    expect((await call(await forgeToken({ ...base_claims, aud: mcpUrl }, -60))).status).toBe(401);
    expect((await call(await forgeToken({ ...base_claims, aud: 'https://other.example/mcp' }))).status).toBe(401);
    expect((await call(await forgeToken({ ...base_claims, aud: mcpUrl, iss: 'https://evil.example' }))).status).toBe(401);
    // Control: a correctly formed token works.
    expect((await call(await forgeToken({ ...base_claims, aud: mcpUrl }))).status).toBe(200);
  });

  it('refreshes tokens', async () => {
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    const { tokens, clientId } = await authorise('schemes:read');
    const res = await fetch(as.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: clientId, resource: mcpUrl }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).access_token).toBeTruthy();
  });

  it('disabled accounts lose existing tokens and cannot authorise again', async () => {
    const carol = await createUser(t, 'carol@example.com', 'carol password 123');
    const { tokens } = await authorise('schemes:read', 'carol@example.com', 'carol password 123');
    const ok = await mcpClient(tokens.access_token);
    await ok.listTools();
    await ok.close();
    t.ctx.accounts.setStatus(t.ctx.accounts.getUserByEmail(ADMIN.email)!, carol.id, 'disabled');
    const res = await fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tokens.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(res.status).toBe(401);
    const grants = t.db.prepare(`SELECT COUNT(*) n FROM oauth_models WHERE account_id = ?`).get(carol.id) as { n: number };
    expect(grants.n).toBe(0);
    await expect(authorise('schemes:read', 'carol@example.com', 'carol password 123')).rejects.toThrow(/login step failed 403/);
  });
});
