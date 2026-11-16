import { NextResponse, type NextRequest } from 'next/server';
import { API_URL, ORG_SLUG } from '@/lib/config';
import { jsonError } from '@/lib/session';

/** Read-only proxy for catalogue data used by client components (booking wizard, reschedule). No PHI. */
export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['slots', 'doctors', 'services', 'clinics', 'specialties', 'org', 'packages']);

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (!path.length || path.length > 2 || !ALLOWED.has(path[0]!) || path.some((s) => !/^[\w\-؀-ۿ%]{1,120}$/.test(s))) return jsonError('not_found', 404);
  const live = path[0] === 'slots';
  try {
    const r = await fetch(`${API_URL}/v1/public/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`, {
      headers: { 'x-org': ORG_SLUG, accept: 'application/json' },
      ...(live ? { cache: 'no-store' as const } : { next: { revalidate: 60 } }),
      signal: AbortSignal.timeout(10_000),
    });
    const data: unknown = await r.json().catch(() => ({ error: 'internal_error' }));
    return NextResponse.json(data, { status: r.status, headers: { 'cache-control': live ? 'no-store' : 'public, max-age=60' } });
  } catch {
    return jsonError('network', 503);
  }
}
