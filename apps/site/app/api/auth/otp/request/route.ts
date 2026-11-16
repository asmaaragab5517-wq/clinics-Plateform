import { NextResponse, type NextRequest } from 'next/server';
import { normalisePhone } from '@hf/shared';
import { API_URL } from '@/lib/config';
import { apiHeaders, csrfOk, jsonError } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!csrfOk(req)) return jsonError('csrf', 403);
  const body = (await req.json().catch(() => null)) as { phone?: unknown } | null;
  const phone = typeof body?.phone === 'string' ? normalisePhone(body.phone) : null;
  if (!phone) return jsonError('invalid_phone', 400);
  try {
    const r = await fetch(`${API_URL}/v1/auth/otp/request`, {
      method: 'POST',
      headers: apiHeaders(req, { 'content-type': 'application/json', accept: 'application/json' }),
      body: JSON.stringify({ phone, purpose: 'login' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await r.json().catch(() => ({ error: 'internal_error' }))) as Record<string, unknown>;
    return NextResponse.json(r.ok ? { ...data, phone } : data, { status: r.status, headers: { 'cache-control': 'no-store' } });
  } catch {
    return jsonError('network', 503);
  }
}
