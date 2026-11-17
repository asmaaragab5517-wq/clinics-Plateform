import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/server/config';
import { writePlatformSession } from '@/lib/server/platform';
import { jwtPayload, sameOrigin } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Development sign-in for platform administrators (AUTH_MODE=dev, non-production API only). */
export async function POST(req: NextRequest) {
  if (serverConfig.authMode !== 'dev') return NextResponse.json({ error: 'dev_auth_disabled' }, { status: 403 });
  if (!sameOrigin(req)) return NextResponse.json({ error: 'csrf_failed' }, { status: 403 });
  let email = '';
  try {
    email = String(((await req.json()) as { email?: unknown }).email ?? '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'validation_failed' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return NextResponse.json({ error: 'validation_failed' }, { status: 400 });
  let r: Response;
  try {
    r = await fetch(`${serverConfig.apiUrl}/v1/auth/dev/platform-token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }), cache: 'no-store' });
  } catch {
    return NextResponse.json({ error: 'api_unreachable' }, { status: 502 });
  }
  const body = (await r.json().catch(() => ({}))) as { accessToken?: string; error?: string };
  if (!r.ok || !body.accessToken) return NextResponse.json({ error: body.error ?? 'unknown_admin' }, { status: r.status || 400 });
  const exp = Number(jwtPayload(body.accessToken).exp ?? 0) * 1000 || Date.now() + 8 * 3600_000;
  const res = NextResponse.json({ ok: true });
  writePlatformSession(res, { accessToken: body.accessToken, expiresAt: exp, email, mode: 'dev' });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
