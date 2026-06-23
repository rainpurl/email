import type { APIRoute } from 'astro';
import { COOKIE, SESSION_MAX_AGE, makeToken, password } from '../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const env = locals.runtime.env;
  const body = await request.json().catch(() => ({}) as any);
  if (body && body.password === password(env)) {
    const token = await makeToken(password(env));
    cookies.set(COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
    return Response.json({ ok: true });
  }
  return Response.json({ ok: false, error: 'Wrong password.' }, { status: 401 });
};
