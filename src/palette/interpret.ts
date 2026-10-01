import { CATALOGUE, isHueFamily, type CatalogueColour } from '../colour/catalogue.js';
import type { JevAnswers } from '../jev/answers.js';
import { topEntries } from '../jev/answers.js';

export interface Candidate {
  colour: CatalogueColour;
  /** Combined, family-weighted evidence (0..~1.6). */
  score: number;
  /** Jev noul: does this colour belong? */
  fit: number;
  /** Jev choice probability across the whole catalogue. */
  affinity: number;
}

export type NeutralBase = 'warm' | 'cool' | 'pure' | 'tinted';

export interface Interpretation {
  candidates: Candidate[];
  familyWeights: Record<string, number>;
  accentFamily: Record<string, number>;
  neutralBase: NeutralBase;
  neutralBaseProbabilities: Record<string, number>;
  character: { key: string; p: number }[];
  temperature: number; // 0 very cool .. 1 very warm
  saturation: number; // 0 greyed .. 1 vivid
  energy: number; // 0 still .. 1 explosive
  contrast: number; // 0 very soft .. 1 stark
  lightness: number; // 0 dark & moody .. 1 light & airy
  monochrome: number; // probability
}

/**
 * Turn Jev's probabilities into ranked evidence. Two independent signals per
 * colour are combined: the absolute noul ("does it belong?") and the relative
 * choice share ("which belongs most?"), then weighted by how strongly Jev
 * wants that colour's family to dominate.
 */
export function interpret(answers: JevAnswers): Interpretation {
  const maxAffinity = Math.max(...Object.values(answers.colourAffinity), 1e-9);
  const familyWeights = answers.dominantFamily;

  const candidates: Candidate[] = CATALOGUE.map((colour) => {
    const fit = answers.fit[colour.id] ?? 0;
    const affinity = answers.colourAffinity[colour.id] ?? 0;
    const familyP = isHueFamily(colour.family) ? (familyWeights[colour.family] ?? 0) : (familyWeights.neutral ?? 0);
    const evidence = 0.55 * fit + 0.45 * (affinity / maxAffinity);
    return { colour, fit, affinity, score: evidence * (0.6 + familyP) };
  }).sort((a, b) => b.score - a.score || a.colour.id.localeCompare(b.colour.id));

  const nb = topEntries(answers.neutralBase, 1)[0]?.key as NeutralBase;

  return {
    candidates,
    familyWeights,
    accentFamily: answers.accentFamily,
    neutralBase: nb ?? 'pure',
    neutralBaseProbabilities: answers.neutralBase,
    character: topEntries(answers.character, 3),
    temperature: answers.temperature.normalised,
    saturation: answers.saturation.normalised,
    energy: answers.energy.normalised,
    contrast: answers.contrast.normalised,
    lightness: answers.lightness.normalised,
    monochrome: answers.monochrome,
  };
}
