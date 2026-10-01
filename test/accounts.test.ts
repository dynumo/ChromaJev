import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, createUser, csrfFrom, loginAgent, makeApp, type TestApp } from './helpers/app.js';
import { AppError } from '../src/util/errors.js';

function linkFrom(text: string, path: string): string {
  const m = new RegExp(`http://localhost:3000${path}\\?token=([A-Za-z0-9_%-]+)`).exec(text);
  if (!m) throw new Error(`no ${path} link in mail`);
  return decodeURIComponent(m[1]);
}

let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
});

describe('admin bootstrap', () => {
  it('creates the first admin with a hashed password', () => {
    const admin = t.ctx.accounts.getUserByEmail(ADMIN.email)!;
    expect(admin.role).toBe('admin');
    expect(admin.emailVerifiedAt).toBeTruthy();
    const row = t.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(admin.id) as { password_hash: string };
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain(ADMIN.password);
  });

  it('does not overwrite an existing account on restart', async () => {
    const before = t.db.prepare('SELECT password_hash FROM users').get();
    // Simulate a restart against the same database with different variables.
    const { AccountService } = await import('../src/accounts/service.js');
    const svc = new AccountService(t.db, { ...t.config, admin: { email: 'other@example.com', password: 'another password 1' } }, t.ctx.settings, t.mail, () => undefined);
    expect(await svc.bootstrapAdmin()).toBe('skipped-existing-users');
    expect(t.db.prepare('SELECT password_hash FROM users').get()).toEqual(before);
    expect(svc.countUsers()).toBe(1);
  });
});

describe('login', () => {
  it('signs in with valid credentials', async () => {
    const { agent } = await loginAgent(t);
    const res = await agent.get('/schemes');
    expect(res.status).toBe(200);
  });

  it('rejects invalid credentials without revealing which part was wrong', async () => {
    const agent = request.agent(t.app);
    const page = await agent.get('/login');
    const a = await agent.post('/login').type('form').send({ _csrf: csrfFrom(page.text), email: ADMIN.email, password: 'wrong password!' });
    const b = await agent.post('/login').type('form').send({ _csrf: csrfFrom(page.text), email: 'nobody@example.com', password: 'wrong password!' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.text).toContain('Email address or password is incorrect.');
    expect(b.text).toContain('Email address or password is incorrect.');
  });

  it('refuses login without a CSRF token', async () => {
    const res = await request(t.app).post('/login').type('form').send({ email: ADMIN.email, password: ADMIN.password });
    expect(res.status).toBe(403);
  });

  it('rejects disabled accounts and ends their sessions', async () => {
    const user = await createUser(t, 'dana@example.com');
    const { agent } = await loginAgent(t, 'dana@example.com', 'user password 123');
    const admin = t.ctx.accounts.getUserByEmail(ADMIN.email)!;
    t.ctx.accounts.setStatus(admin, user.id, 'disabled');
    expect((await agent.get('/schemes')).status).toBe(303); // session gone
    await expect(t.ctx.accounts.authenticate('dana@example.com', 'user password 123')).rejects.toMatchObject({ code: 'account_disabled' });
  });
});

describe('roles and last-admin protection', () => {
  it('promotes and demotes', async () => {
    const admin = t.ctx.accounts.getUserByEmail(ADMIN.email)!;
    const u = await createUser(t, 'erin@example.com');
    expect(t.ctx.accounts.setRole(admin, u.id, 'admin').role).toBe('admin');
    expect(t.ctx.accounts.setRole(admin, u.id, 'user').role).toBe('user');
  });

  it('cannot demote or disable the last active admin', async () => {
    const admin = t.ctx.accounts.getUserByEmail(ADMIN.email)!;
    const other = await createUser(t, 'frank@example.com');
    expect(() => t.ctx.accounts.setRole(other, admin.id, 'user')).toThrow(/last active administrator/);
    expect(() => t.ctx.accounts.setStatus(other, admin.id, 'disabled')).toThrow(/last active administrator/);
    // With a second admin it becomes possible.
    t.ctx.accounts.setRole(admin, other.id, 'admin');
    expect(t.ctx.accounts.setRole(other, admin.id, 'user').role).toBe('user');
  });

  it('non-admins cannot reach the admin area', async () => {
    await createUser(t, 'gail@example.com');
    const { agent } = await loginAgent(t, 'gail@example.com', 'user password 123');
    expect((await agent.get('/admin')).status).toBe(403);
  });
});

describe('public registration', () => {
  it('is disabled by default', async () => {
    expect(t.ctx.settings.publicRegistration()).toBe(false);
    expect((await request(t.app).get('/signup')).status).toBe(404);
    await expect(t.ctx.accounts.register('new@example.com', 'long enough password')).rejects.toBeInstanceOf(AppError);
  });

  it('persists the admin toggle in the database', async () => {
    const { agent, csrf } = await loginAgent(t);
    const res = await agent.post('/admin/settings/registration').type('form').send({ _csrf: csrf, public: '1' });
    expect(res.status).toBe(303);
    expect(t.ctx.settings.publicRegistration()).toBe(true);
    const row = t.db.prepare(`SELECT value FROM settings WHERE key = 'registration.public'`).get() as { value: string };
    expect(JSON.parse(row.value)).toBe(true);
  });

  it('requires email verification before sign-in', async () => {
    t.ctx.settings.set('registration.public', true);
    const agent = request.agent(t.app);
    const page = await agent.get('/signup');
    expect(page.status).toBe(200);
    const res = await agent.post('/signup').type('form').send({ _csrf: csrfFrom(page.text), email: 'Hana@Example.com', password: 'a long password 1' });
    expect(res.status).toBe(200);
    const user = t.ctx.accounts.getUserByEmail('hana@example.com')!;
    expect(user.emailVerifiedAt).toBeNull();
    await expect(t.ctx.accounts.authenticate('hana@example.com', 'a long password 1')).rejects.toMatchObject({ code: 'email_unverified' });

    const mail = t.mail.last('verify_email')!;
    expect(mail.to).toBe('hana@example.com');
    const token = linkFrom(mail.text, '/verify-email');
    const verify = await agent.get(`/verify-email?token=${encodeURIComponent(token)}`);
    expect(verify.status).toBe(303);
    expect((await t.ctx.accounts.authenticate('hana@example.com', 'a long password 1')).email).toBe('hana@example.com');
    // single use
    expect((await agent.get(`/verify-email?token=${encodeURIComponent(token)}`)).status).toBe(400);
  });

  it('does not reveal whether an address is already registered', async () => {
    t.ctx.settings.set('registration.public', true);
    await expect(t.ctx.accounts.register(ADMIN.email, 'a long password 1')).resolves.toBeUndefined();
    expect(t.ctx.accounts.countUsers()).toBe(1);
  });
});

describe('invitations', () => {
  async function invite(email: string) {
    const admin = t.ctx.accounts.getUserByEmail(ADMIN.email)!;
    const out = await t.ctx.accounts.invite(admin, email);
    const token = linkFrom(t.mail.last('invitation')!.text, '/invite');
    return { ...out, token, admin };
  }

  it('sends a single-use invitation that creates a verified account', async () => {
    const { invitation, token } = await invite('ivy@example.com');
    expect(invitation.status).toBe('pending');
    const mail = t.mail.last('invitation')!;
    expect(mail.subject).toMatch(/invited/);
    expect(mail.text).toContain('admin@example.com');
    expect(mail.html).toContain('Accept invitation');
    // token stored hashed, never in plaintext
    const row = t.db.prepare('SELECT token_hash FROM invitations').get() as { token_hash: string };
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toHaveLength(64);

    const agent = request.agent(t.app);
    const page = await agent.get(`/invite?token=${encodeURIComponent(token)}`);
    expect(page.status).toBe(200);
    const res = await agent.post('/invite').type('form').send({ _csrf: csrfFrom(page.text), token, password: 'invited password 1' });
    expect(res.status).toBe(303);
    const user = t.ctx.accounts.getUserByEmail('ivy@example.com')!;
    expect(user.emailVerifiedAt).toBeTruthy();
    expect(t.ctx.accounts.getInvitation(invitation.id)!.status).toBe('accepted');

    // reuse rejected
    await expect(t.ctx.accounts.acceptInvitation(token, 'another password 1')).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('works with public sign-up disabled', async () => {
    expect(t.ctx.settings.publicRegistration()).toBe(false);
    const { token } = await invite('jo@example.com');
    expect((await t.ctx.accounts.acceptInvitation(token, 'invited password 1')).email).toBe('jo@example.com');
  });

  it('expires', async () => {
    const { token, invitation } = await invite('kai@example.com');
    t.db.prepare('UPDATE invitations SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), invitation.id);
    expect(t.ctx.accounts.getInvitation(invitation.id)!.status).toBe('expired');
    await expect(t.ctx.accounts.acceptInvitation(token, 'invited password 1')).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('can be revoked', async () => {
    const { token, invitation } = await invite('lee@example.com');
    t.ctx.accounts.revokeInvitation(invitation.id);
    expect(t.ctx.accounts.getInvitation(invitation.id)!.status).toBe('revoked');
    await expect(t.ctx.accounts.acceptInvitation(token, 'invited password 1')).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('resend rotates the token so old links stop working', async () => {
    const first = await invite('max@example.com');
    const out = await t.ctx.accounts.resendInvitation(first.admin, first.invitation.id);
    expect(out.delivered).toBe(true);
    expect(out.invitation.sendCount).toBe(2);
    const newToken = linkFrom(t.mail.last('invitation')!.text, '/invite');
    expect(newToken).not.toBe(first.token);
    await expect(t.ctx.accounts.acceptInvitation(first.token, 'invited password 1')).rejects.toMatchObject({ code: 'invalid_token' });
    expect((await t.ctx.accounts.acceptInvitation(newToken, 'invited password 1')).email).toBe('max@example.com');
  });

  it('refuses to invite an existing account', async () => {
    const admin = t.ctx.accounts.getUserByEmail(ADMIN.email)!;
    await expect(t.ctx.accounts.invite(admin, ADMIN.email)).rejects.toThrow(/already has a ChromaJev account/);
  });

  it('records email delivery failure instead of losing the invitation', async () => {
    const admin = t.ctx.accounts.getUserByEmail(ADMIN.email)!;
    const { MailDeliveryError } = await import('../src/mail/mailer.js');
    t.mail.failNext = new MailDeliveryError('Elastic Email rejected the message (HTTP 500)');
    const out = await t.ctx.accounts.invite(admin, 'nia@example.com');
    expect(out.delivered).toBe(false);
    expect(out.invitation.lastSendError).toContain('HTTP 500');
    expect(out.invitation.status).toBe('pending');
  });

  it('admins manage invitations through the web UI', async () => {
    const { agent, csrf } = await loginAgent(t);
    const res = await agent.post('/admin/invitations').type('form').send({ _csrf: csrf, email: 'olu@example.com', role: 'user' });
    expect(res.status).toBe(303);
    const page = await agent.get('/admin');
    expect(page.text).toContain('olu@example.com');
    expect(page.text).toContain('pending');
  });
});

describe('password reset', () => {
  it('uses a time-limited single-use token and ends sessions', async () => {
    const { agent } = await loginAgent(t);
    await t.ctx.accounts.requestPasswordReset(ADMIN.email);
    const mail = t.mail.last('reset_password')!;
    const token = linkFrom(mail.text, '/reset-password');
    expect(t.ctx.accounts.checkResetToken(token)).toBe(true);
    await t.ctx.accounts.resetPassword(token, 'brand new password 1');
    expect((await agent.get('/account')).status).toBe(303); // old session revoked
    await expect(t.ctx.accounts.resetPassword(token, 'another new password 1')).rejects.toMatchObject({ code: 'invalid_token' });
    expect((await t.ctx.accounts.authenticate(ADMIN.email, 'brand new password 1')).email).toBe(ADMIN.email);
  });

  it('expired tokens are rejected', async () => {
    await t.ctx.accounts.requestPasswordReset(ADMIN.email);
    const token = linkFrom(t.mail.last('reset_password')!.text, '/reset-password');
    t.db.prepare(`UPDATE email_tokens SET expires_at = ?`).run(new Date(Date.now() - 1).toISOString());
    expect(t.ctx.accounts.checkResetToken(token)).toBe(false);
    await expect(t.ctx.accounts.resetPassword(token, 'brand new password 1')).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('gives the same response for unknown addresses and sends nothing', async () => {
    const agent = request.agent(t.app);
    const page = await agent.get('/forgot-password');
    const known = await agent.post('/forgot-password').type('form').send({ _csrf: csrfFrom(page.text), email: ADMIN.email });
    const sentCount = t.mail.sent.length;
    const unknown = await agent.post('/forgot-password').type('form').send({ _csrf: csrfFrom(page.text), email: 'ghost@example.com' });
    expect(known.status).toBe(unknown.status);
    expect(known.text).toBe(unknown.text);
    expect(t.mail.sent.length).toBe(sentCount);
  });
});
