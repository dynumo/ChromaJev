import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { absoluteUrl } from '../config.js';
import type { DB } from '../db/database.js';
import { nowIso } from '../db/database.js';
import { MailDeliveryError, type MailTransport } from '../mail/mailer.js';
import { invitationEmail, passwordResetEmail, verificationEmail } from '../mail/templates.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../util/errors.js';
import { randomToken, sha256 } from '../util/crypto.js';
import { hashPassword, validatePassword, verifyAgainstDummy, verifyPassword } from './passwords.js';
import type { SettingsService } from './settings.js';

export type Role = 'admin' | 'user';
export type UserStatus = 'active' | 'disabled';

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  status: UserStatus;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  password_hash: string;
  role: Role;
  status: UserStatus;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  invitedBy: string | null;
  invitedByEmail: string | null;
  createdAt: string;
  expiresAt: string;
  lastSentAt: string | null;
  sendCount: number;
  lastSendError: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
}

export const SESSION_TTL_DAYS = 30;
export const INVITATION_TTL_DAYS = 7;
export const VERIFY_TTL_HOURS = 48;
export const RESET_TTL_MINUTES = 60;

export class InvalidCredentialsError extends AppError {
  constructor(message = 'Email address or password is incorrect.') {
    super(401, 'invalid_credentials', message);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normaliseEmail(input: unknown): string {
  if (typeof input !== 'string') throw badRequest('Email address is required.');
  const e = input.trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.length > 254) throw badRequest('Enter a valid email address.');
  return e;
}

function toUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    status: r.status,
    emailVerifiedAt: r.email_verified_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastLoginAt: r.last_login_at,
  };
}

function addMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

type RevokeHook = (userId: string) => void;

/**
 * Users, sessions, email verification, password reset and invitations.
 * Tokens are 256-bit random values; only their SHA-256 is stored.
 */
export class AccountService {
  private revokeHooks: RevokeHook[] = [];

  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly settings: SettingsService,
    private readonly mail: MailTransport,
    private readonly log: (msg: string) => void = (m) => console.log(m),
  ) {}

  /** Called whenever a user's existing access must end (disable, password reset). */
  onAccessRevoked(hook: RevokeHook): void {
    this.revokeHooks.push(hook);
  }

  private revokeAccess(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    for (const h of this.revokeHooks) h(userId);
  }

  // ── Users ───────────────────────────────────────────────────────────────

  countUsers(): number {
    return (this.db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;
  }

  getUser(id: string): User | null {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return r ? toUser(r) : null;
  }

  getUserByEmail(email: string): User | null {
    const r = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as UserRow | undefined;
    return r ? toUser(r) : null;
  }

  listUsers(): User[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as UserRow[]).map(toUser);
  }

  /** Usable by OAuth / API: exists, active and verified. */
  isUsable(user: User | null): user is User {
    return !!user && user.status === 'active' && !!user.emailVerifiedAt;
  }

  private async insertUser(p: { email: string; password: string; role: Role; verified: boolean; displayName?: string | null }): Promise<User> {
    const now = nowIso();
    const id = randomUUID();
    const hashValue = await hashPassword(validatePassword(p.password));
    try {
      this.db
        .prepare(
          `INSERT INTO users (id, email, display_name, password_hash, role, status, email_verified_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        )
        .run(id, p.email, p.displayName ?? null, hashValue, p.role, p.verified ? now : null, now, now);
    } catch (err) {
      if (String((err as Error).message).includes('UNIQUE')) throw conflict('An account with that email address already exists.');
      throw err;
    }
    return this.getUser(id)!;
  }

  /**
   * First-run bootstrap: only when the database has no users at all. Never
   * modifies an existing account, so restarting with the same variables is
   * harmless and changing them later has no effect.
   */
  async bootstrapAdmin(): Promise<'created' | 'skipped-existing-users' | 'skipped-not-configured'> {
    const { email, password } = this.config.admin;
    if (!email || !password) return 'skipped-not-configured';
    if (this.countUsers() > 0) return 'skipped-existing-users';
    await this.insertUser({ email: normaliseEmail(email), password, role: 'admin', verified: true });
    this.log(`Created initial administrator ${email}`);
    return 'created';
  }

  async createUserDirect(p: { email: string; password: string; role?: Role; verified?: boolean }): Promise<User> {
    return this.insertUser({ email: normaliseEmail(p.email), password: p.password, role: p.role ?? 'user', verified: p.verified ?? true });
  }

  private activeAdminCount(excludingId?: string): number {
    return (
      this.db
        .prepare(`SELECT COUNT(*) n FROM users WHERE role = 'admin' AND status = 'active' AND email_verified_at IS NOT NULL AND id != ?`)
        .get(excludingId ?? '') as { n: number }
    ).n;
  }

  setStatus(actor: User, userId: string, status: UserStatus): User {
    const target = this.getUser(userId);
    if (!target) throw notFound('User');
    if (status === 'disabled' && target.role === 'admin' && this.activeAdminCount(target.id) === 0) {
      throw conflict('You cannot disable the last active administrator.');
    }
    if (status === 'disabled' && target.id === actor.id) throw conflict('You cannot disable your own account.');
    this.db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), userId);
    if (status === 'disabled') this.revokeAccess(userId);
    return this.getUser(userId)!;
  }

  setRole(actor: User, userId: string, role: Role): User {
    if (role !== 'admin' && role !== 'user') throw badRequest('Unknown role.');
    const target = this.getUser(userId);
    if (!target) throw notFound('User');
    if (target.role === 'admin' && role === 'user' && this.activeAdminCount(target.id) === 0) {
      throw conflict('You cannot demote the last active administrator.');
    }
    if (role === 'admin' && target.status !== 'active') throw conflict('Re-enable the account before promoting it.');
    this.db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, nowIso(), userId);
    void actor;
    return this.getUser(userId)!;
  }

  // ── Login & sessions ───────────────────────────────────────────────────

  async authenticate(emailInput: unknown, password: unknown): Promise<User> {
    let email: string;
    try {
      email = normaliseEmail(emailInput);
    } catch {
      throw new InvalidCredentialsError();
    }
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
    if (!row || typeof password !== 'string') {
      await verifyAgainstDummy(String(password ?? ''));
      throw new InvalidCredentialsError();
    }
    if (!(await verifyPassword(row.password_hash, password))) throw new InvalidCredentialsError();
    // Only reveal account state once the password has been proven.
    if (row.status !== 'active') throw new AppError(403, 'account_disabled', 'This account has been disabled.');
    if (!row.email_verified_at) {
      throw new AppError(403, 'email_unverified', 'Please confirm your email address first. Check your inbox for the link.');
    }
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id);
    return toUser(row);
  }

  createSession(userId: string): { token: string; csrfToken: string; expiresAt: string } {
    const token = randomToken();
    const csrfToken = randomToken(24);
    const now = nowIso();
    const expiresAt = addMs(SESSION_TTL_DAYS * 86400_000);
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sha256(token), userId, csrfToken, now, expiresAt, now);
    return { token, csrfToken, expiresAt };
  }

  resolveSession(token: string | undefined): { user: User; csrfToken: string } | null {
    if (!token) return null;
    const row = this.db
      .prepare(
        `SELECT s.csrf_token, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(sha256(token), nowIso()) as (UserRow & { csrf_token: string; last_seen_at: string }) | undefined;
    if (!row) return null;
    if (row.status !== 'active' || !row.email_verified_at) return null;
    // Avoid a write on every request: refresh last-seen at most every 10 min.
    if (Date.now() - Date.parse(row.last_seen_at) > 600_000) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(nowIso(), sha256(token));
    }
    return { user: toUser(row), csrfToken: row.csrf_token };
  }

  destroySession(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  purgeExpired(): void {
    const now = nowIso();
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM email_tokens WHERE expires_at <= ? OR used_at IS NOT NULL').run(now);
  }

  async changePassword(user: User, current: unknown, next: unknown): Promise<void> {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
    if (typeof current !== 'string' || !(await verifyPassword(row.password_hash, current))) {
      throw new InvalidCredentialsError('Current password is incorrect.');
    }
    const h = await hashPassword(validatePassword(next));
    this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(h, nowIso(), user.id);
  }

  // ── Public registration & email verification ───────────────────────────

  /**
   * Returns the same outcome whether or not the address is already
   * registered, so sign-up cannot be used to discover accounts.
   */
  async register(emailInput: unknown, password: unknown): Promise<void> {
    if (!this.settings.publicRegistration()) throw forbidden('Public sign-up is disabled. Ask an administrator for an invitation.');
    const email = normaliseEmail(emailInput);
    validatePassword(password);
    const existing = this.getUserByEmail(email);
    if (existing) {
      if (!existing.emailVerifiedAt && existing.status === 'active') await this.sendVerification(existing).catch(() => undefined);
      return;
    }
    const user = await this.insertUser({ email, password: password as string, role: 'user', verified: false });
    await this.sendVerification(user);
  }

  async sendVerification(user: User): Promise<void> {
    const token = this.issueEmailToken(user.id, 'verify_email', VERIFY_TTL_HOURS * 3600_000);
    const url = absoluteUrl(this.config, `/verify-email?token=${encodeURIComponent(token.token)}`);
    await this.mail.send(verificationEmail({ to: user.email, url, expiresAt: token.expiresAt }));
  }

  verifyEmail(token: unknown): User {
    const userId = this.consumeEmailToken(token, 'verify_email');
    this.db
      .prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?')
      .run(nowIso(), nowIso(), userId);
    return this.getUser(userId)!;
  }

  // ── Password reset ──────────────────────────────────────────────────────

  /** Always resolves the same way; only active, verified accounts get mail. */
  async requestPasswordReset(emailInput: unknown): Promise<void> {
    let email: string;
    try {
      email = normaliseEmail(emailInput);
    } catch {
      return;
    }
    const user = this.getUserByEmail(email);
    if (!user || user.status !== 'active' || !user.emailVerifiedAt) return;
    const token = this.issueEmailToken(user.id, 'reset_password', RESET_TTL_MINUTES * 60_000);
    const url = absoluteUrl(this.config, `/reset-password?token=${encodeURIComponent(token.token)}`);
    try {
      await this.mail.send(passwordResetEmail({ to: user.email, url, expiresAt: token.expiresAt }));
    } catch (err) {
      // Don't reveal the outcome to the requester; record it for operators.
      this.log(`Password reset email failed: ${(err as Error).message}`);
    }
  }

  checkResetToken(token: unknown): boolean {
    if (typeof token !== 'string' || !token) return false;
    const row = this.db
      .prepare(`SELECT id FROM email_tokens WHERE token_hash = ? AND purpose = 'reset_password' AND used_at IS NULL AND expires_at > ?`)
      .get(sha256(token), nowIso());
    return !!row;
  }

  async resetPassword(token: unknown, password: unknown): Promise<User> {
    validatePassword(password);
    const h = await hashPassword(password as string);
    const userId = this.consumeEmailToken(token, 'reset_password');
    this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(h, nowIso(), userId);
    // Invalidate other outstanding reset links and every session.
    this.db.prepare(`UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'reset_password' AND used_at IS NULL`).run(nowIso(), userId);
    this.revokeAccess(userId);
    return this.getUser(userId)!;
  }

  private issueEmailToken(userId: string, purpose: 'verify_email' | 'reset_password', ttlMs: number) {
    const token = randomToken();
    const expiresAt = addMs(ttlMs);
    this.db
      .prepare('INSERT INTO email_tokens (id, user_id, purpose, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), userId, purpose, sha256(token), nowIso(), expiresAt);
    return { token, expiresAt };
  }

  private consumeEmailToken(token: unknown, purpose: 'verify_email' | 'reset_password'): string {
    const invalid = new AppError(400, 'invalid_token', 'This link is invalid or has expired.');
    if (typeof token !== 'string' || !token) throw invalid;
    const consume = this.db.transaction(() => {
      const row = this.db
        .prepare(`SELECT id, user_id FROM email_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?`)
        .get(sha256(token), purpose, nowIso()) as { id: string; user_id: string } | undefined;
      if (!row) throw invalid;
      this.db.prepare('UPDATE email_tokens SET used_at = ? WHERE id = ?').run(nowIso(), row.id);
      return row.user_id;
    });
    return consume();
  }

  // ── Invitations ─────────────────────────────────────────────────────────

  listInvitations(): Invitation[] {
    const rows = this.db
      .prepare(
        `SELECT i.*, u.email AS invited_by_email FROM invitations i LEFT JOIN users u ON u.id = i.invited_by ORDER BY i.created_at DESC`,
      )
      .all() as InvitationRow[];
    return rows.map(toInvitation);
  }

  /**
   * Create and email an invitation. An address that already has an account is
   * refused clearly; an address with a pending invitation gets it re-sent.
   */
  async invite(admin: User, emailInput: unknown, roleInput: unknown = 'user'): Promise<{ invitation: Invitation; delivered: boolean; error?: string }> {
    const email = normaliseEmail(emailInput);
    const role: Role = roleInput === 'admin' ? 'admin' : 'user';
    if (this.getUserByEmail(email)) throw conflict(`${email} already has a ChromaJev account.`);
    const pending = this.db
      .prepare(`SELECT id FROM invitations WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`)
      .get(email, nowIso()) as { id: string } | undefined;
    if (pending) {
      this.db.prepare('UPDATE invitations SET role = ? WHERE id = ?').run(role, pending.id);
      return this.resendInvitation(admin, pending.id);
    }
    const id = randomUUID();
    const token = randomToken();
    this.db
      .prepare('INSERT INTO invitations (id, email, role, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, email, role, sha256(token), admin.id, nowIso(), addMs(INVITATION_TTL_DAYS * 86400_000));
    return this.deliverInvitation(admin, id, token);
  }

  /** Rotates the token (old links stop working) and extends the expiry. */
  async resendInvitation(admin: User, id: string): Promise<{ invitation: Invitation; delivered: boolean; error?: string }> {
    const inv = this.getInvitation(id);
    if (!inv) throw notFound('Invitation');
    if (inv.status === 'accepted') throw conflict('This invitation has already been accepted.');
    if (inv.status === 'revoked') throw conflict('This invitation was revoked. Create a new one instead.');
    if (this.getUserByEmail(inv.email)) throw conflict(`${inv.email} already has a ChromaJev account.`);
    const token = randomToken();
    this.db
      .prepare('UPDATE invitations SET token_hash = ?, expires_at = ? WHERE id = ?')
      .run(sha256(token), addMs(INVITATION_TTL_DAYS * 86400_000), id);
    return this.deliverInvitation(admin, id, token);
  }

  private async deliverInvitation(admin: User, id: string, token: string) {
    const inv = this.getInvitation(id)!;
    const url = absoluteUrl(this.config, `/invite?token=${encodeURIComponent(token)}`);
    try {
      await this.mail.send(
        invitationEmail({
          to: inv.email,
          url,
          expiresAt: inv.expiresAt,
          invitedBy: admin.displayName || admin.email,
          siteUrl: this.config.publicBaseUrl.origin,
        }),
      );
      this.db
        .prepare('UPDATE invitations SET last_sent_at = ?, send_count = send_count + 1, last_send_error = NULL WHERE id = ?')
        .run(nowIso(), id);
      return { invitation: this.getInvitation(id)!, delivered: true };
    } catch (err) {
      const message = err instanceof MailDeliveryError ? err.message : 'Email delivery failed.';
      this.db.prepare('UPDATE invitations SET last_send_error = ? WHERE id = ?').run(message, id);
      return { invitation: this.getInvitation(id)!, delivered: false, error: message };
    }
  }

  revokeInvitation(id: string): Invitation {
    const inv = this.getInvitation(id);
    if (!inv) throw notFound('Invitation');
    if (inv.status === 'accepted') throw conflict('This invitation has already been accepted.');
    this.db.prepare('UPDATE invitations SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(nowIso(), id);
    return this.getInvitation(id)!;
  }

  getInvitation(id: string): Invitation | null {
    const row = this.db
      .prepare('SELECT i.*, u.email AS invited_by_email FROM invitations i LEFT JOIN users u ON u.id = i.invited_by WHERE i.id = ?')
      .get(id) as InvitationRow | undefined;
    return row ? toInvitation(row) : null;
  }

  /** Look up a pending invitation by its secret token (for the accept page). */
  findPendingInvitation(token: unknown): Invitation | null {
    if (typeof token !== 'string' || !token) return null;
    const row = this.db
      .prepare(
        `SELECT i.*, u.email AS invited_by_email FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
         WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?`,
      )
      .get(sha256(token), nowIso()) as InvitationRow | undefined;
    return row ? toInvitation(row) : null;
  }

  /**
   * Accept: create the account for exactly the invited address. Following the
   * emailed link proves control of that address, so it is marked verified.
   */
  async acceptInvitation(token: unknown, password: unknown, displayName?: unknown): Promise<User> {
    validatePassword(password);
    const inv = this.findPendingInvitation(token);
    if (!inv) throw new AppError(400, 'invalid_token', 'This invitation is invalid, expired, revoked or already used.');
    if (this.getUserByEmail(inv.email)) throw conflict(`${inv.email} already has an account. Sign in instead.`);
    const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 80) : null;
    const hashValue = await hashPassword(password as string);
    const now = nowIso();
    const userId = randomUUID();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO users (id, email, display_name, password_hash, role, status, email_verified_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        )
        .run(userId, inv.email, name, hashValue, inv.role, now, now, now);
      // Claim inside the same transaction: single use even under races
      // (a lost race rolls the user insert back too).
      const claimed = this.db
        .prepare('UPDATE invitations SET accepted_at = ?, accepted_user_id = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL')
        .run(now, userId, inv.id);
      if (claimed.changes !== 1) throw new AppError(400, 'invalid_token', 'This invitation has already been used.');
    });
    tx();
    return this.getUser(userId)!;
  }

  // ── API keys (per-user, for scripts and integrations) ─────────────────

  createApiKey(user: User, nameInput: unknown, scopesInput: unknown): { key: string; record: ApiKey } {
    const name = typeof nameInput === 'string' && nameInput.trim() ? nameInput.trim().slice(0, 60) : 'API key';
    const scopes = normaliseScopes(scopesInput);
    const secret = `cj_${randomToken(30)}`;
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO api_keys (id, user_id, name, prefix, key_hash, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, user.id, name, secret.slice(0, 10), sha256(secret), scopes.join(' '), nowIso());
    return { key: secret, record: this.listApiKeys(user).find((k) => k.id === id)! };
  }

  listApiKeys(user: User): ApiKey[] {
    return (
      this.db
        .prepare('SELECT * FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC')
        .all(user.id) as ApiKeyRow[]
    ).map(toApiKey);
  }

  revokeApiKey(user: User, id: string): void {
    const r = this.db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').run(nowIso(), id, user.id);
    if (r.changes === 0) throw notFound('API key');
  }

  authenticateApiKey(secret: string): { user: User; scopes: string[] } | null {
    if (!secret.startsWith('cj_')) return null;
    const row = this.db
      .prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL')
      .get(sha256(secret)) as ApiKeyRow | undefined;
    if (!row) return null;
    const user = this.getUser(row.user_id);
    if (!this.isUsable(user)) return null;
    const last = row.last_used_at ? Date.parse(row.last_used_at) : 0;
    if (Date.now() - last > 300_000) this.db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
    return { user, scopes: row.scopes.split(' ').filter(Boolean) };
  }
}

export const SCOPES = ['schemes:read', 'schemes:generate', 'schemes:write'] as const;
export type Scope = (typeof SCOPES)[number];

export function normaliseScopes(input: unknown): Scope[] {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\s,]+/) : [];
  const out = SCOPES.filter((s) => list.includes(s));
  if (out.length === 0) throw badRequest(`Choose at least one scope: ${SCOPES.join(', ')}.`);
  return out;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}
interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
function toApiKey(r: ApiKeyRow): ApiKey {
  return { id: r.id, name: r.name, prefix: r.prefix, scopes: r.scopes.split(' '), createdAt: r.created_at, lastUsedAt: r.last_used_at };
}

interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  invited_by: string | null;
  invited_by_email: string | null;
  created_at: string;
  expires_at: string;
  last_sent_at: string | null;
  send_count: number;
  last_send_error: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
}
function toInvitation(r: InvitationRow): Invitation {
  const status: Invitation['status'] = r.accepted_at
    ? 'accepted'
    : r.revoked_at
      ? 'revoked'
      : Date.parse(r.expires_at) <= Date.now()
        ? 'expired'
        : 'pending';
  return {
    id: r.id,
    email: r.email,
    role: r.role,
    invitedBy: r.invited_by,
    invitedByEmail: r.invited_by_email,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    lastSentAt: r.last_sent_at,
    sendCount: r.send_count,
    lastSendError: r.last_send_error,
    acceptedAt: r.accepted_at,
    revokedAt: r.revoked_at,
    status,
  };
}
