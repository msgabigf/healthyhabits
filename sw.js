// Offline: the whole app is cached on install and served from the cache.
// Bump VERSION on every deploy so phones pick up the new files.
const VERSION = 'rotina-v1.1.0';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js', 'js/backup.js', 'js/config.js', 'js/data.js', 'js/diary.js',
  'js/settings.js', 'js/sleep.js', 'js/state.js', 'js/store.js', 'js/sync.js',
  'js/today.js', 'js/util.js',
  'assets/fonts/fraunces-latin-full-normal.woff2',
  'assets/fonts/fraunces-latin-full-italic.woff2',
  'assets/fonts/outfit-latin-wght-normal.woff2',
  'assets/art/sun.png', 'assets/art/moon.png', 'assets/art/apple.png',
  'assets/art/dumbbell.png', 'assets/art/heart.png',
  'assets/icons/apple-touch-icon.png', 'assets/icons/favicon.png',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Google Sheet sync etc. go straight to the network
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
