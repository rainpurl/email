# email.katr.es (Astro)

A password-gated console for sending email from any `<local>@katr.es` address
through Resend, with send-now or scheduled delivery and a ledger of what has
gone out. Built with Astro and the Cloudflare adapter, deployed as a Cloudflare
Worker. The Resend key and all sending stay server-side.

## Deploy without a terminal (Cloudflare Workers Builds)

This connects the GitHub repo to Cloudflare, which builds and deploys on every
push. It is a Worker, not a Pages project. The Astro Cloudflare adapter only
targets Workers.

1. Repo layout. The project files must sit at the repo root, so `package.json`
   is at the top level (not nested inside a subfolder). If you keep them in a
   subfolder, set the build "Root directory" to that folder in step 4.
2. Create KV storage. In the dashboard: Storage & Databases, KV, Create
   namespace. Make two (title them anything, e.g. `email-katres-emails` and
   `email-katres-session`). Open each and copy its Namespace ID, which is a long
   hex string, not the title.
3. Paste the IDs. Edit `wrangler.jsonc` (GitHub web editor is fine) and replace
   `PASTE_EMAILS_NAMESPACE_ID` and `PASTE_SESSION_NAMESPACE_ID` with the two hex
   IDs. Leave the binding names `EMAILS` and `SESSION` unchanged. Commit.
4. Connect the repo. Workers & Pages, Create application, Import a repository,
   pick the repo. Build command `npm run build`, deploy command
   `npx wrangler deploy`. Save and Deploy. After this, any push to the
   production branch rebuilds and redeploys automatically.
5. Add the Resend key. Open the Worker, Settings, Variables and Secrets, add
   `RESEND_API_KEY` as an encrypted secret. Optionally add `SITE_PASSWORD` to
   change the password from the default `rain`. These are runtime secrets, not
   build variables, and they persist across later builds.
6. Point the domain. Worker, Settings, Domains & Routes, Add custom domain,
   `email.katr.es`. Since katr.es is on Cloudflare, the DNS is updated for you.

The first build succeeds even before the Resend key is set, because the build
never calls Resend. The key is only needed at send time.

### Worker name

`wrangler.jsonc` sets the Worker name to `email` to match the connected build
project. If your Worker is named something else, the build logs a name mismatch
and tries to open a fixup pull request. Either keep `email`, or change the
`name` field to match your Worker. The public address is the custom domain
above, so the Worker name itself is cosmetic.

### Why no .assetsignore file is needed

Cloudflare will refuse to deploy if the `_worker.js` directory looks like a
public static asset. The build writes `dist/.assetsignore` automatically (the
`postbuild` script after `npm run build`), so this is handled even if the
committed `public/.assetsignore` is dropped during a web upload.

## Local development (optional, needs a terminal)

1. `npm install`
2. `cp .dev.vars.example .dev.vars`, then set `RESEND_API_KEY` (and optionally
   `SITE_PASSWORD`) in `.dev.vars`.
3. `npm run dev`. KV is simulated locally, so the ledger persists under
   `.wrangler/`. For a workerd run, `npm run preview`.

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
email/
  astro.config.mjs        Astro + Cloudflare adapter (output: server)
  wrangler.jsonc          Worker name, KV bindings, assets, compatibility
  tsconfig.json
  scripts/postbuild.mjs   Writes dist/.assetsignore after the build
  .dev.vars.example       Template for local secrets (copy to .dev.vars)
  public/.assetsignore    Backup copy of the same exclusion (build also writes it)
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

| Method | Path              | Purpose                                       |
|--------|-------------------|-----------------------------------------------|
| GET    | `/`               | Login, or redirect to `/app` when signed in   |
| GET    | `/app`            | Console, or redirect to `/` when signed out   |
| POST   | `/api/login`      | `{ password }` sets the session cookie        |
| POST   | `/api/logout`     | Clears the cookie                             |
| POST   | `/api/send`       | Send now, or schedule with `scheduledAt`      |
| GET    | `/api/ledger`     | List sent and scheduled messages              |
| POST   | `/api/cancel`     | `{ id }` cancels a scheduled send             |
| POST   | `/api/reschedule` | `{ id, scheduledAt }` moves a send (no UI yet)|

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
