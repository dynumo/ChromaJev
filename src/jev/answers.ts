import { z } from 'zod';
import { CATALOGUE } from '../colour/catalogue.js';
import {
  ACCENT_FAMILY_OPTIONS,
  CHARACTER_OPTIONS,
  DARK_SURFACE_OPTIONS,
  FAMILY_OPTIONS,
  NEUTRAL_BASE_OPTIONS,
  fitKey,
} from './questions.js';

/** Normalised, validated view of Jev's answers used by palette construction. */
export interface ScoreJudgement {
  /** Probability-weighted level (0..levels-1). */
  score: number;
  /** Same, normalised to 0..1. */
  normalised: number;
  probabilities: number[];
  confidence: number | null;
}

export interface JevAnswers {
  colourAffinity: Record<string, number>;
  colourAffinityConfidence: number | null;
  fit: Record<string, number>;
  dominantFamily: Record<string, number>;
  accentFamily: Record<string, number>;
  neutralBase: Record<string, number>;
  /** Absent in evaluations cached before the question existed (or if malformed). */
  darkSurface: Record<string, number> | null;
  character: Record<string, number>;
  temperature: ScoreJudgement;
  saturation: ScoreJudgement;
  energy: ScoreJudgement;
  contrast: ScoreJudgement;
  lightness: ScoreJudgement;
  monochrome: number;
}

const prob = z.number().finite().min(0).max(1.0001);
const choiceSchema = z.object({
  type: z.literal('choice'),
  choice: z.string().optional(),
  probabilities: z.record(z.string(), prob),
  confidence: z.number().finite().optional(),
});
const scoreSchema = z.object({
  type: z.literal('score'),
  score: z.number().finite(),
  probabilities: z.record(z.string(), prob),
  confidence: z.number().finite().optional(),
});
const noulSchema = z.object({ type: z.literal('noul'), noul: prob });

function choice(raw: Record<string, unknown>, key: string, options: string[]) {
  const parsed = choiceSchema.safeParse(raw[key]);
  if (!parsed.success) throw new Error(`answer "${key}" is not a valid choice`);
  const out: Record<string, number> = {};
  let total = 0;
  for (const o of options) {
    const p = parsed.data.probabilities[o];
    if (p === undefined) throw new Error(`answer "${key}" is missing option "${o}"`);
    out[o] = p;
    total += p;
  }
  if (total <= 0) throw new Error(`answer "${key}" has an empty distribution`);
  for (const o of options) out[o] = out[o] / total;
  return { probs: out, confidence: parsed.data.confidence ?? null };
}

/**
 * For answers added after the cache was populated: missing or malformed means
 * "not answered" (the palette builder then falls back to a heuristic) rather
 * than failing the whole evaluation.
 */
function optionalChoice(raw: Record<string, unknown>, key: string, options: string[]): Record<string, number> | null {
  if (raw[key] === undefined) return null;
  try {
    return choice(raw, key, options).probs;
  } catch {
    return null;
  }
}

function score(raw: Record<string, unknown>, key: string, levels: number): ScoreJudgement {
  const parsed = scoreSchema.safeParse(raw[key]);
  if (!parsed.success) throw new Error(`answer "${key}" is not a valid score`);
  const probabilities = Array.from({ length: levels }, (_, i) => parsed.data.probabilities[String(i)] ?? 0);
  const total = probabilities.reduce((a, b) => a + b, 0);
  const norm = total > 0 ? probabilities.map((p) => p / total) : probabilities;
  // Recompute the expectation from the distribution so the two always agree.
  const s = total > 0 ? norm.reduce((acc, p, i) => acc + p * i, 0) : parsed.data.score;
  if (s < -0.01 || s > levels - 1 + 0.01) throw new Error(`answer "${key}" is out of range`);
  return {
    score: s,
    normalised: Math.min(1, Math.max(0, s / (levels - 1))),
    probabilities: norm,
    confidence: parsed.data.confidence ?? null,
  };
}

function noul(raw: Record<string, unknown>, key: string): number {
  const parsed = noulSchema.safeParse(raw[key]);
  if (!parsed.success) throw new Error(`answer "${key}" is not a valid noul`);
  return Math.min(1, parsed.data.noul);
}

/** Validate a raw Jev `answers` map against the current question set. */
export function parseJevAnswers(raw: Record<string, unknown>): JevAnswers {
  const affinity = choice(
    raw,
    'colour_affinity',
    CATALOGUE.map((c) => c.id),
  );
  const fit: Record<string, number> = {};
  for (const c of CATALOGUE) fit[c.id] = noul(raw, fitKey(c.id));
  return {
    colourAffinity: affinity.probs,
    colourAffinityConfidence: affinity.confidence,
    fit,
    dominantFamily: choice(raw, 'dominant_family', Object.keys(FAMILY_OPTIONS)).probs,
    accentFamily: choice(raw, 'accent_family', Object.keys(ACCENT_FAMILY_OPTIONS)).probs,
    neutralBase: choice(raw, 'neutral_base', Object.keys(NEUTRAL_BASE_OPTIONS)).probs,
    darkSurface: optionalChoice(raw, 'dark_surface', Object.keys(DARK_SURFACE_OPTIONS)),
    character: choice(raw, 'character', Object.keys(CHARACTER_OPTIONS)).probs,
    temperature: score(raw, 'temperature', 5),
    saturation: score(raw, 'saturation', 5),
    energy: score(raw, 'energy', 5),
    contrast: score(raw, 'contrast', 5),
    lightness: score(raw, 'lightness', 5),
    monochrome: noul(raw, 'monochrome'),
  };
}

export function topEntries(dist: Record<string, number>, n: number): { key: string; p: number }[] {
  return Object.entries(dist)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([key, p]) => ({ key, p }));
}
