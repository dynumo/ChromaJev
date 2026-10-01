import { contrastRatio, gamutMap, hexToOklch, oklchToHex, round, type Oklch } from './oklch.js';

/** WCAG 2.x thresholds. */
export const AA_TEXT = 4.5;
export const AA_LARGE = 3;
export const AA_NON_TEXT = 3;
export const AAA_TEXT = 7;

export type ContrastLevel = 'AAA' | 'AA' | 'AA-large' | 'fail';

export function contrastLevel(ratio: number): ContrastLevel {
  if (ratio >= AAA_TEXT) return 'AAA';
  if (ratio >= AA_TEXT) return 'AA';
  if (ratio >= AA_LARGE) return 'AA-large';
  return 'fail';
}

export interface ContrastAdjustment {
  original: string;
  final: string;
  adjusted: boolean;
  ratio: number;
  target: number;
  /** False only if no lightness at this hue reaches the target (never silently hidden). */
  meetsTarget: boolean;
}

/**
 * Ensure `colour` reaches `target` contrast against `against`, preserving hue
 * (and as much chroma as the gamut allows) by moving only lightness.
 *
 * `direction` picks which way to move; by default we move away from the
 * background's lightness (darker on light backgrounds, lighter on dark).
 */
export function ensureContrast(
  colour: Oklch | string,
  against: string,
  target: number,
  direction?: 'darker' | 'lighter',
): ContrastAdjustment {
  const start = typeof colour === 'string' ? hexToOklch(colour) : colour;
  const originalHex = oklchToHex(start);
  const startRatio = contrastRatio(originalHex, against);
  if (startRatio >= target) {
    return { original: originalHex, final: originalHex, adjusted: false, ratio: round(startRatio, 2), target, meetsTarget: true };
  }
  const bgL = hexToOklch(against).l;
  const dir = direction ?? (bgL > 0.6 ? 'darker' : 'lighter');
  const sign = dir === 'darker' ? -1 : 1;

  let best: { hex: string; ratio: number } = { hex: originalHex, ratio: startRatio };
  // Step lightness in small increments; keep the first value that passes so
  // the colour stays as close as possible to its semantic original.
  for (let step = 1; step <= 120; step++) {
    const l = start.l + sign * step * 0.0075;
    if (l < 0 || l > 1) break;
    const candidate = gamutMap({ l, c: start.c, h: start.h });
    const hex = oklchToHex(candidate);
    const ratio = contrastRatio(hex, against);
    if (ratio > best.ratio) best = { hex, ratio };
    if (ratio >= target) {
      return { original: originalHex, final: hex, adjusted: true, ratio: round(ratio, 2), target, meetsTarget: true };
    }
  }
  // Fall back to the extreme in that direction.
  const extreme = sign < 0 ? '#000000' : '#ffffff';
  const er = contrastRatio(extreme, against);
  if (er > best.ratio) best = { hex: extreme, ratio: er };
  return {
    original: originalHex,
    final: best.hex,
    adjusted: best.hex !== originalHex,
    ratio: round(best.ratio, 2),
    target,
    meetsTarget: best.ratio >= target,
  };
}

/**
 * Choose the better of a tinted light and tinted dark foreground for text on
 * `background`. Tinting with the background's hue keeps foregrounds from
 * looking pasted-on while staying near white/black.
 */
export function pickForeground(background: string, hueHint?: number): { hex: string; ratio: number } {
  const bg = hexToOklch(background);
  const h = hueHint ?? bg.h;
  const light = oklchToHex({ l: 0.985, c: Math.min(0.012, bg.c * 0.15), h });
  const dark = oklchToHex({ l: 0.18, c: Math.min(0.03, bg.c * 0.25), h });
  const rl = contrastRatio(light, background);
  const rd = contrastRatio(dark, background);
  if (rl >= AA_TEXT && rl >= rd * 0.8) return { hex: light, ratio: round(rl, 2) }; // prefer white text where it passes comfortably
  if (rd >= rl) return { hex: dark, ratio: round(rd, 2) };
  return { hex: light, ratio: round(rl, 2) };
}
