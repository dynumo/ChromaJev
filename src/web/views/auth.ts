import { MIN_PASSWORD_LENGTH } from '../../accounts/passwords.js';
import type { Invitation } from '../../accounts/service.js';
import { html, type SafeHtml } from '../../util/html.js';
import { csrfField, formatDate, LOGO } from './layout.js';

export const EXAMPLES = [
  'browser',
  'Northern Ireland',
  'brutalist architecture',
  'autumn forest',
  'trustworthy fintech',
  'retro computer',
  'calm healthcare',
  'cyberpunk Belfast',
  'warm bakery',
  'accessibility',
];

function authCard(title: string, inner: SafeHtml, intro?: string): SafeHtml {
  return html`<section class="auth-card"><div class="auth-logo">${LOGO}</div><h1>${title}</h1>${intro ? html`<p class="muted">${intro}</p>` : ''}${inner}</section>`;
}

function errorBox(error?: string | null): SafeHtml {
  return error ? html`<div class="flash flash-error" role="alert">${error}</div>` : html``;
}

export function landingPage(publicSignup: boolean): SafeHtml {
  return html`<section class="hero">
    <p class="eyebrow">Concept in · colour system out</p>
    <h1 class="hero-title">Turn a word into a <span class="rainbow">coherent colour scheme</span></h1>
    <p class="hero-lead">Type “autumn forest” or “trustworthy fintech”. Jev judges which colours belong and how the identity should feel; ChromaJev’s colour maths builds matching, accessible light and dark themes and shows them on real interface components.</p>
    <div class="hero-actions"><a class="btn btn-primary" href="/login">Sign in to start</a>${publicSignup ? html`<a class="btn btn-ghost" href="/signup">Create an account</a>` : ''}</div>
    <div class="examples" aria-label="Example concepts">${EXAMPLES.map((e) => html`<span class="chip chip-static">${e}</span>`)}</div>
  </section>
  <section class="how">
    <div class="how-step"><span class="how-num">1</span><h3>Jev judges</h3><p>One request asks Jev about ~80 named colours, hue families, warmth, saturation, energy and contrast — with probabilities, not prose.</p></div>
    <div class="how-step"><span class="how-num">2</span><h3>Code builds</h3><p>OKLCH maths turns that judgement into light and dark modes, enforcing WCAG contrast on every pairing.</p></div>
    <div class="how-step"><span class="how-num">3</span><h3>You test it</h3><p>Preview buttons, forms, tables, dashboards and docs pages, then save, export or use it from the API and MCP.</p></div>
  </section>`;
}

export function loginPage(p: { csrf: string; next: string; error?: string | null; email?: string; publicSignup: boolean; notice?: string | null }): SafeHtml {
  return authCard(
    'Sign in',
    html`${p.notice ? html`<div class="flash flash-success" role="status">${p.notice}</div>` : ''}${errorBox(p.error)}
    <form method="post" action="/login" class="stack">
      ${csrfField(p.csrf)}<input type="hidden" name="next" value="${p.next}">
      <label>Email address<input type="email" name="email" autocomplete="username" required value="${p.email ?? ''}"></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form>
    <p class="auth-links"><a href="/forgot-password">Forgotten your password?</a>${p.publicSignup ? html` · <a href="/signup">Create an account</a>` : ''}</p>`,
  );
}

export function signupPage(p: { csrf: string; error?: string | null; email?: string }): SafeHtml {
  return authCard(
    'Create an account',
    html`${errorBox(p.error)}
    <form method="post" action="/signup" class="stack">
      ${csrfField(p.csrf)}
      <label>Email address<input type="email" name="email" autocomplete="email" required value="${p.email ?? ''}"></label>
      <label>Password <span class="muted">(at least ${MIN_PASSWORD_LENGTH} characters)</span><input type="password" name="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required></label>
      <button class="btn btn-primary" type="submit">Create account</button>
    </form>
    <p class="auth-links">Already registered? <a href="/login">Sign in</a></p>`,
    'We’ll email you a link to confirm your address before you can sign in.',
  );
}

export function messagePage(title: string, message: string, link?: { href: string; label: string }): SafeHtml {
  return authCard(title, html`<p>${message}</p>${link ? html`<p><a class="btn btn-primary" href="${link.href}">${link.label}</a></p>` : ''}`);
}

export function forgotPage(p: { csrf: string; sent?: boolean }): SafeHtml {
  return authCard(
    'Reset your password',
    p.sent
      ? html`<div class="flash flash-success" role="status">If an account exists for that address, we’ve emailed a reset link. It expires in an hour.</div><p><a href="/login">Back to sign in</a></p>`
      : html`<form method="post" action="/forgot-password" class="stack">${csrfField(p.csrf)}
          <label>Email address<input type="email" name="email" autocomplete="email" required></label>
          <button class="btn btn-primary" type="submit">Email me a reset link</button></form>`,
  );
}

export function resetPage(p: { csrf: string; token: string; error?: string | null }): SafeHtml {
  return authCard(
    'Choose a new password',
    html`${errorBox(p.error)}<form method="post" action="/reset-password" class="stack">${csrfField(p.csrf)}
      <input type="hidden" name="token" value="${p.token}">
      <label>New password <span class="muted">(at least ${MIN_PASSWORD_LENGTH} characters)</span><input type="password" name="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required></label>
      <button class="btn btn-primary" type="submit">Set password</button></form>`,
  );
}

export function invitePage(p: { csrf: string; token: string; invitation: Invitation; error?: string | null }): SafeHtml {
  return authCard(
    'Join ChromaJev',
    html`${errorBox(p.error)}
    <p>You’ve been invited${p.invitation.invitedByEmail ? html` by <strong>${p.invitation.invitedByEmail}</strong>` : ''} to create an account for <strong>${p.invitation.email}</strong>. This invitation expires ${formatDate(p.invitation.expiresAt)} UTC.</p>
    <form method="post" action="/invite" class="stack">${csrfField(p.csrf)}
      <input type="hidden" name="token" value="${p.token}">
      <label>Your name <span class="muted">(optional)</span><input type="text" name="display_name" autocomplete="name" maxlength="80"></label>
      <label>Choose a password <span class="muted">(at least ${MIN_PASSWORD_LENGTH} characters)</span><input type="password" name="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required></label>
      <button class="btn btn-primary" type="submit">Create my account</button>
    </form>`,
  );
}
