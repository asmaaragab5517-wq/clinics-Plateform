import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/server/config';
import { exchangeCode, platformRedirectUri } from '@/lib/server/oidc';
import { PLATFORM_COOKIE, safePlatformReturn, writePlatformSession } from '@/lib/server/platform';
import { unseal } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function htmlRedirect(to: string, status = 200) {
  // Same-site navigation so the SameSite=Strict platform cookies are sent on the next request.
  const safe = to.replace(/[^\w\-/?=&%.~]/g, '');
  return new NextResponse(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safe}"><title>HealthFlow</title>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function GET(req: NextRequest) {
  if (serverConfig.authMode !== 'oidc') return htmlRedirect('/platform/login');
  const p = req.nextUrl.searchParams;
  const pending = unseal<{ verifier: string; state: string; nonce: string; returnTo: string }>(req.cookies.get(PLATFORM_COOKIE.oidc)?.value);
  const code = p.get('code');
  if (!pending || !code || p.get('state') !== pending.state) return htmlRedirect('/platform/login?error=state', 400);
  try {
    const tokens = await exchangeCode(code, pending.verifier, pending.nonce, platformRedirectUri());
    const res = htmlRedirect(safePlatformReturn(pending.returnTo));
    writePlatformSession(res, tokens);
    res.cookies.set(PLATFORM_COOKIE.oidc, '', { path: '/api/platform/auth', maxAge: 0 });
    return res;
  } catch {
    return htmlRedirect('/platform/login?error=exchange', 400);
  }
}
