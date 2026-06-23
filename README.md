# email.katr.es

A password-gated console for sending email from any `<local>@katr.es` address
through Resend, with immediate or scheduled sending and a running ledger of
what has gone out. One Cloudflare Worker, one KV namespace, no build step.

## Deploy

1. Install and sign in.
   ```
   npm i -g wrangler
   wrangler login
   ```

2. Add your Resend API key as a secret.
   ```
   wrangler secret put RESEND_API_KEY
   ```
   Paste the `re_...` key when prompted.

3. Create the KV namespace for the ledger, then paste the returned id into
   `wrangler.toml` under `[[kv_namespaces]]`.
   ```
   wrangler kv namespace create EMAILS
   ```

4. Deploy.
   ```
   wrangler deploy
   ```

5. Point the domain at it. `katr.es` is already on Cloudflare, so add
   `email.katr.es` as a custom domain: either uncomment the `[[routes]]` block
   in `wrangler.toml` and redeploy, or add it in the dashboard under
   Workers & Pages > email-katres > Settings > Domains & Routes.

The password is `rain` out of the box. To change it without touching the code:
```
wrangler secret put SITE_PASSWORD
```

## How it works

- **Sending** goes straight to the Resend API from the Worker. The API key
  stays server-side and the send endpoint is behind the password, so the site
  is not an open relay.
- **From** is any local part you type, locked to `@katr.es`. The domain must be
  verified in Resend (it is). An optional display name produces
  `Name <local@katr.es>`.
- **Scheduling** uses Resend's native `scheduled_at`. Resend holds the message
  and delivers it at the chosen time, so there is no cron job to run or drift.
  The ceiling is 30 days out (Resend's limit). Scheduled sends can be cancelled
  from the ledger.
- **Ledger** is stored in KV under a single `index` key (most recent 250
  entries). When you load it, scheduled items whose time has passed are
  refreshed against Resend so the status stays truthful.
- **Auth** is a signed cookie (HMAC-SHA256, 7-day expiry) tied to the password.
  It is a light gate for a personal tool, not hardened multi-user auth.

## Endpoints

All `/api/*` routes except login and logout require the session cookie.

| Method | Path              | Purpose                                  |
|--------|-------------------|------------------------------------------|
| GET    | `/`               | Login page, or the console when signed in |
| POST   | `/api/login`      | `{ password }` -> sets session cookie     |
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

Scheduling is capped at 30 days because that is Resend's native limit. If you
need a longer horizon or a fully self-hosted queue, the alternative is a
Cloudflare Cron Trigger plus D1: store the message locally, fire it from the
cron when due. That adds moving parts and is not in this build. Say the word
and it can be added.
