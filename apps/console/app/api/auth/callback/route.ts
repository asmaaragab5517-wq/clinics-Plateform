import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/server/config';
import { exchangeCode } from '@/lib/server/oidc';
import { COOKIE, safeReturnTo, unseal, writeSession } from '@/lib/server/session';

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
  const pending = unseal<{ verifier: string; state: string; nonce: string; returnTo: string }>(req.cookies.get(COOKIE.oidc)?.value);
  const code = p.get('code');
  if (!pending || !code || p.get('state') !== pending.state) return htmlRedirect('/login?error=state', 400);
  try {
    const tokens = await exchangeCode(code, pending.verifier, pending.nonce);
    const res = htmlRedirect(safeReturnTo(pending.returnTo));
    writeSession(res, tokens);
    res.cookies.set(COOKIE.oidc, '', { path: '/api/auth', maxAge: 0 });
    return res;
  } catch {
    return htmlRedirect('/login?error=exchange', 400);
  }
}
