// ── Service Worker ────────────────────────────────────────────────────────
// A service worker is a script that runs in the background, separate from the
// web page. It intercepts network requests and can serve files from a local
// cache instead of the internet — this is what makes the app work offline.
//
// CACHING STRATEGY
// This app is hosted online and updated regularly, so we avoid the classic
// "stale app" trap (where returning visitors stay stuck on an old version):
//
//   • HTML pages + quiz data (catalog.json, banks/*.json)  → network-first.
//     When online we always fetch the latest, falling back to the cache only
//     if the network fails. This means a push of new questions shows up on the
//     next reload, no version bump required.
//
//   • Static assets (icons, images, manifest)  → cache-first.
//     These rarely change, so we serve them instantly from cache and only hit
//     the network on a cache miss.
//
// Bump the CACHE string below if you ever need to force-clear every cached
// file at once (e.g. a breaking change to asset filenames). Day-to-day content
// updates do NOT need a bump thanks to the network-first strategy above.
const CACHE = 'electrical-quiz-v5';

// Files cached up front when the service worker first installs, so the app
// works offline immediately after the first visit.
const INSTALL_FILES = [
  './home.html',
  './index.html',
  './manifest.json',
  './catalog.json',
  './banks/elec-electrician-capstone-yr1.json',
  './banks/shooting-cartridge-308.json',
  './banks/shooting-cartridge-243.json',
  './banks/shooting-cartridge-65creedmoor.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

// Requests matching these get the network-first treatment (fresh when online,
// cached fallback when offline). Everything else is cache-first.
function isFreshContent(request) {
  // Page navigations (opening home.html / index.html, or the app itself).
  if (request.mode === 'navigate') return true;
  const url = new URL(request.url);
  // Quiz content: the catalog and any question bank JSON.
  if (url.pathname.endsWith('catalog.json')) return true;
  if (url.pathname.includes('/banks/')) return true;
  if (url.pathname.endsWith('.html')) return true;
  return false;
}


// ── Install ───────────────────────────────────────────────────────────────
// Fires the first time the service worker is registered (or when CACHE changes,
// triggering an update). We pre-populate the cache so the app works offline.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(INSTALL_FILES))
  );
  // skipWaiting() makes this new service worker take over immediately instead
  // of waiting for existing tabs to close first.
  self.skipWaiting();
});


// ── Activate ──────────────────────────────────────────────────────────────
// Fires after install, once the worker is in control. We delete caches from
// older versions so stale files don't pile up.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  // clients.claim() takes control of open pages right away, no reload needed.
  return self.clients.claim();
});


// ── Fetch ─────────────────────────────────────────────────────────────────
// Every file request (HTML, JSON, images) routes through here. We pick a
// strategy based on what's being requested (see isFreshContent above).
self.addEventListener('fetch', e => {
  if (isFreshContent(e.request)) {
    // NETWORK-FIRST: try the network, update the cache, and fall back to the
    // cached copy if we're offline.
    e.respondWith(
      fetch(e.request)
        .then(response => {
          // Stash a fresh copy for offline use next time.
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, copy));
          return response;
        })
        .catch(() =>
          // Network failed (offline) — serve whatever we have cached.
          caches.open(CACHE).then(cache => cache.match(e.request))
        )
    );
  } else {
    // CACHE-FIRST: serve from cache instantly; on a miss, fetch and cache it.
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(response => {
            cache.put(e.request, response.clone());
            return response;
          });
        })
      )
    );
  }
});
