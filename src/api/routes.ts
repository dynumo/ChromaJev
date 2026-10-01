import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AppContext } from '../context.js';
import { JevError } from '../jev/client.js';
import { jevErrorToAppError } from '../schemes/service.js';
import { exportScheme, EXPORT_FORMATS, type ExportFormat } from '../palette/exports.js';
import { AppError, notFound } from '../util/errors.js';
import { generationJson, savedJson, summaryJson } from './serialise.js';
import { openApiDocument } from './openapi.js';
import { csrfProtection } from '../web/middleware.js';
import type { Scope } from '../accounts/service.js';

/**
 * Authentication for /api: either a personal API key (Bearer cj_…, scoped)
 * or the signed-in web session (same-origin + CSRF token, all scopes).
 * Perimeter Basic Auth credentials in the Authorization header are ignored.
 */
function apiAuth(ctx: AppContext) {
  const csrf = csrfProtection(ctx.config);
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() === 'bearer') {
      const auth = token ? ctx.accounts.authenticateApiKey(token) : null;
      if (!auth) {
        res.set('WWW-Authenticate', 'Bearer realm="chromajev-api", error="invalid_token"');
        return next(new AppError(401, 'invalid_api_key', 'Invalid or revoked API key.'));
      }
      req.user = auth.user;
      req.apiScopes = auth.scopes;
      req.authVia = 'api_key';
      return next();
    }
    if (req.user) {
      req.apiScopes = ['schemes:read', 'schemes:generate', 'schemes:write'];
      return csrf(req, res, next);
    }
    res.set('WWW-Authenticate', 'Bearer realm="chromajev-api"');
    next(new AppError(401, 'unauthorised', 'Send an API key as "Authorization: Bearer cj_…".'));
  };
}

function scope(required: Scope) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.apiScopes?.includes(required)) return next();
    next(new AppError(403, 'insufficient_scope', `This API key lacks the ${required} scope.`));
  };
}

export function apiRoutes(ctx: AppContext): Router {
  const r = Router();

  r.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument(ctx.config));
  });

  r.use(apiAuth(ctx));

  r.post('/schemes/generate', scope('schemes:generate'), async (req, res) => {
    try {
      const result = await ctx.schemes.generate(req.user!, {
        concept: req.body?.concept,
        variation: req.body?.variation,
        locks: req.body?.locks,
      });
      res.json(generationJson(result));
    } catch (err) {
      if (err instanceof JevError) throw jevErrorToAppError(err);
      throw err;
    }
  });

  r.get('/generations/:id', scope('schemes:read'), (req, res) => {
    const g = ctx.schemes.getGeneration(req.user!, String(req.params.id));
    if (!g) throw notFound('Generated scheme');
    res.json(generationJson(g));
  });

  r.get('/schemes', scope('schemes:read'), (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const { items, total } = ctx.schemes.list(req.user!, { limit, offset });
    res.json({ items: items.map((s) => summaryJson(ctx.config, s)), total, limit: Math.min(Math.max(limit || 50, 1), 200), offset: Math.max(offset || 0, 0) });
  });

  r.post('/schemes', scope('schemes:write'), async (req, res) => {
    if (req.body?.concept !== undefined && !req.apiScopes?.includes('schemes:generate')) {
      throw new AppError(403, 'insufficient_scope', 'Saving from a concept needs the schemes:generate scope; pass generationId instead.');
    }
    try {
      const saved = await ctx.schemes.save(req.user!, {
        name: req.body?.name,
        notes: req.body?.notes,
        generationId: req.body?.generationId ?? req.body?.generation_id,
        concept: req.body?.concept,
        variation: req.body?.variation,
        locks: req.body?.locks,
      });
      res.status(201).location(`/api/schemes/${saved.id}`).json(savedJson(ctx.config, saved));
    } catch (err) {
      if (err instanceof JevError) throw jevErrorToAppError(err);
      throw err;
    }
  });

  r.get('/schemes/:ref', scope('schemes:read'), (req, res) => {
    const s = ctx.schemes.getOwned(req.user!, String(req.params.ref));
    if (!s) throw notFound('Scheme');
    res.json(savedJson(ctx.config, s));
  });

  r.get('/schemes/:ref/export', scope('schemes:read'), (req, res) => {
    const format = String(req.query.format ?? 'css') as ExportFormat;
    if (!EXPORT_FORMATS.includes(format)) throw new AppError(400, 'invalid_request', `format must be one of ${EXPORT_FORMATS.join(', ')}`);
    const s = ctx.schemes.getOwned(req.user!, String(req.params.ref));
    if (!s) throw notFound('Scheme');
    const out = exportScheme(s, format);
    res.type(out.contentType).send(out.body);
  });

  r.patch('/schemes/:ref', scope('schemes:write'), (req, res) => {
    const s = ctx.schemes.update(req.user!, String(req.params.ref), { name: req.body?.name, notes: req.body?.notes });
    res.json(savedJson(ctx.config, s));
  });

  r.post('/schemes/:ref/duplicate', scope('schemes:write'), (req, res) => {
    const s = ctx.schemes.duplicate(req.user!, String(req.params.ref), req.body?.name);
    res.status(201).json(savedJson(ctx.config, s));
  });

  r.delete('/schemes/:ref', scope('schemes:write'), (req, res) => {
    const s = ctx.schemes.delete(req.user!, String(req.params.ref));
    res.json({ deleted: true, id: s.id, slug: s.slug });
  });

  r.use((_req, _res, next) => next(notFound('Endpoint')));
  return r;
}
