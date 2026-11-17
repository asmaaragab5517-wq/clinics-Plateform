import { NextResponse, type NextRequest } from 'next/server';
import { API_URL } from '@/lib/config';
import { ACCESS_COOKIE, REFRESH_COOKIE, apiHeaders, clearSessionCookies, csrfOk, jsonError, refreshTokens } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Signs out this browser only (revokes this session's refresh-token family) unless `{ allDevices: true }` is posted,
 * which revokes every session of the account. Failures still clear the local session.
 */
export async function POST(req: NextRequest) {
  if (!csrfOk(req)) return jsonError('csrf', 403);
  const body = (await req.json().catch(() => null)) as { allDevices?: unknown } | null;
  const allDevices = body?.allDevices === true;
  let access = req.cookies.get(ACCESS_COOKIE)?.value;
  let refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!access && refresh) {
    const r = await refreshTokens(req, refresh);
    if (typeof r === 'object') {
      access = r.accessToken;
      refresh = r.refreshToken;
    }
  }
  if (access) {
    // "This device" = this browser's refresh-token family. Never send an empty body: the API reads that as "all devices".
    const payload = allDevices ? { allDevices: true } : refresh ? { refreshToken: refresh } : null;
    if (payload)
      await fetch(`${API_URL}/v1/auth/logout`, {
        method: 'POST',
        headers: apiHeaders(req, { authorization: `Bearer ${access}`, 'content-type': 'application/json' }),
        body: JSON.stringify(payload),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
  }
  const res = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  clearSessionCookies(res);
  return res;
}
