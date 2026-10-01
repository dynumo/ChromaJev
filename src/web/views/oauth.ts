import type { User } from '../../accounts/service.js';
import { html } from '../../util/html.js';
import { csrfField, page } from './layout.js';

export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'schemes:read': 'View your saved colour schemes',
  'schemes:generate': 'Generate new colour schemes (may use Jev credits on new concepts)',
  'schemes:write': 'Save, rename and delete your colour schemes',
  openid: 'Confirm who you are',
  email: 'See your email address',
  offline_access: 'Stay connected without asking again',
};

export function interactionLoginPage(p: { csrf: string; uid: string; clientName: string; current: User | null; error?: string | null }): string {
  return page({
    title: 'Sign in to connect',
    csrfToken: p.csrf,
    body: html`<section class="auth-card">
      <p class="eyebrow">Connect an app</p>
      <h1>${p.clientName} wants to use ChromaJev</h1>
      <p class="muted">Sign in with your ChromaJev account. ${p.clientName} never sees your password.</p>
      ${p.error ? html`<div class="flash flash-error" role="alert">${p.error}</div>` : ''}
      ${p.current
        ? html`<form method="post" action="/interaction/${p.uid}/login" class="stack">${csrfField(p.csrf)}<input type="hidden" name="use_session" value="1">
            <button class="btn btn-primary" type="submit">Continue as ${p.current.email}</button></form>
            <p class="muted small center">or sign in as someone else:</p>`
        : ''}
      <form method="post" action="/interaction/${p.uid}/login" class="stack">${csrfField(p.csrf)}
        <label>Email address<input type="email" name="email" autocomplete="username" required></label>
        <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn ${p.current ? 'btn-secondary' : 'btn-primary'}" type="submit">Sign in</button>
      </form>
      <form method="post" action="/interaction/${p.uid}/abort" class="center">${csrfField(p.csrf)}<button class="link-button" type="submit">Cancel</button></form>
    </section>`,
  });
}

export function consentPage(p: { csrf: string; uid: string; clientName: string; clientUri?: string | null; redirectHost: string; scopes: string[]; user: User }): string {
  return page({
    title: 'Approve access',
    csrfToken: p.csrf,
    body: html`<section class="auth-card">
      <p class="eyebrow">Approve access</p>
      <h1>Allow ${p.clientName} to access your ChromaJev account?</h1>
      <p class="muted small">Signed in as <strong>${p.user.email}</strong>. After approval you’ll return to <strong>${p.redirectHost}</strong>.</p>
      <ul class="scope-list">${p.scopes.map((s) => html`<li><code>${s}</code> — ${SCOPE_DESCRIPTIONS[s] ?? s}</li>`)}</ul>
      <p class="muted small">You can disconnect it at any time from your account page.</p>
      <form method="post" action="/interaction/${p.uid}/confirm" class="row">${csrfField(p.csrf)}<button class="btn btn-primary" type="submit">Allow</button></form>
      <form method="post" action="/interaction/${p.uid}/abort" class="row">${csrfField(p.csrf)}<button class="btn btn-ghost" type="submit">Deny</button></form>
    </section>`,
  });
}

export function renderOAuthError(out: { error: string; error_description?: string }): string {
  return page({
    title: 'Authorisation problem',
    body: html`<section class="auth-card"><h1>Something went wrong</h1><p>The app’s authorisation request could not be completed.</p>
      <p><code>${out.error}</code>${out.error_description ? html` — ${out.error_description}` : ''}</p><p><a href="/">Back to ChromaJev</a></p></section>`,
  });
}
