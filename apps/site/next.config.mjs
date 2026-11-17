/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig = {
  // Always render metadata in <head> (not streamed into <body>), so link previews, messaging apps and audits see it.
  htmlLimitedBots: /.*/,
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@hf/ui'],
  // FR-WEB-6: never log request URLs (they can carry identifiers) from server fetches.
  logging: { fetches: { fullUrl: false } },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Patient data: never cached by browsers, proxies or CDNs.
      { source: '/api/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] },
      { source: '/api/(auth|portal)/:path*', headers: [{ key: 'Cache-Control', value: 'no-store, private' }] },
      { source: '/:locale(ar|en)/portal/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      // PWA: the worker is always revalidated so updates roll out; it controls the whole origin.
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, max-age=0' },
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'" },
        ],
      },
      { source: '/manifest.webmanifest', headers: [{ key: 'Content-Type', value: 'application/manifest+json; charset=utf-8' }, { key: 'Cache-Control', value: 'public, max-age=3600' }] },
      {
        source: '/offline.html',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, max-age=0' },
          { key: 'X-Robots-Tag', value: 'noindex' },
          { key: 'Content-Security-Policy', value: "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
