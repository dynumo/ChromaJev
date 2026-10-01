import path from 'node:path';

/**
 * All runtime configuration comes from environment variables. Nothing reads a
 * `.env` file in production; `npm run dev` uses Node's `--env-file-if-exists`.
 */
export interface AppConfig {
  env: 'production' | 'development' | 'test';
  port: number;
  host: string;
  publicBaseUrl: URL;
  /** True when the public URL is HTTPS (drives Secure / __Host- cookies). */
  secureCookies: boolean;
  dataDir: string;
  databaseFile: string;
  trustProxy: string | number | boolean;
  jev: {
    /** Where Jev requests go: TypeSafe directly, or Cloudflare's REST API / AI Gateway. */
    provider: 'typesafe' | 'cloudflare';
    apiKey: string | null;
    model: string;
    timeoutMs: number;
    baseUrl: string | null;
    cloudflare: {
      accountId: string | null;
      apiToken: string | null;
      /** Optional named AI Gateway; Cloudflare uses the account default otherwise. */
      gatewayId: string | null;
      model: string;
      baseUrl: string;
    };
  };
  admin: { email: string | null; password: string | null };
  mail: {
    transport: 'elastic' | 'log' | 'none';
    elasticApiKey: string | null;
    fromAddress: string | null;
    fromName: string;
  };
  basicAuth: { username: string; password: string } | null;
  oauth: {
    accessTokenTtlSeconds: number;
    refreshTokenTtlSeconds: number;
    allowDynamicRegistration: boolean;
    allowClientIdMetadataDocuments: boolean;
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

function str(env: Env, key: string): string | null {
  const v = env[key];
  if (v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function int(env: Env, key: string, fallback: number): number {
  const v = str(env, key);
  if (v === null) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ConfigError(`${key} must be a positive integer (got "${v}")`);
  return n;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const v = str(env, key);
  if (v === null) return fallback;
  if (/^(1|true|yes|on)$/i.test(v)) return true;
  if (/^(0|false|no|off)$/i.test(v)) return false;
  throw new ConfigError(`${key} must be true or false (got "${v}")`);
}

function parseTrustProxy(v: string | null): string | number | boolean {
  // Default: trust proxies on loopback and private networks, which covers a
  // reverse proxy (Traefik/Dokploy) on the same Docker network but not the
  // public internet.
  if (v === null) return 'loopback, linklocal, uniquelocal';
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const nodeEnv = (str(env, 'NODE_ENV') ?? 'development') as string;
  const appEnv: AppConfig['env'] =
    nodeEnv === 'production' ? 'production' : nodeEnv === 'test' ? 'test' : 'development';

  const port = int(env, 'PORT', 3000);
  const rawBase = str(env, 'PUBLIC_BASE_URL') ?? (appEnv === 'production' ? null : `http://localhost:${port}`);
  if (!rawBase) throw new ConfigError('PUBLIC_BASE_URL is required in production (e.g. https://chromajev.example.com)');
  let publicBaseUrl: URL;
  try {
    publicBaseUrl = new URL(rawBase.replace(/\/+$/, ''));
  } catch {
    throw new ConfigError(`PUBLIC_BASE_URL is not a valid URL: ${rawBase}`);
  }
  if (publicBaseUrl.pathname !== '/' || publicBaseUrl.search || publicBaseUrl.hash) {
    throw new ConfigError('PUBLIC_BASE_URL must be an origin without a path, query or fragment (e.g. https://chromajev.example.com)');
  }
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(publicBaseUrl.hostname);
  if (appEnv === 'production' && publicBaseUrl.protocol !== 'https:' && !isLocal) {
    throw new ConfigError('PUBLIC_BASE_URL must use https in production (OAuth requires it)');
  }

  // Jev provider. Explicit JEV_PROVIDER wins; otherwise TypeSafe if its key is
  // set, Cloudflare if only Cloudflare credentials are set.
  const tsKey = str(env, 'TYPESAFE_API_KEY');
  const cfAccount = str(env, 'CLOUDFLARE_ACCOUNT_ID');
  const cfToken = str(env, 'CLOUDFLARE_API_TOKEN');
  const providerRaw = (str(env, 'JEV_PROVIDER') ?? '').toLowerCase();
  let jevProvider: AppConfig['jev']['provider'];
  if (providerRaw === '') jevProvider = !tsKey && (cfAccount || cfToken) ? 'cloudflare' : 'typesafe';
  else if (providerRaw === 'typesafe' || providerRaw === 'cloudflare') jevProvider = providerRaw;
  else throw new ConfigError('JEV_PROVIDER must be "typesafe" or "cloudflare"');
  if (jevProvider === 'cloudflare' && (!cfAccount || !cfToken)) {
    throw new ConfigError(
      'JEV_PROVIDER=cloudflare needs both CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (a token with Account > Workers AI > Read).',
    );
  }
  const cfGateway = str(env, 'CLOUDFLARE_AI_GATEWAY_ID');
  if (cfGateway !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(cfGateway)) {
    throw new ConfigError('CLOUDFLARE_AI_GATEWAY_ID must be a gateway ID (letters, digits, "-" or "_")');
  }

  const dataDir = path.resolve(str(env, 'DATA_DIR') ?? (appEnv === 'production' ? '/data' : './data'));

  // Optional perimeter Basic Auth: both or neither.
  const bu = str(env, 'BASIC_AUTH_USERNAME');
  const bp = str(env, 'BASIC_AUTH_PASSWORD');
  if ((bu === null) !== (bp === null)) {
    throw new ConfigError(
      'Basic Auth is half-configured: set both BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD, or neither.',
    );
  }
  if (bu !== null && bu.includes(':')) throw new ConfigError('BASIC_AUTH_USERNAME must not contain ":"');

  const transportRaw = (str(env, 'MAIL_TRANSPORT') ?? '').toLowerCase();
  const elasticApiKey = str(env, 'ELASTIC_EMAIL_API_KEY');
  let transport: AppConfig['mail']['transport'];
  if (transportRaw === '') {
    transport = elasticApiKey ? 'elastic' : appEnv === 'production' ? 'none' : 'log';
  } else if (transportRaw === 'elastic' || transportRaw === 'log' || transportRaw === 'none') {
    transport = transportRaw;
  } else {
    throw new ConfigError('MAIL_TRANSPORT must be one of: elastic, log, none');
  }
  if (transport === 'log' && appEnv === 'production') {
    throw new ConfigError(
      'MAIL_TRANSPORT=log is refused in production: it would write invitation and password-reset links to the logs.',
    );
  }
  if (transport === 'elastic' && !elasticApiKey) {
    throw new ConfigError('MAIL_TRANSPORT=elastic requires ELASTIC_EMAIL_API_KEY');
  }
  const fromAddress = str(env, 'MAIL_FROM_ADDRESS');
  if (transport === 'elastic' && !fromAddress) {
    throw new ConfigError('MAIL_FROM_ADDRESS is required when sending through Elastic Email');
  }

  return {
    env: appEnv,
    port,
    host: str(env, 'HOST') ?? '0.0.0.0',
    publicBaseUrl,
    secureCookies: publicBaseUrl.protocol === 'https:',
    dataDir,
    databaseFile: path.join(dataDir, 'chromajev.sqlite'),
    trustProxy: parseTrustProxy(str(env, 'TRUST_PROXY')),
    jev: {
      provider: jevProvider,
      apiKey: tsKey,
      model: str(env, 'JEV_MODEL') ?? 'jev-latest',
      timeoutMs: int(env, 'JEV_TIMEOUT_MS', 20000),
      baseUrl: str(env, 'TYPESAFE_BASE_URL'),
      cloudflare: {
        accountId: cfAccount,
        apiToken: cfToken,
        gatewayId: cfGateway,
        model: str(env, 'CLOUDFLARE_JEV_MODEL') ?? 'typesafe/jev',
        baseUrl: (str(env, 'CLOUDFLARE_API_BASE_URL') ?? 'https://api.cloudflare.com/client/v4').replace(/\/+$/, ''),
      },
    },
    admin: { email: str(env, 'ADMIN_EMAIL'), password: str(env, 'ADMIN_PASSWORD') },
    mail: {
      transport,
      elasticApiKey,
      fromAddress,
      fromName: str(env, 'MAIL_FROM_NAME') ?? 'ChromaJev',
    },
    basicAuth: bu !== null && bp !== null ? { username: bu, password: bp } : null,
    oauth: {
      accessTokenTtlSeconds: int(env, 'OAUTH_ACCESS_TOKEN_TTL', 3600),
      refreshTokenTtlSeconds: int(env, 'OAUTH_REFRESH_TOKEN_TTL', 60 * 60 * 24 * 30),
      allowDynamicRegistration: bool(env, 'OAUTH_DYNAMIC_REGISTRATION', true),
      allowClientIdMetadataDocuments: bool(env, 'OAUTH_CLIENT_ID_METADATA_DOCUMENTS', true),
    },
  };
}

export function absoluteUrl(config: AppConfig, pathname: string): string {
  return new URL(pathname, config.publicBaseUrl).href;
}

/** Canonical MCP resource identifier (RFC 8707), no trailing slash. */
export function mcpResourceUrl(config: AppConfig): string {
  return new URL('/mcp', config.publicBaseUrl).href;
}

export function issuerUrl(config: AppConfig): string {
  // URL.href of an origin ends with "/"; the issuer is the bare origin.
  return config.publicBaseUrl.origin;
}
