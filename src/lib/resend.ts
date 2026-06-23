export interface ResendResult {
  ok: boolean;
  status: number;
  data: any;
}

export async function resend(env: Env, method: string, path: string, body?: unknown): Promise<ResendResult> {
  const res = await fetch('https://api.resend.com' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { ok: res.ok, status: res.status, data };
}

export function resendError(r: ResendResult, fallback: string): string {
  if (r.data?.message) return r.data.message;
  if (r.data?.error?.message) return r.data.error.message;
  if (r.data?.name) return r.data.name;
  return fallback + ' (HTTP ' + r.status + ')';
}
