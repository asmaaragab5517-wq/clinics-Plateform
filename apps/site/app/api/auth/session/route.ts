import { NextResponse, type NextRequest } from 'next/server';
import { REFRESH_COOKIE } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Whether a session cookie exists; reveals no token or identity. */
export function GET(req: NextRequest) {
  return NextResponse.json({ signedIn: !!req.cookies.get(REFRESH_COOKIE)?.value }, { headers: { 'cache-control': 'no-store' } });
}
