/** Browser client for the BFF proxy (`/api/v1/*`). Tokens stay server-side; mutations carry the CSRF token. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

let lastActivity = Date.now();
export function markActivity() {
  lastActivity = Date.now();
}
export function msSinceActivity() {
  return Date.now() - lastActivity;
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1] ?? '') : null;
}

export function writeCookie(name: string, value: string, maxAgeDays = 365) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeDays * 86400}; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** BFF prefix: the staff proxy by default, `/api/platform/v1` for the platform-admin area. */
  base?: string;
}

export const STAFF_BASE = '/api/v1';
export const PLATFORM_BASE = '/api/platform/v1';

export function csrfHeaders(): Record<string, string> {
  return { 'x-csrf-token': readCookie('hf_csrf') ?? '' };
}

export async function api<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') Object.assign(headers, csrfHeaders());
  // Only user activity keeps the shared-PC session alive (IAM-2 idle timeout is enforced by the BFF too).
  if (msSinceActivity() < 5 * 60_000) headers['x-hf-activity'] = '1';
  if (init.idempotencyKey) headers['idempotency-key'] = init.idempotencyKey;
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const base = init.base ?? STAFF_BASE;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method, headers, body, credentials: 'same-origin', cache: 'no-store', signal: init.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network_error');
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const j = (parsed ?? {}) as { error?: unknown; details?: unknown };
    const code = typeof j.error === 'string' ? j.error : `http_${res.status}`;
    if (typeof window !== 'undefined' && base === PLATFORM_BASE) {
      if (res.status === 401) window.dispatchEvent(new CustomEvent('hf:platform-unauthorized'));
    } else if (typeof window !== 'undefined') {
      if (res.status === 401 && code === 'session_locked') window.dispatchEvent(new CustomEvent('hf:locked'));
      if (res.status === 401 && code === 'unauthorized') window.dispatchEvent(new CustomEvent('hf:unauthorized'));
    }
    throw new ApiError(res.status, code, j.details);
  }
  return parsed as T;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, body: unknown = {}, idempotencyKey?: string) => api<T>(path, { method: 'POST', body, idempotencyKey });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
export const upload = <T>(path: string, form: FormData) => api<T>(path, { method: 'POST', form });

/** Platform-admin BFF (separate session cookie). */
export const pGet = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal, base: PLATFORM_BASE });
export const pPost = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body, base: PLATFORM_BASE });
export const pPatch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body, base: PLATFORM_BASE });

/** Build a query string, dropping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

/** Sign-off and prescription issue need a fresh authentication (IAM-3). Returns true when the token was refreshed in place. */
export async function reauthenticate(returnTo: string): Promise<boolean> {
  const r = await fetch('/api/auth/reauth', { method: 'POST', headers: { 'content-type': 'application/json', ...csrfHeaders() }, body: JSON.stringify({ returnTo }) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; redirect?: string };
  if (j.redirect) {
    window.location.assign(j.redirect);
    return false;
  }
  return !!j.ok;
}

export async function logout() {
  const r = await fetch('/api/auth/logout', { method: 'POST', headers: csrfHeaders() }).catch(() => null);
  const j = r ? ((await r.json().catch(() => ({}))) as { redirect?: string }) : {};
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  window.location.assign(j.redirect ?? '/login');
}
