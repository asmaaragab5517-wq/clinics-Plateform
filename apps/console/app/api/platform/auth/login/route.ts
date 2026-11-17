import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/server/config';
import { discovery, platformRedirectUri } from '@/lib/server/oidc';
import { PLATFORM_COOKIE, safePlatformReturn } from '@/lib/server/platform';
import { randomToken, seal, sha256b64url } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Keycloak sign-in for platform administrators (authorization code + PKCE), separate from the staff flow. */
export async function GET(req: NextRequest) {
  const returnTo = safePlatformReturn(req.nextUrl.searchParams.get('returnTo'));
  if (serverConfig.authMode !== 'oidc') return NextResponse.redirect(new URL('/platform/login', serverConfig.consoleUrl));
  const d = await discovery();
  const verifier = randomToken(48);
  const state = randomToken(24);
  const nonce = randomToken(24);
  const url = new URL(d.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', serverConfig.clientId);
  url.searchParams.set('redirect_uri', platformRedirectUri());
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('code_challenge', sha256b64url(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('prompt', 'login');
  url.searchParams.set('ui_locales', req.cookies.get('hf_locale')?.value === 'en' ? 'en' : 'ar');
  const res = NextResponse.redirect(url);
  res.cookies.set(PLATFORM_COOKIE.oidc, seal({ verifier, state, nonce, returnTo }), { httpOnly: true, secure: serverConfig.secureCookies, sameSite: 'lax', path: '/api/platform/auth', maxAge: 600 });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
