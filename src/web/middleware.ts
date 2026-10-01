import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../config.js';
import type { AccountService, User } from '../accounts/service.js';
import { randomToken, safeEqual } from '../util/crypto.js';
import { AppError } from '../util/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      sessionToken?: string;
      csrfToken: string;
      /** Set by API key / bearer auth on /api routes. */
      apiScopes?: string[];
      authVia?: 'session' | 'api_key';
    }
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export interface CookieNames {
  session: string;
  csrf: string;
}

/** `__Host-` prefix pins cookies to this exact origin when served over HTTPS. */
export function cookieNames(config: AppConfig): CookieNames {
  const p = config.secureCookies ? '__Host-' : '';
  return { session: `${p}cj_session`, csrf: `${p}cj_csrf` };
}

export function setCookie(res: Response, config: AppConfig, name: string, value: string, maxAgeSeconds?: number): void {
  res.cookie(name, value, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/',
    ...(maxAgeSeconds !== undefined ? { maxAge: maxAgeSeconds * 1000 } : {}),
  });
}

export function clearCookie(res: Response, config: AppConfig, name: string): void {
  res.clearCookie(name, { httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/' });
}

/** Optional perimeter Basic Auth (not the account system). */
export function basicAuth(config: AppConfig) {
  const creds = config.basicAuth;
  // Machine-to-machine endpoints carry their own Authorization header (an
  // HTTP request can only have one), and health checks must stay reachable.
  const exempt = [
    /^\/health$/,
    /^\/mcp(\/|$)/,
    /^\/api(\/|$)/,
    /^\/\.well-known\//,
    /^\/oauth\/(token|register|jwks|revoke|introspect|userinfo|par)$/,
  ];
  return (req: Request, res: Response, next: NextFunction) => {
    if (!creds) return next();
    if (exempt.some((re) => re.test(req.path))) return next();
    const header = req.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');
    if (scheme?.toLowerCase() === 'basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      if (i >= 0 && safeEqual(decoded.slice(0, i), creds.username) && safeEqual(decoded.slice(i + 1), creds.password)) {
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="ChromaJev", charset="UTF-8"');
    res.status(401).type('text/plain').send('Authentication required.');
  };
}

export function securityHeaders(config: AppConfig) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    });
    if (config.secureCookies) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  };
}

/**
 * Loads the signed-in user from the session cookie and establishes a CSRF
 * token: the session's token when signed in, otherwise a per-browser cookie.
 */
export function sessionLoader(config: AppConfig, accounts: AccountService) {
  const names = cookieNames(config);
  return (req: Request, res: Response, next: NextFunction) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[names.session];
    const resolved = accounts.resolveSession(token);
    if (resolved) {
      req.user = resolved.user;
      req.sessionToken = token;
      req.csrfToken = resolved.csrfToken;
      req.authVia = 'session';
    } else {
      if (token) clearCookie(res, config, names.session);
      let csrf = cookies[names.csrf];
      if (!csrf || csrf.length < 20) {
        csrf = randomToken(24);
        setCookie(res, config, names.csrf, csrf);
      }
      req.csrfToken = csrf;
    }
    next();
  };
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated, state-changing requests:
 * same-origin check (Origin / Sec-Fetch-Site) plus a synchroniser token in
 * the form body (`_csrf`) or the `X-CSRF-Token` header.
 */
export function csrfProtection(config: AppConfig) {
  const origin = config.publicBaseUrl.origin;
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE.has(req.method)) return next();
    const reqOrigin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    if (reqOrigin && reqOrigin !== origin && reqOrigin !== 'null') {
      return next(new AppError(403, 'csrf', 'Cross-site request refused.'));
    }
    if (site && site !== 'same-origin' && site !== 'none') {
      return next(new AppError(403, 'csrf', 'Cross-site request refused.'));
    }
    const supplied = (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>)._csrf : undefined) ?? req.headers['x-csrf-token'];
    if (typeof supplied !== 'string' || !safeEqual(supplied, req.csrfToken)) {
      return next(new AppError(403, 'csrf', 'Your form expired. Reload the page and try again.'));
    }
    next();
  };
}

/** Small in-memory sliding-window limiter (per process) for auth endpoints. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true if the action is allowed (and records it). */
  attempt(key: string): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number): void {
    for (const [k, v] of this.hits) if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (req.user) return next();
  const back = encodeURIComponent(req.originalUrl);
  res.redirect(303, `/login?next=${back}`);
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role === 'admin') return next();
  next(new AppError(req.user ? 403 : 401, 'forbidden', 'Administrators only.'));
}

/** Only allow same-site relative redirect targets. */
export function safeNext(next: unknown, fallback = '/'): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
