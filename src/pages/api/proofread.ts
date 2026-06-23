import type { APIRoute } from 'astro';
import { COOKIE, password, verifyToken } from '../../lib/auth';

export const prerender = false;

const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const MAX_TOTAL = 12000; // chars across all segments in one request
const BATCH_CHARS = 4000; // soft cap per model call

const SYSTEM =
  'You are a meticulous copy editor. You receive a JSON array of text strings. ' +
  'Return a JSON array of the SAME length and SAME order, where each string is the ' +
  'corresponding input corrected ONLY for spelling, capitalization, and grammar. ' +
  'Strict rules: do not rephrase or rewrite; keep the original wording and meaning; ' +
  'do not add, remove, merge, or split items; do not translate; keep emojis, symbols, ' +
  'numbers, and URLs as-is; if an item needs no change, return it unchanged. ' +
  'Output ONLY the JSON array, with no commentary, no code fences.';

function parseArray(text: string): string[] | null {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start < 0 || end < 0 || end < start) return null;
  try {
    const arr = JSON.parse(t.slice(start, end + 1));
    return Array.isArray(arr) ? arr.map((x) => String(x)) : null;
  } catch {
    return null;
  }
}

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const env = locals.runtime.env;
  if (!(await verifyToken(cookies.get(COOKIE)?.value, password(env)))) {
    return Response.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  }
  if (!env.AI) {
    return Response.json({ ok: false, error: 'AI is not configured on the Worker.' }, { status: 500 });
  }

  const b = await request.json().catch(() => ({}) as any);
  const segments: string[] = Array.isArray(b.segments) ? b.segments.map((x: unknown) => String(x)) : [];
  if (!segments.length) return Response.json({ ok: true, segments: [] });
  const total = segments.reduce((s, x) => s + x.length, 0);
  if (total > MAX_TOTAL) {
    return Response.json({ ok: false, error: 'Message is too long to proofread at once.' }, { status: 400 });
  }

  // group into batches by character budget, preserving order
  const batches: { from: number; items: string[] }[] = [];
  let cur: string[] = [];
  let curLen = 0;
  let from = 0;
  for (let i = 0; i < segments.length; i++) {
    const len = segments[i].length + 8;
    if (cur.length && curLen + len > BATCH_CHARS) {
      batches.push({ from, items: cur });
      cur = [];
      curLen = 0;
      from = i;
    }
    cur.push(segments[i]);
    curLen += len;
  }
  if (cur.length) batches.push({ from, items: cur });

  const out = segments.slice();
  try {
    for (const batch of batches) {
      const r: any = await env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(batch.items) },
        ],
        max_tokens: 3072,
        temperature: 0,
      });
      const text = typeof r === 'string' ? r : r?.response ?? r?.result?.response ?? '';
      const arr = parseArray(String(text));
      if (!arr || arr.length !== batch.items.length) {
        return Response.json({ ok: false, error: 'Proofread could not be applied cleanly. Try again.' }, { status: 502 });
      }
      for (let i = 0; i < arr.length; i++) out[batch.from + i] = arr[i];
    }
  } catch {
    return Response.json({ ok: false, error: 'Proofread service error.' }, { status: 502 });
  }

  return Response.json({ ok: true, segments: out });
};
