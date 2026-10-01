import { AA_NON_TEXT, AA_TEXT, contrastLevel } from '../colour/contrast.js';
import { contrastRatio } from '../colour/oklch.js';
import type { AccessibilityReport, ContrastCheck, ModeToken, ModeTokens } from './types.js';

type Pair = [id: string, label: string, fg: ModeToken, bg: ModeToken, required: number];

const STATUSES = ['success', 'warning', 'error', 'info'] as const;

export const CONTRAST_PAIRS: Pair[] = [
  ['text-background', 'Body text on background', 'text', 'background', AA_TEXT],
  ['text-surface', 'Body text on surface (cards)', 'text', 'surface', AA_TEXT],
  ['text-elevated', 'Body text on elevated surface (dialogs, menus)', 'text', 'surfaceElevated', AA_TEXT],
  ['text-muted-surface', 'Body text on muted surface (table headers)', 'text', 'muted', AA_TEXT],
  ['muted-background', 'Muted text on background', 'textMuted', 'background', AA_TEXT],
  ['muted-surface', 'Muted / helper text on surface', 'textMuted', 'surface', AA_TEXT],
  ['muted-elevated', 'Muted text on elevated surface', 'textMuted', 'surfaceElevated', AA_TEXT],
  ['link-background', 'Link on background', 'link', 'background', AA_TEXT],
  ['link-surface', 'Link on surface', 'link', 'surface', AA_TEXT],
  ['primary-button', 'Primary button label', 'primaryForeground', 'primary', AA_TEXT],
  ['primary-button-hover', 'Primary button label (hover)', 'primaryForeground', 'primaryHover', AA_TEXT],
  ['primary-boundary', 'Primary button against background (non-text)', 'primary', 'background', AA_NON_TEXT],
  ['primary-soft', 'Text on soft primary (selected rows, active nav)', 'primarySoftForeground', 'primarySoft', AA_TEXT],
  ['secondary-button', 'Secondary button label', 'secondaryForeground', 'secondary', AA_TEXT],
  ['secondary-button-hover', 'Secondary button label (hover)', 'secondaryForeground', 'secondaryHover', AA_TEXT],
  ['accent', 'Accent label', 'accentForeground', 'accent', AA_TEXT],
  ['accent-hover', 'Accent label (hover)', 'accentForeground', 'accentHover', AA_TEXT],
  ['field-text', 'Form field text', 'text', 'surface', AA_TEXT],
  ['field-border', 'Form field border against surface (non-text)', 'input', 'surface', AA_NON_TEXT],
  ['field-border-background', 'Form field border against background (non-text)', 'input', 'background', AA_NON_TEXT],
  ['focus-background', 'Focus ring against background (non-text)', 'focusRing', 'background', AA_NON_TEXT],
  ['focus-surface', 'Focus ring against surface (non-text)', 'focusRing', 'surface', AA_NON_TEXT],
  ...STATUSES.flatMap((s): Pair[] => [
    [`${s}-solid`, `${cap(s)} badge / button label`, `${s}Foreground` as ModeToken, s, AA_TEXT],
    [`${s}-alert`, `${cap(s)} alert text`, `${s}SoftForeground` as ModeToken, `${s}Soft` as ModeToken, AA_TEXT],
    [`${s}-inline`, `${cap(s)} message text on surface`, `${s}SoftForeground` as ModeToken, 'surface', AA_TEXT],
  ]),
];

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}

/** Evaluate every pair. A check passes only if its real ratio meets the requirement. */
export function buildAccessibilityReport(tokens: ModeTokens): AccessibilityReport {
  const checks: ContrastCheck[] = CONTRAST_PAIRS.map(([id, label, fg, bg, required]) => {
    // Judge the unrounded ratio so 4.496 is never reported as passing 4.5.
    const raw = contrastRatio(tokens[fg], tokens[bg]);
    const ratio = Math.floor(raw * 100) / 100;
    const passes = raw >= required;
    return {
      id,
      label,
      foreground: fg,
      background: bg,
      foregroundHex: tokens[fg],
      backgroundHex: tokens[bg],
      ratio,
      required,
      level: contrastLevel(raw),
      passes,
    };
  });
  const passed = checks.filter((c) => c.passes).length;
  return { checks, passed, failed: checks.length - passed, allPass: passed === checks.length };
}
