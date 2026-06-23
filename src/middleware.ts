import type { MiddlewareHandler } from 'astro';

// Light hardening on HTML responses. Scripts are bundled same-origin by Astro,
// so no inline-script allowance is needed.
export const onRequest: MiddlewareHandler = async (_context, next) => {
  const res = await next();
  const ct = res.headers.get('Content-Type') || '';
  if (ct.includes('text/html')) {
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('X-Frame-Options', 'DENY');
    res.headers.set('Referrer-Policy', 'no-referrer');
  }
  return res;
};
