export interface EmailRecord {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  status: 'sent' | 'scheduled' | 'cancelled';
  created_at: string;
  scheduled_at: string | null;
  attachments?: number;
  last_event?: string;
}

const LEDGER_CAP = 250;

export async function readIndex(env: Env): Promise<EmailRecord[]> {
  const raw = await env.EMAILS.get('index');
  if (!raw) return [];
  try {
    return JSON.parse(raw) as EmailRecord[];
  } catch {
    return [];
  }
}

export async function writeIndex(env: Env, arr: EmailRecord[]): Promise<void> {
  await env.EMAILS.put('index', JSON.stringify(arr.slice(0, LEDGER_CAP)));
}

export function splitAddrs(s: unknown): string[] {
  if (!s) return [];
  return String(s)
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
