import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { API_URL, ORG_SLUG } from './config';

/**
 * Backend-for-frontend session (SEC-6). Patient tokens live only in httpOnly, SameSite=Strict cookies;
 * the browser never sees them. Mutating requests carry a double-submit CSRF token.
 */
export const ACCESS_COOKIE = 'hf_at';
export const REFRESH_COOKIE = 'hf_rt';
export const CSRF_COOKIE = 'hf_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_S = 30 * 24 * 3600;

const secure = () => process.env.NODE_ENV === 'production' && process.env.COOKIE_INSECURE !== '1';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export function setSessionCookies(res: NextResponse, tokens: Tokens): void {
  // Access token slightly shorter than its JWT lifetime so we refresh before the API rejects it.
  res.cookies.set(ACCESS_COOKIE, tokens.accessToken, { httpOnly: true, secure: secure(), sameSite: 'strict', path: '/api', maxAge: ACCESS_TTL_S - 30 });
  res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, { httpOnly: true, secure: secure(), sameSite: 'strict', path: '/', maxAge: REFRESH_TTL_S });
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(ACCESS_COOKIE, '', { httpOnly: true, secure: secure(), sameSite: 'strict', path: '/api', maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, '', { httpOnly: true, secure: secure(), sameSite: 'strict', path: '/', maxAge: 0 });
}

/** Double-submit check for every mutating BFF request, plus a same-origin check when the browser sends Origin. */
export function csrfOk(req: NextRequest): boolean {
  const cookie = req.cookies.get(CSRF_COOKIE)?.value ?? '';
  const header = req.headers.get(CSRF_HEADER) ?? '';
  if (!cookie || cookie.length < 16 || cookie.length !== header.length) return false;
  if (!timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) return false;
  const origin = req.headers.get('origin');
  if (origin) {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function isMutating(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

/** Headers for calls to the API on behalf of the browser. Only safe metadata is forwarded. */
export function apiHeaders(req: NextRequest, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { 'x-org': ORG_SLUG, 'x-client': 'site', accept: req.headers.get('accept') ?? 'application/json', ...extra };
  const ua = req.headers.get('user-agent');
  if (ua) h['user-agent'] = ua.slice(0, 200);
  // The API trusts one proxy hop for OTP per-IP limits; pass the client address our own edge recorded (not a client-supplied chain).
  const ip = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',').pop()?.trim();
  if (ip && /^[\d.:a-fA-F]{3,45}$/.test(ip)) h['x-forwarded-for'] = ip;
  const lang = req.headers.get('accept-language');
  if (lang) h['accept-language'] = lang.slice(0, 50);
  return h;
}

// Refresh tokens rotate with reuse detection, so concurrent refreshes of the same token must be collapsed into one call.
const inflight = new Map<string, { at: number; p: Promise<RefreshOutcome> }>();
const DEDUPE_MS = 20_000;

/** 'invalid' = the API rejected the refresh token (sign out); 'error' = API unreachable (keep the session). */
export type RefreshOutcome = Tokens | 'invalid' | 'error';

export function refreshTokens(req: NextRequest, refreshToken: string): Promise<RefreshOutcome> {
  const key = createHash('sha256').update(refreshToken).digest('hex');
  const now = Date.now();
  for (const [k, v] of inflight) if (now - v.at > DEDUPE_MS) inflight.delete(k);
  const hit = inflight.get(key);
  if (hit) return hit.p;
  const p = (async () => {
    try {
      const r = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: apiHeaders(req, { 'content-type': 'application/json', accept: 'application/json' }),
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (r.status === 401 || r.status === 400 || r.status === 403) return 'invalid';
      if (!r.ok) return 'error';
      const b = (await r.json()) as Partial<Tokens>;
      return b.accessToken && b.refreshToken ? { accessToken: b.accessToken, refreshToken: b.refreshToken } : 'error';
    } catch {
      return 'error';
    }
  })();
  inflight.set(key, { at: now, p });
  return p;
}

export function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
