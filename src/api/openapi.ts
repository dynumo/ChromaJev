import type { AppConfig } from '../config.js';
import { absoluteUrl } from '../config.js';
import { MODE_TOKENS } from '../palette/types.js';

export function openApiDocument(config: AppConfig) {
  const hex = { type: 'string', pattern: '^#[0-9a-f]{6}$' };
  const modeTokens = {
    type: 'object',
    required: [...MODE_TOKENS],
    properties: Object.fromEntries(MODE_TOKENS.map((t) => [t, hex])),
  };
  const check = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      foreground: { type: 'string' },
      background: { type: 'string' },
      foregroundHex: hex,
      backgroundHex: hex,
      ratio: { type: 'number' },
      required: { type: 'number' },
      level: { type: 'string', enum: ['AAA', 'AA', 'AA-large', 'fail'] },
      passes: { type: 'boolean' },
    },
  };
  const report = { type: 'object', properties: { checks: { type: 'array', items: check }, passed: { type: 'integer' }, failed: { type: 'integer' }, allPass: { type: 'boolean' } } };
  const err = { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } };
  const errorResponses = {
    '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    '401': { description: 'Missing or invalid API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    '403': { description: 'Insufficient scope', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  };
  const ref = { name: 'ref', in: 'path', required: true, description: 'Scheme ID or slug', schema: { type: 'string' } };
  const saved = { $ref: '#/components/schemas/SavedScheme' };

  return {
    openapi: '3.1.0',
    info: {
      title: 'ChromaJev API',
      version: '1.0.0',
      description:
        'Generate and manage paired light/dark colour schemes. Generation consults the semantic cache before calling Jev; `cache.fromCache` reports which happened.',
    },
    servers: [{ url: absoluteUrl(config, '/api') }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: {
        apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'cj_…', description: 'Personal API key from the account page. Scopes: schemes:read, schemes:generate, schemes:write.' },
      },
      schemas: {
        Error: err,
        ModeTokens: modeTokens,
        AccessibilityReport: report,
        Generation: {
          type: 'object',
          properties: {
            generationId: { type: 'string', description: 'Pass to POST /schemes to save. Expires after 7 days.' },
            expiresAt: { type: 'string', format: 'date-time' },
            concept: { type: 'string' },
            variation: { type: 'integer' },
            alternativesAvailable: { type: 'integer' },
            recommendedMode: { type: 'string', enum: ['light', 'dark'] },
            algorithmVersion: { type: 'string' },
            semantic: { type: 'object' },
            light: { $ref: '#/components/schemas/ModeTokens' },
            dark: { $ref: '#/components/schemas/ModeTokens' },
            accessibility: { type: 'object', properties: { light: report, dark: report } },
            adjustments: { type: 'object', description: 'Per-mode record of original vs final colours and whether accessibility adjustment occurred.' },
            judgement: { type: 'object', description: 'Jev probabilities used to build the palette.' },
            cache: {
              type: 'object',
              properties: {
                fromCache: { type: 'boolean' },
                source: { type: 'string', enum: ['cache', 'jev'] },
                evaluationId: { type: 'string' },
                model: { type: ['string', 'null'] },
                catalogueVersion: { type: 'string' },
                questionSetVersion: { type: 'string' },
                evaluatedAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        SavedScheme: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            owner: { type: 'object', properties: { id: { type: 'string' } } },
            name: { type: 'string' },
            slug: { type: 'string' },
            concept: { type: 'string' },
            notes: { type: ['string', 'null'] },
            light: { $ref: '#/components/schemas/ModeTokens' },
            dark: { $ref: '#/components/schemas/ModeTokens' },
            semantic: { type: 'object' },
            accessibility: { type: 'object', properties: { light: report, dark: report } },
            adjustments: { type: 'object' },
            provenance: { type: 'object' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            url: { type: 'string', format: 'uri' },
          },
        },
      },
    },
    paths: {
      '/schemes/generate': {
        post: {
          summary: 'Generate a paired light/dark scheme from a concept',
          'x-required-scope': 'schemes:generate',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['concept'],
                  properties: {
                    concept: { type: 'string', maxLength: 120, example: 'autumn forest' },
                    variation: { type: 'integer', minimum: 0, description: 'Alternative interpretation from the same cached judgement (no extra Jev call).' },
                    locks: { type: 'object', properties: { primary: { type: 'string' }, secondary: { type: 'string' }, accent: { type: 'string' } }, description: 'Catalogue colour IDs to keep fixed.' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Generated scheme', content: { 'application/json': { schema: { $ref: '#/components/schemas/Generation' } } } },
            ...errorResponses,
            '429': { description: 'Jev rate limit' },
            '502': { description: 'Jev failure or malformed response' },
            '503': { description: 'Jev not configured' },
            '504': { description: 'Jev timeout' },
          },
        },
      },
      '/generations/{id}': {
        get: { summary: 'Fetch a recent generation (7-day retention)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Generation', content: { 'application/json': { schema: { $ref: '#/components/schemas/Generation' } } } }, '404': { description: 'Not found' } } },
      },
      '/schemes': {
        get: {
          summary: 'List your saved schemes',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { '200': { description: 'Summaries', content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } }, total: { type: 'integer' } } } } } }, ...errorResponses },
        },
        post: {
          summary: 'Save a generated scheme under a custom name',
          'x-required-scope': 'schemes:write',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 80 }, notes: { type: 'string' }, generationId: { type: 'string' }, concept: { type: 'string', description: 'Alternative to generationId (needs schemes:generate too).' }, variation: { type: 'integer' } } } } },
          },
          responses: { '201': { description: 'Saved', content: { 'application/json': { schema: saved } } }, ...errorResponses, '404': { description: 'Generation expired or not found' } },
        },
      },
      '/schemes/{ref}': {
        get: { summary: 'Retrieve a saved scheme by ID or slug', parameters: [ref], responses: { '200': { description: 'Scheme', content: { 'application/json': { schema: saved } } }, '404': { description: 'Not found (or not yours)' } } },
        patch: { summary: 'Rename or edit notes', parameters: [ref], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, notes: { type: ['string', 'null'] } } } } } }, responses: { '200': { description: 'Updated', content: { 'application/json': { schema: saved } } }, '404': { description: 'Not found' } } },
        delete: { summary: 'Delete a saved scheme', parameters: [ref], responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } } },
      },
      '/schemes/{ref}/duplicate': {
        post: { summary: 'Duplicate a saved scheme', parameters: [ref], responses: { '201': { description: 'Copy', content: { 'application/json': { schema: saved } } } } },
      },
      '/schemes/{ref}/export': {
        get: {
          summary: 'Export as CSS variables, JSON or Tailwind',
          parameters: [ref, { name: 'format', in: 'query', schema: { type: 'string', enum: ['css', 'json', 'tailwind', 'tailwind-v3'], default: 'css' } }],
          responses: { '200': { description: 'Export file' } },
        },
      },
    },
  };
}
