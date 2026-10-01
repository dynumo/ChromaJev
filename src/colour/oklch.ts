/**
 * Colour-space conversion and contrast maths. Everything perceptual happens
 * in OKLab / OKLCH (Björn Ottosson, 2020); contrast uses WCAG 2.x relative
 * luminance. Pure functions only.
 */

export interface Rgb {
  r: number; // 0..1 gamma-encoded sRGB
  g: number;
  b: number;
}

export interface Oklch {
  l: number; // 0..1
  c: number; // 0..~0.37
  h: number; // degrees 0..360
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export function rgbToOklab({ r, g, b }: Rgb): { L: number; a: number; b: number } {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Returns *linear* RGB, possibly out of gamut. */
function oklabToLinearRgb(L: number, a: number, b: number): Rgb {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

export function rgbToOklch(rgb: Rgb): Oklch {
  const { L, a, b } = rgbToOklab(rgb);
  const c = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h: c < 1e-4 ? 0 : h };
}

export function hexToOklch(hex: string): Oklch {
  return rgbToOklch(hexToRgb(hex));
}

function oklchToLinear({ l, c, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180;
  return oklabToLinearRgb(l, c * Math.cos(hr), c * Math.sin(hr));
}

const EPS = 1e-6;
function inGamutLinear({ r, g, b }: Rgb): boolean {
  return r >= -EPS && r <= 1 + EPS && g >= -EPS && g <= 1 + EPS && b >= -EPS && b <= 1 + EPS;
}

export function isInGamut(colour: Oklch): boolean {
  return inGamutLinear(oklchToLinear(colour));
}

/**
 * Map an OKLCH colour into sRGB by reducing chroma at constant lightness and
 * hue (binary search). Preserves the colour's identity better than clipping.
 */
export function gamutMap(colour: Oklch): Oklch {
  const l = clamp01(colour.l);
  const base = { l, c: Math.max(0, colour.c), h: ((colour.h % 360) + 360) % 360 };
  if (isInGamut(base)) return base;
  let lo = 0;
  let hi = base.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (isInGamut({ ...base, c: mid })) lo = mid;
    else hi = mid;
  }
  return { ...base, c: lo };
}

export function oklchToRgb(colour: Oklch): Rgb {
  const lin = oklchToLinear(gamutMap(colour));
  return { r: clamp01(toGamma(lin.r)), g: clamp01(toGamma(lin.g)), b: clamp01(toGamma(lin.b)) };
}

export function oklchToHex(colour: Oklch): string {
  return rgbToHex(oklchToRgb(colour));
}

/** WCAG 2.x relative luminance of a hex colour. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.x contrast ratio between two hex colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Signed shortest hue distance in degrees (0..180). */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Perceptual difference (Euclidean distance in OKLab). */
export function deltaE(a: Oklch, b: Oklch): number {
  const ar = (a.h * Math.PI) / 180;
  const br = (b.h * Math.PI) / 180;
  const da = a.c * Math.cos(ar) - b.c * Math.cos(br);
  const db = a.c * Math.sin(ar) - b.c * Math.sin(br);
  return Math.sqrt((a.l - b.l) ** 2 + da * da + db * db);
}

export function round(n: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Rotate a hue by a number of degrees, wrapping into 0..360. */
export function rotateHue(h: number, by: number): number {
  return (((h + by) % 360) + 360) % 360;
}

/** Move hue `from` toward `to` by at most `maxDegrees`. */
export function nudgeHue(from: number, to: number, maxDegrees: number): number {
  let diff = ((to - from + 540) % 360) - 180; // -180..180
  if (Math.abs(diff) > maxDegrees) diff = Math.sign(diff) * maxDegrees;
  return rotateHue(from, diff);
}
