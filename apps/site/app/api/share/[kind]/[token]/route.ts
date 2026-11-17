import type { NextRequest } from 'next/server';
import { API_URL } from '@/lib/config';
import { jsonError } from '@/lib/session';

/**
 * Same-origin opener for the API's short-lived signed document links (GET /v1/portal/{prescriptions,invoices}/:id/link).
 * The signed token is the only credential; the PDF is streamed through untouched and never cached.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KINDS: Record<string, string> = { rx: 'rx', invoice: 'invoice' };

export async function GET(_req: NextRequest, ctx: { params: Promise<{ kind: string; token: string }> }) {
  const { kind, token } = await ctx.params;
  const k = KINDS[kind];
  if (!k || !/^[\w:-]{1,200}\.\d{1,12}\.[\w-]{20,100}$/.test(token)) return jsonError('not_found', 404);
  let up: Response;
  try {
    up = await fetch(`${API_URL}/v1/share/${k}/${encodeURIComponent(token)}`, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  } catch {
    return jsonError('network', 503);
  }
  const type = up.headers.get('content-type') ?? '';
  if (!up.ok || !type.startsWith('application/pdf')) {
    await up.body?.cancel().catch(() => undefined);
    return jsonError(up.status === 404 || up.status === 400 ? 'link_expired' : 'internal_error', up.ok ? 502 : up.status);
  }
  const name = k === 'rx' ? 'prescription.pdf' : 'invoice.pdf';
  return new Response(up.body, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${name}"`,
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex',
      'referrer-policy': 'no-referrer',
    },
  });
}
