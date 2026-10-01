import Provider, { errors as oidcErrors, type Configuration, type KoaContextWithOIDC } from 'oidc-provider';
import type { AppConfig } from '../config.js';
import { issuerUrl, mcpResourceUrl } from '../config.js';
import type { DB } from '../db/database.js';
import type { AccountService } from '../accounts/service.js';
import { SCOPES } from '../accounts/service.js';
import { sqliteAdapterFactory } from './adapter.js';
import { loadCookieKeys, loadSigningJwks } from './keys.js';
import { renderOAuthError } from '../web/views/oauth.js';

export const OAUTH_PREFIX = '/oauth';

/**
 * ChromaJev's embedded OAuth 2.1 authorisation server, built entirely on
 * oidc-provider. ChromaJev contributes only: persistence (adapter), account
 * lookup (findAccount → local users) and the login/consent pages (the
 * library's "interaction" hook). Every protocol step — PKCE, codes, token
 * minting, client registration/CIMD, discovery — is the library's.
 */
export async function createOAuthProvider(config: AppConfig, db: DB, accounts: AccountService): Promise<Provider> {
  const resource = mcpResourceUrl(config);
  const jwks = await loadSigningJwks(db);

  const configuration: Configuration = {
    adapter: sqliteAdapterFactory(db) as unknown as Configuration['adapter'],
    jwks: jwks as Configuration['jwks'],
    cookies: {
      keys: loadCookieKeys(db),
      long: { signed: true, sameSite: 'lax' },
      short: { signed: true, sameSite: 'lax' },
      names: { session: 'cj_oauth_session', interaction: 'cj_oauth_interaction', resume: 'cj_oauth_resume' },
    },
    routes: {
      authorization: `${OAUTH_PREFIX}/authorize`,
      token: `${OAUTH_PREFIX}/token`,
      registration: `${OAUTH_PREFIX}/register`,
      jwks: `${OAUTH_PREFIX}/jwks`,
      revocation: `${OAUTH_PREFIX}/revoke`,
      introspection: `${OAUTH_PREFIX}/introspect`,
      end_session: `${OAUTH_PREFIX}/logout`,
      userinfo: `${OAUTH_PREFIX}/userinfo`,
      pushed_authorization_request: `${OAUTH_PREFIX}/par`,
      code_verification: `${OAUTH_PREFIX}/device`,
      device_authorization: `${OAUTH_PREFIX}/device/auth`,
      backchannel_authentication: `${OAUTH_PREFIX}/backchannel`,
      challenge: `${OAUTH_PREFIX}/challenge`,
    },
    scopes: ['openid', 'offline_access', ...SCOPES],
    claims: { openid: ['sub'], email: ['email', 'email_verified'] },
    async findAccount(_ctx, sub) {
      const user = accounts.getUser(sub);
      // Disabled or unverified accounts cannot authorise, refresh or use userinfo.
      if (!accounts.isUsable(user)) return undefined;
      return {
        accountId: user.id,
        async claims() {
          return { sub: user.id, email: user.email, email_verified: true };
        },
      };
    },
    interactions: {
      url(_ctx, interaction) {
        return `/interaction/${interaction.uid}`;
      },
    },
    responseTypes: ['code'],
    pkce: { required: () => true },
    clientDefaults: {
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      id_token_signed_response_alg: 'RS256',
    },
    // MCP clients rarely ask for offline_access; issue refresh tokens to any
    // client registered for the refresh_token grant (rotated on every use).
    async issueRefreshToken(_ctx, client) {
      return client.grantTypeAllowed('refresh_token');
    },
    rotateRefreshToken: true,
    ttl: {
      AccessToken: config.oauth.accessTokenTtlSeconds,
      AuthorizationCode: 60,
      RefreshToken: config.oauth.refreshTokenTtlSeconds,
      Grant: config.oauth.refreshTokenTtlSeconds,
      Interaction: 600,
      Session: 14 * 24 * 3600,
      IdToken: 3600,
    },
    features: {
      devInteractions: { enabled: false },
      revocation: { enabled: true },
      introspection: { enabled: false },
      userinfo: { enabled: true },
      registration: {
        enabled: config.oauth.allowDynamicRegistration,
        initialAccessToken: false,
        // Open registration for public clients (DCR is how many MCP clients
        // still onboard). Registered clients can do nothing without a user
        // signing in and consenting.
      },
      clientIdMetadataDocument: config.oauth.allowClientIdMetadataDocuments
        ? { enabled: true, ack: 'draft-02' }
        : { enabled: false },
      resourceIndicators: {
        enabled: true,
        defaultResource: async () => resource,
        useGrantedResource: async () => true,
        async getResourceServerInfo(_ctx, indicator) {
          if (indicator.replace(/\/+$/, '').toLowerCase() !== resource.toLowerCase()) {
            throw new oidcErrors.InvalidTarget('Unknown resource. Use the ChromaJev MCP endpoint URL.');
          }
          return {
            scope: SCOPES.join(' '),
            audience: resource,
            accessTokenTTL: config.oauth.accessTokenTtlSeconds,
            accessTokenFormat: 'jwt',
            jwt: { sign: { alg: 'RS256' } },
          };
        },
      },
    },
    extraClientMetadata: { properties: [] },
    renderError(ctx: KoaContextWithOIDC, out) {
      ctx.type = 'html';
      ctx.body = renderOAuthError(out as { error: string; error_description?: string });
    },
    async loadExistingGrant(ctx) {
      // Reuse a previous consent for the same client/account when it already
      // covers what is being asked (library default behaviour).
      const grantId = ctx.oidc.result?.consent?.grantId || ctx.oidc.session?.grantIdFor(ctx.oidc.client!.clientId);
      return grantId ? ctx.oidc.provider.Grant.find(grantId) : undefined;
    },
  };

  const provider = new Provider(issuerUrl(config), configuration);
  // Express validates forwarded headers (trust proxy) before the request
  // reaches the provider and rewrites them to the trusted values.
  provider.proxy = true;
  return provider;
}
