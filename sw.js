/* SalafiScope Task - simple offline service worker.
 *
 * Strategy:
 *  - On install, save the app shell (page, manifest, icons) so the app opens offline.
 *  - Pages (navigation): try the network first so updates show up. If the network fails,
 *    answers with an error, or takes longer than NAVIGATION_TIMEOUT_MS (a weak connection),
 *    open the saved copy instead; the network request keeps going in the background and
 *    refreshes the saved copy for next time.
 *  - Other same-site files: serve the saved copy instantly and refresh it in the background.
 *  - Google Fonts: save on first use so fonts also work offline.
 *  - Everything else (POST requests, other websites) is left alone.
 *
 * To force every device to pick up a new version of the app files,
 * change the number in CACHE_NAME (e.g. v2 -> v3).
 */
const CACHE_NAME = 'salafiscope-task-v2';

// How long to wait for the network before opening the saved copy of the app.
const NAVIGATION_TIMEOUT_MS = 3000;

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
      .then(function (cache) {
        // cache: 'reload' skips the browser's HTTP cache so a fresh deploy is
        // never saved from a stale copy.
        return Promise.all(APP_SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' }));
        }));
      })
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

  // Opening the app: network first, but never leave the user waiting on a weak
  // connection when a saved copy exists.
  if (request.mode === 'navigate') {
    const network = fetch(request).then(function (response) {
      if (!response.ok) throw new Error('Bad response: ' + response.status); // use the saved copy instead
      return saveCopy('index.html', response);
    });
    // Keep the worker alive so the background refresh can finish even after
    // the page has already been opened from the saved copy.
    event.waitUntil(network.catch(function () {}));

    event.respondWith(
      caches.match('index.html').then(function (cached) {
        if (!cached) {
          // First visit: nothing saved yet, so the network is the only option.
          return network.catch(function () { return caches.match('./'); });
        }
        return Promise.race([
          network.catch(function () { return cached; }),
          new Promise(function (resolve) { setTimeout(function () { resolve(cached); }, NAVIGATION_TIMEOUT_MS); })
        ]);
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
      if (cached) event.waitUntil(refresh); // let the background refresh finish
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
