# email.katr.es — Project Handoff

Last updated: 2026-06-23. Package version: v6.

## What this is
A password-gated web console at email.katr.es for sending email from any
`<local>@katr.es` address through Resend, with send-now or scheduled delivery
and a ledger of what has gone out. Built with Astro and deployed as a Cloudflare
Worker via Workers Builds (Git-connected, no terminal).

## History
- v1: single hand-written Cloudflare Worker (worker.js).
- v2: rebuilt as an Astro project on the Cloudflare adapter, same feature set.
- v3: deploy fixes for Workers Builds. Wrangler bumped to v4, the Worker name
  set to `email` to match the connected build project, and a postbuild step that
  writes `dist/.assetsignore` so the `_worker.js` directory is not rejected as a
  public asset.
- v4: the real EMAILS and SESSION KV namespace IDs are filled into
  wrangler.jsonc, so no manual id paste is needed.
- v5 (this package): interface and composer overhaul. Inter is the only font
  (Roboto Mono only on the lock screen). Eyebrows removed. The landing page is a
  blank black screen showing only red "you are not authorized."; typing the
  password and pressing Enter authenticates via a hidden input. The body is now
  a rich-text HTML editor (bold, italic, underline, strikethrough, font size,
  color, lists, link, inline image upload via CID, image by URL, clear, undo,
  redo), with file attachments and reusable signatures stored in KV. send.ts now
  sends html plus attachments; new endpoint /api/signatures (GET/POST/DELETE).
- v6 (this package): tab title is "emailer" and the favicon is an inline @ SVG
  (Layout.astro). Post-login palette changed to brick #8B3A2F accent on a #f2efe9
  background (only the :root vars changed; the lock screen stays black/red). The
  lock screen focus handling was hardened (autofocus plus refocus on
  pointer/click/touch/visibility) so typing always lands. Added an AI spellcheck
  button: new endpoint /api/proofread backed by Workers AI
  (@cf/meta/llama-3.1-8b-instruct), and the "ai" binding in wrangler.jsonc.

## Who it is for and working style
Owner is Rain (Studio Katresai). Conventions that carry across the work:
- Aesthetic: burnt orange #BF5700 as a functional accent, Fraunces (display),
  Figtree (UI and body), Space Mono (labels, timestamps, data). Minimal,
  editorial, generous whitespace, hairline rules.
- Prose: no em dashes anywhere. Answers stay factual, clean, and succinct.
  Forward momentum, minimal padding.
- Ask before assuming important things.
- Deploys through the GitHub web interface plus Cloudflare's dashboard. No
  terminal. Guidance must be dashboard-based, not CLI.
- Delivery: each iteration ships as one renamed zip (email-katres-vN.zip,
  incrementing N) that always includes this HANDOFF.md so a fresh chat can
  continue from it.

## Stack and verified versions
- Astro 5.18.2, @astrojs/cloudflare 12.6.13, wrangler 4.103.0, Node 22.
- `output: 'server'` (all routes on-demand). No UI framework; `.astro` pages
  plus a bundled vanilla client script.
- Pinned in package.json as astro ^5, @astrojs/cloudflare ^12, wrangler ^4. The
  adapter v13+ line targets Astro 6, so stay on ^12 unless you also move to
  Astro 6.

## Deploy (Workers Builds, no terminal)
1. Project files at the repo root (package.json at the top). If nested, set the
   build Root directory to that subfolder.
2. Create two KV namespaces in the dashboard (Storage & Databases > KV). Copy
   each Namespace ID (the hex string, not the title).
3. In wrangler.jsonc, replace PASTE_EMAILS_NAMESPACE_ID and
   PASTE_SESSION_NAMESPACE_ID with the two hex IDs. Commit.
4. Workers & Pages > Create application > Import a repository > pick the repo.
   Build command `npm run build`, deploy command `npx wrangler deploy`. Save and
   Deploy. Pushes to the production branch redeploy automatically.
5. Worker > Settings > Variables and Secrets: add RESEND_API_KEY as an encrypted
   secret. Optionally SITE_PASSWORD to change the password from `rain`.
6. Worker > Settings > Domains & Routes: add custom domain email.katr.es.

## Build gotchas already handled (history of failures)
- Pages vs Worker: the adapter only targets Workers. Pages will not deploy this.
- `_worker.js` rejected as a public asset: fixed by writing dist/.assetsignore.
  The committed public/.assetsignore kept getting dropped during web uploads, so
  scripts/postbuild.mjs now writes it during `npm run build`. Do not remove that
  script.
- Worker name mismatch: CI expected `email`; wrangler.jsonc now uses `email`. If
  the Worker is renamed, update the `name` field to match.
- Wrangler out-of-date warning: resolved by pinning wrangler ^4 (installs 4.x).
- KV id confusion: the wrangler.jsonc id must be the hex Namespace ID from the
  dashboard, not the namespace title.

## Interface and composer notes (v5)
- One font: Inter everywhere, loaded with Roboto Mono in Layout.astro. Roboto
  Mono is used only by the lock screen text (.auth-text).
- Lock screen (components/Login.astro): full black overlay, red Roboto Mono
  "you are not authorized.", and an invisible full-screen input that is kept
  focused. Enter posts to /api/login; success redirects to /app; failure shakes
  and clears. The password gate is unchanged (default `rain`, or SITE_PASSWORD).
- Rich text (components/Console.astro): a shared contenteditable engine drives
  both the message editor and the signature editor via document.execCommand and
  a saved-selection helper, so the one toolbar acts on whichever editor is
  focused. Font sizes are applied with execCommand fontSize and normalized to
  inline `font-size` px spans at send time. Links get target=_blank and rel.
- Inline images: uploads are stored in a JS array with a generated content_id,
  shown in the editor as data: URLs (data-cid), then rewritten to
  `src="cid:<id>"` and attached at send time. CID inline images are reliable in
  desktop clients but inconsistent in webmail (Gmail), so an Image-by-URL option
  exists for images that must render everywhere.
- Attachments: read to base64 in the browser, capped near 20 MB total, sent in
  the Resend `attachments` array. Inline images are the same array plus a
  content_id.
- Signatures: stored in the EMAILS KV namespace under the key `signatures`
  (no new binding). Endpoints in pages/api/signatures.ts (GET, POST, DELETE).

## Spellcheck (Workers AI), v6
- Binding: `"ai": { "binding": "AI" }` in wrangler.jsonc. No dashboard resource
  is required; Workers AI is account-level and billed per use. Typed in
  src/env.d.ts as a minimal `AI.run` interface.
- Endpoint: src/pages/api/proofread.ts. Takes `{ segments: string[] }`, calls
  `env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages, max_tokens, temperature:0 })`,
  parses the model's JSON array, and requires the returned length to match the
  input length or it refuses to apply (so text is never scrambled). Batches by
  character budget; caps total input.
- Client (Console.astro): walks the active editor's text nodes, sends the
  non-empty cores (preserving each node's leading/trailing whitespace), and
  writes corrected text back node by node. Because only text-node values change,
  bold/links/images/structure are untouched. This is the key to "fixes grammar,
  spelling, capitalization and nothing else."
- Local dev caveat: the AI binding runs in remote mode, so `wrangler dev` needs
  `wrangler login` (or CLOUDFLARE_API_TOKEN). This does not affect the dashboard
  Workers Builds deploy, where the binding just works.

## Architecture and key decisions
- Cloudflare adapter deploys to Workers. Build output is `dist/`, worker entry
  at `dist/_worker.js/index.js`, static assets via the ASSETS binding.
- Bindings are read through `locals.runtime.env` in API routes and
  `Astro.locals.runtime.env` in `.astro` frontmatter. Types in `src/env.d.ts`
  (the `Env` interface: EMAILS, RESEND_API_KEY, SITE_PASSWORD).
- Sending: direct Resend REST calls from the Worker. The key is server-side and
  the send route is behind the password, so the site is not an open relay.
- Scheduling: Resend native `scheduled_at` (ISO 8601), capped at 30 days. This
  replaced the originally discussed Cron plus D1 queue. Tradeoff: the 30-day
  ceiling. For longer horizons, add a Cron Trigger plus D1 that stores messages
  locally and fires when due.
- Ledger: Cloudflare KV, one `index` key holding the most recent 250 records.
- Auth: signed cookie (HMAC-SHA256 via Web Crypto, 7-day expiry) tied to the
  password, set and read with Astro's cookies API. Default password `rain`,
  overridable with the SITE_PASSWORD secret. Light personal gate.
- Routing: `/` shows login or redirects to `/app` when authed; `/app` shows the
  console or redirects to `/` when not. Splitting them keeps each page's client
  script isolated.

## The SESSION KV binding
The Astro Cloudflare adapter enables its own KV-backed session layer by default
and expects a `SESSION` KV binding, even though this app uses its own cookie
auth. Both EMAILS and SESSION are declared in wrangler.jsonc and must exist, or
the deploy fails with "Invalid binding `SESSION`".

## Resend API facts confirmed (June 2026)
- Send: `POST https://api.resend.com/emails`, header `Authorization: Bearer <key>`.
- Payload (snake_case): `from` ("Name <addr>"), `to` (string or array, max 50),
  `subject`, `html` or `text`, `cc`, `bcc`, `reply_to`, `scheduled_at`.
- Schedule window: up to 30 days (raised from 72 hours in April 2025).
- Cancel: `POST /emails/{id}/cancel`. Reschedule: `PATCH /emails/{id}` with
  `{ scheduled_at }`. Status: `GET /emails/{id}`, read `last_event`.
- The batch endpoint does NOT support `scheduled_at`.

## Endpoints
All `/api/*` except login and logout require the session cookie.
- GET `/`: login, or redirect to `/app` when signed in
- GET `/app`: console, or redirect to `/` when signed out
- POST `/api/login`: `{ password }` sets the cookie
- POST `/api/logout`: clears the cookie
- POST `/api/send`: send now, or schedule when `scheduledAt` is present
- GET `/api/ledger`: list sent and scheduled, refreshing past-due scheduled items
- POST `/api/cancel`: `{ id }` cancels a scheduled send
- POST `/api/reschedule`: `{ id, scheduledAt }` moves a scheduled send (no UI yet)

## Testing done
- `npm run build` succeeds and emits `dist/_worker.js/index.js`, the bundled CSS,
  inlined client scripts, and (via postbuild) `dist/.assetsignore`.
- Booted the built worker under local wrangler 4 (Miniflare): `/` returns 200
  with the login page; `/app` without a cookie returns 302 to `/`; `/api/ledger`
  without a cookie returns 401 JSON. Both KV bindings resolve.
- The send/schedule/cancel logic is a direct port of the v1 Worker, which passed
  a 20-case unit suite (auth, tamper rejection, send-now payload, scheduled
  payload, 30-day guard, validation, ledger, cancel).

## Open items and ideas
- The cancel path `POST /emails/{id}/cancel` is from Resend's docs and was not
  exercised live (needs the real key). First thing to check if a cancel errors.
- The reschedule endpoint exists but has no UI control yet.
- Inline (CID) images may not render in Gmail and other webmail. Use Image by
  URL, or add an image-hosting route later, if that becomes a problem.
- The password `rain` is the default fallback; set SITE_PASSWORD to override.
- Not built (out of scope): an external API-key endpoint other tools could POST
  to, a Cron plus D1 long-horizon queue, a reschedule UI, attachments (Resend
  supports them on single sends), and saved templates.

## How to resume in a new chat
Hand the new chat this HANDOFF.md plus the project files from the zip, and state
the next change you want. Keep the conventions above: zip delivery with an
incrementing version, no em dashes, dashboard-based deploy guidance (no
terminal), and ask before assuming.
