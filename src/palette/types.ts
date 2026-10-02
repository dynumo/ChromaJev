import type { ContrastLevel } from '../colour/contrast.js';

/** Bump when palette construction changes. Saved schemes keep their values. */
export const ALGORITHM_VERSION = 'pal-2';

export const MODE_TOKENS = [
  'background',
  'surface',
  'surfaceElevated',
  'muted',
  'text',
  'textMuted',
  'border',
  'input',
  'focusRing',
  'link',
  'primary',
  'primaryForeground',
  'primaryHover',
  'primarySoft',
  'primarySoftForeground',
  'secondary',
  'secondaryForeground',
  'secondaryHover',
  'accent',
  'accentForeground',
  'accentHover',
  'success',
  'successForeground',
  'successSoft',
  'successSoftForeground',
  'warning',
  'warningForeground',
  'warningSoft',
  'warningSoftForeground',
  'error',
  'errorForeground',
  'errorSoft',
  'errorSoftForeground',
  'info',
  'infoForeground',
  'infoSoft',
  'infoSoftForeground',
] as const;

export type ModeToken = (typeof MODE_TOKENS)[number];
export type ModeTokens = Record<ModeToken, string>;
export type Mode = 'light' | 'dark';

export interface TokenDetail {
  /** Catalogue colour or semantic hue this token expresses. */
  source: string;
  /** Colour before any accessibility adjustment. */
  original: string;
  final: string;
  adjusted: boolean;
  /** Why it was adjusted, if it was. */
  reason?: string;
}

export interface ContrastCheck {
  id: string;
  label: string;
  foreground: ModeToken;
  background: ModeToken;
  foregroundHex: string;
  backgroundHex: string;
  ratio: number;
  /** Required minimum (4.5 text, 3 non-text / large text). */
  required: number;
  level: ContrastLevel;
  passes: boolean;
}

export interface AccessibilityReport {
  checks: ContrastCheck[];
  passed: number;
  failed: number;
  /** True only if every check meets its requirement. */
  allPass: boolean;
}

export interface SemanticColourRef {
  role: 'primary' | 'secondary' | 'accent';
  id: string;
  name: string;
  family: string;
  /** Catalogue hex (the colour Jev judged). */
  hex: string;
  score: number;
  fit: number;
  affinity: number;
}

export interface SemanticSummary {
  primary: SemanticColourRef;
  secondary: SemanticColourRef;
  accent: SemanticColourRef;
  neutral: { base: string; hue: number; chroma: number };
  /** What the dark-mode page background is built from, and whether Jev or a heuristic chose it. */
  darkSurface?: { kind: string; hue: number; chroma: number; source: 'jev' | 'heuristic' };
  monochrome: boolean;
}

export interface JudgementSummary {
  topColours: { id: string; name: string; hex: string; family: string; fit: number; affinity: number; score: number }[];
  dominantFamily: { key: string; p: number }[];
  accentFamily: { key: string; p: number }[];
  neutralBase: { key: string; p: number }[];
  darkSurface?: { key: string; p: number }[];
  character: { key: string; p: number }[];
  temperature: { score: number; normalised: number; label: string; probabilities: number[] };
  saturation: { score: number; normalised: number; label: string; probabilities: number[] };
  energy: { score: number; normalised: number; label: string; probabilities: number[] };
  contrast: { score: number; normalised: number; label: string; probabilities: number[] };
  lightness: { score: number; normalised: number; label: string; probabilities: number[] };
  monochrome: number;
}

export interface ColourScheme {
  concept: string;
  algorithmVersion: string;
  variation: number;
  alternativesAvailable: number;
  recommendedMode: Mode;
  semantic: SemanticSummary;
  light: ModeTokens;
  dark: ModeTokens;
  details: Record<Mode, Partial<Record<ModeToken, TokenDetail>>>;
  accessibility: Record<Mode, AccessibilityReport>;
  judgement: JudgementSummary;
}
