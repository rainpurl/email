// email.katr.es — single-file Cloudflare Worker
// Serves a password-gated console for sending email from any <local>@katr.es
// address via Resend, with immediate or scheduled sending (Resend native
// scheduled_at, up to 30 days out) and a KV-backed ledger of what has gone out.
//
// Bindings expected (see wrangler.toml):
//   EMAILS            KV namespace (stores the ledger under key "index")
//   RESEND_API_KEY    secret  ->  wrangler secret put RESEND_API_KEY
//   SITE_PASSWORD     secret  ->  optional; defaults to "rain"

const DOMAIN = "katr.es";
const COOKIE = "session";
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_SCHEDULE = 30 * 24 * 60 * 60 * 1000; // Resend cap: 30 days
const LEDGER_CAP = 250;

const enc = new TextEncoder();

// ---------- auth (signed cookie via HMAC-SHA256) ----------

function b64url(bytes) {
  let s = btoa(String.fromCharCode.apply(null, new Uint8Array(bytes)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
async function makeToken(secret) {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + SESSION_TTL })));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return payload + "." + b64url(sig);
}
async function verifyToken(token, secret) {
  if (!token || token.indexOf(".") < 0) return false;
  const parts = token.split(".");
  const payload = parts[0];
  const sig = parts[1];
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify("HMAC", key, fromB64url(sig), enc.encode(payload));
    if (!ok) return false;
    const obj = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return obj && obj.exp && obj.exp > Date.now();
  } catch (e) {
    return false;
  }
}
function getCookie(request, name) {
  const c = request.headers.get("Cookie") || "";
  const m = c.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
function sessionCookie(token, maxAge) {
  return (
    COOKIE + "=" + token +
    "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=" + maxAge
  );
}

// ---------- responses ----------

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
function html(body) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'",
    },
  });
}

// ---------- helpers ----------

function splitAddrs(s) {
  if (!s) return [];
  return String(s).split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
}

async function resend(env, method, path, body) {
  const res = await fetch("https://api.resend.com" + path, {
    method: method,
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { ok: res.ok, status: res.status, data: data };
}
function resendError(r, fallback) {
  if (r.data && r.data.message) return r.data.message;
  if (r.data && r.data.error && r.data.error.message) return r.data.error.message;
  if (r.data && r.data.name) return r.data.name;
  return fallback + " (HTTP " + r.status + ")";
}

async function readIndex(env) {
  const raw = await env.EMAILS.get("index");
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}
async function writeIndex(env, arr) {
  await env.EMAILS.put("index", JSON.stringify(arr.slice(0, LEDGER_CAP)));
}

// ---------- worker ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const PASSWORD = env.SITE_PASSWORD || "rain";

    // --- login / logout (unauthenticated) ---
    if (path === "/api/login" && method === "POST") {
      const b = await request.json().catch(function () { return {}; });
      if (b && b.password === PASSWORD) {
        const token = await makeToken(PASSWORD);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": sessionCookie(token, Math.floor(SESSION_TTL / 1000)),
          },
        });
      }
      return json({ ok: false, error: "Wrong password." }, 401);
    }
    if (path === "/api/logout" && method === "POST") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": sessionCookie("", 0),
        },
      });
    }

    const authed = await verifyToken(getCookie(request, COOKIE), PASSWORD);

    // --- pages ---
    if (path === "/" && method === "GET") {
      return html(authed ? APP_HTML : LOGIN_HTML);
    }

    // --- protected API ---
    if (path.indexOf("/api/") === 0) {
      if (!authed) return json({ ok: false, error: "Not authenticated." }, 401);

      if (path === "/api/send" && method === "POST") {
        if (!env.RESEND_API_KEY) {
          return json({ ok: false, error: "RESEND_API_KEY is not set on the Worker." }, 500);
        }
        const b = await request.json().catch(function () { return {}; });

        const localPart = String(b.fromLocal || "").trim().replace(/@.*$/, "");
        if (!localPart) return json({ ok: false, error: "A From address is required." }, 400);
        const fromAddr = localPart + "@" + DOMAIN;
        const fromName = String(b.fromName || "").trim();
        const from = fromName ? (fromName + " <" + fromAddr + ">") : fromAddr;

        const to = splitAddrs(b.to);
        if (!to.length) return json({ ok: false, error: "At least one recipient is required." }, 400);

        const subject = String(b.subject || "").trim();
        if (!subject) return json({ ok: false, error: "A subject is required." }, 400);

        const payload = { from: from, to: to, subject: subject };
        const cc = splitAddrs(b.cc);
        const bcc = splitAddrs(b.bcc);
        if (cc.length) payload.cc = cc;
        if (bcc.length) payload.bcc = bcc;
        if (b.replyTo && String(b.replyTo).trim()) payload.reply_to = String(b.replyTo).trim();

        const content = String(b.body || "");
        if (b.isHtml) payload.html = content || "<div></div>";
        else payload.text = content;

        let scheduledIso = null;
        if (b.scheduledAt) {
          const t = new Date(b.scheduledAt);
          if (isNaN(t.getTime())) return json({ ok: false, error: "That schedule time is not valid." }, 400);
          const now = Date.now();
          if (t.getTime() <= now + 30000) return json({ ok: false, error: "Pick a time in the future." }, 400);
          if (t.getTime() > now + MAX_SCHEDULE) return json({ ok: false, error: "Resend schedules up to 30 days ahead." }, 400);
          scheduledIso = t.toISOString();
          payload.scheduled_at = scheduledIso;
        }

        const r = await resend(env, "POST", "/emails", payload);
        if (!r.ok) return json({ ok: false, error: resendError(r, "Resend rejected the send") }, 502);

        const record = {
          id: (r.data && r.data.id) || ("local-" + Date.now()),
          from: from,
          to: to,
          cc: cc,
          bcc: bcc,
          subject: subject,
          status: scheduledIso ? "scheduled" : "sent",
          created_at: new Date().toISOString(),
          scheduled_at: scheduledIso,
        };
        const idx = await readIndex(env);
        idx.unshift(record);
        await writeIndex(env, idx);
        return json({ ok: true, id: record.id, status: record.status });
      }

      if (path === "/api/ledger" && method === "GET") {
        const idx = await readIndex(env);
        let changed = false;
        const now = Date.now();
        // Best-effort: refresh status only for scheduled items whose time has passed.
        for (let i = 0; i < idx.length; i++) {
          const rec = idx[i];
          if (
            rec.status === "scheduled" &&
            rec.id && rec.id.indexOf("local-") !== 0 &&
            rec.scheduled_at && new Date(rec.scheduled_at).getTime() < now
          ) {
            const g = await resend(env, "GET", "/emails/" + rec.id, null);
            if (g.ok && g.data) {
              const ev = g.data.last_event || "";
              if (ev && ev !== "scheduled") {
                rec.status = (ev === "canceled" || ev === "cancelled") ? "cancelled" : "sent";
                rec.last_event = ev;
                changed = true;
              }
            }
          }
        }
        if (changed) await writeIndex(env, idx);
        return json({ ok: true, items: idx });
      }

      if (path === "/api/cancel" && method === "POST") {
        const b = await request.json().catch(function () { return {}; });
        const id = b && b.id;
        if (!id) return json({ ok: false, error: "Missing id." }, 400);
        const r = await resend(env, "POST", "/emails/" + id + "/cancel", {});
        if (!r.ok) return json({ ok: false, error: resendError(r, "Could not cancel") }, 502);
        const idx = await readIndex(env);
        for (let i = 0; i < idx.length; i++) {
          if (idx[i].id === id) idx[i].status = "cancelled";
        }
        await writeIndex(env, idx);
        return json({ ok: true });
      }

      if (path === "/api/reschedule" && method === "POST") {
        const b = await request.json().catch(function () { return {}; });
        const id = b && b.id;
        if (!id || !b.scheduledAt) return json({ ok: false, error: "Missing id or time." }, 400);
        const t = new Date(b.scheduledAt);
        if (isNaN(t.getTime())) return json({ ok: false, error: "That time is not valid." }, 400);
        const now = Date.now();
        if (t.getTime() <= now + 30000) return json({ ok: false, error: "Pick a time in the future." }, 400);
        if (t.getTime() > now + MAX_SCHEDULE) return json({ ok: false, error: "Resend schedules up to 30 days ahead." }, 400);
        const r = await resend(env, "PATCH", "/emails/" + id, { scheduled_at: t.toISOString() });
        if (!r.ok) return json({ ok: false, error: resendError(r, "Could not reschedule") }, 502);
        const idx = await readIndex(env);
        for (let i = 0; i < idx.length; i++) {
          if (idx[i].id === id) { idx[i].scheduled_at = t.toISOString(); idx[i].status = "scheduled"; }
        }
        await writeIndex(env, idx);
        return json({ ok: true });
      }

      return json({ ok: false, error: "Not found." }, 404);
    }

    return new Response("Not found", { status: 404 });
  },
};

// ---------- styles ----------

const STYLE = `
:root{
  --ink:#1C1814; --ink-soft:#6F665B; --paper:#FBFAF7; --panel:#FFFFFF;
  --line:#E7E1D7; --line-strong:#D8D0C2;
  --orange:#BF5700; --orange-deep:#9A4600; --orange-tint:#FBEEE2;
  --sent:#2E7D4F; --radius:7px;
}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{background:var(--paper);color:var(--ink);font-family:"Figtree",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased;}
a{color:var(--orange);}
.wrap{max-width:720px;margin:0 auto;padding:38px 24px 96px;}
.eyebrow{font-family:"Space Mono",ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft);}
.top{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:34px;}
.brand{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:25px;letter-spacing:-.01em;line-height:1;display:flex;align-items:center;gap:9px;}
.brand .dot{width:9px;height:9px;border-radius:50%;background:var(--orange);display:inline-block;flex:0 0 auto;transform:translateY(-1px);}
.brand .sub{color:var(--ink-soft);font-weight:500;}
.signout{font-family:"Space Mono",monospace;font-size:12px;color:var(--ink-soft);background:none;border:none;cursor:pointer;padding:6px 4px;}
.signout:hover{color:var(--orange);}
.section{border-top:1px solid var(--line);padding-top:24px;margin-top:32px;}
.section:first-of-type{border-top:none;margin-top:0;padding-top:0;}
.section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}
.field{margin-bottom:16px;}
.field > label{display:block;font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-soft);margin-bottom:7px;}
input[type=text],input[type=password],input[type=datetime-local],textarea{width:100%;font-family:inherit;font-size:15px;color:var(--ink);background:var(--panel);border:1px solid var(--line-strong);border-radius:var(--radius);padding:11px 13px;outline:none;transition:border-color .12s ease,box-shadow .12s ease;}
textarea{resize:vertical;min-height:152px;line-height:1.55;}
input:focus,textarea:focus{border-color:var(--orange);box-shadow:0 0 0 3px var(--orange-tint);}
::placeholder{color:#B7AEA1;}
.from-group{display:flex;align-items:stretch;border:1px solid var(--line-strong);border-radius:var(--radius);overflow:hidden;background:var(--panel);transition:border-color .12s ease,box-shadow .12s ease;}
.from-group:focus-within{border-color:var(--orange);box-shadow:0 0 0 3px var(--orange-tint);}
.from-group input{border:none;border-radius:0;box-shadow:none !important;flex:1;min-width:0;}
.from-group .suffix{display:flex;align-items:center;padding:0 14px;font-family:"Space Mono",monospace;font-size:14px;color:var(--ink-soft);background:#F4F1EA;border-left:1px solid var(--line);white-space:nowrap;}
.row2{display:flex;gap:12px;}
.row2 > *{flex:1;}
.more-btn{font-family:"Space Mono",monospace;font-size:12px;color:var(--ink-soft);background:none;border:none;cursor:pointer;padding:4px 0;display:inline-flex;align-items:center;gap:7px;}
.more-btn:hover{color:var(--orange);}
.more-btn .chev{display:inline-block;width:10px;text-align:center;font-weight:700;}
.more-panel{display:none;margin-top:16px;}
.more-panel.open{display:block;}
.check{display:flex;align-items:center;gap:9px;font-size:14px;color:var(--ink);cursor:pointer;}
.check input{width:auto;}
.dispatch{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin-top:22px;}
.seg{display:inline-flex;border:1px solid var(--line-strong);border-radius:var(--radius);overflow:hidden;background:var(--panel);}
.seg button{font-family:"Figtree",sans-serif;font-size:13px;font-weight:500;color:var(--ink-soft);background:none;border:none;padding:9px 16px;cursor:pointer;transition:background .12s ease,color .12s ease;}
.seg button.active{background:var(--orange);color:#fff;}
.when-wrap{display:none;align-items:center;gap:10px;}
.when-wrap.show{display:flex;}
.when-wrap input{width:auto;}
.limit{font-family:"Space Mono",monospace;font-size:11px;color:var(--ink-soft);}
.send{margin-left:auto;}
.btn{font-family:"Figtree",sans-serif;font-size:14px;font-weight:600;color:#fff;background:var(--orange);border:none;border-radius:var(--radius);padding:11px 22px;cursor:pointer;transition:background .12s ease,transform .05s ease;}
.btn:hover{background:var(--orange-deep);}
.btn:active{transform:translateY(1px);}
.btn:disabled{opacity:.55;cursor:default;}
.count{font-family:"Space Mono",monospace;font-size:11px;color:var(--ink-soft);}
.grp-label{font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-soft);margin:20px 0 8px;}
.grp-label:first-child{margin-top:0;}
.item{display:flex;align-items:flex-start;gap:12px;padding:13px 0;border-top:1px solid var(--line);animation:rise .26s ease both;}
.item:first-of-type{border-top:none;}
.glyph{flex:0 0 auto;width:16px;text-align:center;font-family:"Space Mono",monospace;font-size:13px;line-height:1.55;margin-top:1px;}
.glyph.scheduled{color:var(--orange);}
.glyph.sent{color:var(--sent);}
.glyph.cancelled{color:#A79E91;}
.item-main{flex:1;min-width:0;}
.item-subj{font-weight:500;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.item.cancelled .item-subj{color:#A79E91;text-decoration:line-through;}
.item-meta{font-family:"Space Mono",monospace;font-size:11.5px;color:var(--ink-soft);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cancel-x{flex:0 0 auto;font-family:"Space Mono",monospace;font-size:11.5px;color:var(--ink-soft);background:none;border:1px solid var(--line);border-radius:5px;padding:4px 10px;cursor:pointer;}
.cancel-x:hover{color:var(--orange);border-color:var(--orange);}
.empty{font-family:"Figtree",sans-serif;color:var(--ink-soft);font-size:14px;padding:8px 0 4px;}
.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(14px);background:var(--ink);color:#fff;font-size:13.5px;padding:11px 18px;border-radius:8px;opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;max-width:90vw;box-shadow:0 6px 22px rgba(28,24,20,.22);z-index:50;}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
.toast.err{background:#8A2B12;}
.login{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
.login-card{width:100%;max-width:330px;text-align:center;}
.login-card .brand{justify-content:center;margin-bottom:8px;font-size:27px;}
.login-cap{font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft);margin-bottom:26px;}
.login-card input{text-align:center;}
.login-card .btn{width:100%;margin-top:12px;}
.login-err{font-family:"Space Mono",monospace;font-size:12px;color:#A83218;margin-top:12px;min-height:16px;}
@keyframes rise{from{opacity:0;transform:translateY(5px);}to{opacity:1;transform:none;}}
@media (max-width:560px){
  .wrap{padding:26px 18px 90px;}
  .row2{flex-direction:column;gap:0;}
  .send{margin-left:0;width:100%;}
  .send .btn{width:100%;}
}
@media (prefers-reduced-motion:reduce){*{transition:none !important;animation:none !important;}}
`;

// ---------- app page ----------

const APP_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>email.katr.es</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Figtree:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet"><style>${STYLE}</style></head><body>
<div class="wrap">
  <header class="top">
    <div class="brand"><span class="dot"></span><span>email<span class="sub">.katr.es</span></span></div>
    <button class="signout" id="signout" type="button">Sign out</button>
  </header>

  <section class="section">
    <div class="eyebrow" style="margin-bottom:18px;">Compose</div>
    <div class="field">
      <label for="fromLocal">From</label>
      <div class="from-group">
        <input id="fromLocal" type="text" placeholder="hello" autocomplete="off" spellcheck="false" autocapitalize="off">
        <span class="suffix">@katr.es</span>
      </div>
    </div>
    <div class="field">
      <label for="to">To</label>
      <input id="to" type="text" placeholder="name@example.com, another@example.com" autocomplete="off">
    </div>
    <div class="field">
      <label for="subject">Subject</label>
      <input id="subject" type="text" autocomplete="off">
    </div>
    <div class="field">
      <label for="body">Message</label>
      <textarea id="body" placeholder="Write your message"></textarea>
    </div>

    <button class="more-btn" id="moreBtn" type="button"><span class="chev">+</span> More options</button>
    <div class="more-panel" id="morePanel">
      <div class="field"><label for="fromName">From name (optional)</label><input id="fromName" type="text" placeholder="Rain" autocomplete="off"></div>
      <div class="row2">
        <div class="field"><label for="cc">Cc</label><input id="cc" type="text" autocomplete="off"></div>
        <div class="field"><label for="bcc">Bcc</label><input id="bcc" type="text" autocomplete="off"></div>
      </div>
      <div class="field"><label for="replyTo">Reply-to</label><input id="replyTo" type="text" autocomplete="off"></div>
      <div class="field" style="margin-bottom:2px;">
        <label class="check"><input id="isHtml" type="checkbox"> Treat the message body as HTML</label>
      </div>
    </div>

    <div class="dispatch">
      <div class="seg">
        <button id="segNow" class="active" type="button">Send now</button>
        <button id="segLater" type="button">Schedule</button>
      </div>
      <div class="when-wrap" id="whenWrap">
        <input id="when" type="datetime-local">
        <span class="limit">up to 30 days out</span>
      </div>
      <div class="send"><button class="btn" id="sendBtn" type="button">Send</button></div>
    </div>
  </section>

  <section class="section">
    <div class="section-head">
      <div class="eyebrow">Ledger</div>
      <span class="count" id="count"></span>
    </div>
    <div id="ledger"><div class="empty">Loading the ledger.</div></div>
  </section>
</div>
<div class="toast" id="toast"></div>
<script>
(function(){
  function $(id){ return document.getElementById(id); }
  var when = $('when');
  var scheduling = false;

  function pad(n){ return (n<10?'0':'')+n; }
  function localValue(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes()); }
  when.min = localValue(new Date(Date.now()+60*1000));
  when.max = localValue(new Date(Date.now()+30*24*60*60*1000));
  when.value = localValue(new Date(Date.now()+10*60*1000));

  function setMode(later){
    scheduling = later;
    if(later){ $('segLater').classList.add('active'); $('segNow').classList.remove('active'); $('whenWrap').classList.add('show'); $('sendBtn').textContent='Schedule send'; }
    else { $('segNow').classList.add('active'); $('segLater').classList.remove('active'); $('whenWrap').classList.remove('show'); $('sendBtn').textContent='Send'; }
  }
  $('segNow').onclick = function(){ setMode(false); };
  $('segLater').onclick = function(){ setMode(true); };

  $('moreBtn').onclick = function(){
    var open = $('morePanel').classList.toggle('open');
    this.querySelector('.chev').textContent = open ? '–' : '+';
  };

  var toastT;
  function toast(msg, isErr){
    var t = $('toast'); t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastT); toastT = setTimeout(function(){ t.className='toast'; }, 3800);
  }

  function esc(s){ s=(s==null?'':String(s)); return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtTime(iso){
    if(!iso) return '';
    var d = new Date(iso); if(isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  }
  function fromLabel(from){
    var v = String(from||'').replace(/^.*</,'').replace(/>.*$/,'').replace(/@katr[.]es$/,'');
    return v || String(from||'');
  }
  function toLine(rec){
    var s = (rec.to||[]).join(', ');
    if(s.length>44) s = s.slice(0,42)+'…';
    return s;
  }
  function rowHtml(rec){
    var st = rec.status;
    var glyph = st==='scheduled' ? '◴' : (st==='cancelled' ? '×' : '✓');
    var lbl = st==='scheduled' ? ('Scheduled '+fmtTime(rec.scheduled_at)) : (st==='cancelled' ? 'Cancelled' : ('Sent '+fmtTime(rec.created_at)));
    var meta = lbl + '  ·  ' + esc(fromLabel(rec.from)) + ' → ' + esc(toLine(rec));
    var cancel = st==='scheduled' ? ('<button class="cancel-x" data-id="'+esc(rec.id)+'">Cancel</button>') : '';
    return '<div class="item '+st+'"><div class="glyph '+st+'">'+glyph+'</div>'
      + '<div class="item-main"><div class="item-subj">'+esc(rec.subject||'(no subject)')+'</div>'
      + '<div class="item-meta">'+meta+'</div></div>'+cancel+'</div>';
  }
  function render(items){
    var sched=[], done=[];
    for(var i=0;i<items.length;i++){ (items[i].status==='scheduled'?sched:done).push(items[i]); }
    var h='';
    if(sched.length){ h+='<div class="grp-label">Scheduled</div>'; for(var a=0;a<sched.length;a++){ h+=rowHtml(sched[a]); } }
    if(done.length){ h+='<div class="grp-label">Recent</div>'; for(var b=0;b<done.length;b++){ h+=rowHtml(done[b]); } }
    if(!sched.length && !done.length){ h='<div class="empty">Nothing sent yet. Compose a message above.</div>'; }
    $('ledger').innerHTML = h;
    $('count').textContent = items.length ? (items.length + (items.length===1?' message':' messages')) : '';
  }
  function loadLedger(){
    fetch('/api/ledger').then(function(r){return r.json();}).then(function(d){
      if(d && d.ok){ render(d.items||[]); } else { $('ledger').innerHTML='<div class="empty">Could not load the ledger.</div>'; }
    }).catch(function(){ $('ledger').innerHTML='<div class="empty">Could not load the ledger.</div>'; });
  }

  $('ledger').addEventListener('click', function(e){
    var btn = e.target && e.target.closest ? e.target.closest('.cancel-x') : null;
    if(!btn) return;
    var id = btn.getAttribute('data-id');
    btn.disabled = true; btn.textContent = '…';
    fetch('/api/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})})
      .then(function(r){return r.json();}).then(function(d){
        if(d && d.ok){ toast('Scheduled send cancelled.'); loadLedger(); }
        else { toast((d&&d.error)||'Could not cancel.', true); btn.disabled=false; btn.textContent='Cancel'; }
      }).catch(function(){ toast('Could not cancel.', true); btn.disabled=false; btn.textContent='Cancel'; });
  });

  $('sendBtn').onclick = function(){
    var payload = {
      fromLocal: $('fromLocal').value, fromName: $('fromName').value,
      to: $('to').value, cc: $('cc').value, bcc: $('bcc').value,
      replyTo: $('replyTo').value, subject: $('subject').value,
      body: $('body').value, isHtml: $('isHtml').checked
    };
    if(scheduling){
      if(!when.value){ toast('Pick a time to schedule.', true); return; }
      payload.scheduledAt = new Date(when.value).toISOString();
    }
    var btn = this; var label = btn.textContent; btn.disabled = true; btn.textContent = scheduling ? 'Scheduling…' : 'Sending…';
    fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){return r.json();}).then(function(d){
        btn.disabled=false; btn.textContent=label;
        if(d && d.ok){
          toast(d.status==='scheduled' ? 'Scheduled.' : 'Sent.');
          $('subject').value=''; $('body').value=''; $('to').value=''; $('cc').value=''; $('bcc').value='';
          loadLedger();
        } else { toast((d&&d.error)||'Could not send.', true); }
      }).catch(function(){ btn.disabled=false; btn.textContent=label; toast('Could not send.', true); });
  };

  $('signout').onclick = function(){ fetch('/api/logout',{method:'POST'}).then(function(){ location.reload(); }); };

  loadLedger();
})();
</script>
</body></html>`;

// ---------- login page ----------

const LOGIN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>email.katr.es</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Figtree:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet"><style>${STYLE}</style></head><body>
<div class="login">
  <div class="login-card">
    <div class="brand"><span class="dot"></span><span>email<span class="sub">.katr.es</span></span></div>
    <div class="login-cap">Private console</div>
    <input id="pw" type="password" placeholder="Password" autocomplete="current-password">
    <button class="btn" id="unlock" type="button">Unlock</button>
    <div class="login-err" id="err"></div>
  </div>
</div>
<script>
(function(){
  function $(id){ return document.getElementById(id); }
  var pw = $('pw'), err = $('err');
  function submit(){
    err.textContent='';
    var btn = $('unlock'); btn.disabled = true; btn.textContent='Unlocking…';
    fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw.value})})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, d:d}; }); })
      .then(function(res){
        if(res.ok && res.d && res.d.ok){ location.reload(); }
        else { err.textContent=(res.d&&res.d.error)||'Wrong password.'; btn.disabled=false; btn.textContent='Unlock'; pw.value=''; pw.focus(); }
      }).catch(function(){ err.textContent='Something went wrong. Try again.'; btn.disabled=false; btn.textContent='Unlock'; });
  }
  $('unlock').onclick = submit;
  pw.addEventListener('keydown', function(e){ if(e.key==='Enter') submit(); });
  pw.focus();
})();
</script>
</body></html>`;
