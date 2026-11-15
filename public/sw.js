// App-shell cache so the page opens offline and can be installed. Network
// first, so a new deploy (or a dev edit) always wins when online. Instagram
// embeds are cross-origin and never touched here.
const CACHE = 'saved-shuffle-v3';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'js/app.js',
  'js/events.js',
  'js/library.js',
  'js/parser.js',
  'js/player.js',
  'js/queue.js',
  'js/rotation.js',
  'js/state.js',
  'js/store.js',
  'js/topics.js',
  'js/zip.js',
  'js/ui/dom.js',
  'js/ui/home.js',
  'js/ui/importer.js',
  'js/ui/settings.js',
  'js/ui/toast.js',
  'js/ui/watch.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // The bundled default list is personal data: never copy it into the cache.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/default/')) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
