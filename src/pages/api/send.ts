import type { APIRoute } from 'astro';
import { COOKIE, password, verifyToken } from '../../lib/auth';
import { resend, resendError } from '../../lib/resend';
import { readIndex, writeIndex, splitAddrs, type EmailRecord } from '../../lib/ledger';

export const prerender = false;

const DOMAIN = 'katr.es';
const MAX_SCHEDULE = 30 * 24 * 60 * 60 * 1000; // Resend cap: 30 days

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

  const cc = splitAddrs(b.cc);
  const bcc = splitAddrs(b.bcc);
  const payload: Record<string, unknown> = { from, to, subject };
  if (cc.length) payload.cc = cc;
  if (bcc.length) payload.bcc = bcc;
  if (b.replyTo && String(b.replyTo).trim()) payload.reply_to = String(b.replyTo).trim();

  const content = String(b.body || '');
  if (b.isHtml) payload.html = content || '<div></div>';
  else payload.text = content;

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
  };
  const idx = await readIndex(env);
  idx.unshift(record);
  await writeIndex(env, idx);
  return Response.json({ ok: true, id: record.id, status: record.status });
};
