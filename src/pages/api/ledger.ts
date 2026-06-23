import type { APIRoute } from 'astro';
import { COOKIE, password, verifyToken } from '../../lib/auth';
import { resend } from '../../lib/resend';
import { readIndex, writeIndex } from '../../lib/ledger';

export const prerender = false;

export const GET: APIRoute = async ({ locals, cookies }) => {
  const env = locals.runtime.env;
  if (!(await verifyToken(cookies.get(COOKIE)?.value, password(env)))) {
    return Response.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const idx = await readIndex(env);
  let changed = false;
  const now = Date.now();
  // Best-effort: refresh status only for scheduled items whose time has passed.
  for (const rec of idx) {
    if (
      rec.status === 'scheduled' &&
      rec.id &&
      !rec.id.startsWith('local-') &&
      rec.scheduled_at &&
      new Date(rec.scheduled_at).getTime() < now
    ) {
      const g = await resend(env, 'GET', '/emails/' + rec.id);
      if (g.ok && g.data) {
        const ev: string = g.data.last_event || '';
        if (ev && ev !== 'scheduled') {
          rec.status = ev === 'canceled' || ev === 'cancelled' ? 'cancelled' : 'sent';
          rec.last_event = ev;
          changed = true;
        }
      }
    }
  }
  if (changed) await writeIndex(env, idx);
  return Response.json({ ok: true, items: idx });
};
