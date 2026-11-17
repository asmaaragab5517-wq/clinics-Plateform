/*
 * HealthFlow Clinics site service worker (BRD risk table: offline-tolerant public site).
 *
 * Caches ONLY the static shell and public assets:
 *   - the offline page, manifest and icons (precached),
 *   - hashed build assets under /_next/static/ (cache-first; immutable).
 * Never touches /api/*, any /portal or /book page, or any other HTML/JSON response: those go straight to the network,
 * so no patient data (PHI) is ever written to Cache Storage. A failed page navigation shows /offline.html.
 */
const VERSION = 'v1';
const SHELL_CACHE = `hf-shell-${VERSION}`;
const STATIC_CACHE = `hf-static-${VERSION}`;
const SHELL = ['/offline.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];
const OFFLINE = '/offline.html';
const MAX_STATIC_ENTRIES = 200;

/** Paths that may carry PHI or session state: never cached, never intercepted. */
function isPrivate(pathname) {
  return pathname.startsWith('/api/') || /^\/(?:ar|en)\/(?:portal|book)(?:\/|$)/.test(pathname) || pathname.startsWith('/portal') || pathname.startsWith('/book');
}

function isStaticAsset(pathname) {
  return pathname.startsWith('/_next/static/') || pathname.startsWith('/icons/') || pathname === '/manifest.webmanifest';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload', credentials: 'omit' }))))
      .then(() => self.skipWaiting()),
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

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_STATIC_ENTRIES; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  const cc = res.headers.get('cache-control') || '';
  if (res.ok && res.type === 'basic' && !/no-store|private/i.test(cc)) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, res.clone());
    void trim(cache);
  }
  return res;
}

async function navigate(request) {
  try {
    return await fetch(request);
  } catch {
    const page = await caches.match(OFFLINE);
    return page || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isPrivate(url.pathname)) return;
  if (request.mode === 'navigate') {
    // Pages are always fetched from the network (they are dynamic and never cached); offline → the offline page.
    event.respondWith(navigate(request));
    return;
  }
  if (isStaticAsset(url.pathname) && !url.search) event.respondWith(cacheFirst(request));
});
