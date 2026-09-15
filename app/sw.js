/**
 * Offline support.
 *
 * The dictionary is one HTML page, three small modules, a stylesheet and a
 * 1.9 MB JSON file. Nothing about it needs a network once those have arrived,
 * and a hundred-year-old book is exactly the sort of thing someone reads on a
 * plane or in a field with no signal, so it should not need one.
 *
 * Three caches, because the three kinds of thing go stale at different rates:
 *
 *   shell-<version>  the app itself. Replaced wholesale on every build.
 *   data-<version>   dictionary.json. Same.
 *   scan-leaves      page images from the Internet Archive. *Not* versioned:
 *                    the 1903 scan will not change, so a leaf fetched today is
 *                    still right after the next twenty builds. Capped, because
 *                    there are 183 of them at a third of a megabyte each.
 *
 * `VERSION` is rewritten by stage 3 with a hash of the payload. That is what
 * makes updates work at all: a browser only notices a new worker when the
 * bytes of this file change, so the version has to live here rather than in
 * something this file imports.
 *
 * Every lookup below opens a named cache rather than calling `caches.match()`,
 * which searches *every* cache on the origin. That is not a hypothetical
 * distinction: on a development machine localhost is whatever was last worked
 * on, and the unscoped call cheerfully answered a navigation with a different
 * application's cached index.html.
 */
const VERSION = '4147be8b7c1d';

const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const LEAVES = 'scan-leaves';
const LEAF_LIMIT = 80;

const SHELL_FILES = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/search.js',
  './js/scan.js',
  './js/offline.js',
  './js/browse.js',
  './manifest.webmanifest',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './assets/favicon.svg',
  './assets/favicon-32.png',
  // The text face. Precached rather than fetched on demand: a dictionary
  // opened offline should look like itself, not fall back to Georgia.
  './assets/fonts/librecaslontext-400-normal.woff2',
  './assets/fonts/librecaslontext-400-italic.woff2',
  './assets/fonts/librecaslontext-700-normal.woff2',
];

const isData = (url) => url.pathname.endsWith('/data/dictionary.json');
const isLeaf = (url) => url.hostname.endsWith('archive.org');

self.addEventListener('install', (event) => {
  // The shell only. dictionary.json is deliberately left out: the page fetches
  // it on first load anyway, and precaching it here would download 1.9 MB
  // twice on somebody's first visit.
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Only this app's own caches. The Cache API is shared by everything on an
    // origin, and deleting whatever is not recognised would throw away another
    // application's data -- which on a development machine, where localhost:5173
    // is whatever was last worked on, is not hypothetical.
    const mine = (name) => name.startsWith('shell-') || name.startsWith('data-');
    const keep = new Set([SHELL, DATA]);
    for (const name of await caches.keys()) {
      if (mine(name) && !keep.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

/** The page asks for this when the reader accepts an update. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/** Keep the newest `limit` entries, in insertion order. */
async function trim(cache, limit) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

/** Serve from cache, and refresh the cache in the background. */
async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const fresh = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return hit || fresh.then((r) => r || Promise.reject(new Error('offline')));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Page images. Cache-first and never revalidated -- the scan is fixed, and
  // the whole point of keeping them is that the Archive is the one thing this
  // app reaches out to.
  if (isLeaf(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(LEAVES);
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      // Cross-origin images come back opaque; that is fine to store and
      // fine to paint, it just cannot be inspected.
      if (res && (res.ok || res.type === 'opaque')) {
        await cache.put(request, res.clone());
        await trim(cache, LEAF_LIMIT);
      }
      return res;
    })());
    return;
  }

  if (url.origin !== location.origin) return;

  // Navigation: try the network first so a deployed update is seen promptly,
  // and fall back to the cached page when there is no network.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL);
        return (await cache.match('./index.html', { ignoreSearch: true })) ||
               Response.error();
      })
    );
    return;
  }

  if (isData(url)) {
    event.respondWith(staleWhileRevalidate(DATA, request));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    return (await cache.match(request, { ignoreSearch: true })) || fetch(request);
  })());
});
