import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { playground, SCENES } from '../src/web/views/playground.js';
import { scopedThemeCss, cssVarName, MODE_TOKENS } from '../src/shared/tokens.js';
import { buildScheme } from '../src/palette/index.js';
import { parseJevAnswers } from '../src/jev/answers.js';
import { fakeAnswers } from './helpers/fakeJev.js';

const css = fs.readFileSync(path.resolve('public/assets/playground.css'), 'utf8');
const markup = playground('light').value;

describe('component playground', () => {
  it('contains no hard-coded colours (only theme tokens)', () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(withoutComments).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|lab)\(/i);
    expect(withoutComments).not.toMatch(/:\s*(white|black|red|blue|green|gray|grey)\b/i);
    expect(markup).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('consumes the semantic theme tokens', () => {
    const used = new Set([...css.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]));
    for (const t of ['background', 'surface', 'surfaceElevated', 'text', 'textMuted', 'primary', 'primaryForeground', 'secondary', 'accent', 'border', 'input', 'focusRing', 'success', 'warning', 'error', 'info', 'link'] as const) {
      expect(used.has(cssVarName(t)), cssVarName(t)).toBe(true);
    }
  });

  it('switches modes with a data attribute', () => {
    expect(markup).toContain('data-mode="light"');
    expect(playground('dark').value).toContain('data-mode="dark"');
    const s = buildScheme('browser', parseJevAnswers(fakeAnswers('browser')));
    const theme = scopedThemeCss('.pg-root', s.light, s.dark);
    expect(theme).toContain(`.pg-root[data-mode="light"]{color-scheme:light;--background:${s.light.background}`);
    expect(theme).toContain(`.pg-root[data-mode="dark"]{color-scheme:dark;--background:${s.dark.background}`);
    for (const t of MODE_TOKENS) expect(theme).toContain(`${cssVarName(t)}:${s.dark[t]}`);
  });

  it('includes the required components and scenes', () => {
    for (const cls of ['pg-btn-primary', 'pg-btn-secondary', 'pg-btn-outline', 'pg-btn-ghost', 'pg-btn-destructive', 'disabled', 'is-focus', 'is-hover', 'pg-input', 'textarea', 'select', 'checkbox', 'radio', 'pg-switch', 'is-invalid', 'pg-card-elevated', 'is-selected', 'pg-nav', 'pg-tabs', 'pg-breadcrumb', 'pg-alert-success', 'pg-alert-warning', 'pg-alert-error', 'pg-alert-info', 'pg-badge', 'pg-pill', 'pg-table', 'pg-pagination', 'pg-modal', 'pg-menu', 'pg-code']) {
      expect(markup, cls).toContain(cls);
    }
    for (const [key] of SCENES) expect(markup).toContain(`data-scene="${key}"`);
  });
});
