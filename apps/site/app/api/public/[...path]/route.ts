import { NextResponse, type NextRequest } from 'next/server';
import { API_URL, ORG_SLUG } from '@/lib/config';
import { apiHeaders, csrfOk, jsonError } from '@/lib/session';

/** Read-only proxy for catalogue data used by client components (booking wizard, reschedule). No PHI. The one write is anonymous funnel tracking. */
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FUNNEL_STEPS = new Set(['doctor', 'service', 'slot', 'patient', 'payment', 'done']);

/** FR-WEB-3 abandoned-booking funnel: best-effort, anonymous, validated here so only the expected shape reaches the API. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path.join('/') !== 'booking-funnel') return jsonError('not_found', 404);
  if (!csrfOk(req)) return jsonError('csrf', 403);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.sessionId !== 'string' || !UUID.test(b.sessionId) || typeof b.step !== 'string' || !FUNNEL_STEPS.has(b.step)) return jsonError('validation_failed', 400);
  const body: Record<string, string> = { sessionId: b.sessionId, step: b.step };
  for (const k of ['doctorId', 'clinicId', 'appointmentId'] as const) if (typeof b[k] === 'string' && UUID.test(b[k] as string)) body[k] = b[k] as string;
  try {
    const r = await fetch(`${API_URL}/v1/public/booking-funnel`, {
      method: 'POST',
      headers: { ...apiHeaders(req, { 'content-type': 'application/json' }), 'x-org': ORG_SLUG },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    await r.body?.cancel().catch(() => undefined);
    return new Response(null, { status: r.ok ? 204 : r.status, headers: { 'cache-control': 'no-store' } });
  } catch {
    return jsonError('network', 503);
  }
}
