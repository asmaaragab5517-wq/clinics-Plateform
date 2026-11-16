import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from './config';

/**
 * The waiting-room screen authenticates with a long-lived, clinic-bound display token (FR-APT-6).
 * Browser EventSource cannot send headers, so the BFF takes the token from the query and forwards it as a bearer.
 */
export async function proxyDisplay(req: NextRequest, upstreamPath: 'display/state' | 'display/stream') {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let upstream: Response;
  try {
    upstream = await fetch(`${serverConfig.apiUrl}/v1/${upstreamPath}`, {
      headers: { authorization: `Bearer ${token}`, accept: upstreamPath === 'display/stream' ? 'text/event-stream' : 'application/json' },
      cache: 'no-store',
      signal: req.signal,
    });
  } catch {
    return NextResponse.json({ error: 'api_unreachable' }, { status: 502 });
  }
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
  if (upstreamPath === 'display/stream') {
    headers.set('Connection', 'keep-alive');
    headers.set('X-Accel-Buffering', 'no');
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
