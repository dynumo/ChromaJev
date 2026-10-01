import { describe, expect, it } from 'vitest';
import { CloudflareJevClient } from '../src/jev/cloudflare.js';
import { createJevClient } from '../src/jev/provider.js';
import { TypeSafeJevClient } from '../src/jev/client.js';
import { SemanticCache } from '../src/jev/cache.js';
import { openDatabase } from '../src/db/database.js';
import { loadConfig } from '../src/config.js';
import { CATALOGUE } from '../src/colour/catalogue.js';
import { fakeAnswers } from './helpers/fakeJev.js';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(responses: (() => Response)[]) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const bare = () => ({ model: 'jev-1.13.0', answers: fakeAnswers('autumn forest'), usage: { input_tokens: 4200, output_tokens: 90 } });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function client(responses: (() => Response)[], extra: Partial<ConstructorParameters<typeof CloudflareJevClient>[0]> = {}) {
  const f = fakeFetch(responses);
  const sleeps: number[] = [];
  const c = new CloudflareJevClient({
    accountId: 'acc123',
    apiToken: 'cf-token',
    timeoutMs: 5000,
    fetch: f.fn,
    sleep: async (ms) => void sleeps.push(ms),
    ...extra,
  });
  return { c, calls: f.calls, sleeps };
}

describe('Cloudflare AI Gateway Jev client', () => {
  it('sends the TypeSafe question set inside Cloudflare’s /ai/run envelope', async () => {
    const { c, calls } = client([json(bare())], { gatewayId: 'chromajev' });
    await c.evaluate('autumn forest');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.cloudflare.com/client/v4/accounts/acc123/ai/run');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer cf-token');
    expect(headers['cf-aig-gateway-id']).toBe('chromajev');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe('typesafe/jev');
    expect(body.input.state).toEqual({ concept: 'autumn forest' });
    expect(Object.keys(body.input.questions)).toContain('colour_affinity');
    expect(Object.keys(body.input.questions)).toHaveLength(CATALOGUE.length + 11);
  });

  it('uses the default gateway when no gateway ID is set', async () => {
    const { c, calls } = client([json(bare())]);
    await c.evaluate('browser');
    expect((calls[0].init.headers as Record<string, string>)['cf-aig-gateway-id']).toBeUndefined();
    expect(c.provider).toBe('Cloudflare AI Gateway (default)');
  });

  it('accepts both the bare and the v4-wrapped response shapes', async () => {
    const a = client([json(bare())]);
    const b = client([json({ success: true, errors: [], messages: [], result: bare() })]);
    const ra = await a.c.evaluate('autumn forest');
    const rb = await b.c.evaluate('autumn forest');
    expect(ra.model).toBe('jev-1.13.0');
    expect(rb.answers).toEqual(ra.answers);
    expect(rb.usage).toEqual({ input_tokens: 4200, output_tokens: 90 });
  });

  it('finds answers inside text-generation style and nested wrappers', async () => {
    const answers = bare().answers;
    const shapes = [
      { success: true, result: { response: JSON.stringify(bare()), usage: { prompt_tokens: 4200, completion_tokens: 90 } } },
      { success: true, result: { response: bare() } },
      { success: true, result: { result: bare() } },
      { result: { output: { answers, model: 'jev-1.13.0' } }, usage: { input_tokens: 1, output_tokens: 0 } },
      { success: true, result: { response: JSON.stringify({ answers }), usage: { prompt_tokens: 7, completion_tokens: 3 } }, model: 'jev-1.13.0' },
    ];
    for (const shape of shapes) {
      const r = await client([json(shape)]).c.evaluate('autumn forest');
      expect(Object.keys(r.answers.fit)).toHaveLength(CATALOGUE.length);
    }
    const usageMapped = await client([json(shapes[0])]).c.evaluate('autumn forest');
    expect(usageMapped.model).toBe('jev-1.13.0');
    const workersUsage = await client([json(shapes[4])]).c.evaluate('autumn forest');
    expect(workersUsage.usage).toEqual({ input_tokens: 7, output_tokens: 3 });
    expect(workersUsage.model).toBe('jev-1.13.0');
  });

  it('reports the response structure (never its content) when answers are missing', async () => {
    const err = await client([json({ success: true, result: { response: 'secret text here', usage: { prompt_tokens: 5 } } })])
      .c.evaluate('x')
      .catch((e) => e);
    expect(err.code).toBe('malformed_response');
    expect(err.message).toContain('{success: boolean, result: {response: string(16), usage: {prompt_tokens: number}}}');
    expect(err.message).not.toContain('secret');
  });

  it('rejects malformed answers', async () => {
    await expect(client([json({ result: { answers: { colour_affinity: 'nope' } } })]).c.evaluate('x')).rejects.toMatchObject({ code: 'malformed_response' });
    await expect(client([json({ success: true, result: { text: 'hello' } })]).c.evaluate('x')).rejects.toMatchObject({ code: 'malformed_response' });
    await expect(client([() => new Response('<html>oops</html>', { status: 200 })]).c.evaluate('x')).rejects.toMatchObject({ code: 'malformed_response' });
  });

  it('maps authentication, credit and validation errors without retrying', async () => {
    const auth = client([json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 401)]);
    await expect(auth.c.evaluate('x')).rejects.toMatchObject({ code: 'authentication' });
    expect(auth.calls).toHaveLength(1);
    const notFound = client([json({ result: null, success: false, errors: [{ code: 7003, message: 'Could not route to /client/v4/accounts/x/ai/run' }] }, 404)]);
    await expect(notFound.c.evaluate('x')).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID/);
    const credit = client([json({ success: false, errors: [{ code: 1, message: 'Insufficient credits' }] }, 402)]);
    await expect(credit.c.evaluate('x')).rejects.toThrow(/credit balance/);
    const bad = client([json({ success: false, errors: [{ code: 5006, message: 'Invalid input' }] }, 400)]);
    await expect(bad.c.evaluate('x')).rejects.toMatchObject({ code: 'rejected' });
    expect(bad.calls).toHaveLength(1);
  });

  it('retries rate limits and server errors with backoff, honouring Retry-After', async () => {
    const { c, calls, sleeps } = client([json({ success: false }, 429, { 'retry-after': '2' }), json({}, 503), json(bare())]);
    const r = await c.evaluate('autumn forest');
    expect(r.model).toBe('jev-1.13.0');
    expect(calls).toHaveLength(3);
    expect(sleeps[0]).toBe(2000);
    expect(sleeps[1]).toBeGreaterThan(0);
  });

  it('gives up after the retry budget with a meaningful error', async () => {
    const { c, calls } = client([json({}, 429), json({}, 429), json({}, 429)]);
    await expect(c.evaluate('x')).rejects.toMatchObject({ code: 'rate_limited' });
    expect(calls).toHaveLength(3);
  });

  it('reports network failures and timeouts', async () => {
    const boom = () => {
      throw new TypeError('fetch failed');
    };
    const timeout = () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    };
    await expect(client([boom, boom, boom]).c.evaluate('x')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(client([timeout, timeout, timeout]).c.evaluate('x')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('works behind the semantic cache exactly like the direct route', async () => {
    const { c, calls } = client([json(bare())]);
    const cache = new SemanticCache(openDatabase(':memory:'), c);
    expect((await cache.getOrEvaluate('Autumn Forest')).source).toBe('jev');
    expect((await cache.getOrEvaluate('autumn forest')).source).toBe('cache');
    expect(calls).toHaveLength(1);
  });
});

describe('Jev provider configuration', () => {
  const base = { NODE_ENV: 'test', PUBLIC_BASE_URL: 'http://localhost:3000' };

  it('defaults to TypeSafe', () => {
    const cfg = loadConfig({ ...base, TYPESAFE_API_KEY: 'ts' });
    expect(cfg.jev.provider).toBe('typesafe');
    expect(createJevClient(cfg)).toBeInstanceOf(TypeSafeJevClient);
  });

  it('selects Cloudflare when only Cloudflare credentials are present', () => {
    const cfg = loadConfig({ ...base, CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_AI_GATEWAY_ID: 'chromajev' });
    expect(cfg.jev.provider).toBe('cloudflare');
    const c = createJevClient(cfg) as CloudflareJevClient;
    expect(c).toBeInstanceOf(CloudflareJevClient);
    expect(c.endpoint).toBe('https://api.cloudflare.com/client/v4/accounts/a/ai/run');
    expect(c.provider).toBe('Cloudflare AI Gateway (chromajev)');
  });

  it('honours an explicit JEV_PROVIDER', () => {
    expect(loadConfig({ ...base, JEV_PROVIDER: 'cloudflare', TYPESAFE_API_KEY: 'ts', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' }).jev.provider).toBe('cloudflare');
    expect(loadConfig({ ...base, JEV_PROVIDER: 'typesafe', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' }).jev.provider).toBe('typesafe');
  });

  it('fails clearly on incomplete or invalid Cloudflare settings', () => {
    expect(() => loadConfig({ ...base, JEV_PROVIDER: 'cloudflare', CLOUDFLARE_ACCOUNT_ID: 'a' })).toThrow(/CLOUDFLARE_API_TOKEN/);
    expect(() => loadConfig({ ...base, CLOUDFLARE_API_TOKEN: 't' })).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
    expect(() => loadConfig({ ...base, JEV_PROVIDER: 'openrouter' })).toThrow(/JEV_PROVIDER/);
    expect(() => loadConfig({ ...base, CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_AI_GATEWAY_ID: 'bad id/../' })).toThrow(/GATEWAY_ID/);
  });
});
