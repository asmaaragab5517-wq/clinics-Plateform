import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/server/config';
import { discovery, exchangeCode } from '@/lib/server/oidc';
import { COOKIE, jwtPayload, safeReturnTo, unseal, writeSession } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function htmlRedirect(to: string, status = 200) {
  // A same-site navigation (meta refresh) so SameSite=Strict session cookies are sent on the next request.
  const safe = to.replace(/[^\w\-/?=&%.~]/g, '');
  return new NextResponse(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safe}"><title>HealthFlow</title>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function GET(req: NextRequest) {
  if (serverConfig.authMode !== 'oidc') return htmlRedirect('/login');
  const p = req.nextUrl.searchParams;
  const pending = unseal<{ verifier: string; state: string; nonce: string; returnTo: string; again?: boolean }>(req.cookies.get(COOKIE.oidc)?.value);
  const code = p.get('code');
  if (!pending || !code || p.get('state') !== pending.state) return htmlRedirect('/login?error=state', 400);
  try {
    const tokens = await exchangeCode(code, pending.verifier, pending.nonce);
    // The API accepts only tokens whose `amr` names an OTP method. The sign-in that enrols the authenticator app
    // does not count as one, so the person is asked to sign in once more with a code instead of meeting a 401.
    const amr = jwtPayload(tokens.accessToken).amr;
    if (!(Array.isArray(amr) && amr.some((m) => ['otp', 'totp', 'mfa'].includes(String(m))))) {
      const next = pending.again ? '/login?error=mfa' : `/login?notice=mfa_enrolled&next=${encodeURIComponent(safeReturnTo(pending.returnTo))}`;
      // End the Keycloak session first: a re-authentication inside the enrolment session would still carry no OTP
      // method, while a fresh sign-in with the new code does.
      let to = next;
      const d = await discovery().catch(() => null);
      if (d?.end_session_endpoint && tokens.idToken) {
        const u = new URL(d.end_session_endpoint);
        u.searchParams.set('client_id', serverConfig.clientId);
        u.searchParams.set('id_token_hint', tokens.idToken);
        u.searchParams.set('post_logout_redirect_uri', `${serverConfig.consoleUrl}${next}`);
        to = u.toString();
      }
      const res = to === next ? htmlRedirect(next) : NextResponse.redirect(to, 303);
      res.cookies.set(COOKIE.oidc, '', { path: '/api/auth', maxAge: 0 });
      res.headers.set('cache-control', 'no-store');
      return res;
    }
    const res = htmlRedirect(safeReturnTo(pending.returnTo));
    writeSession(res, tokens);
    res.cookies.set(COOKIE.oidc, '', { path: '/api/auth', maxAge: 0 });
    return res;
  } catch {
    return htmlRedirect('/login?error=exchange', 400);
  }
}
