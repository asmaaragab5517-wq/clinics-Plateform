import { NextResponse, type NextRequest } from 'next/server';
import { API_URL } from '@/lib/config';
import { ACCESS_COOKIE, REFRESH_COOKIE, apiHeaders, clearSessionCookies, csrfOk, isMutating, jsonError, refreshTokens, setSessionCookies, type Tokens } from '@/lib/session';

/** Patient API proxy (SEC-6, FR-WEB-6): attaches the bearer from httpOnly cookies, refreshes once on 401, never caches or logs. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ path: string[] }> };

const PASS_HEADERS = ['content-type', 'content-disposition', 'content-length', 'retry-after'];

async function handle(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  if (!path.length || path.some((s) => !s || s === '.' || s === '..' || s.length > 200)) return jsonError('not_found', 404);
  const mutating = isMutating(req.method);
  if (mutating && !csrfOk(req)) return jsonError('csrf', 403);

  let access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!access && !refresh) return jsonError('unauthorized', 401);

  let rotated: Tokens | null = null;
  let signOut = false;
  if (!access && refresh) {
    const r = await refreshTokens(req, refresh);
    if (r === 'error') return jsonError('network', 503);
    if (r === 'invalid') {
      const out = NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
      clearSessionCookies(out);
      return out;
    }
    rotated = r;
    access = r.accessToken;
  }

  const extra: Record<string, string> = {};
  const ct = req.headers.get('content-type');
  if (ct) extra['content-type'] = ct;
  const idem = req.headers.get('idempotency-key');
  if (idem) extra['idempotency-key'] = idem.slice(0, 100);
  const body = mutating ? await req.arrayBuffer() : undefined;
  const target = `${API_URL}/v1/portal/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const call = (token: string) =>
    fetch(target, {
      method: req.method,
      headers: apiHeaders(req, { ...extra, authorization: `Bearer ${token}` }),
      body: body && body.byteLength ? body : undefined,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });

  let up: Response;
  try {
    up = await call(access!);
    if (up.status === 401 && refresh && !rotated) {
      const r = await refreshTokens(req, refresh);
      if (typeof r === 'object') {
        await up.body?.cancel().catch(() => undefined);
        rotated = r;
        up = await call(r.accessToken);
      } else if (r === 'invalid') {
        signOut = true;
      }
    }
  } catch {
    return jsonError('network', 503);
  }

  const headers = new Headers({ 'cache-control': 'no-store, private', 'x-content-type-options': 'nosniff' });
  for (const h of PASS_HEADERS) {
    const v = up.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Binary responses (PDF, .ics) are streamed through untouched.
  const res = new NextResponse(up.body, { status: up.status, headers });
  if (rotated) setSessionCookies(res, rotated);
  if (signOut || (up.ok && req.method === 'POST' && path.join('/') === 'account/delete')) clearSessionCookies(res);
  return res;
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
