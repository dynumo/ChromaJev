# ChromaJev architecture

This document records the research done before implementation and the
architecture that follows from it. The README covers day-to-day usage; this
file explains *why* things are built the way they are.

> **Jev provides semantic judgement. Code provides colour mathematics.
> One judgement produces coordinated light and dark themes.**

## 1. Research summary (October 2026)

| Topic | Finding | Consequence |
| --- | --- | --- |
| TypeSafe Jev (`docs.typesafe.ai`) | `POST https://api.typesafe.ai/v1/systemone` takes `state` + a map of typed questions (`noul`, `choice` ≤255 options, `score` 2–10 levels). Answers carry full probability distributions and a `confidence`. Billed per *input* token; one request may carry many questions ("speculative fan-out"). Current model `jev-1.13.0`, alias `jev-latest`. | Ask **one** request per concept with ~100 independent questions. Persist the full answers. |
| Jev 1.13 jaggedness notes | Jev reasons about colour **names** far better than hex/RGB, is weak at arithmetic, reads literally, and should not be asked chained/indirect questions. | The catalogue is sent as names with short descriptions — never hex. All maths (contrast, OKLCH, tones) stays in code. Questions are independent and literal. |
| Official JS SDK `@typesafe-ai/sdk` 0.6 | Typed client with retries/backoff on 408/429/5xx, timeouts, typed errors (`RateLimitError`, `AuthenticationError`, …), refuses to run in a browser. | Used directly behind a small `JevClient` interface so tests inject a fake. |
| JevRun / Jev Pixels | JevRun asks one noul per colour across 63 named colours and ranks by probability. | Inspiration only. ChromaJev combines a *relative* signal (a Choice over the whole catalogue) with *absolute* per-colour nouls, plus family/temperature/energy/contrast judgements, and then builds a full UI system rather than a swatch strip. |
| MCP spec 2026-07-28 | Streamable HTTP transport; "modern" era drops `initialize` in favour of `server/discover`. Authorization: server is an OAuth 2.1 **resource server**, MUST publish RFC 9728 Protected Resource Metadata, MUST validate audience (RFC 8707 resource indicators), 401 + `WWW-Authenticate` with `resource_metadata`, 403 `insufficient_scope` for step-up. AS SHOULD support Client ID Metadata Documents (CIMD); DCR is deprecated but retained for compatibility; AS SHOULD emit `iss` in authorization responses (RFC 9207). | Implement exactly that split (below). |
| MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.2, `/express`, `/node`) | Serves both protocol eras from `createMcpHandler`. Ships **resource-server** helpers only (`requireBearerAuth`, PRM builders, per-tool `scopeChallenge`). The v1 authorization-server helpers are frozen in `server-legacy` and the docs say "use a dedicated identity provider". | MCP SDK for `/mcp` + PRM; a dedicated, maintained AS library for token issuance. |
| `oidc-provider` 9.x (panva, OpenID-certified) | Full OAuth 2.1/OIDC AS: authorization code + PKCE, refresh tokens, RFC 8707 resource indicators with JWT access tokens per resource, RFC 7591 DCR, **CIMD (draft) support**, RFC 9207 `iss`, RFC 8414-compatible discovery, pluggable persistence adapter, and an *interaction* API so the host app renders its own login/consent pages. | ChromaJev hosts its own AS using `oidc-provider`, with the **local ChromaJev account as the identity** via the interaction API. No OAuth protocol code is hand-written. |
| Elastic Email | REST API v4 `POST https://api.elasticemail.com/v4/emails/transactional`, header `X-ElasticEmail-ApiKey`, JSON `{Recipients:{To:[]}, Content:{From, Subject, Body:[{ContentType:"HTML"|"PlainText"}]}}`. Official SDKs are thin axios wrappers. | A ~60 line transport using `fetch`, behind a `Mailer` interface. |
| Accounts | No library covers invitations + admin settings + OIDC interaction cleanly together. `@node-rs/argon2` gives prebuilt Argon2id. | Small, conventional account module: Argon2id hashes, opaque random tokens stored as SHA-256 hashes, DB-backed sessions. |

## 2. Stack

* **Node.js 22 + TypeScript**, **Express 5** — one process, one port (3000).
* **SQLite** via `better-sqlite3` (synchronous, WAL mode, `synchronous=NORMAL`,
  foreign keys on). Single file at `$DATA_DIR/chromajev.sqlite`.
* **Server-rendered HTML** (tiny escaped template helper) + one vanilla
  TypeScript client bundle built with esbuild. No SPA framework — the
  component playground is plain HTML driven by CSS custom properties.
* **vitest + supertest** for tests; Jev and mail are always faked in tests.

### Jev routes

`JevClient` has two implementations chosen by `JEV_PROVIDER`: the official
TypeSafe SDK (direct), and Cloudflare's REST API (`POST
/accounts/{id}/ai/run`, `model: "typesafe/jev"`, optional
`cf-aig-gateway-id`), which adds AI Gateway logging/rate limiting and bills
through Cloudflare Unified Billing. Cloudflare's `input` is exactly
TypeSafe's `{state, questions}`, so both routes share the question set,
answer validation and cache entries. Cloudflare responses may arrive bare or
in the v4 `{success, result, errors}` envelope; both are accepted.

## 3. Pipeline

```
concept ─normalise─▶ semantic cache ──hit──▶ JevEvaluation
                         │ miss (in-flight de-duplicated)
                         ▼
                   Jev (1 request, ~100 questions)
                         ▼
                 interpretation (code): candidate scores, family weights,
                 temperature / saturation / energy / contrast / lightness
                         ▼
                 role selection (primary / secondary / accent / neutral)
                         ▼
          ┌──────────── light mode ─────────┐  ┌──────── dark mode ────────┐
          │ OKLCH tonal derivation          │  │ same semantic hues        │
          │ contrast enforcement + report   │  │ own surface ladder        │
          └─────────────────────────────────┘  └───────────────────────────┘
                         ▼
          GeneratedScheme (temporary, 7 days) ─save─▶ SavedScheme (durable)
                         ▼
              Web UI · HTTP API · MCP (one service layer)
```

## 4. Jev question set (version `qs-3`)

One request (~95 questions). `state` is `{ "concept": "<user text>" }` — nothing else, to
avoid distractors.

| Key | Type | Purpose |
| --- | --- | --- |
| `colour_affinity` | choice over all catalogue IDs (81) | Relative signal: which colour belongs most. Full distribution kept. |
| `fit__<id>` ×81 | noul | Absolute signal: "Does *Teal* (a deep blue-green) belong with this concept?" Independent per colour so alternatives have real evidence. |
| `dominant_family` | choice over 12 hue families + neutral | Which hue family should dominate. |
| `accent_family` | choice over hue families | Which family suits a small, vivid highlight (calls to action, badges). Asked independently, not conditioned on the dominant answer (avoids indirection). |
| `neutral_base` | choice: warm / cool / pure / tinted | Character of greys and surfaces. |
| `dark_surface` | choice: black / warm / cool / primary / secondary (optional; absent in older cache entries) | Hue of the dark-mode page background. |
| `character` | choice: organic, technical, playful, formal, luxurious, utilitarian, retro, futuristic, calm, bold | Shown in Jev view; nudges chroma ceilings and neutral tint. |
| `temperature` | score (5 levels, very cool → very warm) | Neutral hue, status-colour nudges, tie-breaking. |
| `saturation` | score (5 levels, greyed → vivid) | Chroma scale. |
| `energy` | score (5 levels, still → energetic) | Accent chroma and how far accent may diverge. |
| `contrast` | score (5 levels, soft tonal → stark) | Surface spacing, border strength, text lightness targets (never below WCAG minima). |
| `lightness` | score (5 levels, dark & moody → light & airy) | Which mode is presented first; tint strength of surfaces. |
| `monochrome` | noul | Permits an intentionally monochromatic palette (relaxes hue separation). |

The concept text is only ever in `state`; question text is fixed, so prompts
cannot inject into instructions.

## 5. Colour catalogue (version `cat-2`)

81 colours: 10 chromatic families (red, orange, yellow, green, teal, cyan,
blue, purple, pink, brown) × 5–7 tones, plus warm greys, cool greys, neutral greys,
near-black and near-white. Each entry: stable ID (`teal-deep`), name
("Deep teal"), hex, family, a one-line descriptor for Jev. OKLCH is computed
at load time. IDs are stable; any change to the set or wording bumps the
catalogue version, which invalidates cache entries.

## 6. Semantic cache

Table `jev_evaluations`, unique on
`(normalised_query, catalogue_version, question_set_version)`.
Normalisation: Unicode NFKC, trim, collapse internal whitespace, lowercase.
Nothing else (no stemming or synonym folding). Stored: original query,
normalised query, raw answers, model ID returned by Jev, usage, versions,
`created_at`, `last_requested_at`, `request_count`, `hit_count`.
Concurrent misses for the same key share one in-flight promise, so a
double-click never costs two requests. Only successful, validated responses
are stored. The cache is global (an optimisation) but never listed to other
users; the UI only shows a user their own generated history.

Alternatives (`variation = n`) re-run deterministic selection over the cached
distributions (the n-th best joint candidate set), so they cost zero credits.

## 7. Palette construction and light/dark derivation

All mechanics in OKLCH (Björn Ottosson's matrices), gamut-mapped to sRGB by
chroma reduction at constant L/H.

1. **Candidate score** per colour = 0.55·noul + 0.45·(choice / max choice),
   weighted by `0.6 + family probability`.
2. **Roles**: primary = best chromatic candidate (or best overall if
   `monochrome` is high); secondary = best candidate ≥35° hue away (≥15°
   when monochrome); accent = best candidate weighted by `accent_family` and
   chroma, separated from both; neutral hue from `neutral_base` +
   `temperature` (+ primary hue when "tinted").
3. **Light mode**: background L≈0.985, surface 1.0, elevated 1.0 (+shadow),
   muted surface L≈0.955; text L≈0.21; borders/inputs at fixed ΔL steps
   scaled by `contrast`. Brand colours keep their semantic L where it works.
4. **Dark mode** (not an inversion): background L≈0.17 (+0.02 when it is a
   deep brand shade). Its hue comes from the optional `dark_surface` answer
   (`black`, `warm`, `cool`, `primary`, `secondary`); `primary`/`secondary`
   use that role's hue at chroma ≈0.03–0.06, the others a faint neutral tint.
   Older cached evaluations lack the answer, so a heuristic over `neutral_base`,
   saturation and the primary colour stands in (`semantic.darkSurface.source`
   says which). Surface ladder surface ladder +0.035/+0.07, text L≈0.94, brand colours lifted to
   L≈0.72–0.80 with chroma ×0.85 to avoid glare, foregrounds re-chosen.
5. **States**: hover/active computed by ΔL (direction depends on mode).
6. **Status colours** (success 150°, warning 75°, error 27°, info 245°)
   keep their canonical hues (nudged ≤8° by temperature) so they stay
   recognisable; each has a solid, foreground, soft background and
   soft-text variant.

## 8. Accessibility

`ensureContrast(colour, against, target)` walks OKLCH lightness away from
the background (keeping hue, reducing chroma only for gamut), returning
`{original, final, adjusted, ratio}`. Foregrounds are chosen as the higher
contrast of a tinted near-white / near-black. Every mode gets a report of
34 checks (text/background, text/surface, muted text, link, button
foregrounds, form fields, input border 3:1, focus ring 3:1, alerts). Each
check stores the real ratio and `AA`/`AA-large`/`fail` — it is never
labelled passing unless it meets the threshold.

## 9. Data model (SQLite)

* `users`, `sessions` (hashed token), `email_tokens` (verify/reset, hashed),
  `invitations` (hashed token), `settings` (key/value JSON), `api_keys`
  (hashed, per-user, scoped).
* `jev_evaluations` — semantic cache.
* `generated_schemes` — temporary results (7-day TTL) owned by the requesting
  user; enables "save the thing I just generated" from web/API/MCP.
* `schemes` — saved, durable: owner, name, slug (unique per owner), concept,
  `light`, `dark`, `semantic`, `accessibility` JSON (final values, not
  recipes), evaluation ID, algorithm version, notes, timestamps.
* `oauth_models` — `oidc-provider` adapter storage (grants, codes, refresh
  tokens, registered clients, sessions, interactions).
* `app_secrets` — generated signing keys/cookie keys persisted under `/data`.

Migrations: ordered, idempotent SQL in `src/db/migrations.ts`, applied at
start-up inside a transaction, tracked in `schema_migrations`.

## 10. Accounts, registration, invitations, email

* Roles `admin` / `user`; status `active` / `disabled`.
* Bootstrap: if **no users exist** and `ADMIN_EMAIL` + `ADMIN_PASSWORD` are
  set, create a verified admin. Never touches existing accounts.
* Setting `registration.public` (default off) in `settings`; admin toggle.
  Public sign-up creates an unverified account and emails a verification
  link; unverified users cannot log in.
* Invitations: 32-byte random token (base64url), SHA-256 stored, 7-day
  expiry, single use, revocable, resendable (rotates the token). Accepting
  sets the password and marks the email verified (the link proves control of
  that exact address).
* Password reset: 1-hour single-use token; identical response whether or
  not the address exists; resetting kills existing sessions.
* Last-admin protection on disable/demote.
* `Mailer` interface → `ElasticEmailTransport` (production), `LogTransport`
  (development only, refuses to run when `NODE_ENV=production`),
  `MemoryTransport` (tests).

## 11. Authentication surfaces (kept separate)

| Surface | Mechanism |
| --- | --- |
| Perimeter (optional) | HTTP Basic when both `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` are set; one without the other is a start-up error. Applies to browser-facing routes; machine endpoints that must carry their own `Authorization` header (`/mcp`, `/api/*`, OAuth token/registration/JWKS, `/.well-known/*`, `/health`) are exempt because HTTP permits only one `Authorization` header. |
| Web | Session cookie (`__Host-` prefix on HTTPS), SameSite=Lax, plus CSRF token + Origin check on unsafe methods. |
| HTTP API | Personal API keys (`cj_…`, hashed, scoped `schemes:read` / `schemes:generate` / `schemes:write`), or the web session (same-origin + CSRF). |
| MCP | OAuth 2.1 bearer JWTs issued by the embedded AS for resource `${PUBLIC_BASE_URL}/mcp`. |

## 12. OAuth / MCP

* Issuer = `PUBLIC_BASE_URL`. `oidc-provider` mounted at `/oauth/*`
  (`/oauth/authorize`, `/oauth/token`, `/oauth/register`, `/oauth/jwks`,
  `/oauth/revoke`) and `/.well-known/openid-configuration`; the same document
  is also served at `/.well-known/oauth-authorization-server` (RFC 8414).
* Features: PKCE (S256, required), refresh tokens with rotation, resource
  indicators (JWT access tokens, audience = MCP resource, 1 h TTL), DCR
  (open, public clients allowed — deprecated but needed by current clients),
  CIMD, `iss` in authorization responses, revocation.
* Interaction pages `/interaction/:uid` use the normal ChromaJev login and a
  consent screen listing requested scopes. Disabled or unverified accounts
  cannot complete authorisation.
* `/mcp` is guarded by the SDK's `requireBearerAuth` with a verifier that
  checks signature (local JWKS via `jose`), issuer, audience, expiry, and
  that the user still exists and is active. Disabling a user also deletes
  their grants/refresh tokens. PRM at
  `/.well-known/oauth-protected-resource/mcp`.
* Scopes: `schemes:read`, `schemes:generate`, `schemes:write`. Per-tool
  `scopeChallenge` returns 403 `insufficient_scope` for step-up.
* Tools: `generate_colour_scheme`, `get_colour_scheme`,
  `list_colour_schemes`, `save_colour_scheme` (accepts a `generation_id`
  so agents never reconstruct colours), `rename_colour_scheme`,
  `delete_colour_scheme` (destructive hint, write scope). Resource template
  `chromajev://schemes/{slug}` exposes saved schemes read-only.

Answer to the key question: **yes** — `oidc-provider`'s interaction model is
precisely "the host app authenticates the human however it likes, then calls
`interactionFinished` with an `accountId`". ChromaJev supplies its own user
ID; the library performs every protocol step (PKCE, code issuance, token
minting, client validation, discovery, CIMD fetching). The MCP SDK verifies
nothing it did not need to; ChromaJev's verifier is ~40 lines over `jose`.

## 13. Deployment

* Multi-stage Dockerfile on `node:22-bookworm-slim`; production deps only;
  runs as `node` (entrypoint fixes `/data` ownership on fresh volumes, then
  drops privileges with `setpriv`). `EXPOSE 3000`, `HEALTHCHECK` → `/health`.
* All state under `DATA_DIR` (default `/data`) → one volume.
* `PUBLIC_BASE_URL` is authoritative for every absolute URL. `TRUST_PROXY`
  (default: private networks) controls Express's forwarded-header trust;
  the OAuth provider only sees headers Express has already validated.
* SIGTERM: stop accepting, drain, close SQLite (WAL checkpoint).
