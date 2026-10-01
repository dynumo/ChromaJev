import { Router, type Request, type Response } from 'express';
import type { AppContext } from '../context.js';
import { AppError } from '../util/errors.js';
import { consentPage, interactionLoginPage } from '../web/views/oauth.js';
import { RateLimiter, cookieNames, setCookie } from '../web/middleware.js';
import { SESSION_TTL_DAYS } from '../accounts/service.js';

/**
 * Login and consent pages for oidc-provider's interaction flow. The human
 * authenticates with their normal ChromaJev account; we then hand the
 * library an accountId (login) or a Grant (consent). The library does the
 * rest of the OAuth protocol.
 */
export function interactionRoutes(ctx: AppContext): Router {
  const r = Router();
  const { provider, accounts } = ctx;
  const limiter = new RateLimiter(10, 15 * 60_000);

  async function details(req: Request, res: Response) {
    try {
      return await provider.interactionDetails(req, res);
    } catch {
      throw new AppError(400, 'interaction_expired', 'This sign-in request has expired. Start again from your app.');
    }
  }

  async function clientName(clientId: string): Promise<{ name: string; uri: string | null }> {
    const client = await provider.Client.find(clientId);
    const meta = client?.metadata() as { client_name?: string; client_uri?: string } | undefined;
    return { name: meta?.client_name || clientId, uri: meta?.client_uri ?? null };
  }

  r.get('/interaction/:uid', async (req, res) => {
    const d = await details(req, res);
    const client = await clientName(String(d.params.client_id));
    res.set('Cache-Control', 'no-store');
    if (d.prompt.name === 'login') {
      res.send(interactionLoginPage({ csrf: req.csrfToken, uid: d.uid, clientName: client.name, current: req.user ?? null }));
      return;
    }
    // Consent: the account must still be usable.
    const user = accounts.getUser(String(d.session?.accountId ?? ''));
    if (!accounts.isUsable(user)) {
      await provider.interactionFinished(req, res, { error: 'access_denied', error_description: 'Account is not active.' }, { mergeWithLastSubmission: false });
      return;
    }
    const requested = new Set<string>();
    const missing = d.prompt.details as {
      missingOIDCScope?: string[];
      missingResourceScopes?: Record<string, string[]>;
    };
    for (const s of missing.missingOIDCScope ?? []) requested.add(s);
    for (const list of Object.values(missing.missingResourceScopes ?? {})) for (const s of list) requested.add(s);
    if (requested.size === 0) for (const s of String(d.params.scope ?? '').split(' ').filter(Boolean)) requested.add(s);
    let redirectHost = '';
    try {
      redirectHost = new URL(String(d.params.redirect_uri)).host || String(d.params.redirect_uri);
    } catch {
      redirectHost = String(d.params.redirect_uri);
    }
    res.send(consentPage({ csrf: req.csrfToken, uid: d.uid, clientName: client.name, clientUri: client.uri, redirectHost, scopes: [...requested], user }));
  });

  r.post('/interaction/:uid/login', async (req, res) => {
    const d = await details(req, res);
    if (d.prompt.name !== 'login') throw new AppError(400, 'invalid_request', 'Unexpected step.');
    let accountId: string;
    if (req.body.use_session === '1' && req.user) {
      accountId = req.user.id;
    } else {
      const key = `${req.ip}|${String(req.body.email ?? '').toLowerCase()}`;
      const client = await clientName(String(d.params.client_id));
      if (!limiter.attempt(key)) {
        res.status(429).send(interactionLoginPage({ csrf: req.csrfToken, uid: d.uid, clientName: client.name, current: req.user ?? null, error: 'Too many attempts. Try again later.' }));
        return;
      }
      try {
        const user = await accounts.authenticate(req.body.email, req.body.password);
        accountId = user.id;
        limiter.reset(key);
        // Also sign them in to the ChromaJev web app for convenience.
        const s = accounts.createSession(user.id);
        setCookie(res, ctx.config, cookieNames(ctx.config).session, s.token, SESSION_TTL_DAYS * 86400);
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        res.status(err.status).send(interactionLoginPage({ csrf: req.csrfToken, uid: d.uid, clientName: client.name, current: req.user ?? null, error: err.message }));
        return;
      }
    }
    await provider.interactionFinished(req, res, { login: { accountId } }, { mergeWithLastSubmission: false });
  });

  r.post('/interaction/:uid/confirm', async (req, res) => {
    const d = await details(req, res);
    if (d.prompt.name !== 'consent') throw new AppError(400, 'invalid_request', 'Unexpected step.');
    const accountId = String(d.session?.accountId ?? '');
    if (!accounts.isUsable(accounts.getUser(accountId))) {
      await provider.interactionFinished(req, res, { error: 'access_denied', error_description: 'Account is not active.' }, { mergeWithLastSubmission: false });
      return;
    }
    const pd = d.prompt.details as {
      missingOIDCScope?: string[];
      missingOIDCClaims?: string[];
      missingResourceScopes?: Record<string, string[]>;
    };
    const grant = d.grantId
      ? await provider.Grant.find(d.grantId)
      : new provider.Grant({ accountId, clientId: String(d.params.client_id) });
    if (!grant) throw new AppError(400, 'invalid_request', 'Grant not found.');
    if (pd.missingOIDCScope) grant.addOIDCScope(pd.missingOIDCScope.join(' '));
    if (pd.missingOIDCClaims) grant.addOIDCClaims(pd.missingOIDCClaims);
    for (const [indicator, scopes] of Object.entries(pd.missingResourceScopes ?? {})) {
      grant.addResourceScope(indicator, scopes.join(' '));
    }
    const grantId = await grant.save();
    await provider.interactionFinished(req, res, { consent: d.grantId ? {} : { grantId } }, { mergeWithLastSubmission: true });
  });

  r.post('/interaction/:uid/abort', async (req, res) => {
    await details(req, res);
    await provider.interactionFinished(
      req,
      res,
      { error: 'access_denied', error_description: 'The user denied the request.' },
      { mergeWithLastSubmission: false },
    );
  });

  return r;
}
