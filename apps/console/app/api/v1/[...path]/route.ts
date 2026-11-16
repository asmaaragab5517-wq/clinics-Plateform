import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/server/config';
import { refreshTokens } from '@/lib/server/oidc';
import { clearSession, csrfValid, isLocked, markSeen, readSession, writeSession, type SessionTokens } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Allowed while the idle lock screen is up (IAM-2): the PIN re-unlock and the identity used to draw the lock screen. */
const LOCK_EXEMPT = new Set(['auth/pin/verify', 'auth/me']);
const FORWARD_REQUEST_HEADERS = ['content-type', 'accept', 'idempotency-key', 'accept-language', 'user-agent'];
const FORWARD_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'content-length', 'etag', 'last-modified'];

function json(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (!path.length || path.some((s) => !s || s === '.' || s === '..' || s.includes('\\'))) return json(400, 'invalid_path');
  const joined = path.join('/');
  const method = req.method.toUpperCase();
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);

  if (mutating && !csrfValid(req)) return json(403, 'csrf_failed');

  const session = readSession(req);
  if (!session) return json(401, 'unauthorized');
  if (isLocked(session) && !LOCK_EXEMPT.has(joined)) return json(401, 'session_locked');

  // Refresh the access token server-side when it is about to expire (OIDC only).
  let refreshed: SessionTokens | null = null;
  let accessToken = session.accessToken;
  if (session.expiresAt - Date.now() < 30_000) {
    if (session.mode === 'oidc' && session.refreshToken) {
      try {
        refreshed = await refreshTokens(session.refreshToken);
        accessToken = refreshed.accessToken;
      } catch {
        const r = json(401, 'unauthorized');
        clearSession(r);
        return r;
      }
    } else {
      const r = json(401, 'unauthorized');
      clearSession(r);
      return r;
    }
  }

  const upstreamUrl = `${serverConfig.apiUrl}/v1/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
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
    upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body: mutating ? await req.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: req.signal,
    });
  } catch {
    return json(502, 'api_unreachable');
  }

  const out = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  const isSse = (upstream.headers.get('content-type') ?? '').includes('text/event-stream');
  if (isSse) {
    out.delete('content-length');
    out.set('Connection', 'keep-alive');
    out.set('X-Accel-Buffering', 'no');
  }

  // Binary (PDF/CSV/XLSX) and SSE bodies are streamed through untouched.
  const res = new NextResponse(upstream.body, { status: upstream.status, headers: out });
  if (refreshed) writeSession(res, refreshed);
  const activity = req.headers.get('x-hf-activity') === '1';
  if (upstream.ok && ((joined === 'auth/pin/verify' && method === 'POST') || (activity && !isLocked(session)))) markSeen(res);
  return res;
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
