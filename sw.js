'use strict';
// All cache operations and requests stay within this application's directory.
const PREFIX = 'starlight-bell-soundanimation-';
const CACHE = PREFIX + 'v2026.10.17.4';
const BASE = new URL('./', self.location.href);
const ASSETS = ['./', './index.html', './style.css?v=2026.10.17.4', './app.js?v=2026.10.17.4', './manifest.json', './icons/192x192.png', './icons/512x512.png'].map(path => new URL(path, BASE).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname) || !ASSETS.includes(url.href)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {}));
    }
    return response;
  }).catch(() => caches.open(CACHE).then(cache => cache.match(event.request)).then(response => response || Response.error())));
});

