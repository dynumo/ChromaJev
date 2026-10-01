import { describe, expect, it } from 'vitest';
import { parseJevAnswers } from '../src/jev/answers.js';
import { buildScheme, MODE_TOKENS } from '../src/palette/index.js';
import { interpret } from '../src/palette/interpret.js';
import { rankSelections } from '../src/palette/select.js';
import { contrastRatio, deltaE, hexToOklch, hueDistance } from '../src/colour/oklch.js';
import { toCss, toJson, toTailwind } from '../src/palette/exports.js';
import { fakeAnswers } from './helpers/fakeJev.js';

const answers = (concept: string) => parseJevAnswers(fakeAnswers(concept));
const CONCEPTS = ['autumn forest', 'cyberpunk Belfast', 'brutalist architecture', 'calm healthcare', 'warm bakery', 'browser', 'retro computer', 'trustworthy fintech'];

describe('palette construction', () => {
  it('is deterministic for fixed Jev answers', () => {
    const a = buildScheme('autumn forest', answers('autumn forest'));
    const b = buildScheme('autumn forest', answers('autumn forest'));
    expect(a).toEqual(b);
  });

  it('produces every token as hex in both modes', () => {
    const s = buildScheme('browser', answers('browser'));
    for (const mode of ['light', 'dark'] as const) {
      for (const t of MODE_TOKENS) expect(s[mode][t]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('assigns roles from the strongest candidates', () => {
    const a = answers('autumn forest');
    const interp = interpret(a);
    const s = buildScheme('autumn forest', a);
    const top5 = interp.candidates.slice(0, 5).map((c) => c.colour.id);
    expect(top5).toContain(s.semantic.primary.id);
    expect(['green', 'brown', 'orange', 'red']).toContain(s.semantic.primary.family);
  });

  it('keeps primary, secondary and accent distinguishable', () => {
    for (const c of CONCEPTS) {
      const s = buildScheme(c, answers(c));
      if (s.semantic.monochrome) continue;
      for (const mode of ['light', 'dark'] as const) {
        const t = s[mode];
        expect(deltaE(hexToOklch(t.primary), hexToOklch(t.secondary)), `${c} ${mode} primary/secondary`).toBeGreaterThan(0.05);
        expect(deltaE(hexToOklch(t.primary), hexToOklch(t.accent)), `${c} ${mode} primary/accent`).toBeGreaterThan(0.05);
      }
    }
  });

  it('builds a genuine light mode', () => {
    const s = buildScheme('calm healthcare', answers('calm healthcare'));
    expect(hexToOklch(s.light.background).l).toBeGreaterThan(0.9);
    expect(hexToOklch(s.light.text).l).toBeLessThan(0.35);
  });

  it('builds a genuine dark mode with a surface hierarchy (not an inversion)', () => {
    const s = buildScheme('calm healthcare', answers('calm healthcare'));
    const bg = hexToOklch(s.dark.background).l;
    const surface = hexToOklch(s.dark.surface).l;
    const elevated = hexToOklch(s.dark.surfaceElevated).l;
    expect(bg).toBeLessThan(0.25);
    expect(bg).toBeGreaterThan(0.08); // not pure black
    expect(surface).toBeGreaterThan(bg);
    expect(elevated).toBeGreaterThan(surface);
    expect(hexToOklch(s.dark.text).l).toBeGreaterThan(0.85);
    // not a mechanical inversion of light mode
    expect(s.dark.background).not.toBe(s.light.text);
  });

  it('keeps semantic identity consistent across modes', () => {
    for (const c of CONCEPTS) {
      const s = buildScheme(c, answers(c));
      for (const role of ['primary', 'accent'] as const) {
        const l = hexToOklch(s.light[role]);
        const d = hexToOklch(s.dark[role]);
        if (l.c > 0.04 && d.c > 0.04) expect(hueDistance(l.h, d.h), `${c} ${role}`).toBeLessThan(30);
      }
      for (const status of ['success', 'warning', 'error', 'info'] as const) {
        expect(hueDistance(hexToOklch(s.light[status]).h, hexToOklch(s.dark[status]).h), `${c} ${status}`).toBeLessThan(15);
      }
    }
  });

  it('keeps status colours recognisable', () => {
    const s = buildScheme('autumn forest', answers('autumn forest'));
    expect(hueDistance(hexToOklch(s.light.error).h, 27)).toBeLessThan(20);
    expect(hueDistance(hexToOklch(s.light.success).h, 150)).toBeLessThan(20);
    expect(hueDistance(hexToOklch(s.light.info).h, 245)).toBeLessThan(20);
  });

  it('passes every contrast check in both modes, and reports real ratios', () => {
    for (const c of CONCEPTS) {
      const s = buildScheme(c, answers(c));
      for (const mode of ['light', 'dark'] as const) {
        const report = s.accessibility[mode];
        expect(report.checks.length).toBeGreaterThan(25);
        for (const check of report.checks) {
          const real = contrastRatio(check.foregroundHex, check.backgroundHex);
          expect(check.passes).toBe(real >= check.required);
          expect(check.passes, `${c} ${mode} ${check.id} ${check.ratio}`).toBe(true);
        }
        expect(report.allPass).toBe(true);
      }
    }
  });

  it('never labels a failing pair as passing', async () => {
    const { buildAccessibilityReport } = await import('../src/palette/accessibility.js');
    const s = buildScheme('browser', answers('browser'));
    const broken = { ...s.light, text: s.light.background };
    const report = buildAccessibilityReport(broken);
    const textBg = report.checks.find((c) => c.id === 'text-background')!;
    expect(textBg.passes).toBe(false);
    expect(textBg.level).toBe('fail');
    expect(report.allPass).toBe(false);
  });

  it('records accessibility adjustments with original and final values', () => {
    // Pale colours (e.g. Peach, Mint) cannot carry text unadjusted.
    for (const c of CONCEPTS) {
      const s = buildScheme(c, answers(c));
      for (const mode of ['light', 'dark'] as const) {
        for (const d of Object.values(s.details[mode])) {
          expect(d!.final).toMatch(/^#/);
          expect(d!.adjusted).toBe(d!.original !== d!.final);
        }
      }
    }
  });

  it('offers diversified alternatives from one judgement', () => {
    const a = answers('cyberpunk Belfast');
    const ranked = rankSelections(interpret(a));
    expect(ranked.length).toBeGreaterThan(2);
    const v0 = buildScheme('cyberpunk Belfast', a, { variation: 0 });
    const v1 = buildScheme('cyberpunk Belfast', a, { variation: 1 });
    const roles = (s: typeof v0) => [s.semantic.primary.id, s.semantic.secondary.id, s.semantic.accent.id];
    const same = roles(v0).filter((id, i) => roles(v1)[i] === id).length;
    expect(same).toBeLessThanOrEqual(1);
    expect(v1.light).toBeDefined();
    expect(v1.dark).toBeDefined();
  });

  it('honours locked colours', () => {
    const s = buildScheme('warm bakery', answers('warm bakery'), { locks: { primary: 'blue-cobalt' }, variation: 1 });
    expect(s.semantic.primary.id).toBe('blue-cobalt');
    expect(() => buildScheme('warm bakery', answers('warm bakery'), { locks: { primary: 'nope' } })).toThrow();
  });
});

describe('exports', () => {
  const s = buildScheme('browser', answers('browser'));
  const ex = { name: 'Browser', concept: 'browser', light: s.light, dark: s.dark };

  it('CSS has both modes', () => {
    const css = toCss(ex);
    expect(css).toContain(':root');
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain(`--primary-foreground: ${s.light.primaryForeground};`);
    expect(css).toContain(`--primary-foreground: ${s.dark.primaryForeground};`);
  });

  it('JSON contains the paired theme', () => {
    const json = JSON.parse(toJson(ex));
    expect(json.name).toBe('Browser');
    expect(json.light.primary).toBe(s.light.primary);
    expect(json.dark.background).toBe(s.dark.background);
  });

  it('Tailwind maps utilities to the variables', () => {
    const tw = toTailwind(ex);
    expect(tw).toContain('@theme inline');
    expect(tw).toContain('--color-primary: var(--primary);');
    expect(tw).toContain('@custom-variant dark');
  });
});
