import type { DB } from '../db/database.js';

/**
 * Persistence for oidc-provider (grants, codes, refresh tokens, sessions,
 * interactions, registered clients) in the application's SQLite database.
 * Implements the library's documented Adapter interface; no protocol logic.
 */
type Payload = Record<string, unknown> & {
  grantId?: string;
  userCode?: string;
  uid?: string;
  accountId?: string;
  consumed?: number;
};

const now = () => Math.floor(Date.now() / 1000);

export function sqliteAdapterFactory(db: DB) {
  return class SqliteAdapter {
    constructor(private readonly model: string) {}

    async upsert(id: string, payload: Payload, expiresIn?: number): Promise<void> {
      const expiresAt = expiresIn ? now() + expiresIn : null;
      db.prepare(
        `INSERT INTO oauth_models (model, id, payload, grant_id, user_code, uid, account_id, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(model, id) DO UPDATE SET payload = excluded.payload, grant_id = excluded.grant_id,
           user_code = excluded.user_code, uid = excluded.uid, account_id = excluded.account_id, expires_at = excluded.expires_at`,
      ).run(
        this.model,
        id,
        JSON.stringify(payload),
        payload.grantId ?? null,
        payload.userCode ?? null,
        payload.uid ?? null,
        payload.accountId ?? null,
        expiresAt,
      );
    }

    private load(where: string, value: string): Payload | undefined {
      const row = db
        .prepare(`SELECT payload, expires_at, consumed_at FROM oauth_models WHERE model = ? AND ${where} = ?`)
        .get(this.model, value) as { payload: string; expires_at: number | null; consumed_at: number | null } | undefined;
      if (!row) return undefined;
      if (row.expires_at !== null && row.expires_at <= now()) return undefined;
      const payload = JSON.parse(row.payload) as Payload;
      if (row.consumed_at) payload.consumed = row.consumed_at;
      return payload;
    }

    async find(id: string) {
      return this.load('id', id);
    }

    async findByUserCode(userCode: string) {
      return this.load('user_code', userCode);
    }

    async findByUid(uid: string) {
      return this.load('uid', uid);
    }

    async consume(id: string): Promise<void> {
      db.prepare('UPDATE oauth_models SET consumed_at = ? WHERE model = ? AND id = ?').run(now(), this.model, id);
    }

    async destroy(id: string): Promise<void> {
      db.prepare('DELETE FROM oauth_models WHERE model = ? AND id = ?').run(this.model, id);
    }

    async revokeByGrantId(grantId: string): Promise<void> {
      db.prepare('DELETE FROM oauth_models WHERE grant_id = ?').run(grantId);
    }
  };
}

/** Remove every grant, token and session belonging to an account. */
export function revokeAccountOAuth(db: DB, accountId: string): void {
  const grants = db
    .prepare(`SELECT id FROM oauth_models WHERE model = 'Grant' AND account_id = ?`)
    .all(accountId) as { id: string }[];
  const tx = db.transaction(() => {
    for (const g of grants) db.prepare('DELETE FROM oauth_models WHERE grant_id = ?').run(g.id);
    db.prepare('DELETE FROM oauth_models WHERE account_id = ?').run(accountId);
  });
  tx();
}

export function purgeExpiredOAuth(db: DB): number {
  return db.prepare('DELETE FROM oauth_models WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now()).changes;
}

export interface ConnectedClient {
  grantId: string;
  clientId: string;
  clientName: string | null;
  scopes: string[];
  createdAt: number | null;
}

/** Grants a user has approved, for the account page ("connected apps"). */
export function listGrants(db: DB, accountId: string): ConnectedClient[] {
  const rows = db
    .prepare(`SELECT id, payload FROM oauth_models WHERE model = 'Grant' AND account_id = ? AND (expires_at IS NULL OR expires_at > ?)`)
    .all(accountId, now()) as { id: string; payload: string }[];
  return rows.map((r) => {
    const p = JSON.parse(r.payload) as { clientId: string; iat?: number; resources?: Record<string, string> };
    const client = db.prepare(`SELECT payload FROM oauth_models WHERE model = 'Client' AND id = ?`).get(p.clientId) as
      | { payload: string }
      | undefined;
    const meta = client ? (JSON.parse(client.payload) as { client_name?: string }) : null;
    const scopes = Object.values(p.resources ?? {}).flatMap((s) => s.split(' ')).filter(Boolean);
    return { grantId: r.id, clientId: p.clientId, clientName: meta?.client_name ?? null, scopes: [...new Set(scopes)], createdAt: p.iat ?? null };
  });
}

export function revokeGrant(db: DB, accountId: string, grantId: string): boolean {
  const row = db.prepare(`SELECT id FROM oauth_models WHERE model = 'Grant' AND id = ? AND account_id = ?`).get(grantId, accountId);
  if (!row) return false;
  db.prepare('DELETE FROM oauth_models WHERE grant_id = ? OR (model = ? AND id = ?)').run(grantId, 'Grant', grantId);
  return true;
}
