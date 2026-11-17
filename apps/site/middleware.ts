import { NextResponse, type NextRequest } from 'next/server';

const LOCALES = new Set(['ar', 'en']);
const CSRF_COOKIE = 'hf_csrf';

function randomToken(bytes = 16): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SEC-6: strict CSP with a per-request nonce; no inline scripts without it, no framing. */
function csp(nonce: string): string {
  const dev = process.env.NODE_ENV !== 'production';
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    // PWA: only our own /sw.js may run as a worker; the manifest is same-origin.
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `frame-src https://www.openstreetmap.org`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

function withCsrfCookie(req: NextRequest, res: NextResponse): NextResponse {
  if (!req.cookies.get(CSRF_COOKIE)) {
    // Double-submit token (SEC-6): readable by our own scripts, never sent cross-site.
    res.cookies.set(CSRF_COOKIE, randomToken(24), { httpOnly: false, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_INSECURE !== '1', path: '/' });
  }
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith('/api/')) return withCsrfCookie(req, NextResponse.next());

  // Locale prefix: `/` → `/ar`, `/clinics` → `/ar/clinics` (LOC-1: Arabic is the default).
  const first = pathname.split('/')[1] ?? '';
  if (!LOCALES.has(first)) {
    const url = req.nextUrl.clone();
    url.pathname = `/ar${pathname === '/' ? '' : pathname}`;
    url.search = search;
    return NextResponse.redirect(url, 308);
  }

  const nonce = randomToken();
  const policy = csp(nonce);
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);
  headers.set('x-locale', first);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', policy);
  if (pathname.startsWith(`/${first}/portal`) || pathname.startsWith(`/${first}/book`)) {
    // FR-WEB-6: patient pages are never cached.
    res.headers.set('Cache-Control', 'private, no-store, max-age=0');
  }
  return withCsrfCookie(req, res);
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|opengraph-image|robots.txt|sitemap.xml|.*\\.[\\w]+$).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
};
