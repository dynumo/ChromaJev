import type { ChangelogEntry } from '../../changelog/service.js';
import { html, type SafeHtml } from '../../util/html.js';

/**
 * Entries are plain text: blank lines separate paragraphs, and consecutive
 * lines starting with "- " or "* " become a bullet list. Everything is
 * escaped, so admins cannot inject markup.
 */
export function renderEntryBody(body: string): SafeHtml {
  const blocks = body.split(/\n{2,}/).map((b) => b.split('\n'));
  return html`${blocks.map((lines) =>
    lines.every((l) => /^[-*]\s+/.test(l))
      ? html`<ul>${lines.map((l) => html`<li>${l.replace(/^[-*]\s+/, '')}</li>`)}</ul>`
      : html`<p>${lines.map((l, i) => html`${i ? html`<br>` : ''}${l}`)}</p>`,
    )}`;
}

export function changelogPage(entries: ChangelogEntry[]): SafeHtml {
  return html`<article class="prose changelog">
  <h1>Changelog</h1>
  <p class="muted">What has changed in ChromaJev, newest first.</p>
  ${entries.length
    ? entries.map(
        (e) => html`<section class="changelog-entry" id="entry-${e.id}">
      <h2>${e.title}</h2>
      <p class="muted small"><time datetime="${e.publishedAt}">${new Date(e.publishedAt).toLocaleDateString('en-GB', { dateStyle: 'long', timeZone: 'UTC' })}</time></p>
      ${renderEntryBody(e.body)}
    </section>`,
      )
    : html`<p class="muted">Nothing has been posted yet.</p>`}
  </article>`;
}
