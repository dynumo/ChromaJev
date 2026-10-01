import { createRemoteJWKSet, createLocalJWKSet, jwtVerify, errors as joseErrors, type JWK } from 'jose';
import {
  createMcpHandler,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  ResourceTemplate,
  requireScopes,
  type AuthInfo,
  type CallToolResult,
} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { AppContext } from '../context.js';
import { issuerUrl, mcpResourceUrl } from '../config.js';
import { JevError } from '../jev/client.js';
import { jevErrorToAppError, type Actor } from '../schemes/service.js';
import { AppError } from '../util/errors.js';
import { generationJson, savedJson, summaryJson } from '../api/serialise.js';
import { publicJwks } from '../oauth/keys.js';
import { SCOPES } from '../accounts/service.js';

export const MCP_SCOPES = [...SCOPES];

/**
 * Verifies ChromaJev-issued OAuth access tokens (JWTs) for the MCP resource:
 * signature (local signing keys), issuer, audience (RFC 8707 resource),
 * expiry — then that the user still exists and is active. Tokens of a
 * disabled user stop working immediately, even before they expire.
 */
export function createTokenVerifier(ctx: AppContext, jwks: { keys: JWK[] } | null) {
  const keySet = jwks ? createLocalJWKSet(publicJwks(jwks)) : createRemoteJWKSet(new URL('/oauth/jwks', ctx.config.publicBaseUrl));
  const issuer = issuerUrl(ctx.config);
  const audience = mcpResourceUrl(ctx.config);
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let payload: Record<string, unknown>;
      try {
        ({ payload } = await jwtVerify(token, keySet, { issuer, audience, algorithms: ['RS256'], typ: 'at+jwt' }));
      } catch (err) {
        const reason = err instanceof joseErrors.JWTExpired ? 'Token has expired' : 'Invalid access token';
        throw new OAuthError(OAuthErrorCode.InvalidToken, reason);
      }
      const sub = typeof payload.sub === 'string' ? payload.sub : '';
      const user = ctx.accounts.getUser(sub);
      if (!ctx.accounts.isUsable(user)) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Account is disabled or no longer exists');
      const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [];
      return {
        token,
        clientId: typeof payload.client_id === 'string' ? payload.client_id : 'unknown',
        scopes,
        expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
        resource: new URL(audience),
        extra: { userId: user.id, role: user.role },
      };
    },
  };
}

function actorFrom(authInfo: AuthInfo | undefined): Actor {
  const userId = authInfo?.extra?.userId;
  if (typeof userId !== 'string') throw new AppError(401, 'unauthorised', 'Not authenticated.');
  return { id: userId, role: authInfo?.extra?.role === 'admin' ? 'admin' : 'user' };
}

function hasScope(authInfo: AuthInfo | undefined, scope: string): boolean {
  return !!authInfo?.scopes.includes(scope);
}

function ok(text: string, structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

function fail(err: unknown): CallToolResult {
  const e = err instanceof JevError ? jevErrorToAppError(err) : err;
  const message = e instanceof AppError ? `${e.message} (${e.code})` : 'Unexpected server error.';
  if (!(e instanceof AppError)) console.error('MCP tool error', err);
  return { content: [{ type: 'text', text: message }], isError: true };
}

function swatchSummary(tokens: Record<string, string>): string {
  return ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'textMuted'].map((k) => `${k} ${tokens[k]}`).join(', ');
}

/** One fresh McpServer per request, bound to the authenticated user. */
export function buildMcpServer(ctx: AppContext, authInfo: AuthInfo | undefined): McpServer {
  const server = new McpServer(
    { name: 'chromajev', title: 'ChromaJev', version: '1.0.0' },
    {
      instructions:
        'ChromaJev generates accessible paired light/dark colour schemes from a short concept. Call generate_colour_scheme, show the user the result, and save it with save_colour_scheme using the returned generation_id. Repeated concepts are served from a cache at no cost.',
    },
  );

  server.registerTool(
    'generate_colour_scheme',
    {
      title: 'Generate colour scheme',
      description:
        'Generate a coherent, accessible colour scheme for a concept (e.g. "autumn forest"). Returns coordinated light and dark palettes with WCAG contrast results. Pass variation > 0 for alternative interpretations of the same concept (no extra cost).',
      inputSchema: z.object({
        concept: z.string().min(1).max(120).describe('A short word or phrase, e.g. "trustworthy fintech"'),
        variation: z.number().int().min(0).max(1000).optional().describe('0 = best interpretation; 1, 2… = alternatives'),
        lock_primary: z.string().optional().describe('Catalogue colour ID to keep as primary (from a previous result)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      scopeChallenge: requireScopes('schemes:generate'),
    },
    async ({ concept, variation, lock_primary }) => {
      if (!hasScope(authInfo, 'schemes:generate')) return fail(new AppError(403, 'insufficient_scope', 'Requires schemes:generate'));
      try {
        const g = await ctx.schemes.generate(actorFrom(authInfo), {
          concept,
          variation,
          locks: lock_primary ? { primary: lock_primary } : undefined,
        });
        const json = generationJson(g);
        const s = g.scheme;
        const a11y = (m: 'light' | 'dark') => `${s.accessibility[m].passed}/${s.accessibility[m].checks.length} contrast checks pass`;
        const text = [
          `Colour scheme for "${s.concept}" (variation ${s.variation} of ${s.alternativesAvailable}; ${g.cache.source === 'cache' ? 'served from cache' : 'fresh Jev judgement'}).`,
          `Semantic colours: primary ${s.semantic.primary.name}, secondary ${s.semantic.secondary.name}, accent ${s.semantic.accent.name}.`,
          `Light: ${swatchSummary(s.light)} — ${a11y('light')}.`,
          `Dark: ${swatchSummary(s.dark)} — ${a11y('dark')}.`,
          `generation_id: ${g.generationId} (pass to save_colour_scheme to keep it).`,
        ].join('\n');
        return ok(text, json);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'list_colour_schemes',
    {
      title: 'List saved colour schemes',
      description: 'List your saved colour schemes, most recently updated first.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }),
      annotations: { readOnlyHint: true },
      scopeChallenge: requireScopes('schemes:read'),
    },
    async ({ limit, offset }) => {
      if (!hasScope(authInfo, 'schemes:read')) return fail(new AppError(403, 'insufficient_scope', 'Requires schemes:read'));
      try {
        const { items, total } = ctx.schemes.list(actorFrom(authInfo), { limit: limit ?? 25, offset: offset ?? 0 });
        const text = items.length
          ? `${total} saved scheme(s):\n` + items.map((s) => `- ${s.name} (slug: ${s.slug}, from "${s.concept}")`).join('\n')
          : 'No saved schemes yet.';
        return ok(text, { items: items.map((s) => summaryJson(ctx.config, s)), total, offset: offset ?? 0 });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'get_colour_scheme',
    {
      title: 'Get a saved colour scheme',
      description: 'Fetch one of your saved schemes (both light and dark modes) by ID, slug or exact name.',
      inputSchema: z.object({
        id: z.string().optional().describe('Scheme ID'),
        slug: z.string().optional().describe('Scheme slug, e.g. "dynumo"'),
        name: z.string().optional().describe('Exact scheme name, if unambiguous'),
      }),
      annotations: { readOnlyHint: true },
      scopeChallenge: requireScopes('schemes:read'),
    },
    async ({ id, slug, name }) => {
      if (!hasScope(authInfo, 'schemes:read')) return fail(new AppError(403, 'insufficient_scope', 'Requires schemes:read'));
      try {
        const actor = actorFrom(authInfo);
        let scheme = id || slug ? ctx.schemes.getOwned(actor, (id || slug)!) : null;
        if (!scheme && name) {
          const found = ctx.schemes.findByName(actor, name);
          if (found.ambiguous) return fail(new AppError(409, 'ambiguous', `More than one scheme is named "${name}"; use the slug.`));
          scheme = found.scheme;
        }
        if (!scheme) return fail(new AppError(404, 'not_found', 'Scheme not found.'));
        const json = savedJson(ctx.config, scheme);
        return ok(`${scheme.name} (from "${scheme.concept}")\nLight: ${swatchSummary(scheme.light)}\nDark: ${swatchSummary(scheme.dark)}`, json);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'save_colour_scheme',
    {
      title: 'Save colour scheme',
      description:
        'Save a scheme you generated under a custom name. Pass the generation_id returned by generate_colour_scheme (preferred — no colours need to be re-sent).',
      inputSchema: z.object({
        name: z.string().min(1).max(80).describe('Display name, e.g. "Dynumo"'),
        generation_id: z.string().optional(),
        concept: z.string().max(120).optional().describe('Alternative to generation_id: regenerate from this concept'),
        variation: z.number().int().min(0).optional(),
        notes: z.string().max(2000).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      scopeChallenge: requireScopes('schemes:write'),
    },
    async ({ name, generation_id, concept, variation, notes }) => {
      if (!hasScope(authInfo, 'schemes:write')) return fail(new AppError(403, 'insufficient_scope', 'Requires schemes:write'));
      if (!generation_id && concept && !hasScope(authInfo, 'schemes:generate')) {
        return fail(new AppError(403, 'insufficient_scope', 'Saving from a concept also requires schemes:generate'));
      }
      try {
        const saved = await ctx.schemes.save(actorFrom(authInfo), { name, generationId: generation_id, concept, variation, notes });
        return ok(`Saved "${saved.name}" (slug: ${saved.slug}). View it at ${savedJson(ctx.config, saved).url}`, savedJson(ctx.config, saved));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'rename_colour_scheme',
    {
      title: 'Rename colour scheme',
      description: 'Rename one of your saved schemes (its slug follows the new name).',
      inputSchema: z.object({ id_or_slug: z.string(), name: z.string().min(1).max(80) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      scopeChallenge: requireScopes('schemes:write'),
    },
    async ({ id_or_slug, name }) => {
      if (!hasScope(authInfo, 'schemes:write')) return fail(new AppError(403, 'insufficient_scope', 'Requires schemes:write'));
      try {
        const s = ctx.schemes.update(actorFrom(authInfo), id_or_slug, { name });
        return ok(`Renamed to "${s.name}" (slug: ${s.slug}).`, savedJson(ctx.config, s));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'delete_colour_scheme',
    {
      title: 'Delete colour scheme',
      description: 'Permanently delete one of your saved schemes. This cannot be undone — confirm with the user first.',
      inputSchema: z.object({ id_or_slug: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      scopeChallenge: requireScopes('schemes:write'),
    },
    async ({ id_or_slug }) => {
      if (!hasScope(authInfo, 'schemes:write')) return fail(new AppError(403, 'insufficient_scope', 'Requires schemes:write'));
      try {
        const s = ctx.schemes.delete(actorFrom(authInfo), id_or_slug);
        return ok(`Deleted "${s.name}".`, { deleted: true, id: s.id, slug: s.slug });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // Saved schemes as read-only resources.
  server.registerResource(
    'saved-scheme',
    new ResourceTemplate('chromajev://schemes/{slug}', {
      list: async () => {
        if (!hasScope(authInfo, 'schemes:read')) return { resources: [] };
        const { items } = ctx.schemes.list(actorFrom(authInfo), { limit: 200 });
        return {
          resources: items.map((s) => ({ uri: `chromajev://schemes/${s.slug}`, name: s.slug, title: s.name, description: `Colour scheme from "${s.concept}"`, mimeType: 'application/json' })),
        };
      },
    }),
    { title: 'Saved colour scheme', description: 'A saved paired light/dark colour scheme', mimeType: 'application/json', scopeChallenge: requireScopes('schemes:read') },
    async (uri, variables) => {
      const slug = String(Array.isArray(variables.slug) ? variables.slug[0] : variables.slug);
      const scheme = ctx.schemes.getOwned(actorFrom(authInfo), decodeURIComponent(slug));
      if (!scheme) throw new Error('Scheme not found');
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(savedJson(ctx.config, scheme), null, 2) }] };
    },
  );

  return server;
}

export function createMcpHttpHandler(ctx: AppContext) {
  return createMcpHandler((reqCtx) => buildMcpServer(ctx, reqCtx.authInfo), {
    onerror: (e) => {
      if (ctx.config.env !== 'test') console.error('MCP error:', e.message);
    },
  });
}
