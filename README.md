# email.katr.es (Astro)

A password-gated console for sending email from any `<local>@katr.es` address
through Resend, with send-now or scheduled delivery and a ledger of what has
gone out. Built with Astro and the Cloudflare adapter, deployed as a Cloudflare
Worker. The Resend key and all sending stay server-side.

## Requirements

Node 18.17+ or 20+, and a Cloudflare account with `katr.es` on it. The sending
domain must be verified in Resend (it is).

## Local development

1. Install dependencies.
   ```
   npm install
   ```
2. Add local secrets. Copy the example and fill in your Resend key.
   ```
   cp .dev.vars.example .dev.vars
   ```
   Edit `.dev.vars`: set `RESEND_API_KEY`, and optionally `SITE_PASSWORD`.
3. Run the dev server. KV is simulated locally by Miniflare, so the ledger
   persists in local state under `.wrangler/`.
   ```
   npm run dev
   ```
   For a production-like run on Cloudflare's workerd runtime: `npm run preview`.

## Deploy

1. Sign in.
   ```
   npm install
   wrangler login
   ```
2. Create the two KV namespaces, then paste each returned id into
   `wrangler.jsonc` under `kv_namespaces`.
   ```
   wrangler kv namespace create EMAILS
   wrangler kv namespace create SESSION
   ```
   `EMAILS` holds the ledger. `SESSION` is required by the Astro Cloudflare
   adapter's session layer even though this app uses its own cookie auth.
3. Add the Resend key as a secret.
   ```
   wrangler secret put RESEND_API_KEY
   ```
4. Optional: change the password from the default `rain`.
   ```
   wrangler secret put SITE_PASSWORD
   ```
5. Build and deploy.
   ```
   npm run deploy
   ```
6. Point the domain at it. Add `email.katr.es` as a custom domain in the
   dashboard (Workers & Pages > email-katres > Settings > Domains & Routes), or
   add a route to `wrangler.jsonc` and redeploy:
   ```jsonc
   "routes": [{ "pattern": "email.katr.es", "custom_domain": true }]
   ```

## How it works

- Sending calls the Resend REST API from the Worker. The key is server-side and
  every `/api/*` route except login and logout checks the session cookie, so the
  site is not an open relay.
- From is any local part you type, locked to `@katr.es`. An optional display
  name produces `Name <local@katr.es>`.
- Scheduling uses Resend's native `scheduled_at`, capped at 30 days out. Resend
  holds and delivers the message, so there is no cron to run. Scheduled sends
  can be cancelled from the ledger.
- The ledger lives in KV under a single `index` key (most recent 250 records).
  Loading it refreshes any past-due scheduled items against Resend.
- Auth is a signed cookie (HMAC-SHA256, 7-day expiry) tied to the password. It
  is a light gate for a personal tool, not hardened multi-user auth.

## Project structure

```
email-katres/
  astro.config.mjs        Astro + Cloudflare adapter (output: server)
  wrangler.jsonc          Worker name, KV bindings, assets, compatibility
  tsconfig.json
  .dev.vars.example       Template for local secrets (copy to .dev.vars)
  public/.assetsignore    Keeps _worker.js and _routes.json out of static assets
  src/
    env.d.ts              Typed runtime bindings (EMAILS, RESEND_API_KEY, ...)
    middleware.ts         Security headers on HTML responses
    layouts/Layout.astro  Shared head, fonts, global CSS
    styles/app.css        Burnt-orange editorial theme
    components/
      Login.astro         Login card + its client script
      Console.astro       Compose form, ledger, and the client script
    pages/
      index.astro         Login, or redirect to /app when signed in
      app.astro           Console, or redirect to / when signed out
      api/
        login.ts          Sets the session cookie
        logout.ts         Clears the cookie
        send.ts           Send now, or schedule with scheduledAt
        ledger.ts         List sent and scheduled
        cancel.ts         Cancel a scheduled send
        reschedule.ts     Move a scheduled send (no UI yet)
```

## Endpoints

All `/api/*` except login and logout require the session cookie.

| Method | Path              | Purpose                                   |
|--------|-------------------|-------------------------------------------|
| GET    | `/`               | Login, or redirect to `/app` when signed in |
| GET    | `/app`            | Console, or redirect to `/` when signed out  |
| POST   | `/api/login`      | `{ password }` sets the session cookie    |
| POST   | `/api/logout`     | Clears the cookie                         |
| POST   | `/api/send`       | Send now, or schedule with `scheduledAt`  |
| GET    | `/api/ledger`     | List sent and scheduled messages          |
| POST   | `/api/cancel`     | `{ id }` cancels a scheduled send         |
| POST   | `/api/reschedule` | `{ id, scheduledAt }` moves a scheduled send (no UI yet) |

`/api/send` body:
```json
{
  "fromLocal": "hello",
  "fromName": "Rain",
  "to": "a@example.com, b@example.com",
  "cc": "",
  "bcc": "",
  "replyTo": "",
  "subject": "Subject line",
  "body": "Message text",
  "isHtml": false,
  "scheduledAt": "2026-07-01T15:00:00.000Z"
}
```
`to`, `cc`, and `bcc` accept commas, semicolons, or newlines. Omit
`scheduledAt` to send immediately.

## Scope note

Scheduling is capped at 30 days because that is Resend's native limit. For a
longer horizon or a fully self-hosted queue, the alternative is a Cloudflare
Cron Trigger plus D1: store the message locally and fire it when due. That adds
moving parts and is not in this build.
