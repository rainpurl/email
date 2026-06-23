# email.katr.es (Astro)

A password-gated console for sending email from any `<local>@katr.es` address
through Resend, with a rich-text composer, attachments, inline images,
signatures, and send-now or scheduled delivery. Built with Astro and the
Cloudflare adapter, deployed as a Cloudflare Worker. The Resend key and all
sending stay server-side.

## Interface

- Tab title is `emailer`; the favicon is an `@` mark.
- One font, Inter, across the whole app. The only exception is the lock screen
  line, which is Roboto Mono.
- Lock screen: a blank black screen showing only `you are not authorized.` in
  red. There is no visible field. Type the password (default `rain`) and press
  Enter. A wrong entry shakes the text and clears. The field stays focused, so
  typing works without clicking first.
- Console palette: brick `#8B3A2F` as the accent on a warm `#f2efe9` background.
- The console has no decorative labels. It is the compose form, then the ledger.

## Composer

A rich-text editor that sends HTML email. Toolbar:

- Bold, italic, underline, strikethrough
- Font size (Small through Huge) and text color
- Bulleted and numbered lists
- Link (uses the current selection, or inserts the URL as a link)
- Inline image upload, embedded with a Content-ID (see the caveat below)
- Image by URL, which inserts a normal `<img src>`
- Clear formatting, undo, redo
- Spellcheck (AI): fixes spelling, capitalization, and grammar only

Below the editor: Attach files (any type, shown as removable chips, about 20 MB
total), and a Signatures panel to create, append, and delete reusable
signatures. Signatures are stored server-side in KV and share the same toolbar
for formatting. Append a signature from the panel or the Signature dropdown in
the toolbar.

### Spellcheck (Workers AI)

The spellcheck button sends the message text to Cloudflare Workers AI
(`@cf/meta/llama-3.1-8b-instruct`) and applies the result per text node, so it
fixes spelling, capitalization, and grammar without changing formatting, links,
images, wording, or meaning. Workers AI needs no extra resource: the `ai`
binding in `wrangler.jsonc` is enough, and usage is billed on your Cloudflare
account.

### Inline image caveat

Uploaded inline images are sent as CID attachments (`<img src="cid:...">`). These
render reliably in desktop mail clients but are inconsistent in webmail such as
Gmail. For an image that renders everywhere, host it and use Image by URL
instead.

## Deploy without a terminal (Cloudflare Workers Builds)

This connects the GitHub repo to Cloudflare, which builds and deploys on every
push. It is a Worker, not a Pages project. The Astro Cloudflare adapter only
targets Workers.

1. Repo layout. The project files must sit at the repo root, so `package.json`
   is at the top level. If you keep them in a subfolder, set the build "Root
   directory" to that folder in step 4.
2. KV storage. Two namespaces (EMAILS for the ledger and signatures, SESSION for
   the adapter) already exist and their IDs are filled into `wrangler.jsonc`. If
   you ever recreate them, copy each new Namespace ID (Storage & Databases, KV,
   click the namespace) and replace the `id` values, leaving the binding names
   unchanged.
3. Connect the repo. Workers & Pages, Create application, Import a repository,
   pick the repo. Build command `npm run build`, deploy command
   `npx wrangler deploy`. Save and Deploy. Pushes to the production branch
   redeploy automatically.
4. Add the Resend key. Open the Worker, Settings, Variables and Secrets, add
   `RESEND_API_KEY` as an encrypted secret. Optionally add `SITE_PASSWORD` to
   change the password from `rain`. These are runtime secrets, not build
   variables, and they persist across later builds.
5. Point the domain. Worker, Settings, Domains & Routes, Add custom domain,
   `email.katr.es`. Since katr.es is on Cloudflare, the DNS is updated for you.

### Worker name

`wrangler.jsonc` sets the Worker name to `email` to match the connected build
project. If your Worker is named something else, change the `name` field to
match, or the build logs a name mismatch.

### Why no .assetsignore file is needed

The build writes `dist/.assetsignore` automatically (the `postbuild` script
after `npm run build`), so the `_worker.js` directory is never rejected as a
public asset, even if the committed `public/.assetsignore` is dropped during a
web upload.

## Local development (optional, needs a terminal)

1. `npm install`
2. `cp .dev.vars.example .dev.vars`, then set `RESEND_API_KEY` (and optionally
   `SITE_PASSWORD`).
3. `npm run dev`. KV is simulated locally. For a workerd run, `npm run preview`.

## How sending works

- Calls the Resend REST API from the Worker. The key is server-side and every
  `/api/*` route except login and logout checks the session cookie.
- From is any local part you type, locked to `@katr.es`, with an optional
  display name.
- The editor's HTML is wrapped in a portable font stack before sending, inline
  images are converted to CID attachments, and links get `target=_blank`.
- Scheduling uses Resend's native `scheduled_at`, capped at 30 days. Scheduled
  sends can be cancelled from the ledger.
- The ledger and signatures both live in the EMAILS KV namespace (keys `index`
  and `signatures`).

## Project structure

```
email/
  astro.config.mjs        Astro + Cloudflare adapter (output: server)
  wrangler.jsonc          Worker name, KV + AI bindings, assets, compatibility
  tsconfig.json
  scripts/postbuild.mjs   Writes dist/.assetsignore after the build
  .dev.vars.example       Template for local secrets
  public/.assetsignore    Backup of the same exclusion (build also writes it)
  src/
    env.d.ts              Typed runtime bindings (EMAILS, RESEND_API_KEY, ...)
    middleware.ts         Security headers on HTML responses
    layouts/Layout.astro  Head, Inter + Roboto Mono, global CSS
    styles/app.css        Inter theme, lock screen, editor, chips, signatures
    components/
      Login.astro         Blank black lock screen with hidden password capture
      Console.astro       Rich-text composer, attachments, signatures, ledger
    pages/
      index.astro         Lock screen, or redirect to /app when signed in
      app.astro           Console, or redirect to / when signed out
      api/
        login.ts          Sets the session cookie
        logout.ts         Clears the cookie
        send.ts           Send/schedule HTML email with attachments
        ledger.ts         List sent and scheduled
        cancel.ts         Cancel a scheduled send
        reschedule.ts     Move a scheduled send (no UI yet)
        signatures.ts     List, create, delete signatures (KV)
        proofread.ts      AI spellcheck via Workers AI (text only)
```

## Endpoints

All `/api/*` except login and logout require the session cookie.

| Method | Path               | Purpose                                       |
|--------|--------------------|-----------------------------------------------|
| GET    | `/`                | Lock screen, or redirect to `/app` when signed in |
| GET    | `/app`             | Console, or redirect to `/` when signed out   |
| POST   | `/api/login`       | `{ password }` sets the session cookie        |
| POST   | `/api/logout`      | Clears the cookie                             |
| POST   | `/api/send`        | Send or schedule HTML email, with attachments |
| GET    | `/api/ledger`      | List sent and scheduled messages              |
| POST   | `/api/cancel`      | `{ id }` cancels a scheduled send             |
| POST   | `/api/reschedule`  | `{ id, scheduledAt }` moves a send (no UI yet)|
| GET    | `/api/signatures`  | List saved signatures                         |
| POST   | `/api/signatures`  | `{ name, html }` creates a signature          |
| DELETE | `/api/signatures`  | `{ id }` deletes a signature                  |
| POST   | `/api/proofread`   | `{ segments }` returns AI-corrected text      |

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
  "html": "<div>...</div>",
  "attachments": [
    { "filename": "file.pdf", "content": "<base64>" },
    { "filename": "logo.png", "content": "<base64>", "content_id": "img123" }
  ],
  "scheduledAt": "2026-07-01T15:00:00.000Z"
}
```
`to`, `cc`, and `bcc` accept commas, semicolons, or newlines. Attachments with a
`content_id` are inline images referenced as `cid:<content_id>` in the HTML. Omit
`scheduledAt` to send immediately.

## Scope note

Scheduling is capped at 30 days because that is Resend's native limit. For a
longer horizon, the alternative is a Cloudflare Cron Trigger plus D1. That adds
moving parts and is not in this build.
