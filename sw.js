/* Cache limitata ai file pubblici dell'app. Mai cache di archivi o allegati personali. */
'use strict';
const PREFIX = 'ricettario:' + new URL(self.registration.scope).pathname + ':';
const CACHE = PREFIX + 'v1';
const FILES = ['./', './index.html', './app.js', './shopping.js', './plans.js', './style.css', './local-api.js', './mobile.js', './core.mjs', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const URLS = new Set(FILES.map(file => new URL(file, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys())
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      // Mantiene HTML e script della stessa versione fino all'aggiornamento.
      return (await caches.match(new URL('./index.html', self.registration.scope).href)) || fetch(event.request);
    })());
    return;
  }
  if (URLS.has(event.request.url)) event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
