# ChromaJev

**Coherent, accessible colour schemes from a word or phrase.** Type “autumn forest”, “trustworthy fintech” or “cyberpunk Belfast”; ChromaJev asks TypeSafe’s **Jev** for a structured semantic judgement, then deterministic colour mathematics turns that judgement into a paired **light and dark** theme, checks every important pairing against WCAG, and shows the result on real interface components.

> **Jev provides semantic judgement. Code provides colour mathematics.**
> One judgement produces coordinated light and dark themes. The component playground shows whether they work. The cache stops repeated judgement costing credits. Saved schemes become durable, user-owned assets — available in the web app, over a JSON API and to AI assistants via MCP.

One Node.js process, one SQLite file, one Docker image. Design notes and the research behind the choices are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Contents

1. [What ChromaJev is](#1-what-chromajev-is)
2. [Why Jev suits the task](#2-why-jev-suits-the-task)
3. [How semantic colour evaluation works](#3-how-semantic-colour-evaluation-works)
4. [How palette construction works](#4-how-palette-construction-works)
5. [Paired light/dark themes](#5-paired-lightdark-themes)
6. [Accessibility](#6-accessibility)
7. [Component playground](#7-component-playground)
8. [Semantic cache and Jev credit savings](#8-semantic-cache-and-jev-credit-savings)
9. [Saved colour schemes](#9-saved-colour-schemes) · [10. Ownership](#10-scheme-ownership)
11. [User accounts](#11-user-accounts) · [12. Public registration](#12-public-registration) · [13. Invitations](#13-invitations)
14. [Elastic Email](#14-elastic-email-setup)
15. [Storage and persistence](#15-storage-and-persistence)
16. [HTTP API](#16-http-api) · [17. API authentication](#17-api-authentication)
18. [MCP server](#18-mcp-server) · [19. MCP OAuth](#19-mcp-oauth)
20. [Optional perimeter Basic Auth](#20-optional-perimeter-basic-auth)
21. [Docker](#21-docker-deployment) · [22. Dokploy](#22-dokploy-deployment)
23. [Environment variables](#23-environment-variables) · [24. Persistent volumes](#24-persistent-volumes)
25. [Local development](#25-local-development) · [26. Testing](#26-testing)
27. [CSS / JSON / Tailwind exports](#27-css--json--tailwind-exports)

---

## 1. What ChromaJev is

* an **interactive generator**: concept in → paired light/dark colour system out, with “Another interpretation”, optional colour locks, and **Run again** on cached results (asks Jev afresh and replaces the shared cached judgement; confirmed first, and limited to 10 per user per hour);
* a **library** of named, saved schemes (`/schemes/dynumo`), each holding both modes;
* a **component playground** with typography, buttons (normal/hover/focus/disabled), forms, cards, navigation, alerts, badges, tables, pagination, a modal and a menu — plus dashboard, landing page, documentation and mobile scenes;
* a **JSON HTTP API** (with OpenAPI) and a **remote MCP server** with OAuth;
* a small **multi-user app**: accounts, admin role, invitations, optional public sign-up with email verification, password reset;
* a public **changelog** (`/changelog`, linked from the footer) that admins write in **Admin → Changelog** (post, edit, delete; plain text, escaped).

## 2. Why Jev suits the task

Jev is a *decision* model: given `state` and typed questions it returns calibrated probabilities over bounded options — it does not write text or invent values. That is exactly what colour *direction* needs (“does Teal belong with ‘calm healthcare’?”, “how warm should it feel?”), while everything numeric (contrast ratios, lightness, gamut) is something code does exactly. TypeSafe’s own guidance for jev‑1.13 says it judges **colour names far better than hex values** and that maths belongs in code, so ChromaJev never shows Jev a hex code and never asks it to compute anything.

### Jev providers: TypeSafe direct or Cloudflare AI Gateway

Jev can be reached two ways; both send the same question set and return the same answers, so the cache, palettes, API and MCP behave identically (cached judgements are shared between them).

| | TypeSafe API (default) | Cloudflare AI Gateway |
| --- | --- | --- |
| Endpoint | `POST https://api.typesafe.ai/v1/systemone` (official SDK) | `POST https://api.cloudflare.com/client/v4/accounts/{account}/ai/run` with `model: "typesafe/jev"` |
| Credentials | `TYPESAFE_API_KEY` | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` |
| Billing | TypeSafe account | Cloudflare [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/) credits (pass-through price plus Cloudflare’s credit fee) |
| Extras | pin a version with `JEV_MODEL` | gateway logging, analytics, rate limiting and guardrails; Jev is listed by Cloudflare as zero data retention |

To use Cloudflare:

1. In the Cloudflare dashboard, open **AI › AI Gateway** and load credits (**Credits Available › Manage**). Optionally create a gateway (e.g. `chromajev`).
2. Create an API token with **Account › Workers AI › Read** (an AI Gateway-only permission returns 401).
3. Set `JEV_PROVIDER=cloudflare`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and optionally `CLOUDFLARE_AI_GATEWAY_ID` (sent as the `cf-aig-gateway-id` header; otherwise the default gateway is used).

ChromaJev retries 408/429/5xx with backoff (honouring `Retry-After`) and reports authentication, credit (402) and bad-account (404) problems clearly. The active route is shown under **Admin › Semantic cache**. Note that `JEV_MODEL` version pinning applies only to the TypeSafe route; Cloudflare serves its current `typesafe/jev`, and the versioned model that actually answered (e.g. `jev-1.13.0`) is still recorded with every cached judgement.

## 3. How semantic colour evaluation works

ChromaJev keeps a bounded **catalogue of 81 named colours** (`src/colour/catalogue.ts`): six-ish tones in each of ten hue families (red, orange, yellow, green, teal, cyan, blue, purple, pink, brown) plus warm greys, cool greys, neutral greys, near-blacks and near-whites. Each has a stable ID (`teal-deep`), a name (“Deep teal”), a hex value, its family, a one-line descriptor for Jev, and OKLCH coordinates computed at start-up.

For a new concept ChromaJev sends **one** request to `POST https://api.typesafe.ai/v1/systemone` with `state = {"concept": "…"}` and ~95 independent questions (question set `qs-3`, `src/jev/questions.ts`):

| Question | Type | Used for |
| --- | --- | --- |
| `colour_affinity` | choice over all 81 colours | relative evidence: which colour belongs *most* |
| `fit__<id>` ×81 | noul | absolute evidence: does *this* colour belong at all |
| `dominant_family` | choice (11 families) | weighting candidates by family |
| `accent_family` | choice | the small vivid highlight colour |
| `neutral_base` | choice: warm / cool / pure / tinted | greys and surfaces |
| `dark_surface` | choice: black / warm / cool / primary / secondary (optional) | dark-mode page background |
| `character` | choice: organic, technical, playful, formal, luxurious… | shown in the Jev view |
| `temperature`, `saturation`, `energy`, `contrast`, `lightness` | score (5 levels each) | chroma scale, accent vividness, surface spacing, recommended mode |
| `monochrome` | noul | permits an intentionally single-hue palette |

The full probability distributions are kept — not just the winners — and the concept text only ever appears in `state`, never inside question instructions. Answers are validated (`src/jev/answers.ts`); a malformed response is an error, not a guess (the one exception is the optional `dark_surface` answer, which older cached evaluations lack and which then falls back to a heuristic).

## 4. How palette construction works

`src/palette/` — pure, deterministic functions (same answers → same scheme):

1. **Interpret**: each colour scores `(0.55 × noul + 0.45 × choice/maxChoice) × (0.6 + P(family dominates))`.
2. **Select roles**: primary = strongest chromatic candidate (a neutral may lead only when Jev clearly prefers it, e.g. brutalism → concrete); secondary = strongest candidate ≥35° of hue away; accent = strongest vivid candidate weighted by `accent_family`, separated from both. Combinations are ranked and *diversified* (each alternative differs in ≥2 roles) — that ranked list is what “Another interpretation” walks through.
3. **Derive** neutrals (hue/chroma from `neutral_base` and `temperature`), then build each mode in **OKLCH** with gamut mapping by chroma reduction at constant lightness and hue.
4. **Enforce contrast** (below) and record every adjustment.

## 5. Paired light/dark themes

Every scheme has `light` and `dark`, built from the **same** semantic selection — no second Jev call. Dark mode is designed, not inverted: a dark background (L≈0.15–0.21, never pure black) whose colour is chosen by Jev's `dark_surface` answer — near-black, warm brown, cool slate, or a deep shade of the primary or secondary colour (so “Ruby City” gets oxblood rather than brown); evaluations cached before that question existed fall back to a heuristic over the older answers, a surface ladder (surface +0.035, elevated +0.075), brand colours lifted to L≈0.66–0.82 with ~12 % less chroma to avoid glare, and foregrounds chosen afresh. Status colours keep canonical hues (success ≈150°, warning ≈78°, error ≈27°, info ≈245°, nudged ≤6° toward the brand) so they stay recognisable in both modes.

Each mode has 37 tokens: `background, surface, surfaceElevated, muted, text, textMuted, border, input, focusRing, link, primary, primaryForeground, primaryHover, primarySoft, primarySoftForeground, secondary, secondaryForeground, secondaryHover, accent, accentForeground, accentHover`, and for each of `success | warning | error | info`: the solid colour, its foreground, a soft background and soft-foreground text.

## 6. Accessibility

Built into construction, not bolted on:

* Solid fills (buttons, badges) search for the **smallest lightness change at the same hue** where a tinted near-white or near-black label reaches **4.5:1** and the fill separates from the page.
* Text tokens are pushed until they pass on *every* surface they can sit on (body text aims for 7:1).
* Input borders and focus rings meet **3:1** non-text contrast against surface and background.
* Every mode carries a report of 34 checks — body/muted text on each surface, links, button labels (normal + hover), soft-primary text, form fields, field borders, focus rings, and each status’s badge, alert and inline text — with the real ratio, the requirement and the level. A check is marked passing **only** if its unrounded ratio meets the threshold.
* `adjustments` records, per mode, the semantic original, the final production colour, whether it changed and why. The UI flags adjusted swatches with “◐ adjusted”.

## 7. Component playground

`src/web/views/playground.ts` + `public/assets/playground.css`. Every rule uses only the scheme’s CSS custom properties (a test fails if a literal colour sneaks into the stylesheet). The theme is applied as `.pg-root[data-mode="light|dark"] { --primary: … }`, so switching mode is a single attribute change. Scenes: **Components**, **SaaS dashboard**, **Landing page**, **Documentation**, **Mobile app** — switchable while keeping the current mode.

## 8. Semantic cache and Jev credit savings

Table `jev_evaluations` stores the *structured Jev answers* (not the palette), keyed by `(normalised_query, catalogue_version, question_set_version)`. Normalisation is deliberately conservative — Unicode NFKC, trim, collapse whitespace, lower-case — so `browser`, `Browser` and `  BROWSER ` share an entry while `brutalist`/`brutalism` do not. Stored with each entry: original and normalised query, raw answers with probabilities, the versioned model ID Jev reported (e.g. `jev-1.13.0`), token usage, versions, created/last-requested times, request and hit counts.

* **Run again** (`refresh: true` on `POST /api/schemes/generate`) re-asks Jev and overwrites the entry in place — same ID, so saved-scheme provenance and hit counters survive; a failed refresh leaves the old judgement intact.
* Hits make **zero** Jev calls; light, dark, alternatives and locks are all derived from the cached answers.
* Concurrent misses for the same concept share one in-flight request.
* Only validated, successful responses are stored.
* Changing the catalogue or question set bumps `CATALOGUE_VERSION` / `QUESTION_SET_VERSION`, so old entries stop matching (admins can purge them).
* The cache is global (an optimisation) but never listed: users only see their own recent concepts. The UI badges each result “Fresh Jev judgement” or “From cache”, and the API returns `cache.fromCache`.

## 9. Saved colour schemes

Generations are temporary (7 days, table `generated_schemes`); saving copies the **final values** into `schemes`: name, slug, concept, `light`, `dark`, semantic colours, accessibility reports, adjustments, provenance (evaluation ID, generation ID, variation), notes, `algorithm_version`, timestamps. Because values — not instructions — are stored, a later algorithm change can never alter a saved scheme. Users can save, rename (the slug follows), edit notes, duplicate, delete, export and copy individual colours, and switch modes on the scheme page. URLs are stable: `/schemes/dynumo`; collisions become `dynumo-2`, `dynumo-3`.

## 10. Scheme ownership

Schemes belong to their creator. Every query is scoped by `owner_id` — web, API and MCP alike — and another user’s scheme behaves exactly like a missing one (404). Administrators can open any scheme read-only via `/schemes/id/{id}`; API and MCP access is always own-schemes-only. There is no public sharing yet; it would be modelled explicitly.

## 11. User accounts

Roles `admin` and `user`; statuses `active` and `disabled`. Passwords are hashed with **Argon2id** (OWASP parameters, `@node-rs/argon2`). Sessions are random 256-bit tokens in an HttpOnly, SameSite=Lax cookie (`__Host-` prefixed over HTTPS), stored hashed. Forms are protected by a synchroniser CSRF token plus an Origin/Sec-Fetch-Site check; login is rate-limited.

**Bootstrap**: when the database has **no accounts**, `ADMIN_EMAIL` + `ADMIN_PASSWORD` create a verified admin. With any account present they are ignored, so restarts never overwrite anything. After that, manage people in **Admin**: view users (email, role, created, verified, last sign-in), disable/re-enable (which also ends their sessions and revokes their OAuth grants), promote/demote. The last active administrator can be neither disabled nor demoted.

## 12. Public registration

A database setting, toggled in **Admin → Registration** (default: disabled). Enabled: visitors can sign up and must confirm their address (48-hour single-use link) before they can sign in; sign-up responds identically whether or not the address is already registered. Disabled: `/signup` is closed and only invitations create accounts.

## 13. Invitations

Admins invite by email (optionally as admin). ChromaJev creates a 256-bit random token, stores only its SHA-256, and emails a link that expires in 7 days and works once. Accepting sets a password and marks the email verified (following the link proves control of that exact address). Admins see who invited whom, created/expiry dates, send count, last delivery error and status (pending / accepted / expired / revoked), and can **resend** (rotates the token — old links die) or **revoke**. Inviting an address that already has an account is refused with a clear message; inviting someone with a pending invitation re-sends it rather than duplicating.

## 14. Elastic Email setup

Mail goes through `src/mail/mailer.ts` (a small `MailTransport` interface). The production transport calls Elastic Email’s REST API v4 `POST /v4/emails/transactional` with the `X-ElasticEmail-ApiKey` header, sending HTML and plain-text bodies (tracking off).

1. In Elastic Email, verify your sending domain (SPF/DKIM).
2. Create an API key with the **SendHttp** permission.
3. Set `ELASTIC_EMAIL_API_KEY`, `MAIL_FROM_ADDRESS` (on the verified domain) and optionally `MAIL_FROM_NAME`.

Templates: invitation, email verification, password reset — consistent, lightweight HTML with plain-text fallbacks; no passwords or reusable secrets are ever emailed.

Development: without a key, `MAIL_TRANSPORT` defaults to `log`, printing messages and links to the console. In production `log` is refused at start-up, and a missing key yields an explicit “email not configured” error on send (plus a banner in Admin) — never a silent fallback. Tests use an in-memory transport.

## 15. Storage and persistence

One SQLite database, `$DATA_DIR/chromajev.sqlite` (WAL mode, foreign keys on, checkpointed on shutdown). Conceptually separate tables: `jev_evaluations` (cache), `generated_schemes` (temporary), `schemes` (saved), `users`, `sessions`, `email_tokens`, `invitations`, `api_keys`, `settings`, `oauth_models` (authorisation-server state), `app_secrets` (generated OAuth signing keys and cookie secrets). Migrations are ordered SQL applied automatically at start-up inside transactions (`src/db/migrations.ts`) — no manual steps after a deploy. No Redis or Postgres is needed.

## 16. HTTP API

Base URL `${PUBLIC_BASE_URL}/api`. OpenAPI 3.1: `GET /api/openapi.json`; human docs at `/docs/api`.

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| POST | `/api/schemes/generate` | `schemes:generate` | `{"concept": "browser", "variation": 0, "locks": {"primary": "blue-cobalt"}}` |
| GET | `/api/generations/{id}` | `schemes:read` | a recent generation |
| GET | `/api/schemes?limit=&offset=` | `schemes:read` | your schemes (summaries with preview colours) |
| POST | `/api/schemes` | `schemes:write` | `{"name": "Dynumo", "generationId": "…", "notes": "…"}` |
| GET | `/api/schemes/{idOrSlug}` | `schemes:read` | full paired scheme |
| PATCH | `/api/schemes/{idOrSlug}` | `schemes:write` | rename / notes |
| POST | `/api/schemes/{idOrSlug}/duplicate` | `schemes:write` | |
| DELETE | `/api/schemes/{idOrSlug}` | `schemes:write` | |
| GET | `/api/schemes/{idOrSlug}/export?format=css\|json\|tailwind\|tailwind-v3` | `schemes:read` | |

```bash
curl -s -X POST "$BASE/api/schemes/generate" \
  -H "Authorization: Bearer $CHROMAJEV_API_KEY" -H "Content-Type: application/json" \
  -d '{"concept": "autumn forest"}'
```

Response (abridged; values illustrative):

```json
{
  "generationId": "6f1c…", "concept": "autumn forest", "variation": 0, "alternativesAvailable": 12,
  "recommendedMode": "light",
  "semantic": { "primary": { "id": "green-leaf", "name": "Leaf green", "fit": 0.91, "affinity": 0.07 }, "…": "…" },
  "light": { "primary": "#4da350", "primaryForeground": "#091509", "background": "#fef9f1", "surface": "#fffdfb", "text": "#180e02", "…": "…" },
  "dark":  { "primary": "#61aa62", "primaryForeground": "#091509", "background": "#160f05", "surface": "#1e1710", "text": "#f9f2e8", "…": "…" },
  "accessibility": { "light": { "allPass": true, "passed": 34, "failed": 0, "checks": [ { "id": "text-background", "ratio": 17.9, "required": 4.5, "level": "AAA", "passes": true } ] }, "dark": { "…": "…" } },
  "adjustments": { "light": { "primary": { "original": "#4caf50", "final": "#4da350", "adjusted": true, "reason": "…" } } },
  "judgement": { "topColours": [ "…" ], "temperature": { "label": "Warm…", "normalised": 0.71 } },
  "cache": { "fromCache": false, "source": "jev", "model": "jev-1.13.0", "catalogueVersion": "cat-2", "questionSetVersion": "qs-3" }
}
```

Errors are `{"error": {"code": "…", "message": "…"}}`: `400 invalid_concept`, `401`, `403 insufficient_scope`, `404 not_found`, `429 jev_rate_limited`, `502 jev_unavailable | jev_malformed_response`, `503 jev_not_configured`, `504 jev_timeout`.

## 17. API authentication

Personal API keys instead of one shared key: each user creates keys on **Account → API keys**, choosing scopes (`schemes:read`, `schemes:generate`, `schemes:write`). Keys look like `cj_…`, are shown once, stored hashed, act as their owner (so ownership checks hold) and stop working if revoked or the owner is disabled. Send `Authorization: Bearer cj_…`. The web UI itself calls the same API with its session cookie plus CSRF header.

Four separate mechanisms, never conflated: optional perimeter **Basic Auth** (browser gate), **web sessions**, **API keys** (`/api`), **OAuth bearer tokens** (`/mcp`).

## 18. MCP server

Endpoint: **`${PUBLIC_BASE_URL}/mcp`** — Streamable HTTP via the official TypeScript SDK v2 (`@modelcontextprotocol/server`), serving both the 2026‑07‑28 protocol and 2025-era clients statelessly. Tools:

| Tool | Scope | |
| --- | --- | --- |
| `generate_colour_scheme` | `schemes:generate` | concept, optional `variation`, `lock_primary`; returns both modes, accessibility, cache info and a `generation_id` |
| `list_colour_schemes` | `schemes:read` | paginated |
| `get_colour_scheme` | `schemes:read` | by `id`, `slug` or unambiguous `name` |
| `save_colour_scheme` | `schemes:write` | by `generation_id` (no colour re-sending) or `concept` |
| `rename_colour_scheme` | `schemes:write` | |
| `delete_colour_scheme` | `schemes:write` | annotated `destructiveHint: true` |

Saved schemes are also read-only **resources**: `chromajev://schemes/{slug}` (listable). Tool results carry readable text and `structuredContent` with the same JSON as the HTTP API.

Connecting: in Claude (Settings → Connectors → *Add custom connector*), ChatGPT (developer-mode connectors) or any MCP client, add the URL above. The client opens ChromaJev, you sign in with your normal account and approve the requested access.

## 19. MCP OAuth

ChromaJev is both the **resource server** (`/mcp`) and — as a separate component — a small **authorisation server**, as the MCP spec allows:

* **Authorisation server**: [`oidc-provider`](https://github.com/panva/node-oidc-provider) (OpenID-certified), issuer = `PUBLIC_BASE_URL`. ChromaJev supplies only persistence (SQLite adapter), account lookup and the login/consent pages through the library’s *interaction* API — **your normal ChromaJev account is the identity**, the client never sees your password, and no OAuth protocol code is hand-written. Enabled: authorisation code + **PKCE (S256, required)**, `response_type=code` only, **RFC 8707 resource indicators** issuing **JWT access tokens with `aud` = the MCP URL** (1 h), rotating refresh tokens, **Client ID Metadata Documents** and **Dynamic Client Registration** (for current clients), **RFC 9207 `iss`** in authorisation responses, revocation.
* **Discovery**: `/.well-known/oauth-protected-resource/mcp` (RFC 9728) → `authorization_servers`; `/.well-known/oauth-authorization-server` (RFC 8414) and `/.well-known/openid-configuration`. Endpoints live under `/oauth/*`.
* **Resource server**: the SDK’s `requireBearerAuth` with a verifier that checks signature, issuer, audience, `typ: at+jwt`, expiry, and that the user still exists and is active. Missing/invalid/expired tokens → `401` with `WWW-Authenticate: Bearer … resource_metadata="…"`; missing scope → `403 insufficient_scope` naming the needed scope (step-up).
* Disabled accounts cannot sign in or consent; their existing tokens are rejected and their grants/refresh tokens deleted. Users can disconnect apps under **Account → Connected AI apps**.
* Signing keys and cookie secrets are generated on first start and stored in the database, so they survive redeploys. HTTPS is required in production (`PUBLIC_BASE_URL` must be `https://`).

## 20. Optional perimeter Basic Auth

Set **both** `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` to put a browser Basic Auth prompt in front of the web UI (including the OAuth login pages). Neither → off. Only one → the app refuses to start with a clear error. Because an HTTP request has one `Authorization` header, endpoints that need their own credentials are exempt: `/health`, `/api/*`, `/mcp`, `/.well-known/*` and the OAuth token/registration/JWKS/revocation endpoints. It is an extra fence, not the account system.

## 21. Docker deployment

```bash
docker build -t chromajev .
docker run -d --name chromajev \
  -p 3000:3000 \
  --env-file .env \
  -v chromajev-data:/data \
  chromajev
```

The image is a two-stage build on `node:22-bookworm-slim`; the final stage has production dependencies and compiled output only, listens on **port 3000**, runs as the unprivileged `node` user (the entrypoint fixes ownership of a freshly mounted `/data` and drops privileges with `setpriv`), has a `HEALTHCHECK` on `/health`, and shuts down cleanly on `SIGTERM`. Compose is not required; a minimal example if you like it:

```yaml
services:
  chromajev:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    volumes: ["chromajev-data:/data"]
volumes:
  chromajev-data:
```

## 22. Dokploy deployment

1. **Create an Application** from this Git repository; **Build type: Dockerfile** (path `Dockerfile`).
2. **Port**: the container listens on `3000`.
3. **Domains**: add your domain, container port `3000`.
4. **Environment**: add the variables below (at least `PUBLIC_BASE_URL`, `TYPESAFE_API_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ELASTIC_EMAIL_API_KEY`, `MAIL_FROM_ADDRESS`). No `.env` file is needed.
5. **Volumes / Mounts**: add a volume mounted at **`/data`**.
6. **HTTPS**: enable it on the domain (Let’s Encrypt) — Traefik terminates TLS.
7. Set **`PUBLIC_BASE_URL`** to the final `https://` URL exactly (no trailing slash).
8. Redeploy. OAuth/MCP metadata, redirects and email links all derive from `PUBLIC_BASE_URL`, so MCP clients use `https://your-domain/mcp`.

Behind Traefik, Express trusts `X-Forwarded-*` only from loopback/private networks (`TRUST_PROXY`), so secure cookies and protocol detection work while spoofed headers from the internet are ignored. No Dokploy-specific code exists; any Docker host works the same way.

## 23. Environment variables

See [`.env.example`](.env.example) for comments.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `http://localhost:3000` (required in production) | Authoritative external URL; https in production |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listener |
| `NODE_ENV` | `development` (`production` in image) | |
| `DATA_DIR` | `/data` in production, `./data` otherwise | Persistent data |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Forwarded-header trust |
| `TYPESAFE_API_KEY` | — | Jev API key (server-side only) |
| `JEV_MODEL` | `jev-latest` | Or a pinned version, e.g. `jev-1.13.0` |
| `JEV_TIMEOUT_MS` | `20000` | Per attempt (SDK retries 429/5xx with backoff) |
| `TYPESAFE_BASE_URL` | SDK default | Override API host |
| `JEV_PROVIDER` | `typesafe`, or `cloudflare` if only Cloudflare credentials are set | Which route Jev requests take |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | — | Cloudflare route (token: Account › Workers AI › Read) |
| `CLOUDFLARE_AI_GATEWAY_ID` | account default gateway | Named AI Gateway to route through |
| `CLOUDFLARE_JEV_MODEL` | `typesafe/jev` | Cloudflare catalogue ID |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | — | First-run admin only |
| `MAIL_TRANSPORT` | `elastic` if key set; else `log` (dev) / `none` (prod) | |
| `ELASTIC_EMAIL_API_KEY`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` | —, —, `ChromaJev` | Email |
| `BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD` | — | Optional perimeter (both or neither) |
| `OAUTH_ACCESS_TOKEN_TTL` | `3600` | Seconds |
| `OAUTH_REFRESH_TOKEN_TTL` | `2592000` | Seconds |
| `OAUTH_DYNAMIC_REGISTRATION` | `true` | Allow RFC 7591 DCR |
| `OAUTH_CLIENT_ID_METADATA_DOCUMENTS` | `true` | Allow CIMD clients |

## 24. Persistent volumes

Everything durable is under **`/data`** (one file: `chromajev.sqlite`, plus transient `-wal`/`-shm` files while running): cached Jev judgements, saved schemes, users, sessions, invitations, settings, OAuth clients/grants/refresh tokens and the OAuth signing keys. Mount a volume there and redeploys lose nothing. Back up by copying the file while stopped, or online with `sqlite3 /data/chromajev.sqlite ".backup /backup/chromajev.sqlite"`. If the volume is lost, signing keys regenerate and connected MCP clients simply re-authorise.

## 25. Local development

```bash
npm install
cp .env.example .env     # add TYPESAFE_API_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
npm run dev              # http://localhost:3000, restarts on change; emails print to the console
```

`npm run dev:demo` starts an **offline demo** on port 3111 with a deterministic *fake* Jev (keyword-based stand-in answers, no credits; log in as `demo@example.com` / `demo password 1`) — handy for UI work, never for real palettes. `npm run build && npm start` runs the production build. Requires Node 22+.

Code map: `src/colour` (OKLCH, contrast, catalogue) · `src/jev` (questions, client, validation, cache) · `src/palette` (interpretation, roles, modes, accessibility, exports) · `src/schemes` (the shared service) · `src/accounts`, `src/mail` · `src/web` (pages, middleware) · `src/api` · `src/oauth` · `src/mcp` · `src/client` (browser bundle).

## 26. Testing

```bash
npm test          # vitest — 129 tests
npm run typecheck
```

No test spends Jev credits or sends email: Jev is replaced by a deterministic fake and mail by an in-memory transport. Coverage includes colour conversion and contrast, palette roles, light/dark construction and cross-mode consistency, determinism, accessibility reporting honesty, alternatives and locks; cache hits/misses, normalisation, concurrency, failure handling and version invalidation; saved-scheme CRUD, slug collisions, ownership and stability; playground token usage; accounts, bootstrap, roles, last-admin protection, registration, verification, invitations (expiry, revocation, resend, reuse), password reset and anti-enumeration; Elastic Email requests and production mail rules; the Cloudflare AI Gateway route (request envelope, both response shapes, retries, error mapping, configuration); the HTTP API, scopes and CSRF; Basic Auth; and a full **OAuth + MCP** round trip (discovery, DCR, PKCE authorisation through the real login and consent pages, token exchange, tool and resource calls, 401/403 challenges, bad/expired/wrong-audience tokens, refresh, and disabled-account revocation).

## 27. CSS / JSON / Tailwind exports

From the scheme page (copy or download), `/schemes/{slug}/export.{css|json|tailwind|tailwind-v3}`, or the API.

**CSS variables** — light on `:root`, dark on `[data-theme="dark"]`, plus an opt-in `prefers-color-scheme` block:

```css
:root, [data-theme="light"] { color-scheme: light; --background: #fef9f1; --primary: #4da350; --primary-foreground: #091509; … }
[data-theme="dark"]         { color-scheme: dark;  --background: #160f05; --primary: #61aa62; … }
```

**JSON** — `{ "name", "concept", "light": { "primary": "#…", … }, "dark": { … } }`.

**Tailwind v4** — the variables above, `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))` and `@theme inline { --color-primary: var(--primary); … }`, so `bg-primary text-primary-foreground` switch with the theme. A **Tailwind v3** `tailwind.config.js` (`theme.extend.colors` pointing at the variables) is also available.

---

ChromaJev uses TypeSafe’s Jev via the official `@typesafe-ai/sdk`. Licence: MIT.
