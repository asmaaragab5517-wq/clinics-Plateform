import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/server/config';
import { csrfValid, jwtPayload, readSession, safeReturnTo, writeSession } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Fresh authentication for clinical sign-off (IAM-3). In OIDC mode the client is sent through Keycloak with
 * prompt=login; in dev mode a new dev token (new auth_time) is minted for the signed-in seeded user.
 */
export async function POST(req: NextRequest) {
  if (!csrfValid(req)) return NextResponse.json({ error: 'csrf_failed' }, { status: 403 });
  const s = readSession(req);
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { returnTo?: string };
  const returnTo = safeReturnTo(body.returnTo);
  if (serverConfig.authMode === 'oidc') {
    return NextResponse.json({ redirect: `/api/auth/login?prompt=login&returnTo=${encodeURIComponent(returnTo)}` });
  }
  if (!s.email) return NextResponse.json({ redirect: `/login?next=${encodeURIComponent(returnTo)}` });
  const r = await fetch(`${serverConfig.apiUrl}/v1/auth/dev/staff-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org': serverConfig.orgSlug },
    body: JSON.stringify({ email: s.email }),
    cache: 'no-store',
  }).catch(() => null);
  const j = r ? ((await r.json().catch(() => ({}))) as { accessToken?: string }) : {};
  if (!r?.ok || !j.accessToken) return NextResponse.json({ error: 'reauthentication_failed' }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  writeSession(res, { accessToken: j.accessToken, expiresAt: Number(jwtPayload(j.accessToken).exp ?? 0) * 1000 || Date.now() + 8 * 3600_000, email: s.email, mode: 'dev' });
  return res;
}
