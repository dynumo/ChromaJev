import type { ApiKey, Invitation, User } from '../../accounts/service.js';
import { SCOPES } from '../../accounts/service.js';
import type { ConnectedClient } from '../../oauth/adapter.js';
import { html, type SafeHtml } from '../../util/html.js';
import { csrfField, formatDate } from './layout.js';

export function accountPage(p: {
  csrf: string;
  user: User;
  apiKeys: ApiKey[];
  newKey?: string | null;
  grants: ConnectedClient[];
  mcpUrl: string;
  apiBase: string;
  error?: string | null;
}): SafeHtml {
  return html`<h1>Your account</h1>
  ${p.error ? html`<div class="flash flash-error" role="alert">${p.error}</div>` : ''}
  <div class="cards-2">
    <section class="panel">
      <h2 class="panel-title">Profile</h2>
      <dl class="dl"><dt>Email</dt><dd>${p.user.email}</dd><dt>Role</dt><dd>${p.user.role}</dd><dt>Member since</dt><dd>${formatDate(p.user.createdAt)}</dd></dl>
    </section>
    <section class="panel">
      <h2 class="panel-title">Change password</h2>
      <form method="post" action="/account/password" class="stack">${csrfField(p.csrf)}
        <label>Current password<input type="password" name="current_password" autocomplete="current-password" required></label>
        <label>New password<input type="password" name="new_password" autocomplete="new-password" minlength="10" required></label>
        <button class="btn btn-primary" type="submit">Update password</button></form>
    </section>
  </div>

  <section class="panel">
    <h2 class="panel-title">API keys</h2>
    <p class="muted small">Personal keys for scripts and integrations. Send as <code>Authorization: Bearer cj_…</code> to <code>${p.apiBase}</code>. Keys act as you and only see your schemes.</p>
    ${p.newKey ? html`<div class="flash flash-success" role="status"><strong>Copy your new key now — it won’t be shown again:</strong><br><code class="secret" data-copy-text="${p.newKey}">${p.newKey}</code> <button type="button" class="btn btn-ghost btn-sm" data-copy="${p.newKey}">Copy</button></div>` : ''}
    ${p.apiKeys.length
      ? html`<table class="table"><thead><tr><th>Name</th><th>Key</th><th>Scopes</th><th>Created</th><th>Last used</th><th></th></tr></thead><tbody>
      ${p.apiKeys.map((k) => html`<tr><td>${k.name}</td><td><code>${k.prefix}…</code></td><td>${k.scopes.join(', ')}</td><td>${formatDate(k.createdAt)}</td><td>${formatDate(k.lastUsedAt)}</td>
        <td><form method="post" action="/account/api-keys/${k.id}/revoke" class="inline-form" data-confirm="Revoke this key?">${csrfField(p.csrf)}<button class="btn btn-ghost btn-sm" type="submit">Revoke</button></form></td></tr>`)}
      </tbody></table>`
      : html`<p class="muted">No API keys yet.</p>`}
    <form method="post" action="/account/api-keys" class="row wrap">${csrfField(p.csrf)}
      <label class="grow">Key name<input name="name" maxlength="60" placeholder="e.g. Build script"></label>
      <fieldset class="scopes"><legend>Scopes</legend>${SCOPES.map((s) => html`<label class="check"><input type="checkbox" name="scopes" value="${s}" ${s !== 'schemes:write' ? 'checked' : ''}> ${s}</label>`)}</fieldset>
      <button class="btn btn-primary" type="submit">Create key</button></form>
  </section>

  <section class="panel">
    <h2 class="panel-title">Connected AI apps (MCP)</h2>
    <p class="muted small">Add <code>${p.mcpUrl}</code> as a remote MCP server in Claude, ChatGPT or another MCP client. You’ll be asked to sign in here and approve access; the client never sees your password.</p>
    ${p.grants.length
      ? html`<table class="table"><thead><tr><th>Client</th><th>Access</th><th>Approved</th><th></th></tr></thead><tbody>
      ${p.grants.map((g) => html`<tr><td>${g.clientName ?? g.clientId}</td><td>${g.scopes.join(', ') || '—'}</td><td>${g.createdAt ? formatDate(new Date(g.createdAt * 1000).toISOString()) : '—'}</td>
        <td><form method="post" action="/account/grants/${g.grantId}/revoke" class="inline-form" data-confirm="Disconnect this app?">${csrfField(p.csrf)}<button class="btn btn-ghost btn-sm" type="submit">Disconnect</button></form></td></tr>`)}
      </tbody></table>`
      : html`<p class="muted">No apps connected.</p>`}
  </section>`;
}

export function adminPage(p: {
  csrf: string;
  me: User;
  users: User[];
  invitations: Invitation[];
  publicSignup: boolean;
  mailStatus: string;
  cache: { entries: number; current: number; hits: number; requests: number };
  jevConfigured: boolean;
  jevProvider: string;
  flash?: { kind: 'success' | 'error' | 'info'; message: string } | null;
}): SafeHtml {
  const saved = p.cache.hits;
  return html`<h1>Administration</h1>
  ${p.mailStatus !== 'ok' ? html`<div class="flash flash-error" role="alert">${p.mailStatus}</div>` : ''}
  ${p.jevConfigured ? '' : html`<div class="flash flash-error" role="alert">Jev is not configured (set TYPESAFE_API_KEY, or CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN): new concepts cannot be evaluated.</div>`}
  <div class="cards-3">
    <section class="panel">
      <h2 class="panel-title">Registration</h2>
      <form method="post" action="/admin/settings/registration" class="stack">${csrfField(p.csrf)}
        <label class="check"><input type="radio" name="public" value="1" ${p.publicSignup ? 'checked' : ''}> Public sign-up enabled <span class="muted small">(email verification required)</span></label>
        <label class="check"><input type="radio" name="public" value="0" ${p.publicSignup ? '' : 'checked'}> Public sign-up disabled <span class="muted small">(invitations only)</span></label>
        <button class="btn btn-primary" type="submit">Save</button></form>
    </section>
    <section class="panel">
      <h2 class="panel-title">Semantic cache</h2>
      <dl class="dl"><dt>Jev route</dt><dd>${p.jevConfigured ? p.jevProvider : 'not configured'}</dd><dt>Cached judgements</dt><dd>${p.cache.current} current · ${p.cache.entries} total</dd><dt>Requests served</dt><dd>${p.cache.requests}</dd><dt>Jev calls avoided</dt><dd>${saved}</dd></dl>
      ${p.cache.entries > p.cache.current
        ? html`<form method="post" action="/admin/cache/purge-stale" class="inline-form">${csrfField(p.csrf)}<button class="btn btn-ghost btn-sm" type="submit">Remove stale versions</button></form>`
        : ''}
    </section>
    <section class="panel">
      <h2 class="panel-title">Invite someone</h2>
      <form method="post" action="/admin/invitations" class="stack">${csrfField(p.csrf)}
        <label>Email address<input type="email" name="email" required></label>
        <label>Role<select name="role"><option value="user">User</option><option value="admin">Administrator</option></select></label>
        <button class="btn btn-primary" type="submit">Send invitation</button></form>
    </section>
  </div>

  <section class="panel">
    <h2 class="panel-title">Invitations</h2>
    ${p.invitations.length
      ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Email</th><th>Role</th><th>Invited by</th><th>Created</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
    ${p.invitations.map((i) => html`<tr><td>${i.email}</td><td>${i.role}</td><td>${i.invitedByEmail ?? '—'}</td><td>${formatDate(i.createdAt)}</td><td>${formatDate(i.expiresAt)}</td>
      <td><span class="badge badge-${i.status}">${i.status}</span>${i.lastSendError ? html`<br><span class="small error-text">Last send failed: ${i.lastSendError}</span>` : ''}${i.acceptedAt ? html`<br><span class="small muted">${formatDate(i.acceptedAt)}</span>` : ''}</td>
      <td class="actions">${i.status === 'pending' || i.status === 'expired'
        ? html`<form method="post" action="/admin/invitations/${i.id}/resend" class="inline-form">${csrfField(p.csrf)}<button class="btn btn-ghost btn-sm" type="submit">Resend</button></form>`
        : ''}${i.status === 'pending'
        ? html`<form method="post" action="/admin/invitations/${i.id}/revoke" class="inline-form" data-confirm="Revoke the invitation for ${i.email}?">${csrfField(p.csrf)}<button class="btn btn-ghost btn-sm" type="submit">Revoke</button></form>`
        : ''}</td></tr>`)}
    </tbody></table></div>`
      : html`<p class="muted">No invitations yet.</p>`}
  </section>

  <section class="panel">
    <h2 class="panel-title">Users</h2>
    <div class="table-wrap"><table class="table"><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Email verified</th><th>Created</th><th>Last sign-in</th><th></th></tr></thead><tbody>
    ${p.users.map((u) => html`<tr><td>${u.email}${u.id === p.me.id ? html` <span class="badge">you</span>` : ''}</td><td>${u.role}</td>
      <td><span class="badge badge-${u.status === 'active' ? 'ok' : 'warn'}">${u.status}</span></td>
      <td>${u.emailVerifiedAt ? formatDate(u.emailVerifiedAt) : html`<span class="muted">No</span>`}</td><td>${formatDate(u.createdAt)}</td><td>${formatDate(u.lastLoginAt)}</td>
      <td class="actions">${u.id === p.me.id
        ? ''
        : html`<form method="post" action="/admin/users/${u.id}/status" class="inline-form">${csrfField(p.csrf)}<input type="hidden" name="status" value="${u.status === 'active' ? 'disabled' : 'active'}"><button class="btn btn-ghost btn-sm" type="submit">${u.status === 'active' ? 'Disable' : 'Re-enable'}</button></form>
        <form method="post" action="/admin/users/${u.id}/role" class="inline-form">${csrfField(p.csrf)}<input type="hidden" name="role" value="${u.role === 'admin' ? 'user' : 'admin'}"><button class="btn btn-ghost btn-sm" type="submit">${u.role === 'admin' ? 'Make user' : 'Make admin'}</button></form>`}</td></tr>`)}
    </tbody></table></div>
  </section>`;
}
