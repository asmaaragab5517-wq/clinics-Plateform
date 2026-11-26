import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/server/config';
import { discovery, redirectUri } from '@/lib/server/oidc';
import { COOKIE, randomToken, safeReturnTo, seal, sha256b64url } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** OIDC authorization-code + PKCE start (IAM-2). `prompt=login` forces a fresh authentication (IAM-3 sign-off). */
export async function GET(req: NextRequest) {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get('returnTo'));
  if (serverConfig.authMode !== 'oidc') return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(returnTo)}`, serverConfig.consoleUrl));
  const d = await discovery();
  const verifier = randomToken(48);
  const state = randomToken(24);
  const nonce = randomToken(24);
  const url = new URL(d.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', serverConfig.clientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('code_challenge', sha256b64url(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  const locale = req.cookies.get('hf_locale')?.value === 'en' ? 'en' : 'ar';
  url.searchParams.set('ui_locales', locale);
  // prompt=login forces a fresh sign-in (new auth_time). Not max_age=0: Keycloak then drops every AMR value as too
  // old, the token carries no OTP method and the API refuses it.
  if (req.nextUrl.searchParams.get('prompt') === 'login') url.searchParams.set('prompt', 'login');
  const res = NextResponse.redirect(url);
  // Lax (not Strict): the cookie must survive the top-level cross-site redirect back from Keycloak.
  res.cookies.set(COOKIE.oidc, seal({ verifier, state, nonce, returnTo, again: req.nextUrl.searchParams.get('again') === '1' }), {
    httpOnly: true,
    secure: serverConfig.secureCookies,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 600,
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
