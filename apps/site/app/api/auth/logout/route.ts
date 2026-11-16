import { NextResponse, type NextRequest } from 'next/server';
import { API_URL } from '@/lib/config';
import { ACCESS_COOKIE, REFRESH_COOKIE, apiHeaders, clearSessionCookies, csrfOk, jsonError, refreshTokens } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!csrfOk(req)) return jsonError('csrf', 403);
  let access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!access && refresh) {
    const r = await refreshTokens(req, refresh);
    if (typeof r === 'object') access = r.accessToken;
  }
  if (access) {
    // Revokes every refresh token of the account on the API; failures still clear the local session.
    await fetch(`${API_URL}/v1/auth/logout`, { method: 'POST', headers: apiHeaders(req, { authorization: `Bearer ${access}` }), cache: 'no-store', signal: AbortSignal.timeout(10_000) }).catch(() => null);
  }
  const res = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  clearSessionCookies(res);
  return res;
}
