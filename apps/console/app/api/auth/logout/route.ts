import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/server/config';
import { discovery } from '@/lib/server/oidc';
import { clearSession, csrfValid, readSession } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!csrfValid(req)) return NextResponse.json({ error: 'csrf_failed' }, { status: 403 });
  const s = readSession(req);
  let redirect = '/login';
  if (serverConfig.authMode === 'oidc') {
    try {
      const d = await discovery();
      if (d.end_session_endpoint) {
        const u = new URL(d.end_session_endpoint);
        u.searchParams.set('client_id', serverConfig.clientId);
        u.searchParams.set('post_logout_redirect_uri', `${serverConfig.consoleUrl}/login`);
        if (s?.idToken) u.searchParams.set('id_token_hint', s.idToken);
        redirect = u.toString();
      }
    } catch {
      // fall back to the local sign-in page
    }
  }
  const res = NextResponse.json({ ok: true, redirect });
  clearSession(res);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
