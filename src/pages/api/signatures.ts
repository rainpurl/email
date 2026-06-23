import type { APIRoute } from 'astro';
import { COOKIE, password, verifyToken } from '../../lib/auth';

export const prerender = false;

const KEY = 'signatures';
const CAP = 50;

interface Signature {
  id: string;
  name: string;
  html: string;
}

async function readSigs(env: Env): Promise<Signature[]> {
  const raw = await env.EMAILS.get(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Signature[];
  } catch {
    return [];
  }
}
async function writeSigs(env: Env, arr: Signature[]): Promise<void> {
  await env.EMAILS.put(KEY, JSON.stringify(arr.slice(0, CAP)));
}
async function authed(cookies: any, env: Env): Promise<boolean> {
  return verifyToken(cookies.get(COOKIE)?.value, password(env));
}

export const GET: APIRoute = async ({ locals, cookies }) => {
  const env = locals.runtime.env;
  if (!(await authed(cookies, env))) return Response.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  return Response.json({ ok: true, items: await readSigs(env) });
};

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const env = locals.runtime.env;
  if (!(await authed(cookies, env))) return Response.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  const b = await request.json().catch(() => ({}) as any);
  const name = String(b.name || '').trim();
  const html = String(b.html || '');
  if (!name) return Response.json({ ok: false, error: 'A name is required.' }, { status: 400 });
  const items = await readSigs(env);
  const sig: Signature = { id: 'sig-' + Date.now().toString(36), name, html };
  items.unshift(sig);
  await writeSigs(env, items);
  return Response.json({ ok: true, item: sig, items });
};

export const DELETE: APIRoute = async ({ request, locals, cookies }) => {
  const env = locals.runtime.env;
  if (!(await authed(cookies, env))) return Response.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  const b = await request.json().catch(() => ({}) as any);
  const id = String(b.id || '');
  const items = (await readSigs(env)).filter((s) => s.id !== id);
  await writeSigs(env, items);
  return Response.json({ ok: true, items });
};
