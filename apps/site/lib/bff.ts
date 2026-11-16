import { has, t, tDyn, type Locale } from './i18n';

/** Browser-side client for the BFF (`/api/*`). Tokens never touch JS; only the CSRF double-submit token does. */
export class BffError extends Error {
  constructor(public code: string, public status: number, public details?: unknown) {
    super(code);
  }
}

function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const m = /(?:^|;\s*)hf_csrf=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]!) : '';
}

export interface BffInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  json?: unknown;
  form?: FormData;
  idempotencyKey?: string;
}

export async function bff<T>(url: string, init: BffInit = {}): Promise<T> {
  const method = init.method ?? (init.json !== undefined || init.form ? 'POST' : 'GET');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken();
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  if (init.idempotencyKey) headers['idempotency-key'] = init.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined), credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new BffError('network', 0);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const b = (data ?? {}) as { error?: string; details?: unknown };
    throw new BffError(res.status === 401 && !b.error?.startsWith('otp_') ? 'unauthorized' : b.error ?? 'internal_error', res.status, b.details);
  }
  return data as T;
}

export function errorText(locale: Locale, e: unknown): string {
  const code = e instanceof BffError ? e.code : 'internal_error';
  if (e instanceof BffError && code === 'validation_failed' && Array.isArray(e.details)) {
    const msg = (e.details as { message?: string }[]).map((d) => d.message).find((m) => m && has(`error.${m}`));
    if (msg) return tDyn(locale, `error.${msg}`);
  }
  if (code.startsWith('national_id_')) return t(locale, 'patient.nationalIdInvalid');
  return has(`error.${code}`) ? tDyn(locale, `error.${code}`) : t(locale, 'common.error');
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** sessionStorage helpers: may throw in private mode or when storage is blocked. */
export function loadSession<T>(key: string): T | null {
  try {
    const v = window.sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
export function saveSession(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the wizard still works, it just is not resumable */
  }
}
export function clearSession(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
