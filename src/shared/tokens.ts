/**
 * Shared between server-rendered pages and the browser bundle, so both
 * render theme variables identically.
 */
import { MODE_TOKENS, type ModeToken, type ModeTokens } from '../palette/types.js';
import { cssVarName } from '../palette/exports.js';

export { MODE_TOKENS, cssVarName };
export type { ModeToken, ModeTokens };

export const TOKEN_GROUPS: { title: string; tokens: ModeToken[] }[] = [
  { title: 'Brand', tokens: ['primary', 'primaryForeground', 'primaryHover', 'primarySoft', 'primarySoftForeground', 'secondary', 'secondaryForeground', 'secondaryHover', 'accent', 'accentForeground', 'accentHover'] },
  { title: 'Surfaces', tokens: ['background', 'surface', 'surfaceElevated', 'muted', 'border', 'input', 'focusRing'] },
  { title: 'Text', tokens: ['text', 'textMuted', 'link'] },
  {
    title: 'Status',
    tokens: ['success', 'successForeground', 'successSoft', 'successSoftForeground', 'warning', 'warningForeground', 'warningSoft', 'warningSoftForeground', 'error', 'errorForeground', 'errorSoft', 'errorSoftForeground', 'info', 'infoForeground', 'infoSoft', 'infoSoftForeground'],
  },
];

/** Human label for a token: primaryForeground → "Primary foreground". */
export function tokenLabel(t: ModeToken): string {
  const s = t.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`);
  return s[0].toUpperCase() + s.slice(1);
}

/** For each token, the token it is meant to be read against (for swatch labels). */
export function swatchInk(t: ModeToken, tokens: ModeTokens): string {
  const fg = `${t}Foreground` as ModeToken;
  if (fg in tokens) return tokens[fg];
  if (t.endsWith('Foreground')) return tokens[t.replace(/Foreground$/, '') as ModeToken] ?? tokens.background;
  if (['background', 'surface', 'surfaceElevated', 'muted', 'border', 'input'].includes(t)) return tokens.text;
  return luminanceIsLight(tokens[t]) ? '#111111' : '#ffffff';
}

function luminanceIsLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

/** Scoped CSS: `${scope}[data-mode="light"]{…}` and the dark equivalent. */
export function scopedThemeCss(scope: string, light: ModeTokens, dark: ModeTokens): string {
  const block = (mode: 'light' | 'dark', tokens: ModeTokens) =>
    `${scope}[data-mode="${mode}"]{color-scheme:${mode};${MODE_TOKENS.map((t) => `${cssVarName(t)}:${tokens[t]}`).join(';')}}`;
  return `${block('light', light)}\n${block('dark', dark)}`;
}
