import type { APIRoute } from 'astro';
import { COOKIE, password, verifyToken } from '../../lib/auth';
import { resend, resendError } from '../../lib/resend';
import { readIndex, writeIndex } from '../../lib/ledger';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const env = locals.runtime.env;
  if (!(await verifyToken(cookies.get(COOKIE)?.value, password(env)))) {
    return Response.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  }
  const b = await request.json().catch(() => ({}) as any);
  const id = b?.id;
  if (!id) return Response.json({ ok: false, error: 'Missing id.' }, { status: 400 });

  const r = await resend(env, 'POST', '/emails/' + id + '/cancel', {});
  if (!r.ok) return Response.json({ ok: false, error: resendError(r, 'Could not cancel') }, { status: 502 });

  const idx = await readIndex(env);
  for (const rec of idx) if (rec.id === id) rec.status = 'cancelled';
  await writeIndex(env, idx);
  return Response.json({ ok: true });
};
