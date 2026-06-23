const enc = new TextEncoder();
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

export const COOKIE = 'session';
export const SESSION_MAX_AGE = Math.floor(SESSION_TTL / 1000);

export function password(env: Env): string {
  return env.SITE_PASSWORD || 'rain';
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function makeToken(secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + SESSION_TTL })));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return payload + '.' + b64url(sig);
}

export async function verifyToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify('HMAC', key, fromB64url(sig), enc.encode(payload));
    if (!ok) return false;
    const obj = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return !!(obj && obj.exp && obj.exp > Date.now());
  } catch {
    return false;
  }
}
