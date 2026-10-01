import { exportJWK, generateKeyPair, type JWK } from 'jose';
import type { DB } from '../db/database.js';
import { nowIso } from '../db/database.js';
import { randomToken } from '../util/crypto.js';

/**
 * Signing keys and cookie secrets are generated on first start and kept in
 * the database under DATA_DIR, so they survive redeploys without extra
 * environment variables.
 */
function getSecret(db: DB, name: string): string | null {
  const row = db.prepare('SELECT value FROM app_secrets WHERE name = ?').get(name) as { value: string } | undefined;
  return row?.value ?? null;
}

function setSecret(db: DB, name: string, value: string): void {
  db.prepare('INSERT OR IGNORE INTO app_secrets (name, value, created_at) VALUES (?, ?, ?)').run(name, value, nowIso());
}

export async function loadSigningJwks(db: DB): Promise<{ keys: JWK[] }> {
  const existing = getSecret(db, 'oauth.jwks');
  if (existing) return JSON.parse(existing);
  const { privateKey } = await generateKeyPair('RS256', { extractable: true, modulusLength: 2048 });
  const jwk = await exportJWK(privateKey);
  const jwks = { keys: [{ ...jwk, kid: `cj-${randomToken(8)}`, alg: 'RS256', use: 'sig' }] };
  setSecret(db, 'oauth.jwks', JSON.stringify(jwks));
  // Another process may have won the race; always return what is stored.
  return JSON.parse(getSecret(db, 'oauth.jwks')!);
}

export function loadCookieKeys(db: DB): string[] {
  let v = getSecret(db, 'oauth.cookie_keys');
  if (!v) {
    setSecret(db, 'oauth.cookie_keys', JSON.stringify([randomToken(32)]));
    v = getSecret(db, 'oauth.cookie_keys')!;
  }
  return JSON.parse(v);
}

/** Public half of the signing keys, for local access-token verification. */
export function publicJwks(jwks: { keys: JWK[] }): { keys: JWK[] } {
  return {
    keys: jwks.keys.map(({ kty, n, e, kid, alg, use, crv, x, y }) =>
      Object.fromEntries(Object.entries({ kty, n, e, kid, alg, use, crv, x, y }).filter(([, v]) => v !== undefined)),
    ),
  };
}
