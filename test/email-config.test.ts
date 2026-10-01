import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { ElasticEmailTransport, MailDeliveryError, UnconfiguredTransport } from '../src/mail/mailer.js';
import { invitationEmail, passwordResetEmail, verificationEmail } from '../src/mail/templates.js';
import { createMailTransport } from '../src/app.js';
import { makeApp } from './helpers/app.js';

const base = { NODE_ENV: 'test', PUBLIC_BASE_URL: 'http://localhost:3000' };

describe('email templates', () => {
  const expiresAt = '2026-10-08T12:00:00.000Z';
  it('invitation explains ChromaJev, who invited, expiry and the link', () => {
    const m = invitationEmail({ to: 'a@example.com', url: 'https://cj.example/invite?token=abc', expiresAt, invitedBy: 'Adam', siteUrl: 'https://cj.example' });
    for (const body of [m.html, m.text]) {
      expect(body).toContain('ChromaJev');
      expect(body).toContain('Adam');
      expect(body).toContain('8 October 2026');
      expect(body).toContain('https://cj.example/invite?token=abc');
    }
    expect(m.text).not.toMatch(/password:/i);
  });
  it('verification and reset have HTML and plain text', () => {
    const v = verificationEmail({ to: 'a@example.com', url: 'https://x/verify-email?token=t', expiresAt });
    const r = passwordResetEmail({ to: 'a@example.com', url: 'https://x/reset-password?token=t', expiresAt });
    for (const m of [v, r]) {
      expect(m.html).toContain('<html');
      expect(m.text).toContain('token=t');
      expect(m.text).not.toContain('<');
    }
  });
  it('escapes user-controlled values in HTML', () => {
    const m = invitationEmail({ to: 'a@example.com', url: 'https://x/i?token=1', expiresAt, invitedBy: '<script>x</script>', siteUrl: 'https://x' });
    expect(m.html).not.toContain('<script>');
  });
});

describe('Elastic Email transport', () => {
  it('posts a v4 transactional request with the API key header', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ TransactionID: 't', MessageID: 'm' }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = new ElasticEmailTransport({ apiKey: 'KEY', fromAddress: 'noreply@cj.example', fromName: 'ChromaJev', fetch: fake });
    await t.send({ to: 'b@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', kind: 'test' });
    expect(calls[0].url).toBe('https://api.elasticemail.com/v4/emails/transactional');
    expect((calls[0].init.headers as Record<string, string>)['X-ElasticEmail-ApiKey']).toBe('KEY');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.Recipients.To).toEqual(['b@example.com']);
    expect(body.Content.From).toBe('ChromaJev <noreply@cj.example>');
    expect(body.Content.Body.map((b: { ContentType: string }) => b.ContentType)).toEqual(['HTML', 'PlainText']);
  });

  it('surfaces delivery failures', async () => {
    const fake = (async () => new Response('bad key', { status: 401 })) as unknown as typeof fetch;
    const t = new ElasticEmailTransport({ apiKey: 'KEY', fromAddress: 'x@y.z', fromName: 'C', fetch: fake });
    await expect(t.send({ to: 'b@example.com', subject: 'Hi', html: '', text: '', kind: 'test' })).rejects.toBeInstanceOf(MailDeliveryError);
  });
});

describe('mail configuration', () => {
  it('refuses the logging transport in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://cj.example', MAIL_TRANSPORT: 'log' })).toThrow(/refused in production/);
  });
  it('never silently falls back to logging in production', async () => {
    const config = loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://cj.example' });
    expect(config.mail.transport).toBe('none');
    const t = createMailTransport(config, () => undefined);
    expect(t).toBeInstanceOf(UnconfiguredTransport);
    await expect(t.send()).rejects.toThrow(/not configured/);
  });
  it('requires a from address for Elastic Email', () => {
    expect(() => loadConfig({ ...base, ELASTIC_EMAIL_API_KEY: 'k' })).toThrow(/MAIL_FROM_ADDRESS/);
    expect(loadConfig({ ...base, ELASTIC_EMAIL_API_KEY: 'k', MAIL_FROM_ADDRESS: 'a@b.c' }).mail.transport).toBe('elastic');
  });
});

describe('configuration', () => {
  it('requires https PUBLIC_BASE_URL in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://cj.example' })).toThrow(/https/);
    expect(() => loadConfig({ ...base, PUBLIC_BASE_URL: 'https://cj.example/sub' })).toThrow(/without a path/);
  });
  it('defaults the data directory to /data in production', () => {
    expect(loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://cj.example' }).dataDir).toBe('/data');
  });
});

describe('optional perimeter Basic Auth', () => {
  const auth = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

  it('is disabled when neither variable is set', async () => {
    const t = await makeApp();
    expect(t.config.basicAuth).toBeNull();
    expect((await request(t.app).get('/')).status).toBe(200);
  });

  it('fails clearly when only one variable is set', () => {
    expect(() => loadConfig({ ...base, BASIC_AUTH_USERNAME: 'gate' })).toThrow(/half-configured/);
    expect(() => loadConfig({ ...base, BASIC_AUTH_PASSWORD: 'pw' })).toThrow(/half-configured/);
  });

  it('challenges browsers and accepts only valid credentials', async () => {
    const t = await makeApp({ BASIC_AUTH_USERNAME: 'gate', BASIC_AUTH_PASSWORD: 'open sesame' });
    const none = await request(t.app).get('/');
    expect(none.status).toBe(401);
    expect(none.headers['www-authenticate']).toMatch(/^Basic/);
    expect((await request(t.app).get('/').set('Authorization', auth('gate', 'wrong'))).status).toBe(401);
    expect((await request(t.app).get('/').set('Authorization', auth('gate', 'open sesame'))).status).toBe(200);
  });

  it('is separate from API, MCP and OAuth authentication', async () => {
    const t = await makeApp({ BASIC_AUTH_USERNAME: 'gate', BASIC_AUTH_PASSWORD: 'open sesame' });
    expect((await request(t.app).get('/health')).status).toBe(200);
    expect((await request(t.app).get('/.well-known/oauth-protected-resource/mcp')).status).toBe(200);
    // API and MCP answer with their own Bearer challenges, not Basic.
    const api = await request(t.app).get('/api/schemes');
    expect(api.status).toBe(401);
    expect(api.headers['www-authenticate']).toMatch(/^Bearer/);
    const mcp = await request(t.app).post('/mcp').send({});
    expect(mcp.status).toBe(401);
    expect(mcp.headers['www-authenticate']).toMatch(/^Bearer/);
    // Basic credentials are not accepted as API credentials.
    expect((await request(t.app).get('/api/schemes').set('Authorization', auth('gate', 'open sesame'))).status).toBe(401);
  });
});

describe('health', () => {
  it('reports ok without touching Jev', async () => {
    const t = await makeApp();
    const res = await request(t.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(t.jev.calls).toHaveLength(0);
  });
});
