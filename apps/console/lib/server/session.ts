import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { IDLE_TIMEOUT_MS, serverConfig } from './config';

/**
 * Server-side session for the BFF (SEC-6). Tokens never reach browser JavaScript: they live in
 * httpOnly, SameSite=Strict cookies whose values are sealed with AES-256-GCM using SESSION_SECRET.
 */

export const COOKIE = {
  access: 'hf_at',
  refresh: 'hf_rt',
  id: 'hf_it',
  who: 'hf_who',
  seen: 'hf_seen',
  oidc: 'hf_oidc',
  csrf: 'hf_csrf',
} as const;

function key(): Buffer {
  return createHash('sha256').update(`hf-console-session:${serverConfig.sessionSecret}`).digest();
}

export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

export function unseal<T>(sealed: string | undefined | null): T | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, 'base64url');
    if (raw.length < 29) return null;
    const d = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const pt = Buffer.concat([d.update(raw.subarray(28)), d.final()]);
    return JSON.parse(pt.toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256b64url(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

/** Decode a JWT payload without verifying it (the API verifies every token it receives). */
export function jwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) return {};
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface SessionTokens {
  accessToken: string;
  expiresAt: number; // epoch ms
  refreshToken?: string | null;
  refreshExpiresAt?: number | null;
  idToken?: string | null;
  email?: string | null;
  mode: 'dev' | 'oidc';
}

export interface Session {
  accessToken: string;
  expiresAt: number;
  refreshToken: string | null;
  idToken: string | null;
  email: string | null;
  mode: 'dev' | 'oidc';
  seenAt: number | null;
}

export function readSession(req: NextRequest): Session | null {
  const at = unseal<{ t: string; exp: number }>(req.cookies.get(COOKIE.access)?.value);
  const rt = unseal<{ t: string; exp: number | null }>(req.cookies.get(COOKIE.refresh)?.value);
  if (!at && !rt) return null;
  const who = unseal<{ email: string | null; mode: 'dev' | 'oidc' }>(req.cookies.get(COOKIE.who)?.value);
  const seen = unseal<{ at: number }>(req.cookies.get(COOKIE.seen)?.value);
  return {
    accessToken: at?.t ?? '',
    expiresAt: at?.exp ?? 0,
    refreshToken: rt && (!rt.exp || rt.exp > Date.now()) ? rt.t : null,
    idToken: unseal<{ t: string }>(req.cookies.get(COOKIE.id)?.value)?.t ?? null,
    email: who?.email ?? null,
    mode: who?.mode ?? serverConfig.authMode,
    seenAt: seen?.at ?? null,
  };
}

function baseCookie(maxAgeSeconds: number) {
  return { httpOnly: true, secure: serverConfig.secureCookies, sameSite: 'strict' as const, path: '/', maxAge: maxAgeSeconds };
}

export function writeSession(res: NextResponse, s: SessionTokens) {
  const accessAge = Math.max(60, Math.floor((s.expiresAt - Date.now()) / 1000));
  const sessionAge = s.refreshExpiresAt ? Math.max(accessAge, Math.floor((s.refreshExpiresAt - Date.now()) / 1000)) : accessAge;
  res.cookies.set(COOKIE.access, seal({ t: s.accessToken, exp: s.expiresAt }), baseCookie(accessAge));
  if (s.refreshToken) res.cookies.set(COOKIE.refresh, seal({ t: s.refreshToken, exp: s.refreshExpiresAt ?? null }), baseCookie(sessionAge));
  if (s.idToken) res.cookies.set(COOKIE.id, seal({ t: s.idToken }), baseCookie(sessionAge));
  res.cookies.set(COOKIE.who, seal({ email: s.email ?? null, mode: s.mode }), baseCookie(sessionAge));
  markSeen(res, sessionAge);
  ensureCsrf(res, null, sessionAge);
}

export function markSeen(res: NextResponse, maxAge = 12 * 3600) {
  res.cookies.set(COOKIE.seen, seal({ at: Date.now() }), baseCookie(maxAge));
}

/** Double-submit CSRF token: readable by the page (not httpOnly), SameSite=Strict. */
export function ensureCsrf(res: NextResponse, existing: string | null, maxAge = 12 * 3600) {
  if (existing) return;
  res.cookies.set(COOKIE.csrf, randomToken(24), { httpOnly: false, secure: serverConfig.secureCookies, sameSite: 'strict', path: '/', maxAge });
}

export function clearSession(res: NextResponse) {
  for (const name of [COOKIE.access, COOKIE.refresh, COOKIE.id, COOKIE.who, COOKIE.seen]) {
    res.cookies.set(name, '', { ...baseCookie(0), maxAge: 0 });
  }
}

export function isLocked(s: Session): boolean {
  return !s.seenAt || Date.now() - s.seenAt > IDLE_TIMEOUT_MS;
}

/** Same-origin check for state-changing BFF requests (defence in depth with the CSRF token). */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // same-origin fetches from older browsers may omit Origin; CSRF token still required
  try {
    const o = new URL(origin);
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    return o.host === host || origin === serverConfig.consoleUrl;
  } catch {
    return false;
  }
}

export function csrfValid(req: NextRequest): boolean {
  const cookie = req.cookies.get(COOKIE.csrf)?.value;
  const header = req.headers.get('x-csrf-token');
  return !!cookie && !!header && cookie.length >= 16 && cookie === header && sameOrigin(req);
}

/** Only allow relative in-app return paths (no open redirects). */
export function safeReturnTo(v: string | null | undefined): string {
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || v.startsWith('/api/')) return '/';
  return v;
}
