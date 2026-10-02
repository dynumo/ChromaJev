/* ChromaJev browser bundle: progressive behaviour for the server-rendered pages. */
import { MODE_TOKENS, TOKEN_GROUPS, scopedThemeCss, swatchInk, tokenLabel, type ModeToken, type ModeTokens } from '../shared/tokens.js';
import { exportScheme, type ExportFormat } from '../palette/exports.js';

type Mode = 'light' | 'dark';

interface Check {
  id: string;
  label: string;
  foregroundHex: string;
  backgroundHex: string;
  ratio: number;
  required: number;
  level: string;
  passes: boolean;
}
interface Report {
  checks: Check[];
  passed: number;
  failed: number;
  allPass: boolean;
}
interface SemanticRef {
  role: string;
  id: string;
  name: string;
  family: string;
  hex: string;
  fit: number;
  affinity: number;
}
interface Detail {
  source: string;
  original: string;
  final: string;
  adjusted: boolean;
  reason?: string;
}
interface Dist {
  key: string;
  p: number;
}
interface ScoreSummary {
  score: number;
  normalised: number;
  label: string;
  probabilities: number[];
}
interface Judgement {
  topColours: { id: string; name: string; hex: string; family: string; fit: number; affinity: number; score: number }[];
  dominantFamily: Dist[];
  accentFamily: Dist[];
  neutralBase: Dist[];
  darkSurface?: Dist[];
  character: Dist[];
  temperature: ScoreSummary;
  saturation: ScoreSummary;
  energy: ScoreSummary;
  contrast: ScoreSummary;
  lightness: ScoreSummary;
  monochrome: number;
}
interface SchemeData {
  kind: 'generated' | 'saved';
  name?: string;
  slug?: string;
  concept: string;
  light: ModeTokens;
  dark: ModeTokens;
  details?: Record<Mode, Partial<Record<ModeToken, Detail>>>;
  adjustments?: Record<Mode, Partial<Record<ModeToken, Detail>>>;
  accessibility: Record<Mode, Report>;
  semantic: { primary: SemanticRef; secondary: SemanticRef; accent: SemanticRef; neutral: { base: string }; monochrome: boolean };
  judgement: Judgement | null;
  recommendedMode: Mode;
  variation: number;
  alternativesAvailable?: number;
  generationId?: string;
  cache?: { fromCache: boolean; source: string; model: string | null; evaluatedAt: string };
  exportBase?: string | null;
}

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
const csrf = () => $<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
const pct = (p: number) => `${Math.round(p * 100)}%`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null | undefined)[]) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) node.append(c);
  return node;
}

async function copy(text: string, button?: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const old = button.textContent;
      button.textContent = 'Copied';
      button.classList.add('is-copied');
      setTimeout(() => {
        button.textContent = old;
        button.classList.remove('is-copied');
      }, 1200);
    }
  } catch {
    window.prompt('Copy this:', text);
  }
}

// ── Generic behaviours ───────────────────────────────────────────────────

function wireGeneric() {
  for (const form of $$<HTMLFormElement>('form[data-confirm]')) {
    form.addEventListener('submit', (e) => {
      if (!window.confirm(form.dataset.confirm ?? 'Are you sure?')) e.preventDefault();
    });
  }
  document.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-copy]');
    if (t) void copy(t.dataset.copy ?? '', t);
  });
}

// ── Workspace rendering ──────────────────────────────────────────────────

class Workspace {
  mode: Mode;
  data!: SchemeData;
  exportFormat: ExportFormat = 'css';
  private style: HTMLStyleElement;
  locks: Partial<Record<'primary' | 'secondary' | 'accent', string>> = {};
  onLockChange?: () => void;

  constructor(private root: HTMLElement) {
    this.mode = 'light';
    this.style = el('style');
    document.head.append(this.style);
    for (const b of $$('[data-mode-btn]', root)) b.addEventListener('click', () => this.setMode(b.dataset.modeBtn as Mode));
    root.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.matches('[data-mode-btn]') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        this.setMode(this.mode === 'light' ? 'dark' : 'light');
        $<HTMLElement>(`[data-mode-btn="${this.mode}"]`, root)?.focus();
      }
    });
    for (const tab of $$('[data-scene-tab]', root)) {
      tab.addEventListener('click', () => {
        for (const t of $$('[data-scene-tab]', root)) {
          t.classList.toggle('is-active', t === tab);
          t.setAttribute('aria-selected', String(t === tab));
        }
        for (const s of $$('[data-scene]', root)) s.hidden = s.dataset.scene !== tab.dataset.sceneTab;
      });
    }
    for (const tab of $$('[data-export-tab]', root)) {
      tab.addEventListener('click', () => {
        this.exportFormat = tab.dataset.exportTab as ExportFormat;
        for (const t of $$('[data-export-tab]', root)) t.classList.toggle('is-active', t === tab);
        this.renderExport();
      });
    }
    $('[data-export-copy]', root)?.addEventListener('click', (e) => void copy($('[data-export-output]', root)?.textContent ?? '', e.currentTarget as HTMLElement));
    $('[data-export-download]', root)?.addEventListener('click', () => this.download());
  }

  render(data: SchemeData) {
    this.data = data;
    this.style.textContent = scopedThemeCss('.pg-root', data.light, data.dark) + '\n' + scopedThemeCss('.swatch-scope', data.light, data.dark);
    this.setMode(this.mode, true);
    this.renderSemantic();
    this.renderJev();
    this.renderExport();
    const meta = $('[data-meta]', this.root);
    if (meta) {
      meta.textContent = '';
      if (data.cache) {
        meta.append(
          el('span', {
            class: `badge ${data.cache.fromCache ? 'badge-cache' : 'badge-fresh'}`,
            title: data.cache.fromCache ? 'This judgement was already cached — no Jev credit used' : 'Jev was asked about this concept just now',
            text: data.cache.fromCache ? '● From cache' : '● Fresh Jev judgement',
          }),
        );
      }
      if (data.alternativesAvailable) meta.append(el('span', { class: 'muted small', text: ` Interpretation ${data.variation + 1} of ${data.alternativesAvailable}` }));
    }
  }

  setMode(mode: Mode, force = false) {
    if (!force && mode === this.mode) return;
    this.mode = mode;
    for (const b of $$('[data-mode-btn]', this.root)) b.setAttribute('aria-checked', String(b.dataset.modeBtn === mode));
    for (const r of $$('[data-preview-root]', this.root)) r.dataset.mode = mode;
    this.renderSwatches();
    this.renderA11y();
  }

  private details(): Partial<Record<ModeToken, Detail>> {
    const d = this.data.details ?? this.data.adjustments;
    return d?.[this.mode] ?? {};
  }

  private renderSemantic() {
    const host = $('[data-semantic]', this.root);
    if (!host) return;
    host.textContent = '';
    const roles = [this.data.semantic.primary, this.data.semantic.secondary, this.data.semantic.accent];
    for (const r of roles) {
      const lockable = this.data.kind === 'generated';
      const chip = el(
        'div',
        { class: 'semantic-chip' },
        el('span', { class: 'semantic-dot', style: `background:${r.hex}` }),
        el('span', {}, el('strong', { text: r.name }), el('span', { class: 'muted small', text: ` ${r.role} · ${r.family}` })),
      );
      if (lockable) {
        const role = r.role as 'primary' | 'secondary' | 'accent';
        const locked = this.locks[role] === r.id;
        const btn = el('button', {
          type: 'button',
          class: `lock-btn${locked ? ' is-locked' : ''}`,
          'aria-pressed': String(locked),
          title: locked ? `Unlock ${role}` : `Keep ${r.name} as ${role} when exploring alternatives`,
          text: locked ? '🔒' : '🔓',
        });
        btn.addEventListener('click', () => {
          if (this.locks[role] === r.id) delete this.locks[role];
          else this.locks[role] = r.id;
          this.renderSemantic();
          this.onLockChange?.();
        });
        chip.append(btn);
      }
      host.append(chip);
    }
    if (this.data.semantic.monochrome) host.append(el('span', { class: 'badge', text: 'Intentionally monochromatic' }));
  }

  private renderSwatches() {
    const host = $('[data-swatches]', this.root);
    if (!host || !this.data) return;
    host.textContent = '';
    host.className = 'swatch-groups swatch-scope';
    host.dataset.mode = this.mode;
    const tokens = this.data[this.mode];
    const details = this.details();
    const semanticNames: Partial<Record<ModeToken, string>> = {
      primary: this.data.semantic.primary.name,
      secondary: this.data.semantic.secondary.name,
      accent: this.data.semantic.accent.name,
    };
    for (const group of TOKEN_GROUPS) {
      const grid = el('div', { class: `swatch-grid ${group.title === 'Status' ? 'swatch-grid-small' : ''}` });
      for (const t of group.tokens) {
        const hex = tokens[t];
        const d = details[t];
        const big = ['primary', 'secondary', 'accent', 'background', 'surface', 'text'].includes(t);
        const btn = el('button', { type: 'button', class: 'copy-hex', 'data-copy': hex, 'aria-label': `Copy ${tokenLabel(t)} ${hex}`, text: hex });
        const card = el(
          'div',
          { class: `swatch${big ? ' swatch-big' : ''}` },
          el(
            'div',
            { class: 'swatch-colour', style: `background:${hex};color:${swatchInk(t, tokens)}` },
            big ? el('span', { class: 'swatch-sample', text: 'Aa' }) : null,
            d?.adjusted ? el('span', { class: 'swatch-flag', title: `${d.reason ?? 'Adjusted for contrast'} (was ${d.original})`, text: '◐ adjusted' }) : null,
          ),
          el(
            'div',
            { class: 'swatch-meta' },
            el('span', { class: 'swatch-role', text: tokenLabel(t) }),
            semanticNames[t] ? el('span', { class: 'swatch-name', text: semanticNames[t]! }) : null,
            btn,
          ),
        );
        grid.append(card);
      }
      host.append(el('section', { class: 'swatch-group' }, el('h3', { class: 'swatch-group-title', text: group.title }), grid));
    }
  }

  private renderA11y() {
    const host = $('[data-a11y]', this.root);
    const summary = $('[data-a11y-summary]', this.root);
    if (!host || !this.data) return;
    const report = this.data.accessibility[this.mode];
    if (summary) {
      summary.textContent = report.allPass ? `✓ ${report.passed}/${report.checks.length} pass (${this.mode})` : `${report.failed} of ${report.checks.length} fail (${this.mode})`;
      summary.className = `badge ${report.allPass ? 'badge-ok' : 'badge-warn'}`;
    }
    host.textContent = '';
    const adjusted = Object.entries(this.details()).filter(([, d]) => d?.adjusted);
    if (adjusted.length) {
      host.append(
        el('p', { class: 'small muted', text: `${adjusted.length} semantic colour(s) were adjusted in ${this.mode} mode to meet contrast requirements, keeping their hue:` }),
        el(
          'ul',
          { class: 'adjust-list' },
          ...adjusted.map(([t, d]) =>
            el(
              'li',
              {},
              el('span', { class: 'mini', style: `background:${d!.original}` }),
              ' → ',
              el('span', { class: 'mini', style: `background:${d!.final}` }),
              ` ${tokenLabel(t as ModeToken)}: ${d!.original} → ${d!.final}${d!.reason ? ` (${d!.reason})` : ''}`,
            ),
          ),
        ),
      );
    }
    const table = el('table', { class: 'table a11y-table' });
    table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Pairing' }), el('th', { text: 'Sample' }), el('th', { text: 'Ratio' }), el('th', { text: 'Needs' }), el('th', { text: 'Result' }))));
    const tbody = el('tbody');
    for (const c of report.checks) {
      tbody.append(
        el(
          'tr',
          {},
          el('td', { text: c.label }),
          el('td', {}, el('span', { class: 'contrast-sample', style: `background:${c.backgroundHex};color:${c.foregroundHex};border-color:${c.foregroundHex}`, text: 'Aa' })),
          el('td', { text: `${c.ratio.toFixed(2)}:1` }),
          el('td', { text: `${c.required}:1` }),
          el('td', {}, el('span', { class: `badge ${c.passes ? 'badge-ok' : 'badge-warn'}`, text: c.passes ? `Pass ${c.level}` : 'Fail' })),
        ),
      );
    }
    table.append(tbody);
    host.append(el('div', { class: 'table-wrap' }, table));
  }

  private renderJev() {
    const host = $('[data-jev]', this.root);
    if (!host) return;
    host.textContent = '';
    const j = this.data.judgement;
    if (!j) {
      host.append(el('p', { class: 'muted', text: 'No judgement data stored for this scheme.' }));
      return;
    }
    if (this.data.cache) {
      host.append(
        el('p', {
          class: 'small muted',
          text: `${this.data.cache.fromCache ? 'Served from the semantic cache' : 'Fresh Jev request'} · model ${this.data.cache.model ?? 'unknown'} · judged ${new Date(this.data.cache.evaluatedAt).toLocaleString('en-GB')}`,
        }),
      );
    }
    const top = el('table', { class: 'table jev-table' });
    top.append(el('thead', {}, el('tr', {}, el('th', { text: 'Colour' }), el('th', { text: 'Belongs? (noul)' }), el('th', { text: 'Choice share' }), el('th', { text: 'Combined' }))));
    const body = el('tbody');
    const maxScore = Math.max(...j.topColours.map((c) => c.score), 0.0001);
    for (const c of j.topColours) {
      body.append(
        el(
          'tr',
          {},
          el('td', {}, el('span', { class: 'mini', style: `background:${c.hex}` }), ` ${c.name}`, el('span', { class: 'muted small', text: ` ${c.family}` })),
          el('td', {}, bar(c.fit), ` ${pct(c.fit)}`),
          el('td', { text: pct(c.affinity) }),
          el('td', {}, bar(c.score / maxScore)),
        ),
      );
    }
    top.append(body);
    host.append(el('h3', { class: 'jev-h', text: 'Leading colour candidates' }), el('div', { class: 'table-wrap' }, top));

    const dist = (title: string, d: Dist[]) =>
      el('div', { class: 'jev-dist' }, el('h3', { class: 'jev-h', text: title }), ...d.map((x) => el('div', { class: 'dist-row' }, el('span', { text: x.key }), bar(x.p), el('span', { class: 'small', text: pct(x.p) }))));
    const score = (title: string, s: ScoreSummary, ends: [string, string]) =>
      el(
        'div',
        { class: 'jev-score' },
        el('h3', { class: 'jev-h', text: title }),
        el('div', { class: 'scale' }, el('span', { class: 'scale-marker', style: `left:${s.normalised * 100}%` })),
        el('div', { class: 'scale-ends small muted' }, el('span', { text: ends[0] }), el('span', { text: ends[1] })),
        el('p', { class: 'small', text: `${s.label} (${s.score.toFixed(2)} on 0–4)` }),
      );
    host.append(
      el(
        'div',
        { class: 'jev-grid' },
        dist('Dominant family', j.dominantFamily),
        dist('Accent family', j.accentFamily),
        dist('Neutral base', j.neutralBase),
        ...(j.darkSurface ? [dist('Dark background', j.darkSurface)] : []),
        dist('Character', j.character),
      ),
      el(
        'div',
        { class: 'jev-grid' },
        score('Temperature', j.temperature, ['cool', 'warm']),
        score('Saturation', j.saturation, ['greyed', 'vivid']),
        score('Energy', j.energy, ['restrained', 'energetic']),
        score('Contrast', j.contrast, ['soft', 'stark']),
        score('Lightness', j.lightness, ['dark', 'light']),
      ),
      el('p', { class: 'small', text: `Monochrome suitability (noul): ${pct(j.monochrome)}` }),
    );
  }

  private exportable() {
    return {
      name: this.data.name ?? this.data.concept,
      slug: this.data.slug,
      concept: this.data.concept,
      light: this.data.light,
      dark: this.data.dark,
    };
  }

  renderExport() {
    const out = $('[data-export-output]', this.root);
    if (out && this.data) out.textContent = exportScheme(this.exportable(), this.exportFormat).body;
  }

  private download() {
    const e = exportScheme(this.exportable(), this.exportFormat);
    const base = (this.data.slug ?? this.data.concept).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scheme';
    const blob = new Blob([e.body], { type: e.contentType });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${base}.${e.extension}` });
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }
}

function bar(p: number): HTMLElement {
  return el('span', { class: 'bar' }, el('span', { style: `width:${Math.max(0, Math.min(1, p)) * 100}%` }));
}

// ── Generator page ───────────────────────────────────────────────────────

function wireGenerator() {
  const form = $<HTMLFormElement>('[data-generate-form]');
  if (!form) return;
  const input = $<HTMLInputElement>('#concept', form)!;
  const status = $('[data-status]')!;
  const result = $('[data-result]')!;
  const title = $('[data-result-title]')!;
  const wsRoot = $('[data-workspace]', result)!;
  const ws = new Workspace(wsRoot);
  const saveForm = $<HTMLFormElement>('[data-save-form]')!;
  let current: SchemeData | null = null;
  let busy = false;

  async function generate(concept: string, variation = 0) {
    if (busy) return;
    busy = true;
    status.textContent = variation ? 'Building another interpretation from the cached judgement…' : 'Asking Jev and building your palettes…';
    status.className = 'status-line is-busy';
    try {
      const res = await fetch('/api/schemes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf(), Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ concept, variation, locks: ws.locks }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
      current = { ...json, kind: 'generated' } as SchemeData;
      title.textContent = current.concept;
      if (!variation) ws.mode = current.recommendedMode;
      ws.render(current);
      result.hidden = false;
      status.textContent = '';
      status.className = 'status-line';
      const url = new URL(location.href);
      url.searchParams.set('concept', concept);
      history.replaceState(null, '', url);
      if (!variation) result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      status.textContent = (err as Error).message;
      status.className = 'status-line is-error';
    } finally {
      busy = false;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    ws.locks = {};
    void generate(input.value.trim());
  });
  for (const b of $$('[data-example]')) {
    b.addEventListener('click', () => {
      input.value = b.dataset.example ?? '';
      ws.locks = {};
      void generate(input.value);
    });
  }
  $('[data-another]')?.addEventListener('click', () => {
    if (current) void generate(current.concept, (current.variation + 1) % Math.max(current.alternativesAvailable ?? 1, 1));
  });
  ws.onLockChange = () => undefined;

  $('[data-open-save]')?.addEventListener('click', () => {
    saveForm.hidden = false;
    const name = $<HTMLInputElement>('input[name="name"]', saveForm)!;
    if (!name.value && current) name.value = current.concept.replace(/\b\w/g, (m) => m.toUpperCase());
    name.focus();
    name.select();
  });
  $('[data-cancel-save]')?.addEventListener('click', () => (saveForm.hidden = true));
  saveForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!current?.generationId) return;
    const fd = new FormData(saveForm);
    const btn = $<HTMLButtonElement>('button[type="submit"]', saveForm)!;
    btn.disabled = true;
    try {
      const res = await fetch('/api/schemes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf(), Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: fd.get('name'), notes: fd.get('notes'), generationId: current.generationId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not save.');
      location.href = `/schemes/${encodeURIComponent(json.slug)}`;
    } catch (err) {
      status.textContent = (err as Error).message;
      status.className = 'status-line is-error';
      btn.disabled = false;
    }
  });

  if (input.value.trim()) void generate(input.value.trim());
}

// ── Saved scheme page ────────────────────────────────────────────────────

function wireSchemePage() {
  const dataEl = document.getElementById('scheme-data');
  const root = $('[data-workspace]');
  if (!dataEl || !root) return;
  const data = JSON.parse(dataEl.textContent ?? '{}') as SchemeData;
  const ws = new Workspace(root);
  ws.mode = data.recommendedMode;
  ws.render(data);
}

document.addEventListener('DOMContentLoaded', () => {
  wireGeneric();
  wireGenerator();
  wireSchemePage();
});

// Keep tree-shaking honest about the shared token list.
void MODE_TOKENS;
