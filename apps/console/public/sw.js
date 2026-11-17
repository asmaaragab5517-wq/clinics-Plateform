/* HealthFlow staff console service worker (NFR-7).
 *
 * Caches the application shell and static assets only, so the console opens without a connection and the
 * offline action queue (lib/offline.ts) can replay when it returns. It NEVER caches API responses (/api/*),
 * never caches pages whose URL carries an identifier, and never stores anything that came back from a
 * redirect or an error. Patient data is fetched client-side from /api and so never lands in these caches.
 */
const VERSION = 'v1';
const SHELL_CACHE = `hf-shell-${VERSION}`;
const STATIC_CACHE = `hf-static-${VERSION}`;
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];
// Fixed console pages (no ids, no query) whose HTML may be kept. Their HTML holds no patient data.
const SHELL_ROUTES = new Set(['/', '/reception', '/calendar', '/patients', '/doctor', '/nurse', '/cashier', '/dashboard', '/profile']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await shell.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload', credentials: 'same-origin' })));
      // The offline page must hydrate without a network: keep the hashed scripts and styles its HTML references.
      const html = await (await shell.match(OFFLINE_URL)).text();
      const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [])];
      const statics = await caches.open(STATIC_CACHE);
      await Promise.all(assets.map((u) => statics.add(u).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hf-') && k !== SHELL_CACHE && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  // Sign-out clears the shell so nothing of the session's pages survives on a shared PC.
  if (event.data && event.data.type === 'hf:clear') event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('hf-')).map((k) => caches.delete(k)))));
});

function cacheable(res) {
  return res && res.ok && res.status === 200 && res.type === 'basic' && !res.redirected;
}

function isStatic(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname === '/icon.svg' || url.pathname === '/manifest.webmanifest';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API traffic (patient data, the offline queue's replays, SSE) always goes straight to the network.
  if (url.pathname.startsWith('/api/')) return;
  // React Server Component payloads for client navigations are not cached either.
  if (req.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) return;

  if (isStatic(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (cacheable(res)) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const res = await fetch(req);
          if (cacheable(res) && !url.search && SHELL_ROUTES.has(url.pathname)) cache.put(url.pathname, res.clone());
          return res;
        } catch {
          return (SHELL_ROUTES.has(url.pathname) && (await cache.match(url.pathname))) || (await cache.match(OFFLINE_URL)) || Response.error();
        }
      })(),
    );
  }
});
