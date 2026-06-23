# email.katr.es — Project Handoff

Last updated: 2026-06-23. Package version: v2 (Astro rewrite).

## What this is
A password-gated web console at email.katr.es for sending email from any
`<local>@katr.es` address through Resend, with send-now or scheduled delivery
and a ledger of what has gone out. Built with Astro and deployed as a Cloudflare
Worker.

## History
- v1 was a single hand-written Cloudflare Worker (worker.js) with embedded
  HTML, CSS, and JS.
- v2 (this package) is the same app and feature set rebuilt as an Astro project
  on the Cloudflare adapter. The server logic is ported one-to-one into typed
  API routes; the UI is unchanged.

## Who it is for and working style
Owner is Rain (Studio Katresai). Conventions that carry across the work:
- Aesthetic: burnt orange #BF5700 as a functional accent, Fraunces (display),
  Figtree (UI and body), Space Mono (labels, timestamps, data). Minimal,
  editorial, generous whitespace, hairline rules.
- Prose: no em dashes anywhere. Answers stay factual, clean, and succinct.
  Forward momentum, minimal padding.
- Ask before assuming important things.
- Delivery: each iteration ships as one renamed zip (email-katres-vN.zip,
  incrementing N) that always includes this HANDOFF.md so a fresh chat can
  continue from it.

## Stack and verified versions
- Astro 5.18.2, @astrojs/cloudflare 12.6.13, wrangler 3.114 (dev), Node 22.
- `output: 'server'` (all routes on-demand). No UI framework; `.astro` pages
  plus a bundled vanilla client script.
- Pinned in package.json as astro ^5, @astrojs/cloudflare ^12. The adapter v13+
  line targets Astro 6, so stay on ^12 unless you also move to Astro 6.

## Architecture and key decisions
- Cloudflare adapter deploys to Workers (Pages support was removed from the
  adapter). Build output is `dist/`, with the worker entry at
  `dist/_worker.js/index.js` and static assets served via the ASSETS binding.
- Bindings are read through `locals.runtime.env` in API routes and
  `Astro.locals.runtime.env` in `.astro` frontmatter. Types are declared in
  `src/env.d.ts` (the `Env` interface: EMAILS, RESEND_API_KEY, SITE_PASSWORD).
- Sending: direct Resend REST calls from the Worker. The key is server-side and
  the send route is behind the password, so the site is not an open relay.
- Scheduling: Resend native `scheduled_at` (ISO 8601), capped at 30 days. This
  replaced the originally discussed Cron plus D1 queue. Rationale: no cron, no
  drift, no extra database. Tradeoff: the 30-day ceiling. For longer horizons,
  add a Cron Trigger plus D1 that stores messages locally and fires when due.
- Ledger: Cloudflare KV, one `index` key holding a JSON array of the most recent
  250 records.
- Auth: signed cookie (HMAC-SHA256 via Web Crypto, 7-day expiry) tied to the
  password, set and read with Astro's cookies API. Password defaults to `rain`,
  overridable with a SITE_PASSWORD secret. Light personal gate, not hardened
  multi-user auth.
- Routing: `/` shows login or redirects to `/app` when authed; `/app` shows the
  console or redirects to `/` when not. Splitting the two keeps each page's
  client script isolated.

## Important gotcha: the SESSION KV binding
The Astro Cloudflare adapter enables its own KV-backed session layer by default
and expects a `SESSION` KV binding, even though this app does not use Astro
Sessions (it uses the HMAC cookie above). Both `EMAILS` and `SESSION` are
declared in `wrangler.jsonc` and must be created at deploy time. Without
`SESSION`, the deploy can fail with "Invalid binding `SESSION`".

## Resend API facts confirmed (June 2026)
- Send: `POST https://api.resend.com/emails`, header `Authorization: Bearer <key>`.
- Payload (snake_case REST): `from` (use the "Name <addr>" form), `to` (string or
  array, max 50), `subject`, `html` or `text`, `cc`, `bcc`, `reply_to`,
  `scheduled_at`.
- Schedule window: up to 30 days (raised from 72 hours in April 2025).
- Cancel a scheduled send: `POST /emails/{id}/cancel`.
- Reschedule: `PATCH /emails/{id}` with `{ scheduled_at }`.
- Status: `GET /emails/{id}`, read `last_event`.
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

## Deploy
1. `npm install && wrangler login`
2. `wrangler kv namespace create EMAILS` and `wrangler kv namespace create SESSION`, paste both ids into wrangler.jsonc
3. `wrangler secret put RESEND_API_KEY`
4. Optional: `wrangler secret put SITE_PASSWORD`
5. `npm run deploy`  (runs astro build then wrangler deploy)
6. Add email.katr.es as a custom domain (dashboard, or a routes entry in wrangler.jsonc)

Local dev: `cp .dev.vars.example .dev.vars`, fill the key, then `npm run dev`.

## Testing done
- `npm run build` succeeds and emits `dist/_worker.js/index.js` plus the bundled
  CSS and inlined client scripts.
- Booted the built worker under local wrangler/Miniflare and confirmed: `/`
  returns 200 with the login page (markup, inline script, CSS link); `/app`
  without a cookie returns 302 to `/`; `/api/ledger` without a cookie returns 401
  JSON. Both KV bindings resolve locally.
- The send/schedule/cancel logic is a direct port of the v1 Worker, which passed
  a 20-case unit suite (auth, tamper rejection, send-now payload, scheduled
  payload, 30-day guard, validation, ledger, cancel).

## Open items and ideas
- The cancel path `POST /emails/{id}/cancel` is from Resend's docs and was not
  exercised live (needs the real key). First thing to check if a cancel errors.
- The reschedule endpoint exists but has no UI control yet.
- The password `rain` is the default fallback; set SITE_PASSWORD to override.
- Not built (out of scope): an external API-key endpoint other tools could POST
  to, a Cron plus D1 long-horizon queue, a reschedule UI, attachments (Resend
  supports them on single sends), and saved templates.

## How to resume in a new chat
Hand the new chat this HANDOFF.md plus the project files from the zip, and state
the next change you want. Keep the conventions above: zip delivery with an
incrementing version, no em dashes, and ask before assuming. Run `npm install`
to restore dependencies.
