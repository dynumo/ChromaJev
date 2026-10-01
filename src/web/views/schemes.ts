import type { SavedScheme, SchemeSummary } from '../../schemes/service.js';
import { html, jsonForScript, type SafeHtml } from '../../util/html.js';
import { EXAMPLES } from './auth.js';
import { csrfField, formatDate } from './layout.js';
import { playground } from './playground.js';

/** Shared result workspace; populated by the browser bundle from JSON. */
function workspace(kind: 'generated' | 'saved', mode: 'light' | 'dark'): SafeHtml {
  return html`<section class="workspace" data-workspace data-kind="${kind}">
    <div class="ws-toolbar">
      <div class="mode-toggle" role="radiogroup" aria-label="Colour mode">
        <button type="button" role="radio" data-mode-btn="light" aria-checked="${mode === 'light'}">☀ Light</button>
        <button type="button" role="radio" data-mode-btn="dark" aria-checked="${mode === 'dark'}">☾ Dark</button>
      </div>
      <span class="ws-meta" data-meta></span>
    </div>
    <div class="semantic-strip" data-semantic></div>
    <div data-swatches class="swatch-groups"></div>
    <section class="panel">
      <h2 class="panel-title">Component playground</h2>
      <p class="muted small">Every component below is coloured only by this scheme’s tokens. Switch mode above and scenes here.</p>
      ${playground(mode)}
    </section>
    <details class="panel" data-a11y-panel>
      <summary><h2 class="panel-title">Accessibility <span data-a11y-summary class="badge"></span></h2></summary>
      <div data-a11y></div>
    </details>
    <details class="panel" data-jev-panel>
      <summary><h2 class="panel-title">Jev view <span class="muted small">— the structured judgement behind this palette</span></h2></summary>
      <div data-jev></div>
    </details>
    <section class="panel">
      <h2 class="panel-title">Export</h2>
      <div class="export-tabs" role="tablist">
        <button type="button" class="chip is-active" data-export-tab="css">CSS variables</button>
        <button type="button" class="chip" data-export-tab="json">JSON</button>
        <button type="button" class="chip" data-export-tab="tailwind">Tailwind v4</button>
        <button type="button" class="chip" data-export-tab="tailwind-v3">Tailwind v3</button>
      </div>
      <pre class="export-pre" data-export-output tabindex="0"></pre>
      <div class="row"><button type="button" class="btn btn-secondary" data-export-copy>Copy</button><button type="button" class="btn btn-ghost" data-export-download>Download</button></div>
    </section>
  </section>`;
}

export function generatorPage(p: { csrf: string; recent: string[]; initialConcept?: string; jevConfigured: boolean }): SafeHtml {
  return html`<section class="hero hero-compact">
    <h1 class="hero-title">What should it <span class="rainbow">feel</span> like?</h1>
    <p class="hero-lead">Enter a word or short phrase. ChromaJev asks Jev once, then builds paired light and dark themes you can test, save and export.</p>
    ${p.jevConfigured ? '' : html`<div class="flash flash-error" role="alert">Jev isn’t configured on this server (TYPESAFE_API_KEY is missing). Cached concepts still work; new ones will fail.</div>`}
    <form class="concept-form" data-generate-form autocomplete="off">
      <label class="sr-only" for="concept">Concept</label>
      <input id="concept" name="concept" maxlength="120" required placeholder="e.g. autumn forest" value="${p.initialConcept ?? ''}">
      <button class="btn btn-primary btn-lg" type="submit">Generate</button>
    </form>
    <div class="examples" aria-label="Example concepts">${EXAMPLES.map((e) => html`<button type="button" class="chip" data-example="${e}">${e}</button>`)}</div>
    ${p.recent.length ? html`<p class="recent muted small">Your recent concepts: ${p.recent.map((r) => html`<button type="button" class="link-button" data-example="${r}">${r}</button> `)}</p>` : ''}
    <div class="status-line" data-status role="status" aria-live="polite"></div>
  </section>
  <div data-result hidden>
    <div class="result-head">
      <div><p class="eyebrow">Colour scheme for</p><h2 class="result-title" data-result-title></h2></div>
      <div class="row">
        <button type="button" class="btn btn-ghost" data-another title="Uses the cached judgement — no extra Jev credit">↻ Another interpretation</button>
        <button type="button" class="btn btn-primary" data-open-save>Save scheme</button>
      </div>
    </div>
    <form class="save-form panel" data-save-form hidden>
      ${csrfField(p.csrf)}
      <label>Name<input name="name" maxlength="80" required placeholder="e.g. Dynumo"></label>
      <label>Notes <span class="muted">(optional)</span><textarea name="notes" rows="2" maxlength="2000"></textarea></label>
      <div class="row"><button class="btn btn-primary" type="submit">Save to library</button><button class="btn btn-ghost" type="button" data-cancel-save>Cancel</button></div>
    </form>
    ${workspace('generated', 'light')}
  </div>`;
}

export function schemePage(p: { csrf: string; scheme: SavedScheme; ownedByViewer: boolean }): SafeHtml {
  const s = p.scheme;
  const payload = {
    kind: 'saved',
    name: s.name,
    slug: s.slug,
    concept: s.concept,
    light: s.light,
    dark: s.dark,
    details: s.details,
    accessibility: s.accessibility,
    semantic: s.semantic,
    judgement: s.generation.judgement,
    recommendedMode: s.generation.recommendedMode,
    variation: s.generation.variation,
    algorithmVersion: s.algorithmVersion,
    exportBase: p.ownedByViewer ? `/schemes/${encodeURIComponent(s.slug)}/export` : null,
  };
  return html`<div class="result-head">
      <div><p class="eyebrow">Saved scheme · from “${s.concept}”</p><h1 class="result-title">${s.name}</h1>
      <p class="muted small">Created ${formatDate(s.createdAt)} · updated ${formatDate(s.updatedAt)} · algorithm ${s.algorithmVersion}</p></div>
      ${p.ownedByViewer
        ? html`<div class="row">
        <a class="btn btn-ghost" href="/?concept=${encodeURIComponent(s.concept)}">Explore alternatives</a>
        <form method="post" action="/schemes/${s.slug}/duplicate" class="inline-form">${csrfField(p.csrf)}<button class="btn btn-secondary" type="submit">Duplicate</button></form>
        <form method="post" action="/schemes/${s.slug}/delete" class="inline-form" data-confirm="Delete “${s.name}”? This cannot be undone.">${csrfField(p.csrf)}<button class="btn btn-danger" type="submit">Delete</button></form>
      </div>`
        : html`<p class="badge">Viewing as administrator</p>`}
    </div>
    ${p.ownedByViewer
      ? html`<details class="panel"><summary><h2 class="panel-title">Rename or edit notes</h2></summary>
      <form method="post" action="/schemes/${s.slug}/edit" class="stack narrow">${csrfField(p.csrf)}
        <label>Name<input name="name" maxlength="80" required value="${s.name}"></label>
        <label>Notes<textarea name="notes" rows="3" maxlength="2000">${s.notes ?? ''}</textarea></label>
        <button class="btn btn-primary" type="submit">Save changes</button></form></details>`
      : ''}
    ${s.notes ? html`<p class="notes">${s.notes}</p>` : ''}
    <script type="application/json" id="scheme-data">${jsonForScript(payload)}</script>
    ${workspace('saved', s.generation.recommendedMode)}`;
}

export function libraryPage(p: { items: SchemeSummary[]; total: number }): SafeHtml {
  if (p.items.length === 0) {
    return html`<section class="empty"><h1>Your library is empty</h1><p class="muted">Generate a scheme and press <strong>Save scheme</strong> to keep it here.</p><a class="btn btn-primary" href="/">Generate a scheme</a></section>`;
  }
  return html`<div class="result-head"><div><h1>Saved schemes</h1><p class="muted">${p.total} scheme${p.total === 1 ? '' : 's'}</p></div><a class="btn btn-primary" href="/">New scheme</a></div>
  <div class="library-grid">${p.items.map((s) => {
    const strip = (m: Record<string, string | undefined>) =>
      html`<div class="lib-mode" style="background:${m.background};color:${m.text}"><span style="background:${m.primary}"></span><span style="background:${m.secondary}"></span><span style="background:${m.accent}"></span><span style="background:${m.surface};outline:1px solid ${m.text}22"></span></div>`;
    return html`<a class="lib-card" href="/schemes/${s.slug}">
      <div class="lib-preview">${strip(s.preview.light)}${strip(s.preview.dark)}</div>
      <div class="lib-body"><h2>${s.name}</h2><p class="muted small">“${s.concept}” · ${formatDate(s.updatedAt)}</p>
      <p class="small">${s.accessibility.light && s.accessibility.dark ? html`<span class="badge badge-ok">✓ All contrast checks pass</span>` : html`<span class="badge badge-warn">Some checks fail</span>`}</p></div></a>`;
  })}</div>`;
}
