# email.katr.es — Project Handoff

Last updated: 2026-06-23. Package version: v1.

## What this is
A password-gated web console at email.katr.es for sending email from any
`<local>@katr.es` address through Resend, with send-now or scheduled delivery
and a ledger of what has gone out. Built as a single Cloudflare Worker.

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

## Architecture and key decisions
- Cloudflare Worker, single file (worker.js). The HTML, CSS, and client JS are
  embedded as template literals. The inner client JS deliberately avoids
  backticks and the dollar-brace sequence so the outer template literal stays
  valid; only the CSS block is interpolated, via a single STYLE placeholder.
- Sending: direct calls to the Resend REST API from the Worker. The API key is
  server-side and the send route is behind the password, so the site is not an
  open relay.
- Scheduling: Resend native `scheduled_at` (ISO 8601), capped at 30 days out.
  This replaced the originally discussed Cloudflare Cron plus D1 queue.
  Rationale: no cron to run, no drift, no extra database. Tradeoff: the 30-day
  ceiling. If a longer horizon or fully self-hosted control is needed, add a
  Cron Trigger plus D1 that stores messages locally and fires them when due.
- Ledger: Cloudflare KV, one `index` key holding a JSON array of the most recent
  250 records. Matches Rain's existing KV pattern (storage.katr.es, txt.katr.es).
- Auth: signed cookie (HMAC-SHA256 via Web Crypto, 7-day expiry) tied to the
  password. Password defaults to `rain`, overridable with a SITE_PASSWORD
  secret. This is a light personal gate, not hardened multi-user auth.

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

## Files in this package
- worker.js: the entire app (server logic plus the login page and console page).
- wrangler.toml: Worker name, KV binding, commented custom-domain route.
- README.md: deploy steps, behavior notes, endpoint reference.
- HANDOFF.md: this document.

## Endpoints
All `/api/*` except login and logout require the session cookie.
- GET `/`: login page, or the console when signed in
- POST `/api/login`: `{ password }` sets the cookie
- POST `/api/logout`: clears the cookie
- POST `/api/send`: send now, or schedule when `scheduledAt` is present
- GET `/api/ledger`: list sent and scheduled, refreshing past-due scheduled items
- POST `/api/cancel`: `{ id }` cancels a scheduled send
- POST `/api/reschedule`: `{ id, scheduledAt }` moves a scheduled send (no UI yet)

## Deploy
1. `npm i -g wrangler && wrangler login`
2. `wrangler secret put RESEND_API_KEY`
3. `wrangler kv namespace create EMAILS`, paste the id into wrangler.toml
4. `wrangler deploy`
5. Add email.katr.es as a custom domain (uncomment the routes block in
   wrangler.toml, or use the dashboard under Workers & Pages > email-katres >
   Settings > Domains & Routes)
6. Optional: `wrangler secret put SITE_PASSWORD` to change the password

## Testing done
Validated in Node 22 with a mocked KV and a stubbed Resend fetch. 20 cases pass:
unauth serves login, wrong password returns 401, correct password sets the
cookie, authed serves the console, the send route rejects without a cookie,
send-now builds the right payload (from, array recipients, text vs html), a
scheduled send sets `scheduled_at` and a named From, a schedule beyond 30 days
is rejected, a missing recipient is rejected, the ledger lists items, cancel
marks the record cancelled, logout clears the cookie, and a tampered cookie is
rejected.

## Open items and ideas
- The cancel path `POST /emails/{id}/cancel` is taken from Resend's docs and was
  not exercised live (needs the real key). First thing to check if a cancel
  ever errors.
- The reschedule endpoint exists but has no UI control yet.
- The password `rain` is a fallback constant in worker.js; set SITE_PASSWORD to
  avoid keeping it in source.
- Not built (out of scope for v1): an external API-key endpoint other tools
  could POST to, a Cron plus D1 long-horizon queue, a reschedule UI, attachments
  (Resend supports them on single sends), and saved templates.

## How to resume in a new chat
Hand the new chat this HANDOFF.md plus the other files from the zip, and state
the next change you want. Keep the conventions above: zip delivery with an
incrementing version, no em dashes, and ask before assuming.
