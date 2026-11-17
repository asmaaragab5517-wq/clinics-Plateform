import type { NextRequest, NextResponse } from 'next/server';
import { serverConfig } from './config';
import { seal, unseal, type SessionTokens } from './session';

/**
 * Platform-admin session (FR-ADM-1). Kept entirely separate from the staff session: different httpOnly,
 * SameSite=Strict cookies sealed with the same AES-256-GCM key, read only by the `/api/platform/*` routes.
 */
export const PLATFORM_COOKIE = {
  access: 'hf_pat',
  refresh: 'hf_prt',
  id: 'hf_pit',
  who: 'hf_pwho',
  oidc: 'hf_poidc',
} as const;

export interface PlatformSession {
  accessToken: string;
  expiresAt: number;
  refreshToken: string | null;
  idToken: string | null;
  email: string | null;
  mode: 'dev' | 'oidc';
}

function cookie(maxAge: number) {
  return { httpOnly: true, secure: serverConfig.secureCookies, sameSite: 'strict' as const, path: '/', maxAge };
}

export function readPlatformSession(req: NextRequest): PlatformSession | null {
  const at = unseal<{ t: string; exp: number }>(req.cookies.get(PLATFORM_COOKIE.access)?.value);
  const rt = unseal<{ t: string; exp: number | null }>(req.cookies.get(PLATFORM_COOKIE.refresh)?.value);
  if (!at && !rt) return null;
  const who = unseal<{ email: string | null; mode: 'dev' | 'oidc' }>(req.cookies.get(PLATFORM_COOKIE.who)?.value);
  return {
    accessToken: at?.t ?? '',
    expiresAt: at?.exp ?? 0,
    refreshToken: rt && (!rt.exp || rt.exp > Date.now()) ? rt.t : null,
    idToken: unseal<{ t: string }>(req.cookies.get(PLATFORM_COOKIE.id)?.value)?.t ?? null,
    email: who?.email ?? null,
    mode: who?.mode ?? serverConfig.authMode,
  };
}

export function writePlatformSession(res: NextResponse, s: SessionTokens) {
  const accessAge = Math.max(60, Math.floor((s.expiresAt - Date.now()) / 1000));
  const sessionAge = s.refreshExpiresAt ? Math.max(accessAge, Math.floor((s.refreshExpiresAt - Date.now()) / 1000)) : accessAge;
  res.cookies.set(PLATFORM_COOKIE.access, seal({ t: s.accessToken, exp: s.expiresAt }), cookie(accessAge));
  if (s.refreshToken) res.cookies.set(PLATFORM_COOKIE.refresh, seal({ t: s.refreshToken, exp: s.refreshExpiresAt ?? null }), cookie(sessionAge));
  if (s.idToken) res.cookies.set(PLATFORM_COOKIE.id, seal({ t: s.idToken }), cookie(sessionAge));
  res.cookies.set(PLATFORM_COOKIE.who, seal({ email: s.email ?? null, mode: s.mode }), cookie(sessionAge));
}

export function clearPlatformSession(res: NextResponse) {
  for (const name of [PLATFORM_COOKIE.access, PLATFORM_COOKIE.refresh, PLATFORM_COOKIE.id, PLATFORM_COOKIE.who]) res.cookies.set(name, '', { ...cookie(0), maxAge: 0 });
}

/** Only allow relative return paths inside the platform area. */
export function safePlatformReturn(v: string | null | undefined): string {
  if (!v || !v.startsWith('/platform') || v.startsWith('//')) return '/platform';
  return v;
}
