import type { APIRoute } from 'astro';
import { COOKIE, password, verifyToken } from '../../lib/auth';
import { resend, resendError } from '../../lib/resend';
import { readIndex, writeIndex } from '../../lib/ledger';

export const prerender = false;

const MAX_SCHEDULE = 30 * 24 * 60 * 60 * 1000;

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const env = locals.runtime.env;
  if (!(await verifyToken(cookies.get(COOKIE)?.value, password(env)))) {
    return Response.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  }
  const b = await request.json().catch(() => ({}) as any);
  const id = b?.id;
  if (!id || !b.scheduledAt) return Response.json({ ok: false, error: 'Missing id or time.' }, { status: 400 });
  const t = new Date(b.scheduledAt);
  if (isNaN(t.getTime())) return Response.json({ ok: false, error: 'That time is not valid.' }, { status: 400 });
  const now = Date.now();
  if (t.getTime() <= now + 30000) return Response.json({ ok: false, error: 'Pick a time in the future.' }, { status: 400 });
  if (t.getTime() > now + MAX_SCHEDULE) return Response.json({ ok: false, error: 'Resend schedules up to 30 days ahead.' }, { status: 400 });

  const r = await resend(env, 'PATCH', '/emails/' + id, { scheduled_at: t.toISOString() });
  if (!r.ok) return Response.json({ ok: false, error: resendError(r, 'Could not reschedule') }, { status: 502 });

  const idx = await readIndex(env);
  for (const rec of idx) if (rec.id === id) { rec.scheduled_at = t.toISOString(); rec.status = 'scheduled'; }
  await writeIndex(env, idx);
  return Response.json({ ok: true });
};
