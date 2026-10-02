import { CATALOGUE, HUE_FAMILIES } from '../colour/catalogue.js';

/**
 * The fixed question set ChromaJev sends to Jev — one request per concept.
 *
 * Design notes (from TypeSafe's guidance for jev-1.13):
 *  - colours are described by *name*, never by hex;
 *  - every question is independent and literal (no "other than the previous
 *    answer" indirection);
 *  - the user's concept appears only in `state`, never inside instructions;
 *  - numeric work (contrast, tones) is left to code.
 *
 * Any change to wording, options or keys must bump QUESTION_SET_VERSION so
 * stale cache entries are not reused.
 */
export const QUESTION_SET_VERSION = 'qs-3';

export const FAMILY_OPTIONS: Record<string, string> = {
  red: 'Reds, from coral to crimson and oxblood',
  orange: 'Oranges, from peach to tangerine, terracotta and rust',
  yellow: 'Yellows, from butter and lemon to gold, amber and mustard',
  green: 'Greens, from mint and lime to emerald, forest and olive',
  teal: 'Teals, the blue-greens from seafoam to deep teal',
  cyan: 'Cyans, the bright and icy blue-greens leaning blue',
  blue: 'Blues, from powder blue and azure to cobalt and navy',
  purple: 'Purples, from lavender to violet, indigo and plum',
  pink: 'Pinks, from petal pink to hot pink and magenta',
  brown: 'Browns and tans, from sand and caramel to walnut and chocolate',
  neutral: 'Neutrals: greys, black, white and off-whites with little or no colour',
};

export const ACCENT_FAMILY_OPTIONS: Record<string, string> = Object.fromEntries(
  HUE_FAMILIES.map((f) => [f, FAMILY_OPTIONS[f]]),
);

export const NEUTRAL_BASE_OPTIONS = {
  warm: 'Warm neutrals: creams, stone, sand-tinted greys',
  cool: 'Cool neutrals: blue-tinted greys, slate, frost',
  pure: 'Pure neutrals: true greys and clean white with no tint',
  tinted: 'Neutrals tinted noticeably with the main colour of the concept',
} as const;

/**
 * Dark-mode page background. Added after qs-3 shipped: the answer is optional
 * in `parseJevAnswers` (older cached evaluations lack it and fall back to a
 * heuristic in the palette builder), so adding it does not bump
 * QUESTION_SET_VERSION and does not discard the cache.
 */
export const DARK_SURFACE_OPTIONS = {
  black: 'Near-black or charcoal: a dark background with no noticeable colour',
  warm: 'Dark warm brown: espresso, chocolate, walnut or dark sand-tinted background',
  cool: 'Dark cool slate: midnight blue-grey or ink-tinted background',
  primary: 'A deep, dark shade of the single most characteristic colour of the concept',
  secondary: 'A deep, dark shade of a second, supporting colour of the concept',
} as const;

export const CHARACTER_OPTIONS = {
  organic: 'Organic, natural, earthy',
  technical: 'Technical, precise, engineered',
  playful: 'Playful, fun, light-hearted',
  formal: 'Formal, serious, institutional',
  luxurious: 'Luxurious, premium, refined',
  utilitarian: 'Utilitarian, functional, no-nonsense',
  retro: 'Retro, nostalgic, vintage',
  futuristic: 'Futuristic, digital, neon',
  calm: 'Calm, gentle, reassuring',
  bold: 'Bold, loud, confident',
} as const;

export const TEMPERATURE_LEVELS = [
  'Very cool: icy blues, cold greys',
  'Cool: leaning blue, green or grey',
  'Balanced: neither warm nor cool',
  'Warm: leaning red, orange, yellow or brown',
  'Very warm: fiery, sunny, glowing',
] as const;

export const SATURATION_LEVELS = [
  'Greyed and desaturated, almost colourless',
  'Muted and dusty',
  'Moderately coloured',
  'Rich and saturated',
  'Vivid, neon, intensely saturated',
] as const;

export const ENERGY_LEVELS = [
  'Still, quiet and restrained',
  'Calm and steady',
  'Moderate energy',
  'Lively and dynamic',
  'Explosive, loud and high-energy',
] as const;

export const CONTRAST_LEVELS = [
  'Very soft: gentle tonal steps, low contrast between elements',
  'Soft: subtle separation between elements',
  'Moderate: clear but not harsh separation',
  'Strong: crisp, distinct separation',
  'Stark: maximum contrast, hard edges',
] as const;

export const LIGHTNESS_LEVELS = [
  'Dark and moody, mostly deep tones',
  'Leaning dark',
  'Balanced between light and dark',
  'Leaning light',
  'Light and airy, mostly pale tones',
] as const;

export type JevQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: readonly string[] };

export const fitKey = (colourId: string) => `fit__${colourId}`;

export function buildQuestions(): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};

  questions.colour_affinity = {
    type: 'choice',
    instructions: 'Which one of these named colours most strongly belongs with the `concept`?',
    criteria: Object.fromEntries(CATALOGUE.map((c) => [c.id, `${c.name}: ${c.descriptor}`])),
  };

  for (const c of CATALOGUE) {
    questions[fitKey(c.id)] = {
      type: 'noul',
      instructions: `Does the colour ${c.name} (${c.descriptor}) clearly belong in a colour palette for the \`concept\`?`,
      criteria: {
        true: `${c.name} is strongly associated with the concept or would clearly suit it`,
        false: `${c.name} is unrelated to the concept or would feel out of place`,
      },
    };
  }

  questions.dominant_family = {
    type: 'choice',
    instructions: 'Which family of colours should dominate a visual identity for the `concept`?',
    criteria: FAMILY_OPTIONS,
  };
  questions.accent_family = {
    type: 'choice',
    instructions:
      'A visual identity for the `concept` needs one small, vivid highlight colour for buttons, links and badges. Which colour family suits that highlight best?',
    criteria: ACCENT_FAMILY_OPTIONS,
  };
  questions.neutral_base = {
    type: 'choice',
    instructions: 'Which kind of neutral background tones best suit a visual identity for the `concept`?',
    criteria: { ...NEUTRAL_BASE_OPTIONS },
  };
  questions.dark_surface = {
    type: 'choice',
    instructions:
      'In a dark theme for a visual identity for the `concept`, which kind of dark page background would suit it best?',
    criteria: { ...DARK_SURFACE_OPTIONS },
  };
  questions.character = {
    type: 'choice',
    instructions: 'Which description best fits the visual character of the `concept`?',
    criteria: { ...CHARACTER_OPTIONS },
  };
  questions.temperature = {
    type: 'score',
    instructions: 'How warm or cool should the colours for the `concept` feel?',
    criteria: TEMPERATURE_LEVELS,
  };
  questions.saturation = {
    type: 'score',
    instructions: 'How saturated should the colours for the `concept` be?',
    criteria: SATURATION_LEVELS,
  };
  questions.energy = {
    type: 'score',
    instructions: 'How energetic or restrained should the colours for the `concept` feel?',
    criteria: ENERGY_LEVELS,
  };
  questions.contrast = {
    type: 'score',
    instructions: 'How much contrast should a visual identity for the `concept` use between its elements?',
    criteria: CONTRAST_LEVELS,
  };
  questions.lightness = {
    type: 'score',
    instructions: 'Is the `concept` better expressed with dark tones or light tones?',
    criteria: LIGHTNESS_LEVELS,
  };
  questions.monochrome = {
    type: 'noul',
    instructions:
      'Is the `concept` so strongly tied to one single colour that a palette built almost entirely from shades of that one colour would be the right choice?',
  };

  return questions;
}

export function buildState(concept: string): { concept: string } {
  return { concept };
}
