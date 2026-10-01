import type { AppConfig } from '../config.js';
import { absoluteUrl } from '../config.js';
import type { GenerationResult, SavedScheme, SchemeSummary } from '../schemes/service.js';

/** Stable JSON shapes shared by the HTTP API and MCP tools. */
export function generationJson(g: GenerationResult) {
  const s = g.scheme;
  return {
    generationId: g.generationId,
    expiresAt: g.expiresAt,
    concept: s.concept,
    variation: s.variation,
    alternativesAvailable: s.alternativesAvailable,
    recommendedMode: s.recommendedMode,
    algorithmVersion: s.algorithmVersion,
    semantic: s.semantic,
    light: s.light,
    dark: s.dark,
    accessibility: s.accessibility,
    adjustments: s.details,
    judgement: s.judgement,
    cache: {
      fromCache: g.cache.source === 'cache',
      source: g.cache.source,
      evaluationId: g.cache.evaluationId,
      model: g.cache.model,
      catalogueVersion: g.cache.catalogueVersion,
      questionSetVersion: g.cache.questionSetVersion,
      evaluatedAt: g.cache.evaluatedAt,
    },
  };
}

export function savedJson(config: AppConfig, s: SavedScheme) {
  return {
    id: s.id,
    owner: { id: s.ownerId },
    name: s.name,
    slug: s.slug,
    concept: s.concept,
    notes: s.notes,
    recommendedMode: s.generation.recommendedMode,
    semantic: s.semantic,
    light: s.light,
    dark: s.dark,
    accessibility: s.accessibility,
    adjustments: s.details,
    provenance: {
      evaluationId: s.evaluationId,
      generationId: s.generation.generationId,
      variation: s.generation.variation,
      algorithmVersion: s.algorithmVersion,
    },
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    url: absoluteUrl(config, `/schemes/${encodeURIComponent(s.slug)}`),
  };
}

export function summaryJson(config: AppConfig, s: SchemeSummary) {
  return { ...s, url: absoluteUrl(config, `/schemes/${encodeURIComponent(s.slug)}`) };
}
