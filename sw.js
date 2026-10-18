'use strict';
// All cache operations and requests stay within this application's directory.
const PREFIX = 'starlight-bell-soundanimation-';
const CACHE = PREFIX + 'v2026.10.18.21';
const BASE = new URL('./', self.location.href);
// Immutable AI assets live independently of shell versions. Bump this key if
// the model, bundled port or ORT files change; app updates must keep this cache.
const MODEL_CACHE = PREFIX + 'beat-this-small0-ort-1.23.2-cpu-v2';
const MODEL_ASSETS = [
  './vendor/beat-this/beat-this-small0.onnx', './vendor/beat-this/beat-this-cpu.mjs',
  './vendor/beat-this/ort-wasm-simd-threaded.mjs',
  './vendor/beat-this/ort-wasm-simd-threaded.wasm'
].map(path => new URL(path, BASE).href);
const ASSETS = [
  './', './index.html', './style.css?v=2026.10.18.21', './app.js?v=2026.10.18.21',
  './beat-this-audio.js?v=2026.10.18.21', './beat-this-capture.js?v=2026.10.18.21',
  './beat-this-client.js?v=2026.10.18.21', './beat-this-worker.js?v=2026.10.18.21', './beat-this-rhythm.js?v=2026.10.18.21',
  './model-setup.js?v=2026.10.18.21', './model-setup-worker.js?v=2026.10.18.21', './model-assets.js?v=2026.10.18.21',
  './licenses.html', './manifest.json', './icons/192x192.png', './icons/512x512.png'
].map(path => new URL(path, BASE).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE && name !== MODEL_CACHE && name !== PREFIX + 'beat-this-final0-ort-1.23.2-v1').map(name => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && MODEL_ASSETS.includes(url.href)) {
    event.respondWith((async () => {
      let cache;
      try {
        cache = await caches.open(MODEL_CACHE);
        const saved = await cache.match(event.request);
        if (saved && event.request.cache !== 'reload') return saved;
      } catch { /* Storage may be disabled; live analysis can still run. */ }
      const response = await fetch(event.request);
      // Wait for persistence before completing a first load. Never save failed
      // or partial responses, and don't break analysis on quota/storage errors.
      if (cache && response.status === 200) {
        try { await cache.put(event.request, response.clone()); } catch {}
      }
      return response;
    })());
    return;
  }
  if (event.request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname) || !ASSETS.includes(url.href)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {}));
    }
    return response;
  }).catch(() => caches.open(CACHE).then(cache => cache.match(event.request)).then(response => response || Response.error())));
});

