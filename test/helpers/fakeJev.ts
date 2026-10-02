import { createHash } from 'node:crypto';
import { CATALOGUE } from '../../src/colour/catalogue.js';
import { toResult, type JevClient, type JevResult } from '../../src/jev/client.js';
import { buildQuestions, fitKey } from '../../src/jev/questions.js';

/** Deterministic pseudo-random in [0,1) from a string. */
function rand(seed: string): number {
  return createHash('sha256').update(seed).digest().readUInt32BE(0) / 2 ** 32;
}

const HINTS: Record<string, string[]> = {
  forest: ['green', 'brown'],
  autumn: ['orange', 'brown', 'red'],
  ocean: ['blue', 'teal', 'cyan'],
  browser: ['blue', 'cyan'],
  fintech: ['blue', 'teal'],
  healthcare: ['teal', 'green', 'blue'],
  bakery: ['brown', 'orange', 'yellow'],
  cyberpunk: ['pink', 'cyan', 'purple'],
  brutalist: ['neutral'],
  retro: ['orange', 'yellow', 'brown'],
  ruby: ['red'],
};

/**
 * Builds a plausible, well-formed Jev response for any concept, entirely
 * offline. Answers depend only on the concept text, so tests are stable.
 */
export function fakeAnswers(concept: string): Record<string, unknown> {
  const words = concept.toLowerCase().split(/\s+/);
  const families = new Set(words.flatMap((w) => HINTS[w] ?? []));
  if (families.size === 0) families.add(['red', 'blue', 'green', 'purple', 'orange'][Math.floor(rand(concept) * 5)]);
  const questions = buildQuestions();
  const answers: Record<string, unknown> = {};

  const affinityRaw = CATALOGUE.map((c) => {
    const fam = families.has(c.family) || (families.has('neutral') && !c.chromatic);
    return [c.id, (fam ? 3 : 0.1) * (0.3 + rand(concept + c.id))] as const;
  });
  const total = affinityRaw.reduce((a, [, v]) => a + v, 0);
  const probs = Object.fromEntries(affinityRaw.map(([k, v]) => [k, v / total]));
  answers.colour_affinity = { type: 'choice', choice: affinityRaw.sort((a, b) => b[1] - a[1])[0][0], probabilities: probs, confidence: 0.4 };

  for (const c of CATALOGUE) {
    const fam = families.has(c.family) || (families.has('neutral') && !c.chromatic);
    answers[fitKey(c.id)] = { type: 'noul', noul: fam ? 0.5 + 0.45 * rand(`fit${concept}${c.id}`) : 0.05 * rand(c.id + concept) };
  }

  const choiceDist = (key: string, favoured: string[]) => {
    const q = questions[key] as { criteria: Record<string, unknown> };
    const raw = Object.keys(q.criteria).map((o) => [o, (favoured.includes(o) ? 4 : 0.2) * (0.5 + rand(concept + key + o))] as const);
    const t = raw.reduce((a, [, v]) => a + v, 0);
    const p = Object.fromEntries(raw.map(([k, v]) => [k, v / t]));
    return { type: 'choice', choice: raw.sort((a, b) => b[1] - a[1])[0][0], probabilities: p, confidence: 0.5 };
  };
  answers.dominant_family = choiceDist('dominant_family', [...families]);
  answers.accent_family = choiceDist('accent_family', [...families].slice(-1));
  answers.neutral_base = choiceDist('neutral_base', [families.has('neutral') ? 'pure' : 'warm']);
  answers.dark_surface = choiceDist('dark_surface', [families.has('neutral') ? 'black' : families.has('brown') ? 'warm' : 'primary']);
  answers.character = choiceDist('character', ['calm']);

  const scoreAns = (key: string, centre: number) => {
    const probs: Record<string, number> = {};
    let t = 0;
    for (let i = 0; i < 5; i++) {
      const v = Math.exp(-((i - centre) ** 2));
      probs[String(i)] = v;
      t += v;
    }
    let s = 0;
    for (let i = 0; i < 5; i++) {
      probs[String(i)] /= t;
      s += i * probs[String(i)];
    }
    return { type: 'score', score: s, legend: {}, probabilities: probs, confidence: 0.6 };
  };
  answers.temperature = scoreAns('temperature', 1 + 2.5 * rand(concept + 't'));
  answers.saturation = scoreAns('saturation', 1 + 2.5 * rand(concept + 's'));
  answers.energy = scoreAns('energy', 1 + 2.5 * rand(concept + 'e'));
  answers.contrast = scoreAns('contrast', 1 + 2.5 * rand(concept + 'c'));
  answers.lightness = scoreAns('lightness', words.includes('cyberpunk') ? 0.5 : 2 + 2 * rand(concept + 'l'));
  answers.monochrome = { type: 'noul', noul: families.has('neutral') ? 0.7 : 0.1 };
  return answers;
}

export class FakeJevClient implements JevClient {
  readonly provider = 'Fake (tests)';
  calls: string[] = [];
  configured = true;
  failWith: Error | null = null;
  delayMs = 0;
  model = 'jev-1.13.0';

  async evaluate(concept: string): Promise<JevResult> {
    this.calls.push(concept);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failWith) throw this.failWith;
    return toResult({ model: this.model, answers: fakeAnswers(concept), usage: { input_tokens: 4200, output_tokens: 0 } });
  }
}
