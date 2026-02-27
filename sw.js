/* ═══════════════════════════════════════════════════════
   NexaChat v1.00 — Service Worker
   Strategy: Cache-first for assets, network-first for API
   ═══════════════════════════════════════════════════════ */

const CACHE_NAME = 'nexachat-v1.0.0';
const OFFLINE_URL = './index.html';

// Files to cache immediately on install
const PRECACHE_ASSETS = [
  './index.html',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32x32.png'
];

// ── INSTALL ─────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing NexaChat v1.00...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching app shell');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log('[SW] Install complete');
        return self.skipWaiting(); // Activate immediately
      })
      .catch(err => console.error('[SW] Pre-cache failed:', err))
  );
});

// ── ACTIVATE ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    Promise.all([
      // Delete old caches
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            })
        )
      ),
      // Take control of all open pages immediately
      self.clients.claim()
    ]).then(() => console.log('[SW] Activation complete'))
  );
});

// ── FETCH ─────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept Anthropic API calls — always go network
  if (url.hostname === 'api.anthropic.com') {
    return; // Let it pass through normally
  }

  // Never intercept Google Fonts — pass through
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // For same-origin requests: Cache-first with network fallback
  if (url.origin === self.location.origin || request.mode === 'navigate') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) {
          // Serve from cache, update in background
          const networkUpdate = fetch(request)
            .then(response => {
              if (response && response.ok && response.type !== 'opaque') {
                caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
              }
              return response;
            })
            .catch(() => {}); // Silent fail on background update
          return cached;
        }

        // Not in cache — fetch from network
        return fetch(request)
          .then(response => {
            if (response && response.ok) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
            }
            return response;
          })
          .catch(() => {
            // Offline fallback — serve the app shell
            if (request.mode === 'navigate') {
              return caches.match(OFFLINE_URL);
            }
            return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
          });
      })
    );
    return;
  }

  // All other requests — try network first, cache fallback
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ── BACKGROUND SYNC (future-ready) ────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'nexachat-sync') {
    console.log('[SW] Background sync triggered');
  }
});

// ── PUSH NOTIFICATIONS (future-ready) ─────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'NexaChat', {
    body: data.body || 'You have a new message',
    icon: './icons/icon-192x192.png',
    badge: './icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || './' }
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url === event.notification.data.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(event.notification.data.url || './');
    })
  );
});
