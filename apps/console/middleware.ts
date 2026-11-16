import { NextResponse, type NextRequest } from 'next/server';

/**
 * Security headers with a per-request CSP nonce (SEC-6): no inline scripts, frame-ancestors 'none', HSTS.
 * Also gates console pages behind the BFF session cookie and seeds the double-submit CSRF cookie.
 */
const PUBLIC_PREFIXES = ['/login', '/display', '/api/auth/', '/api/display/'];

function nonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

function csp(n: string): string {
  const dev = process.env.NODE_ENV !== 'production';
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${n}' 'strict-dynamic'${dev ? ` 'unsafe-eval'` : ''}`,
    // React style attributes (chart widths, progress bars) need inline styles; scripts never run inline.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    `media-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p));
  const hasSession = !!(req.cookies.get('hf_at')?.value || req.cookies.get('hf_rt')?.value);

  if (!isPublic && !hasSession && !pathname.startsWith('/api/')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const n = nonce();
  const policy = csp(n);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', n);
  requestHeaders.set('content-security-policy', policy);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', policy);
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (!pathname.startsWith('/api/')) res.headers.set('Cache-Control', 'no-store');

  if (!req.cookies.get('hf_csrf')?.value) {
    const b = new Uint8Array(24);
    crypto.getRandomValues(b);
    const token = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    res.cookies.set('hf_csrf', token, { httpOnly: false, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 12 * 3600 });
  }
  return res;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg).*)' }],
};
