import { getCatalogueColour } from '../colour/catalogue.js';
import { round } from '../colour/oklch.js';
import type { JevAnswers, ScoreJudgement } from '../jev/answers.js';
import { topEntries } from '../jev/answers.js';
import {
  CONTRAST_LEVELS,
  ENERGY_LEVELS,
  LIGHTNESS_LEVELS,
  SATURATION_LEVELS,
  TEMPERATURE_LEVELS,
} from '../jev/questions.js';
import { buildAccessibilityReport } from './accessibility.js';
import { interpret } from './interpret.js';
import { buildMode, neutralSpec } from './modes.js';
import { selectRoles, type RoleChoice, type RoleLocks } from './select.js';
import { ALGORITHM_VERSION, type ColourScheme, type JudgementSummary, type SemanticColourRef } from './types.js';

export * from './types.js';
export type { RoleLocks } from './select.js';

export interface BuildOptions {
  /** 0 = best interpretation; n = n-th diversified alternative (no Jev call). */
  variation?: number;
  /** Pin catalogue colours to roles while the rest is re-chosen. */
  locks?: RoleLocks;
}

export class LockError extends Error {}

/**
 * Deterministic: the same answers and options always produce the same scheme.
 * One judgement → both modes; no extra Jev request is ever needed here.
 */
export function buildScheme(concept: string, answers: JevAnswers, options: BuildOptions = {}): ColourScheme {
  const locks = options.locks ?? {};
  for (const [role, id] of Object.entries(locks)) {
    if (id && !getCatalogueColour(id)) throw new LockError(`Unknown colour "${id}" locked to ${role}`);
  }
  const interp = interpret(answers);
  const { selection, index, available } = selectRoles(interp, options.variation ?? 0, locks);
  const neutral = neutralSpec(interp, selection.primary.colour);

  const light = buildMode('light', selection, interp, neutral);
  const dark = buildMode('dark', selection, interp, neutral);

  return {
    concept,
    algorithmVersion: ALGORITHM_VERSION,
    variation: index,
    alternativesAvailable: available,
    recommendedMode: interp.lightness < 0.4 ? 'dark' : 'light',
    semantic: {
      primary: ref('primary', selection.primary),
      secondary: ref('secondary', selection.secondary),
      accent: ref('accent', selection.accent),
      neutral: { base: neutral.base, hue: round(neutral.hue, 1), chroma: round(neutral.chroma, 4) },
      monochrome: interp.monochrome >= 0.6,
    },
    light: light.tokens,
    dark: dark.tokens,
    details: { light: light.details, dark: dark.details },
    accessibility: { light: buildAccessibilityReport(light.tokens), dark: buildAccessibilityReport(dark.tokens) },
    judgement: summariseJudgement(answers, interp.candidates.slice(0, 12)),
  };
}

function ref(role: SemanticColourRef['role'], choice: RoleChoice): SemanticColourRef {
  return {
    role,
    id: choice.colour.id,
    name: choice.colour.name,
    family: choice.colour.family,
    hex: choice.colour.hex,
    score: round(choice.score, 4),
    fit: round(choice.fit, 4),
    affinity: round(choice.affinity, 4),
  };
}

function scoreSummary(s: ScoreJudgement, labels: readonly string[]) {
  return {
    score: round(s.score, 3),
    normalised: round(s.normalised, 3),
    label: labels[Math.round(s.score)] ?? '',
    probabilities: s.probabilities.map((p) => round(p, 4)),
  };
}

const rounded = (xs: { key: string; p: number }[]) => xs.map((x) => ({ key: x.key, p: round(x.p, 4) }));

/** Real Jev data for the "Jev view" — no invented explanations. */
export function summariseJudgement(
  answers: JevAnswers,
  candidates: ReturnType<typeof interpret>['candidates'],
): JudgementSummary {
  return {
    topColours: candidates.map((c) => ({
      id: c.colour.id,
      name: c.colour.name,
      hex: c.colour.hex,
      family: c.colour.family,
      fit: round(c.fit, 4),
      affinity: round(c.affinity, 4),
      score: round(c.score, 4),
    })),
    dominantFamily: rounded(topEntries(answers.dominantFamily, 5)),
    accentFamily: rounded(topEntries(answers.accentFamily, 5)),
    neutralBase: rounded(topEntries(answers.neutralBase, 4)),
    character: rounded(topEntries(answers.character, 4)),
    temperature: scoreSummary(answers.temperature, TEMPERATURE_LEVELS),
    saturation: scoreSummary(answers.saturation, SATURATION_LEVELS),
    energy: scoreSummary(answers.energy, ENERGY_LEVELS),
    contrast: scoreSummary(answers.contrast, CONTRAST_LEVELS),
    lightness: scoreSummary(answers.lightness, LIGHTNESS_LEVELS),
    monochrome: round(answers.monochrome, 4),
  };
}
