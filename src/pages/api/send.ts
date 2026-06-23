import type { APIRoute } from 'astro';
import { COOKIE, password, verifyToken } from '../../lib/auth';
import { resend, resendError } from '../../lib/resend';
import { readIndex, writeIndex, splitAddrs, type EmailRecord } from '../../lib/ledger';

export const prerender = false;

const DOMAIN = 'katr.es';
const MAX_SCHEDULE = 30 * 24 * 60 * 60 * 1000; // Resend cap: 30 days
const MAX_ATTACH_B64 = 28_000_000; // ~20 MB of raw bytes once base64-encoded

interface InAttachment {
  filename?: string;
  content?: string;
  content_id?: string;
}

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const env = locals.runtime.env;
  if (!(await verifyToken(cookies.get(COOKIE)?.value, password(env)))) {
    return Response.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  }
  if (!env.RESEND_API_KEY) {
    return Response.json({ ok: false, error: 'RESEND_API_KEY is not set on the Worker.' }, { status: 500 });
  }

  const b = await request.json().catch(() => ({}) as any);

  const localPart = String(b.fromLocal || '').trim().replace(/@.*$/, '');
  if (!localPart) return Response.json({ ok: false, error: 'A From address is required.' }, { status: 400 });
  const fromAddr = localPart + '@' + DOMAIN;
  const fromName = String(b.fromName || '').trim();
  const from = fromName ? `${fromName} <${fromAddr}>` : fromAddr;

  const to = splitAddrs(b.to);
  if (!to.length) return Response.json({ ok: false, error: 'At least one recipient is required.' }, { status: 400 });

  const subject = String(b.subject || '').trim();
  if (!subject) return Response.json({ ok: false, error: 'A subject is required.' }, { status: 400 });

  // Attachments (regular files plus inline images carrying a content_id)
  const rawAtts: InAttachment[] = Array.isArray(b.attachments) ? b.attachments : [];
  if (rawAtts.length > 25) return Response.json({ ok: false, error: 'Too many attachments (max 25).' }, { status: 400 });
  let totalB64 = 0;
  const attachments = rawAtts
    .filter((a) => a && a.filename && a.content)
    .map((a) => {
      totalB64 += String(a.content).length;
      const out: Record<string, string> = { filename: String(a.filename), content: String(a.content) };
      if (a.content_id) out.content_id = String(a.content_id);
      return out;
    });
  if (totalB64 > MAX_ATTACH_B64) {
    return Response.json({ ok: false, error: 'Attachments exceed the size limit (about 20 MB total).' }, { status: 400 });
  }

  const html = String(b.html || '');
  const text = String(b.body || b.text || '');
  if (!html && !text && attachments.length === 0) {
    return Response.json({ ok: false, error: 'A message body is required.' }, { status: 400 });
  }

  const cc = splitAddrs(b.cc);
  const bcc = splitAddrs(b.bcc);
  const payload: Record<string, unknown> = { from, to, subject };
  if (cc.length) payload.cc = cc;
  if (bcc.length) payload.bcc = bcc;
  if (b.replyTo && String(b.replyTo).trim()) payload.reply_to = String(b.replyTo).trim();
  if (html) payload.html = html;
  else if (text) payload.text = text;
  else payload.html = '<div></div>';
  if (attachments.length) payload.attachments = attachments;

  let scheduledIso: string | null = null;
  if (b.scheduledAt) {
    const t = new Date(b.scheduledAt);
    if (isNaN(t.getTime())) return Response.json({ ok: false, error: 'That schedule time is not valid.' }, { status: 400 });
    const now = Date.now();
    if (t.getTime() <= now + 30000) return Response.json({ ok: false, error: 'Pick a time in the future.' }, { status: 400 });
    if (t.getTime() > now + MAX_SCHEDULE) return Response.json({ ok: false, error: 'Resend schedules up to 30 days ahead.' }, { status: 400 });
    scheduledIso = t.toISOString();
    payload.scheduled_at = scheduledIso;
  }

  const r = await resend(env, 'POST', '/emails', payload);
  if (!r.ok) return Response.json({ ok: false, error: resendError(r, 'Resend rejected the send') }, { status: 502 });

  const record: EmailRecord = {
    id: r.data?.id || 'local-' + Date.now(),
    from,
    to,
    cc,
    bcc,
    subject,
    status: scheduledIso ? 'scheduled' : 'sent',
    created_at: new Date().toISOString(),
    scheduled_at: scheduledIso,
    attachments: attachments.length || undefined,
  };
  const idx = await readIndex(env);
  idx.unshift(record);
  await writeIndex(env, idx);
  return Response.json({ ok: true, id: record.id, status: record.status });
};
