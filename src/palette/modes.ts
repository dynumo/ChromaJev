import type { CatalogueColour } from '../colour/catalogue.js';
import { ensureContrast, pickForeground } from '../colour/contrast.js';
import {
  contrastRatio,
  deltaE,
  gamutMap,
  hexToOklch,
  hueDistance,
  nudgeHue,
  oklchToHex,
  rotateHue,
  type Oklch,
} from '../colour/oklch.js';
import type { Interpretation, NeutralBase } from './interpret.js';
import type { Selection } from './select.js';
import type { Mode, ModeToken, ModeTokens, TokenDetail } from './types.js';

type Details = Partial<Record<ModeToken, TokenDetail>>;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const hex = (c: Oklch) => oklchToHex(gamutMap(c));

/** Status hues in OKLCH degrees, chosen to stay universally recognisable. */
const STATUS = {
  success: { hue: 150, chroma: 0.15, light: 0.56 },
  warning: { hue: 78, chroma: 0.16, light: 0.78 },
  error: { hue: 27, chroma: 0.19, light: 0.56 },
  info: { hue: 245, chroma: 0.15, light: 0.56 },
} as const;
type Status = keyof typeof STATUS;

export interface NeutralSpec {
  base: NeutralBase;
  hue: number;
  chroma: number;
}

export function neutralSpec(interp: Interpretation, primary: CatalogueColour): NeutralSpec {
  const p = interp.neutralBaseProbabilities;
  const strength = p[interp.neutralBase] ?? 0.5; // how sure Jev is about the base
  switch (interp.neutralBase) {
    case 'warm':
      return { base: 'warm', hue: 75, chroma: 0.006 + 0.01 * strength + 0.004 * interp.temperature };
    case 'cool':
      return { base: 'cool', hue: 250, chroma: 0.006 + 0.01 * strength + 0.004 * (1 - interp.temperature) };
    case 'tinted':
      return { base: 'tinted', hue: primary.oklch.h, chroma: primary.chromatic ? 0.01 + 0.012 * strength : 0.004 };
    case 'pure':
    default: {
      // Pure, but a whisper of temperature keeps greys from feeling dead.
      const warm = interp.temperature > 0.65;
      const cool = interp.temperature < 0.35;
      return { base: 'pure', hue: warm ? 75 : cool ? 250 : primary.oklch.h, chroma: warm || cool ? 0.003 : 0.0015 };
    }
  }
}

/**
 * Move `start` in `direction` until it meets `target` contrast against every
 * background. Monotonic, so it converges in a few passes.
 */
function textOn(start: Oklch, backgrounds: string[], target: number, direction: 'darker' | 'lighter') {
  let current = hex(start);
  const original = current;
  for (let pass = 0; pass < 3; pass++) {
    for (const bg of backgrounds) {
      current = ensureContrast(current, bg, target, direction).final;
    }
  }
  const worst = Math.min(...backgrounds.map((bg) => contrastRatio(current, bg)));
  return { hex: current, original, adjusted: current !== original, ratio: worst };
}

interface Fill {
  fill: string;
  foreground: string;
  hover: string;
  original: string;
  adjusted: boolean;
  reason?: string;
}

/**
 * A solid colour that carries text (buttons, badges). Keeps hue and chroma,
 * and finds the smallest lightness change for which a tinted near-white or
 * near-black label reaches 4.5:1 and the fill stands `minBg` apart from the
 * page background.
 */
function solidFill(base: Oklch, background: string, mode: Mode, minBg: number): Fill {
  const original = hex(base);
  const first = mode === 'light' ? -1 : 1; // try darker first on light pages
  for (let i = 0; i <= 70; i++) {
    for (const dir of i === 0 ? [0] : [first, -first]) {
      const l = base.l + dir * i * 0.01;
      if (l < 0.05 || l > 0.97) continue;
      const fill = hex({ l, c: base.c, h: base.h });
      const fg = pickForeground(fill, base.h);
      if (fg.ratio >= 4.5 && contrastRatio(fill, background) >= minBg) {
        const reasons: string[] = [];
        if (i > 0) {
          if (contrastRatio(original, background) < minBg) reasons.push(`separation from background below ${minBg}:1`);
          if (pickForeground(original, base.h).ratio < 4.5) reasons.push('label contrast below 4.5:1');
        }
        return {
          fill,
          foreground: fg.hex,
          hover: hoverOf(fill, fg.hex),
          original,
          adjusted: fill !== original,
          reason: fill !== original ? `Lightness adjusted: ${reasons.join(', ') || 'contrast'}` : undefined,
        };
      }
    }
  }
  // Unreachable in practice (near-black always works), but never pretend.
  const fg = pickForeground(original, base.h);
  return { fill: original, foreground: fg.hex, hover: hoverOf(original, fg.hex), original, adjusted: false };
}

/** Hover moves away from the label's lightness so label contrast only improves. */
function hoverOf(fill: string, foreground: string): string {
  const f = hexToOklch(fill);
  const fg = hexToOklch(foreground);
  const dir = fg.l > f.l ? -1 : 1;
  return hex({ l: clamp(f.l + dir * 0.05, 0.03, 0.98), c: f.c, h: f.h });
}

function brandBase(colour: CatalogueColour, mode: Mode, chromaScale: number): Oklch {
  const { l, c, h } = colour.oklch;
  if (mode === 'light') return { l, c: c * chromaScale, h };
  if (colour.chromatic) {
    // Dark mode: lift deep colours, calm their chroma slightly to avoid glare.
    return { l: clamp(l, 0.66, 0.82), c: c * chromaScale * 0.88, h };
  }
  // Neutral brand colours (charcoal, ink, stone…) become their light counterpart.
  return { l: l < 0.5 ? clamp(0.9 - l * 0.25, 0.78, 0.9) : clamp(l, 0.72, 0.9), c, h };
}

export interface ModeBuild {
  tokens: ModeTokens;
  details: Details;
}

export function buildMode(mode: Mode, selection: Selection, interp: Interpretation, neutral: NeutralSpec): ModeBuild {
  const details: Details = {};
  const t = {} as ModeTokens;
  const k = interp.contrast;
  const nh = neutral.hue;
  const nc = neutral.chroma;
  const dir = mode === 'light' ? 'darker' : 'lighter';

  // ── Neutral surface ladder ────────────────────────────────────────────
  if (mode === 'light') {
    const bgL = 0.965 + 0.02 * interp.lightness;
    t.background = hex({ l: bgL, c: nc * 0.7, h: nh });
    t.surface = hex({ l: 0.995, c: nc * 0.25, h: nh });
    t.surfaceElevated = '#ffffff';
    t.muted = hex({ l: bgL - 0.035 - 0.015 * k, c: nc * 0.9, h: nh });
    t.border = hex({ l: 0.885 - 0.06 * k, c: nc * 1.1, h: nh });
  } else {
    const bgL = 0.155 + 0.035 * interp.lightness - 0.015 * k;
    const tint = nc > 0.002 ? Math.min(0.018, Math.max(nc * 1.2, 0.006)) : nc;
    t.background = hex({ l: bgL, c: tint, h: nh });
    t.surface = hex({ l: bgL + 0.035, c: tint, h: nh });
    t.surfaceElevated = hex({ l: bgL + 0.075, c: tint, h: nh });
    t.muted = hex({ l: bgL + 0.055, c: tint, h: nh });
    t.border = hex({ l: bgL + 0.11 + 0.06 * k, c: tint, h: nh });
  }
  const surfaces = [t.background, t.surface, t.surfaceElevated, t.muted];

  const text = textOn(
    mode === 'light' ? { l: 0.24 - 0.08 * k, c: Math.min(0.03, nc * 2.5), h: nh } : { l: 0.93 + 0.04 * k, c: Math.min(0.015, nc * 1.5), h: nh },
    surfaces,
    7,
    dir,
  );
  t.text = text.hex;
  const muted = textOn(
    mode === 'light' ? { l: 0.5 - 0.04 * k, c: Math.min(0.03, nc * 2), h: nh } : { l: 0.72, c: Math.min(0.025, nc * 2), h: nh },
    surfaces,
    4.5,
    dir,
  );
  t.textMuted = muted.hex;
  if (muted.adjusted) {
    details.textMuted = { source: 'neutral', original: muted.original, final: muted.hex, adjusted: true, reason: 'Raised to 4.5:1 on every surface' };
  }
  const input = textOn(
    mode === 'light' ? { l: 0.7, c: nc * 1.3, h: nh } : { l: 0.42, c: nc * 1.3, h: nh },
    [t.surface, t.background],
    3,
    dir,
  );
  t.input = input.hex;

  // ── Brand roles ───────────────────────────────────────────────────────
  const chromaScale = 0.6 + 0.7 * interp.saturation;
  const mono = interp.monochrome >= 0.6;

  const pBase = brandBase(selection.primary.colour, mode, chromaScale);
  const primary = solidFill(pBase, t.background, mode, 3);
  t.primary = primary.fill;
  t.primaryForeground = primary.foreground;
  t.primaryHover = primary.hover;
  details.primary = detail(selection.primary.colour, primary);

  let sBase = brandBase(selection.secondary.colour, mode, chromaScale);
  let secondary = solidFill(sBase, t.background, mode, 1.3);
  if (!mono && deltaE(hexToOklch(secondary.fill), hexToOklch(primary.fill)) < 0.06) {
    // Keep roles distinguishable: shift secondary's lightness away from primary.
    const pL = hexToOklch(primary.fill).l;
    const firstOriginal = secondary.original;
    sBase = { ...sBase, l: clamp(sBase.l + (sBase.l >= pL ? 0.14 : -0.14), 0.1, 0.95) };
    secondary = solidFill(sBase, t.background, mode, 1.3);
    secondary.original = firstOriginal;
    secondary.reason = [secondary.reason, 'Lightness shifted to stay distinct from primary'].filter(Boolean).join('; ');
    secondary.adjusted = secondary.fill !== secondary.original;
  }
  t.secondary = secondary.fill;
  t.secondaryForeground = secondary.foreground;
  t.secondaryHover = secondary.hover;
  details.secondary = detail(selection.secondary.colour, secondary);

  const energyBoost = 0.85 + 0.3 * interp.energy;
  const aBaseRaw = brandBase(selection.accent.colour, mode, chromaScale);
  let aBase = { ...aBaseRaw, c: aBaseRaw.c * energyBoost };
  let accent = solidFill(aBase, t.background, mode, 1.3);
  const tooClose = (x: string) => deltaE(hexToOklch(accent.fill), hexToOklch(x)) < 0.06;
  if (!mono && (tooClose(primary.fill) || tooClose(secondary.fill))) {
    const firstOriginal = accent.original;
    aBase = { ...aBase, h: rotateHue(aBase.h, 25) };
    accent = solidFill(aBase, t.background, mode, 1.3);
    accent.original = firstOriginal;
    accent.reason = [accent.reason, 'Hue rotated to stay distinct from other roles'].filter(Boolean).join('; ');
    accent.adjusted = accent.fill !== accent.original;
  }
  t.accent = accent.fill;
  t.accentForeground = accent.foreground;
  t.accentHover = accent.hover;
  details.accent = detail(selection.accent.colour, accent);

  // Soft brand tint (selected rows, active nav, highlighted cards).
  const pHue = pBase.h;
  const pC = selection.primary.colour.chromatic ? pBase.c : 0.01;
  t.primarySoft =
    mode === 'light'
      ? hex({ l: 0.93, c: Math.min(0.05, pC * 0.35), h: pHue })
      : hex({ l: hexToOklch(t.background).l + 0.085, c: Math.min(0.06, pC * 0.4), h: pHue });
  t.primarySoftForeground = textOn(
    mode === 'light' ? { l: 0.38, c: pC * 0.9, h: pHue } : { l: 0.86, c: pC * 0.6, h: pHue },
    [t.primarySoft],
    4.5,
    dir,
  ).hex;

  // Links read as brand but must work as text on every page surface.
  const link = textOn(
    mode === 'light' ? hexToOklch(primary.fill) : { l: 0.78, c: pC * 0.9, h: pHue },
    [t.background, t.surface, t.surfaceElevated],
    4.5,
    dir,
  );
  t.link = link.hex;
  details.link = {
    source: selection.primary.colour.id,
    original: link.original,
    final: link.hex,
    adjusted: link.adjusted,
    reason: link.adjusted ? 'Adjusted to 4.5:1 as body text on every surface' : undefined,
  };

  // Focus ring: brand hue, 3:1 against every surface it can sit on.
  const ringStart: Oklch =
    mode === 'light' ? { l: 0.55, c: Math.max(0.12, pC), h: pHue } : { l: 0.75, c: Math.max(0.1, pC * 0.9), h: pHue };
  const ring = textOn(ringStart, [t.background, t.surface, t.surfaceElevated], 3, dir);
  t.focusRing = ring.hex;
  details.focusRing = { source: selection.primary.colour.id, original: ring.original, final: ring.hex, adjusted: ring.adjusted };

  // ── Status colours ────────────────────────────────────────────────────
  const satScale = 0.85 + 0.3 * interp.saturation;
  for (const s of Object.keys(STATUS) as Status[]) {
    const spec = STATUS[s];
    let h: number = nudgeHue(spec.hue, pHue, 6);
    if (selection.primary.colour.chromatic && hueDistance(h, pHue) < 12) {
      // Brand shares the status hue (e.g. a red identity): step away a little.
      h = rotateHue(h, h >= pHue ? 8 : -8);
    }
    const base: Oklch =
      mode === 'light'
        ? { l: spec.light, c: spec.chroma * satScale, h }
        : { l: clamp(spec.light + 0.14, 0.7, 0.84), c: spec.chroma * satScale * 0.85, h };
    const solid = solidFill(base, t.background, mode, 1.5);
    t[s] = solid.fill;
    t[`${s}Foreground` as ModeToken] = solid.foreground;
    const soft =
      mode === 'light'
        ? hex({ l: 0.955, c: Math.min(0.04, base.c * 0.3), h })
        : hex({ l: hexToOklch(t.background).l + 0.07, c: Math.min(0.045, base.c * 0.35), h });
    t[`${s}Soft` as ModeToken] = soft;
    t[`${s}SoftForeground` as ModeToken] = textOn(
      mode === 'light' ? { l: 0.42, c: base.c * 0.85, h } : { l: 0.84, c: base.c * 0.7, h },
      [soft, t.surface, t.background],
      4.5,
      dir,
    ).hex;
    details[s] = {
      source: `${s} hue ${Math.round(h)}°`,
      original: solid.original,
      final: solid.fill,
      adjusted: solid.adjusted,
      reason: solid.reason,
    };
  }

  return { tokens: t, details };
}

function detail(colour: CatalogueColour, fill: Fill): TokenDetail {
  return {
    source: colour.id,
    original: fill.original,
    final: fill.fill,
    adjusted: fill.adjusted,
    ...(fill.reason ? { reason: fill.reason } : {}),
  };
}
