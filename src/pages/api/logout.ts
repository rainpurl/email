import type { APIRoute } from 'astro';
import { COOKIE } from '../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
  cookies.delete(COOKIE, { path: '/' });
  return Response.json({ ok: true });
};
