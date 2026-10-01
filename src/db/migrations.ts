/**
 * Ordered schema migrations. Never edit a released migration — append a new
 * one. Each runs once, inside a transaction, at start-up.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      -- ── Accounts ─────────────────────────────────────────────────────────
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        email_verified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);

      -- Email verification and password reset tokens (hashed, single use).
      CREATE TABLE email_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE INDEX email_tokens_user ON email_tokens(user_id, purpose);

      CREATE TABLE invitations (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL COLLATE NOCASE,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        token_hash TEXT NOT NULL UNIQUE,
        invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_sent_at TEXT,
        send_count INTEGER NOT NULL DEFAULT 0,
        last_send_error TEXT,
        accepted_at TEXT,
        accepted_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        revoked_at TEXT
      );
      CREATE INDEX invitations_email ON invitations(email);

      CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        scopes TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );
      CREATE INDEX api_keys_user ON api_keys(user_id);

      -- ── Application settings and generated secrets ──────────────────────
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE app_secrets (
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- ── Semantic Jev cache (global optimisation, never listed to users) ──
      CREATE TABLE jev_evaluations (
        id TEXT PRIMARY KEY,
        normalised_query TEXT NOT NULL,
        original_query TEXT NOT NULL,
        catalogue_version TEXT NOT NULL,
        question_set_version TEXT NOT NULL,
        model TEXT,
        answers TEXT NOT NULL,
        usage TEXT,
        created_at TEXT NOT NULL,
        last_requested_at TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 1,
        hit_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE (normalised_query, catalogue_version, question_set_version)
      );

      -- ── Temporary generated palettes (expire) ───────────────────────────
      CREATE TABLE generated_schemes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        evaluation_id TEXT REFERENCES jev_evaluations(id) ON DELETE SET NULL,
        concept TEXT NOT NULL,
        variation INTEGER NOT NULL DEFAULT 0,
        options TEXT NOT NULL,
        scheme TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        from_cache INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX generated_user ON generated_schemes(user_id, created_at);
      CREATE INDEX generated_expiry ON generated_schemes(expires_at);

      -- ── Deliberately saved colour schemes (durable, user-owned) ─────────
      CREATE TABLE schemes (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        concept TEXT NOT NULL,
        light TEXT NOT NULL,
        dark TEXT NOT NULL,
        semantic TEXT NOT NULL,
        accessibility TEXT NOT NULL,
        details TEXT NOT NULL,
        evaluation_id TEXT REFERENCES jev_evaluations(id) ON DELETE SET NULL,
        generation TEXT NOT NULL,
        notes TEXT,
        algorithm_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (owner_id, slug)
      );
      CREATE INDEX schemes_owner ON schemes(owner_id, updated_at);

      -- ── OAuth authorisation-server storage (oidc-provider adapter) ──────
      CREATE TABLE oauth_models (
        model TEXT NOT NULL,
        id TEXT NOT NULL,
        payload TEXT NOT NULL,
        grant_id TEXT,
        user_code TEXT,
        uid TEXT,
        account_id TEXT,
        expires_at INTEGER,
        consumed_at INTEGER,
        PRIMARY KEY (model, id)
      );
      CREATE INDEX oauth_models_grant ON oauth_models(grant_id);
      CREATE INDEX oauth_models_uid ON oauth_models(uid);
      CREATE INDEX oauth_models_user_code ON oauth_models(user_code);
      CREATE INDEX oauth_models_account ON oauth_models(account_id);
      CREATE INDEX oauth_models_expiry ON oauth_models(expires_at);
    `,
  },
];
