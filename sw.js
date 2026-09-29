/* SalafiScope Task - simple offline service worker.
 *
 * Strategy:
 *  - On install, save the app shell (page, manifest, icons) so the app opens offline.
 *  - Pages (navigation): try the network first so updates show up, fall back to the saved copy.
 *  - Other same-site files: serve the saved copy instantly and refresh it in the background.
 *  - Google Fonts: save on first use so fonts also work offline.
 *  - Everything else (POST requests, other websites) is left alone.
 *
 * To force every device to pick up a new version of the app files,
 * change the number in CACHE_NAME (e.g. v1 -> v2).
 */
const CACHE_NAME = 'salafiscope-task-v1';

const APP_SHELL = [
  './',
  'index.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys
          .filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function saveCopy(request, response) {
  // Only keep good responses (opaque ones are cross-site font files).
  if (response && (response.ok || response.type === 'opaque')) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
  }
  return response;
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameSite = url.origin === self.location.origin;
  const isFont = FONT_HOSTS.indexOf(url.hostname) !== -1;
  if (!sameSite && !isFont) return;

  // Opening the app: network first, saved copy if offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (response) { return saveCopy('index.html', response); })
        .catch(function () {
          return caches.match('index.html').then(function (cached) {
            return cached || caches.match('./');
          });
        })
    );
    return;
  }

  // Other files: saved copy first, refreshed in the background.
  event.respondWith(
    caches.match(request).then(function (cached) {
      const refresh = fetch(request)
        .then(function (response) { return saveCopy(request, response); })
        .catch(function () { return cached; });
      return cached || refresh;
    })
  );
});

// Tapping a reminder notification opens (or returns to) the app.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const target = self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const client of list) {
        if (client.url.indexOf(target) === 0 && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
