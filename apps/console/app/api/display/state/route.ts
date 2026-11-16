import type { NextRequest } from 'next/server';
import { proxyDisplay } from '@/lib/server/display';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return proxyDisplay(req, 'display/state');
}
