import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { getOAuthProtectedResourceMetadataUrl, requireBearerAuth } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { buildOAuthProtectedResourceMetadata } from '@modelcontextprotocol/server';
import type { AppConfig } from './config.js';
import { issuerUrl, mcpResourceUrl } from './config.js';
import { openDatabase, type DB } from './db/database.js';
import { AccountService } from './accounts/service.js';
import { SettingsService } from './accounts/settings.js';
import { SemanticCache } from './jev/cache.js';
import { TypeSafeJevClient, type JevClient } from './jev/client.js';
import { ElasticEmailTransport, LogTransport, UnconfiguredTransport, type MailTransport } from './mail/mailer.js';
import { SchemeService } from './schemes/service.js';
import { createOAuthProvider, OAUTH_PREFIX } from './oauth/provider.js';
import { interactionRoutes } from './oauth/interactions.js';
import { purgeExpiredOAuth, revokeAccountOAuth } from './oauth/adapter.js';
import { loadSigningJwks } from './oauth/keys.js';
import { createMcpHttpHandler, createTokenVerifier, MCP_SCOPES } from './mcp/server.js';
import { apiRoutes } from './api/routes.js';
import { webRoutes } from './web/routes.js';
import { basicAuth, csrfProtection, securityHeaders, sessionLoader } from './web/middleware.js';
import { page } from './web/views/layout.js';
import { messagePage } from './web/views/auth.js';
import { AppError } from './util/errors.js';
import type { AppContext } from './context.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.resolve(here, '..', 'public');

export interface AppOverrides {
  jev?: JevClient;
  mail?: MailTransport;
  db?: DB;
  log?: (msg: string) => void;
}

export function createMailTransport(config: AppConfig, log: (m: string) => void): MailTransport {
  switch (config.mail.transport) {
    case 'elastic':
      return new ElasticEmailTransport({
        apiKey: config.mail.elasticApiKey!,
        fromAddress: config.mail.fromAddress!,
        fromName: config.mail.fromName,
      });
    case 'log':
      return new LogTransport(log);
    default:
      return new UnconfiguredTransport();
  }
}

export async function createApp(config: AppConfig, overrides: AppOverrides = {}) {
  const log = overrides.log ?? ((m: string) => console.log(m));
  const db = overrides.db ?? openDatabase(config.databaseFile);
  const jev =
    overrides.jev ??
    new TypeSafeJevClient({ apiKey: config.jev.apiKey, model: config.jev.model, timeoutMs: config.jev.timeoutMs, baseUrl: config.jev.baseUrl });
  const mail = overrides.mail ?? createMailTransport(config, log);
  const settings = new SettingsService(db);
  const accounts = new AccountService(db, config, settings, mail, log);
  const cache = new SemanticCache(db, jev);
  const schemes = new SchemeService(db, cache);
  const provider = await createOAuthProvider(config, db, accounts);
  accounts.onAccessRevoked((userId) => revokeAccountOAuth(db, userId));

  const ctx: AppContext = { config, db, jev, cache, schemes, accounts, settings, mail, provider };
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  // ── Always-available, unauthenticated ──────────────────────────────────
  app.get('/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      fs.accessSync(config.dataDir, fs.constants.W_OK);
      res.set('Cache-Control', 'no-store').json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'error', detail: 'storage unavailable' });
    }
  });

  app.use(securityHeaders(config));
  app.use(basicAuth(config));
  app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets'), { maxAge: config.env === 'production' ? '1h' : 0 }));

  // ── OAuth / MCP discovery ───────────────────────────────────────────────
  const resourceUrl = new URL(mcpResourceUrl(config));
  const prm = buildOAuthProtectedResourceMetadata({
    oauthMetadata: { issuer: issuerUrl(config) } as never,
    resourceServerUrl: resourceUrl,
    scopesSupported: MCP_SCOPES,
    resourceName: 'ChromaJev',
    serviceDocumentationUrl: new URL('/docs/mcp', config.publicBaseUrl),
    dangerouslyAllowInsecureIssuerUrl: config.env !== 'production',
  } as Parameters<typeof buildOAuthProtectedResourceMetadata>[0]);
  const cors = (_req: Request, res: Response, next: NextFunction) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
      'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version',
    });
    if (_req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  };
  const prmPath = new URL(getOAuthProtectedResourceMetadataUrl(resourceUrl)).pathname;
  app.get([prmPath, '/.well-known/oauth-protected-resource'], cors, (_req, res) => {
    res.json(prm);
  });

  // The authorisation server is oidc-provider (a Koa app). Express decides
  // which forwarded headers to trust, then passes the provider only those.
  const providerCallback = provider.callback();
  const toProvider = (req: Request, res: Response) => {
    for (const h of ['x-forwarded-host', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-port', 'forwarded']) delete req.headers[h];
    req.headers['x-forwarded-proto'] = req.protocol;
    req.headers['x-forwarded-for'] = req.ip ?? '';
    req.headers['x-forwarded-host'] = config.publicBaseUrl.host;
    providerCallback(req, res);
  };
  app.get('/.well-known/oauth-authorization-server', cors, (req, res) => {
    req.url = '/.well-known/openid-configuration';
    toProvider(req, res);
  });
  app.use((req, res, next) => {
    if (req.path === '/.well-known/openid-configuration' || req.path.startsWith(`${OAUTH_PREFIX}/`)) {
      if (req.path.startsWith('/.well-known') || /\/(token|register|jwks|revoke)$/.test(req.path)) {
        res.set('Access-Control-Allow-Origin', '*');
        if (req.method === 'OPTIONS') {
          res.set({ 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' });
          return void res.sendStatus(204);
        }
      }
      return toProvider(req, res);
    }
    next();
  });

  // ── MCP (OAuth bearer tokens only) ─────────────────────────────────────
  const verifier = createTokenVerifier(ctx, await loadSigningJwks(db));
  const mcpNode = toNodeHandler(createMcpHttpHandler(ctx));
  app.options('/mcp', cors);
  app.all(
    '/mcp',
    cors,
    express.json({ limit: '1mb' }),
    requireBearerAuth({ verifier, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl) }),
    (req, res) => void mcpNode(req, res, req.body),
  );

  // ── Session-aware routes ───────────────────────────────────────────────
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(sessionLoader(config, accounts));
  app.use('/api', express.json({ limit: '256kb' }), apiRoutes(ctx));
  app.use(csrfProtection(config));
  app.use(interactionRoutes(ctx));
  app.use(webRoutes(ctx));

  // ── Errors ──────────────────────────────────────────────────────────────
  app.use((req, _res, next) => next(new AppError(404, 'not_found', 'Page not found.')));
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    let e: AppError;
    if (err instanceof AppError) e = err;
    else if ((err as { type?: string }).type === 'entity.parse.failed') e = new AppError(400, 'invalid_json', 'Request body is not valid JSON.');
    else if ((err as { type?: string }).type === 'entity.too.large') e = new AppError(413, 'too_large', 'Request body is too large.');
    else {
      log(`Unhandled error on ${req.method} ${req.path}: ${(err as Error)?.stack ?? err}`);
      e = new AppError(500, 'internal_error', 'Something went wrong on our side.');
    }
    if (res.headersSent) return;
    const wantsJson = req.path.startsWith('/api') || req.path === '/mcp' || (req.headers.accept ?? '').includes('application/json');
    if (wantsJson) {
      res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
      return;
    }
    if (e.status === 401 && !req.user) return void res.redirect(303, `/login?next=${encodeURIComponent(req.originalUrl)}`);
    res
      .status(e.status)
      .send(page({ title: e.status === 404 ? 'Not found' : 'Error', user: req.user, csrfToken: req.csrfToken, body: messagePage(e.status === 404 ? 'Not found' : 'Something went wrong', e.message, { href: '/', label: 'Go home' }) }));
  });

  // Periodic housekeeping (expired sessions, tokens, temporary palettes).
  const housekeeping = () => {
    try {
      accounts.purgeExpired();
      schemes.purgeExpiredGenerations();
      purgeExpiredOAuth(db);
    } catch (err) {
      log(`Housekeeping failed: ${(err as Error).message}`);
    }
  };
  housekeeping();
  const timer = setInterval(housekeeping, 60 * 60_000);
  timer.unref();

  return { app, ctx, stop: () => clearInterval(timer) };
}
