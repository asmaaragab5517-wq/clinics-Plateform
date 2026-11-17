import type { NextRequest } from 'next/server';
import { API_URL, ORG_SLUG } from '@/lib/config';

/** Same-origin doctor photo (public, not PHI): the browser never calls the API host. Only images are passed through. */
export const dynamic = 'force-dynamic';

const MAX_BYTES = 2 * 1024 * 1024;

function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'cache-control': 'public, max-age=300' } });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!/^[\w\-؀-ۿ%]{1,80}$/.test(slug)) return notFound();
  try {
    const r = await fetch(`${API_URL}/v1/public/doctors/${encodeURIComponent(decodeURIComponent(slug))}/photo`, {
      headers: { 'x-org': ORG_SLUG, accept: 'image/*' },
      next: { revalidate: 3600, tags: ['public'] },
      signal: AbortSignal.timeout(10_000),
    });
    const type = (r.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!r.ok || !/^image\/(jpeg|png|webp|avif|gif)$/.test(type)) {
      await r.body?.cancel().catch(() => undefined);
      return notFound();
    }
    const body = await r.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return notFound();
    return new Response(body, {
      status: 200,
      headers: { 'content-type': type, 'cache-control': 'public, max-age=86400, stale-while-revalidate=604800', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" },
    });
  } catch {
    return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
