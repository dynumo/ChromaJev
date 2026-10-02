import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AppContext } from '../context.js';
import { mcpResourceUrl, absoluteUrl } from '../config.js';
import { AppError } from '../util/errors.js';
import { listGrants, revokeGrant } from '../oauth/adapter.js';
import { exportScheme, EXPORT_FORMATS, type ExportFormat } from '../palette/exports.js';
import {
  forgotPage,
  invitePage,
  landingPage,
  loginPage,
  messagePage,
  resetPage,
  signupPage,
} from './views/auth.js';
import { accountPage, adminPage } from './views/admin.js';
import { page } from './views/layout.js';
import { generatorPage, libraryPage, schemePage } from './views/schemes.js';
import { apiDocsPage, mcpDocsPage } from './views/docs.js';
import { changelogPage } from './views/changelog.js';
import { RateLimiter, parseCookies, clearCookie, cookieNames, requireAdmin, requireUser, safeNext, setCookie } from './middleware.js';
import { SESSION_TTL_DAYS } from '../accounts/service.js';

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const FLASH_COOKIE = 'cj_flash';
type Flash = { kind: 'success' | 'error' | 'info'; message: string };

/** One-shot flash message carried in a short-lived cookie (not the URL). */
function flashFromQuery(req: Request, res?: Response): Flash | null {
  const raw = parseCookies(req.headers.cookie)[FLASH_COOKIE];
  if (!raw) return null;
  res?.clearCookie(FLASH_COOKIE, { path: '/' });
  try {
    const f = JSON.parse(raw) as Flash;
    if ((f.kind === 'success' || f.kind === 'error' || f.kind === 'info') && typeof f.message === 'string') return { kind: f.kind, message: f.message.slice(0, 400) };
  } catch {
    /* ignore */
  }
  return null;
}

export function webRoutes(ctx: AppContext): Router {
  const redirectWithFlash = (res: Response, path: string, kind: 'ok' | 'err', message: string) => {
    res.cookie(FLASH_COOKIE, JSON.stringify({ kind: kind === 'ok' ? 'success' : 'error', message }), {
      httpOnly: true,
      sameSite: 'lax',
      secure: ctx.config.secureCookies,
      path: '/',
      maxAge: 60_000,
    });
    res.redirect(303, path);
  };
  const r = Router();
  const names = cookieNames(ctx.config);
  const loginLimiter = new RateLimiter(10, 15 * 60_000);
  const emailLimiter = new RateLimiter(5, 15 * 60_000);

  const startSession = (res: Response, userId: string) => {
    const s = ctx.accounts.createSession(userId);
    setCookie(res, ctx.config, names.session, s.token, SESSION_TTL_DAYS * 86400);
    return s;
  };

  // ── Home / generator ────────────────────────────────────────────────────
  r.get('/', (req, res) => {
    if (!req.user) {
      res.send(page({ title: 'Colour schemes from concepts', body: landingPage(ctx.settings.publicRegistration()), csrfToken: req.csrfToken }));
      return;
    }
    const initial = typeof req.query.concept === 'string' ? req.query.concept.slice(0, 120) : undefined;
    res.send(
      page({
        title: 'Generate',
        user: req.user,
        csrfToken: req.csrfToken,
        active: 'generate',
        wide: true,
        includePlayground: true,
        body: generatorPage({
          csrf: req.csrfToken,
          recent: ctx.schemes.recentConcepts(req.user),
          initialConcept: initial,
          jevConfigured: ctx.cache.jevConfigured,
        }),
      }),
    );
  });

  // ── Sign in / out ───────────────────────────────────────────────────────
  r.get('/login', (req, res) => {
    if (req.user) return res.redirect(303, safeNext(req.query.next));
    const notice = req.query.verified ? 'Email confirmed — you can sign in now.' : req.query.reset ? 'Password updated. Sign in with your new password.' : null;
    res.send(
      page({
        title: 'Sign in',
        csrfToken: req.csrfToken,
        body: loginPage({ csrf: req.csrfToken, next: safeNext(req.query.next), publicSignup: ctx.settings.publicRegistration(), notice }),
      }),
    );
  });

  r.post(
    '/login',
    wrap(async (req, res) => {
      const next = safeNext(req.body.next);
      const email = String(req.body.email ?? '');
      const key = `${req.ip}|${email.toLowerCase()}`;
      const render = (error: string, status = 401) =>
        res.status(status).send(
          page({ title: 'Sign in', csrfToken: req.csrfToken, body: loginPage({ csrf: req.csrfToken, next, email, error, publicSignup: ctx.settings.publicRegistration() }) }),
        );
      if (!loginLimiter.attempt(key)) return render('Too many attempts. Wait a few minutes and try again.', 429);
      try {
        const user = await ctx.accounts.authenticate(email, req.body.password);
        loginLimiter.reset(key);
        startSession(res, user.id);
        res.redirect(303, next);
      } catch (err) {
        if (err instanceof AppError) return render(err.message, err.status);
        throw err;
      }
    }),
  );

  r.post('/logout', (req, res) => {
    ctx.accounts.destroySession(req.sessionToken);
    clearCookie(res, ctx.config, names.session);
    res.redirect(303, '/');
  });

  // ── Public sign-up & verification ──────────────────────────────────────
  r.get('/signup', (req, res) => {
    if (!ctx.settings.publicRegistration()) {
      res.status(404).send(page({ title: 'Sign-up closed', body: messagePage('Sign-up is invitation-only', 'Public registration is turned off. Ask an administrator to invite you.', { href: '/login', label: 'Sign in' }) }));
      return;
    }
    res.send(page({ title: 'Create an account', csrfToken: req.csrfToken, body: signupPage({ csrf: req.csrfToken }) }));
  });

  r.post(
    '/signup',
    wrap(async (req, res) => {
      const email = String(req.body.email ?? '');
      if (!emailLimiter.attempt(`signup|${req.ip}`)) {
        return res.status(429).send(page({ title: 'Create an account', csrfToken: req.csrfToken, body: signupPage({ csrf: req.csrfToken, email, error: 'Too many attempts. Try again later.' }) }));
      }
      try {
        await ctx.accounts.register(email, req.body.password);
      } catch (err) {
        if (err instanceof AppError) {
          return res.status(err.status).send(page({ title: 'Create an account', csrfToken: req.csrfToken, body: signupPage({ csrf: req.csrfToken, email, error: err.message }) }));
        }
        const msg = (err as Error).name === 'MailDeliveryError' ? 'We could not send the confirmation email. Please try again later.' : null;
        if (msg) return res.status(503).send(page({ title: 'Create an account', csrfToken: req.csrfToken, body: signupPage({ csrf: req.csrfToken, email, error: msg }) }));
        throw err;
      }
      res.send(page({ title: 'Check your email', body: messagePage('Check your email', 'If that address can be registered, we’ve sent a confirmation link. Follow it to activate your account.') }));
    }),
  );

  r.get('/verify-email', (req, res) => {
    try {
      ctx.accounts.verifyEmail(req.query.token);
      res.redirect(303, '/login?verified=1');
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      res.status(400).send(page({ title: 'Link invalid', body: messagePage('That link didn’t work', err.message, { href: '/login', label: 'Sign in' }) }));
    }
  });

  // ── Password reset ──────────────────────────────────────────────────────
  r.get('/forgot-password', (req, res) => {
    res.send(page({ title: 'Reset password', csrfToken: req.csrfToken, body: forgotPage({ csrf: req.csrfToken }) }));
  });
  r.post(
    '/forgot-password',
    wrap(async (req, res) => {
      if (emailLimiter.attempt(`reset|${req.ip}`)) await ctx.accounts.requestPasswordReset(req.body.email);
      // Identical response regardless of whether the address exists.
      res.send(page({ title: 'Reset password', csrfToken: req.csrfToken, body: forgotPage({ csrf: req.csrfToken, sent: true }) }));
    }),
  );
  r.get('/reset-password', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!ctx.accounts.checkResetToken(token)) {
      res.status(400).send(page({ title: 'Link invalid', body: messagePage('That link has expired', 'Reset links work once and last an hour. Request a new one.', { href: '/forgot-password', label: 'Request a new link' }) }));
      return;
    }
    res.send(page({ title: 'Choose a new password', csrfToken: req.csrfToken, body: resetPage({ csrf: req.csrfToken, token }) }));
  });
  r.post(
    '/reset-password',
    wrap(async (req, res) => {
      const token = String(req.body.token ?? '');
      try {
        await ctx.accounts.resetPassword(token, req.body.password);
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        return res.status(err.status).send(page({ title: 'Choose a new password', csrfToken: req.csrfToken, body: resetPage({ csrf: req.csrfToken, token, error: err.message }) }));
      }
      clearCookie(res, ctx.config, names.session);
      res.redirect(303, '/login?reset=1');
    }),
  );

  // ── Invitations ─────────────────────────────────────────────────────────
  r.get('/invite', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const invitation = ctx.accounts.findPendingInvitation(token);
    if (!invitation) {
      res.status(400).send(page({ title: 'Invitation invalid', body: messagePage('This invitation can’t be used', 'It may have expired, been revoked or already been accepted. Ask the person who invited you to send a new one.', { href: '/login', label: 'Sign in' }) }));
      return;
    }
    res.send(page({ title: 'Join ChromaJev', csrfToken: req.csrfToken, body: invitePage({ csrf: req.csrfToken, token, invitation }) }));
  });
  r.post(
    '/invite',
    wrap(async (req, res) => {
      const token = String(req.body.token ?? '');
      try {
        const user = await ctx.accounts.acceptInvitation(token, req.body.password, req.body.display_name);
        startSession(res, user.id);
        res.redirect(303, '/');
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        const invitation = ctx.accounts.findPendingInvitation(token);
        if (!invitation) return res.status(400).send(page({ title: 'Invitation invalid', body: messagePage('This invitation can’t be used', err.message, { href: '/login', label: 'Sign in' }) }));
        res.status(err.status).send(page({ title: 'Join ChromaJev', csrfToken: req.csrfToken, body: invitePage({ csrf: req.csrfToken, token, invitation, error: err.message }) }));
      }
    }),
  );

  // ── Saved schemes ───────────────────────────────────────────────────────
  r.get('/schemes', requireUser, (req, res) => {
    const { items, total } = ctx.schemes.list(req.user!, { limit: 200 });
    res.send(page({ title: 'Library', user: req.user, csrfToken: req.csrfToken, active: 'schemes', wide: true, flash: flashFromQuery(req, res), body: libraryPage({ items, total }) }));
  });

  r.get('/schemes/id/:id', requireUser, (req, res, next) => {
    const scheme = ctx.schemes.getAny(req.user!, String(req.params.id));
    if (!scheme) return next(new AppError(404, 'not_found', 'Scheme not found.'));
    if (scheme.ownerId === req.user!.id) return res.redirect(303, `/schemes/${scheme.slug}`);
    res.send(page({ title: scheme.name, user: req.user, csrfToken: req.csrfToken, wide: true, includePlayground: true, body: schemePage({ csrf: req.csrfToken, scheme, ownedByViewer: false }) }));
  });

  r.get('/schemes/:slug', requireUser, (req, res, next) => {
    const scheme = ctx.schemes.getOwned(req.user!, String(req.params.slug));
    if (!scheme) return next(new AppError(404, 'not_found', 'Scheme not found.'));
    res.send(page({ title: scheme.name, user: req.user, csrfToken: req.csrfToken, active: 'schemes', wide: true, includePlayground: true, flash: flashFromQuery(req, res), body: schemePage({ csrf: req.csrfToken, scheme, ownedByViewer: true }) }));
  });

  r.get('/schemes/:slug/export.:format', requireUser, (req, res, next) => {
    const format = String(req.params.format) as ExportFormat;
    if (!EXPORT_FORMATS.includes(format)) return next(new AppError(404, 'not_found', 'Unknown export format.'));
    const scheme = ctx.schemes.getOwned(req.user!, String(req.params.slug));
    if (!scheme) return next(new AppError(404, 'not_found', 'Scheme not found.'));
    const out = exportScheme(scheme, format);
    res.type(out.contentType).attachment(`${scheme.slug}.${out.extension}`).send(out.body);
  });

  r.post('/schemes/:slug/edit', requireUser, (req, res) => {
    try {
      const s = ctx.schemes.update(req.user!, String(req.params.slug), { name: req.body.name, notes: req.body.notes ?? null });
      redirectWithFlash(res, `/schemes/${s.slug}`, 'ok', 'Scheme updated.');
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      redirectWithFlash(res, `/schemes/${encodeURIComponent(String(req.params.slug))}`, 'err', err.message);
    }
  });

  r.post('/schemes/:slug/duplicate', requireUser, (req, res) => {
    const s = ctx.schemes.duplicate(req.user!, String(req.params.slug));
    redirectWithFlash(res, `/schemes/${s.slug}`, 'ok', `Duplicated as “${s.name}”.`);
  });

  r.post('/schemes/:slug/delete', requireUser, (req, res) => {
    const s = ctx.schemes.delete(req.user!, String(req.params.slug));
    redirectWithFlash(res, '/schemes', 'ok', `Deleted “${s.name}”.`);
  });

  // ── Account ─────────────────────────────────────────────────────────────
  const renderAccount = (req: Request, res: Response, extra: { newKey?: string; error?: string } = {}) =>
    res.send(
      page({
        title: 'Account',
        user: req.user,
        csrfToken: req.csrfToken,
        active: 'account',
        flash: flashFromQuery(req, res),
        body: accountPage({
          csrf: req.csrfToken,
          user: req.user!,
          apiKeys: ctx.accounts.listApiKeys(req.user!),
          newKey: extra.newKey,
          error: extra.error,
          grants: listGrants(ctx.db, req.user!.id),
          mcpUrl: mcpResourceUrl(ctx.config),
          apiBase: absoluteUrl(ctx.config, '/api'),
        }),
      }),
    );

  r.get('/account', requireUser, (req, res) => renderAccount(req, res));
  r.post(
    '/account/password',
    requireUser,
    wrap(async (req, res) => {
      try {
        await ctx.accounts.changePassword(req.user!, req.body.current_password, req.body.new_password);
        redirectWithFlash(res, '/account', 'ok', 'Password updated.');
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        renderAccount(req, res.status(err.status), { error: err.message });
      }
    }),
  );
  r.post('/account/api-keys', requireUser, (req, res) => {
    try {
      const { key } = ctx.accounts.createApiKey(req.user!, req.body.name, req.body.scopes);
      res.set('Cache-Control', 'no-store');
      renderAccount(req, res, { newKey: key });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      renderAccount(req, res.status(err.status), { error: err.message });
    }
  });
  r.post('/account/api-keys/:id/revoke', requireUser, (req, res) => {
    ctx.accounts.revokeApiKey(req.user!, String(req.params.id));
    redirectWithFlash(res, '/account', 'ok', 'API key revoked.');
  });
  r.post('/account/grants/:id/revoke', requireUser, (req, res) => {
    revokeGrant(ctx.db, req.user!.id, String(req.params.id));
    redirectWithFlash(res, '/account', 'ok', 'App disconnected.');
  });

  // ── Admin ───────────────────────────────────────────────────────────────
  r.get('/admin', requireUser, requireAdmin, (req, res) => {
    const mailStatus =
      ctx.mail.name === 'unconfigured'
        ? 'Email delivery is not configured (ELASTIC_EMAIL_API_KEY / MAIL_FROM_ADDRESS). Invitations, verification and password resets cannot be sent.'
        : 'ok';
    res.send(
      page({
        title: 'Admin',
        user: req.user,
        csrfToken: req.csrfToken,
        active: 'admin',
        wide: true,
        flash: flashFromQuery(req, res),
        body: adminPage({
          csrf: req.csrfToken,
          me: req.user!,
          users: ctx.accounts.listUsers(),
          invitations: ctx.accounts.listInvitations(),
          publicSignup: ctx.settings.publicRegistration(),
          mailStatus,
          cache: ctx.cache.stats(),
          jevConfigured: ctx.cache.jevConfigured,
          jevProvider: ctx.jev.provider,
          changelog: ctx.changelog.list(),
        }),
      }),
    );
  });

  const adminAction = (fn: (req: Request) => Promise<string> | string) =>
    wrap(async (req, res) => {
      try {
        redirectWithFlash(res, '/admin', 'ok', await fn(req));
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        redirectWithFlash(res, '/admin', 'err', err.message);
      }
    });

  r.post('/admin/settings/registration', requireUser, requireAdmin, adminAction((req) => {
    const on = req.body.public === '1';
    ctx.settings.set('registration.public', on, req.user!.id);
    return on ? 'Public sign-up enabled.' : 'Public sign-up disabled.';
  }));
  r.post('/admin/invitations', requireUser, requireAdmin, adminAction(async (req) => {
    const out = await ctx.accounts.invite(req.user!, req.body.email, req.body.role);
    if (!out.delivered) throw new AppError(502, 'mail_failed', `Invitation created for ${out.invitation.email}, but the email could not be sent: ${out.error}`);
    return `Invitation sent to ${out.invitation.email}.`;
  }));
  r.post('/admin/invitations/:id/resend', requireUser, requireAdmin, adminAction(async (req) => {
    const out = await ctx.accounts.resendInvitation(req.user!, String(req.params.id));
    if (!out.delivered) throw new AppError(502, 'mail_failed', `The email could not be sent: ${out.error}`);
    return `Invitation re-sent to ${out.invitation.email}. Earlier links no longer work.`;
  }));
  r.post('/admin/invitations/:id/revoke', requireUser, requireAdmin, adminAction((req) => {
    const inv = ctx.accounts.revokeInvitation(String(req.params.id));
    return `Invitation for ${inv.email} revoked.`;
  }));
  r.post('/admin/users/:id/status', requireUser, requireAdmin, adminAction((req) => {
    const u = ctx.accounts.setStatus(req.user!, String(req.params.id), req.body.status === 'disabled' ? 'disabled' : 'active');
    return `${u.email} is now ${u.status}.`;
  }));
  r.post('/admin/users/:id/role', requireUser, requireAdmin, adminAction((req) => {
    const u = ctx.accounts.setRole(req.user!, String(req.params.id), req.body.role);
    return `${u.email} is now ${u.role === 'admin' ? 'an administrator' : 'a user'}.`;
  }));
  r.post('/admin/cache/purge-stale', requireUser, requireAdmin, adminAction(() => `Removed ${ctx.cache.purgeStale()} stale cache entries.`));

  r.post('/admin/changelog', requireUser, requireAdmin, adminAction((req) => {
    const e = ctx.changelog.create(req.user!.id, { title: req.body.title, body: req.body.body, publishedAt: req.body.published_at });
    return `Posted “${e.title}” to the changelog.`;
  }));
  r.post('/admin/changelog/:id/edit', requireUser, requireAdmin, adminAction((req) => {
    const e = ctx.changelog.update(String(req.params.id), { title: req.body.title, body: req.body.body, publishedAt: req.body.published_at });
    return `Updated “${e.title}”.`;
  }));
  r.post('/admin/changelog/:id/delete', requireUser, requireAdmin, adminAction((req) => {
    const e = ctx.changelog.delete(String(req.params.id));
    return `Deleted “${e.title}” from the changelog.`;
  }));

  // ── Changelog (public) ──────────────────────────────────────────────────
  r.get('/changelog', (req, res) => {
    res.send(page({ title: 'Changelog', user: req.user, csrfToken: req.csrfToken, active: 'changelog', body: changelogPage(ctx.changelog.list()) }));
  });

  // ── Docs ────────────────────────────────────────────────────────────────
  r.get('/docs/api', (req, res) => {
    res.send(page({ title: 'HTTP API', user: req.user, csrfToken: req.csrfToken, active: 'docs', body: apiDocsPage(absoluteUrl(ctx.config, '/api')) }));
  });
  r.get('/docs/mcp', (req, res) => {
    res.send(page({ title: 'MCP', user: req.user, csrfToken: req.csrfToken, active: 'docs', body: mcpDocsPage(mcpResourceUrl(ctx.config)) }));
  });

  return r;
}
