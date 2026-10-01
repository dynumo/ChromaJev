import { getCatalogueColour, isHueFamily, type CatalogueColour } from '../colour/catalogue.js';
import { deltaE, hueDistance } from '../colour/oklch.js';
import type { Candidate, Interpretation } from './interpret.js';

export type Role = 'primary' | 'secondary' | 'accent';

export interface RoleLocks {
  primary?: string;
  secondary?: string;
  accent?: string;
}

export interface RoleChoice {
  colour: CatalogueColour;
  score: number;
  fit: number;
  affinity: number;
}

export interface Selection {
  primary: RoleChoice;
  secondary: RoleChoice;
  accent: RoleChoice;
  jointScore: number;
}

const MONO_THRESHOLD = 0.6;

function separated(a: CatalogueColour, b: CatalogueColour, minHue: number, minDelta: number): boolean {
  if (a.id === b.id) return false;
  const d = deltaE(a.oklch, b.oklch);
  if (d < minDelta) return false;
  if (a.chromatic && b.chromatic) return hueDistance(a.oklch.h, b.oklch.h) >= minHue || d >= 0.22;
  return true;
}

function asChoice(c: Candidate): RoleChoice {
  return { colour: c.colour, score: c.score, fit: c.fit, affinity: c.affinity };
}

function lockedCandidate(interp: Interpretation, id: string | undefined): Candidate | null {
  if (!id) return null;
  const found = interp.candidates.find((c) => c.colour.id === id);
  if (found) return found;
  const colour = getCatalogueColour(id);
  return colour ? { colour, score: 0, fit: 0, affinity: 0 } : null;
}

/**
 * Enumerate plausible (primary, secondary, accent) sets from the cached
 * judgement, best first, diversified so each alternative differs from every
 * earlier one in at least two roles. Index 0 is the main interpretation;
 * later indices are "another interpretation" without another Jev call.
 */
export function rankSelections(interp: Interpretation, locks: RoleLocks = {}, limit = 12): Selection[] {
  const mono = interp.monochrome >= MONO_THRESHOLD;
  const cands = interp.candidates;

  // Primary: best chromatic colours; a neutral may lead only when Jev clearly
  // prefers it (e.g. "brutalist architecture" → concrete/charcoal).
  const bestChromatic = cands.find((c) => c.colour.chromatic)?.score ?? 0;
  const primaryPool = cands
    .filter((c) => c.colour.chromatic || c.score > bestChromatic * 1.15)
    .filter((c) => !['near-white'].includes(c.colour.family))
    .slice(0, 5);

  const lockedP = lockedCandidate(interp, locks.primary);
  const lockedS = lockedCandidate(interp, locks.secondary);
  const lockedA = lockedCandidate(interp, locks.accent);
  const primaries = lockedP ? [lockedP] : primaryPool;

  const combos: Selection[] = [];
  for (const p of primaries) {
    const secondaryPool = lockedS
      ? [lockedS]
      : cands
          .filter((c) => c.colour.family !== 'near-white')
          .filter((c) => separated(p.colour, c.colour, mono ? 0 : 35, mono ? 0.07 : 0.1))
          .slice(0, 6);
    for (const s of secondaryPool) {
      const accentPool = lockedA
        ? [lockedA]
        : cands
            .filter((c) => c.colour.chromatic)
            .filter((c) => separated(p.colour, c.colour, mono ? 0 : 30, 0.1))
            .filter((c) => separated(s.colour, c.colour, mono ? 0 : 25, 0.1))
            .map((c) => ({
              c,
              weighted:
                c.score *
                (0.5 + (isHueFamily(c.colour.family) ? (interp.accentFamily[c.colour.family] ?? 0) : 0)) *
                (0.7 + 0.3 * Math.min(1, c.colour.oklch.c / 0.2)),
            }))
            .sort((a, b) => b.weighted - a.weighted || a.c.colour.id.localeCompare(b.c.colour.id))
            .slice(0, 6)
            .map((x) => x.c);
      for (const a of accentPool) {
        if (a.colour.id === p.colour.id || a.colour.id === s.colour.id) continue;
        combos.push({
          primary: asChoice(p),
          secondary: asChoice(s),
          accent: asChoice(a),
          jointScore: p.score + 0.6 * s.score + 0.5 * a.score,
        });
      }
    }
  }

  combos.sort(
    (x, y) =>
      y.jointScore - x.jointScore ||
      `${x.primary.colour.id}${x.secondary.colour.id}${x.accent.colour.id}`.localeCompare(
        `${y.primary.colour.id}${y.secondary.colour.id}${y.accent.colour.id}`,
      ),
  );

  const chosen: Selection[] = [];
  for (const c of combos) {
    const distinct = chosen.every((prev) => {
      let same = 0;
      if (prev.primary.colour.id === c.primary.colour.id) same++;
      if (prev.secondary.colour.id === c.secondary.colour.id) same++;
      if (prev.accent.colour.id === c.accent.colour.id) same++;
      return same <= 1;
    });
    if (distinct) chosen.push(c);
    if (chosen.length >= limit) break;
  }
  // Locks can make strong diversification impossible; fall back to raw order.
  if (chosen.length === 0 && combos.length > 0) chosen.push(combos[0]);
  return chosen;
}

export function selectRoles(interp: Interpretation, variation = 0, locks: RoleLocks = {}) {
  const ranked = rankSelections(interp, locks);
  if (ranked.length === 0) throw new Error('No viable colour combination for this judgement');
  const index = ((variation % ranked.length) + ranked.length) % ranked.length;
  return { selection: ranked[index], index, available: ranked.length };
}
