import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/server/config';
import { refreshTokens } from '@/lib/server/oidc';
import { clearPlatformSession, readPlatformSession, writePlatformSession } from '@/lib/server/platform';
import { csrfValid, type SessionTokens } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * BFF proxy for the platform-admin area. It forwards only to `/v1/platform/*` and only with the platform-admin
 * token from its own cookies, so a staff session can never reach platform routes through here (and vice versa).
 */
const FORWARD_REQUEST_HEADERS = ['content-type', 'accept', 'accept-language', 'user-agent'];
const FORWARD_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'content-length'];

function json(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (!path.length || path.some((s) => !s || s === '.' || s === '..' || s.includes('\\'))) return json(400, 'invalid_path');
  const method = req.method.toUpperCase();
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (mutating && !csrfValid(req)) return json(403, 'csrf_failed');

  const session = readPlatformSession(req);
  if (!session) return json(401, 'unauthorized');
  let accessToken = session.accessToken;
  let refreshed: SessionTokens | null = null;
  if (session.expiresAt - Date.now() < 30_000) {
    if (session.mode === 'oidc' && session.refreshToken) {
      try {
        refreshed = await refreshTokens(session.refreshToken);
        accessToken = refreshed.accessToken;
      } catch {
        const r = json(401, 'unauthorized');
        clearPlatformSession(r);
        return r;
      }
    } else {
      const r = json(401, 'unauthorized');
      clearPlatformSession(r);
      return r;
    }
  }

  const upstreamUrl = `${serverConfig.apiUrl}/v1/platform/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers = new Headers();
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set('authorization', `Bearer ${accessToken}`);
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) headers.set('x-forwarded-for', fwd);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { method, headers, body: mutating ? await req.arrayBuffer() : undefined, redirect: 'manual', cache: 'no-store', signal: req.signal });
  } catch {
    return json(502, 'api_unreachable');
  }
  const out = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  const res = new NextResponse(upstream.body, { status: upstream.status, headers: out });
  if (refreshed) writePlatformSession(res, { ...refreshed, mode: 'oidc' });
  return res;
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
