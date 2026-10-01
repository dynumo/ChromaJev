import { describe, expect, it } from 'vitest';
import { contrastRatio, gamutMap, hexToOklch, hexToRgb, isInGamut, oklchToHex, rgbToHex, hueDistance } from '../src/colour/oklch.js';
import { ensureContrast, pickForeground, contrastLevel } from '../src/colour/contrast.js';
import { CATALOGUE, HUE_FAMILIES } from '../src/colour/catalogue.js';

describe('colour conversion', () => {
  it('round-trips hex through OKLCH', () => {
    for (const c of CATALOGUE) expect(oklchToHex(hexToOklch(c.hex))).toBe(c.hex);
  });

  it('matches known OKLCH reference values', () => {
    const white = hexToOklch('#ffffff');
    expect(white.l).toBeCloseTo(1, 3);
    expect(white.c).toBeLessThan(1e-3);
    const red = hexToOklch('#ff0000');
    expect(red.l).toBeCloseTo(0.628, 2);
    expect(red.c).toBeCloseTo(0.2577, 2);
    expect(red.h).toBeCloseTo(29.23, 0);
  });

  it('parses and formats hex', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 1, g: 128 / 255, b: 0 });
    expect(rgbToHex({ r: 1, g: 0.5, b: 0 })).toBe('#ff8000');
    expect(() => hexToRgb('nope')).toThrow();
  });

  it('gamut maps by reducing chroma at constant lightness and hue', () => {
    const wild = { l: 0.7, c: 0.4, h: 150 };
    expect(isInGamut(wild)).toBe(false);
    const mapped = gamutMap(wild);
    expect(isInGamut(mapped)).toBe(true);
    expect(mapped.l).toBeCloseTo(0.7, 6);
    expect(mapped.h).toBeCloseTo(150, 6);
    expect(mapped.c).toBeLessThan(0.4);
  });

  it('measures hue distance on the circle', () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(10, 190)).toBe(180);
  });
});

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('classifies levels', () => {
    expect(contrastLevel(7.1)).toBe('AAA');
    expect(contrastLevel(4.6)).toBe('AA');
    expect(contrastLevel(3.2)).toBe('AA-large');
    expect(contrastLevel(2)).toBe('fail');
  });

  it('picks an accessible foreground', () => {
    expect(contrastRatio(pickForeground('#0047ab').hex, '#0047ab')).toBeGreaterThanOrEqual(4.5);
    const onYellow = pickForeground('#f5c518');
    expect(hexToOklch(onYellow.hex).l).toBeLessThan(0.5);
    expect(onYellow.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('adjusts lightness while preserving hue, and records what happened', () => {
    const result = ensureContrast('#f6a15b', '#ffffff', 4.5);
    expect(result.adjusted).toBe(true);
    expect(result.original).toBe('#f6a15b');
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
    expect(result.meetsTarget).toBe(true);
    expect(hueDistance(hexToOklch(result.final).h, hexToOklch('#f6a15b').h)).toBeLessThan(6);
    const untouched = ensureContrast('#1b2a4a', '#ffffff', 4.5);
    expect(untouched.adjusted).toBe(false);
    expect(untouched.final).toBe('#1b2a4a');
  });
});

describe('catalogue', () => {
  it('has stable unique IDs and covers every family', () => {
    const ids = new Set(CATALOGUE.map((c) => c.id));
    expect(ids.size).toBe(CATALOGUE.length);
    expect(CATALOGUE.length).toBeGreaterThan(60);
    expect(CATALOGUE.length).toBeLessThan(255); // Jev Choice limit
    for (const f of [...HUE_FAMILIES, 'warm-grey', 'cool-grey', 'near-black', 'near-white']) {
      expect(CATALOGUE.some((c) => c.family === f)).toBe(true);
    }
  });
});
