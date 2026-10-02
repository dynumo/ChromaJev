import type { User } from '../../accounts/service.js';
import { html, type SafeHtml } from '../../util/html.js';

export interface PageOptions {
  title: string;
  user?: User | null;
  csrfToken?: string;
  body: SafeHtml;
  active?: 'generate' | 'schemes' | 'account' | 'admin' | 'docs' | 'changelog';
  flash?: { kind: 'success' | 'error' | 'info'; message: string } | null;
  wide?: boolean;
  includePlayground?: boolean;
}

export const LOGO = html`<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="11" cy="12" r="8" class="lm-a"/><circle cx="21" cy="12" r="8" class="lm-b"/><circle cx="16" cy="20.5" r="8" class="lm-c"/></svg>`;

export function page(o: PageOptions): string {
  const nav = o.user
    ? html`<nav class="site-nav" aria-label="Main">
        <a href="/" class="${o.active === 'generate' ? 'is-active' : ''}">Generate</a>
        <a href="/schemes" class="${o.active === 'schemes' ? 'is-active' : ''}">Library</a>
        <a href="/account" class="${o.active === 'account' ? 'is-active' : ''}">Account</a>
        ${o.user.role === 'admin' ? html`<a href="/admin" class="${o.active === 'admin' ? 'is-active' : ''}">Admin</a>` : ''}
        <form method="post" action="/logout" class="inline-form"><input type="hidden" name="_csrf" value="${o.csrfToken ?? ''}"><button class="link-button" type="submit">Sign out</button></form>
      </nav>`
    : html`<nav class="site-nav" aria-label="Main"><a href="/login">Sign in</a></nav>`;

  return `<!doctype html>${html`<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="csrf-token" content="${o.csrfToken ?? ''}">
<title>${o.title} · ChromaJev</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/app.css">
${o.includePlayground ? html`<link rel="stylesheet" href="/assets/playground.css">` : ''}
<script src="/assets/app.js" defer></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <a class="brand" href="/">${LOGO}<span>Chroma<b>Jev</b></span></a>
  ${nav}
</header>
<main id="main" class="${o.wide ? 'container wide' : 'container'}">
${o.flash ? html`<div class="flash flash-${o.flash.kind}" role="status">${o.flash.message}</div>` : ''}
${o.body}
</main>
<footer class="site-footer"><p>ChromaJev · semantic judgement by TypeSafe’s Jev, colour mathematics by code · <a href="/docs/api">API</a> · <a href="/docs/mcp">MCP</a> · <a href="/changelog">Changelog</a></p></footer>
</body></html>`}`;
}

export function csrfField(token: string): SafeHtml {
  return html`<input type="hidden" name="_csrf" value="${token}">`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
}
