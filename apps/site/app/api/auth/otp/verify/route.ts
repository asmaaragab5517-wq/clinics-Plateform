import { NextResponse, type NextRequest } from 'next/server';
import { normalisePhone, toWesternDigits } from '@hf/shared';
import { API_URL } from '@/lib/config';
import { apiHeaders, csrfOk, jsonError, setSessionCookies } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!csrfOk(req)) return jsonError('csrf', 403);
  const body = (await req.json().catch(() => null)) as { phone?: unknown; code?: unknown } | null;
  const phone = typeof body?.phone === 'string' ? normalisePhone(body.phone) : null;
  const code = typeof body?.code === 'string' ? toWesternDigits(body.code).replace(/\D/g, '') : '';
  if (!phone) return jsonError('invalid_phone', 400);
  if (!/^\d{6}$/.test(code)) return jsonError('otp_invalid', 400);
  try {
    const r = await fetch(`${API_URL}/v1/auth/otp/verify`, {
      method: 'POST',
      headers: apiHeaders(req, { 'content-type': 'application/json', accept: 'application/json' }),
      body: JSON.stringify({ phone, code, deviceId: 'web' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await r.json().catch(() => ({ error: 'internal_error' }))) as { accessToken?: string; refreshToken?: string; locale?: string; error?: string };
    if (!r.ok || !data.accessToken || !data.refreshToken) return NextResponse.json({ error: data.error ?? 'otp_invalid' }, { status: r.ok ? 502 : r.status, headers: { 'cache-control': 'no-store' } });
    // Tokens go into httpOnly cookies only; the response body never carries them (SEC-6).
    const res = NextResponse.json({ ok: true, locale: data.locale ?? 'ar' }, { headers: { 'cache-control': 'no-store' } });
    setSessionCookies(res, { accessToken: data.accessToken, refreshToken: data.refreshToken });
    return res;
  } catch {
    return jsonError('network', 503);
  }
}
