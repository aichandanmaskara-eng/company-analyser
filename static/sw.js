/* Company Analyser service worker: app shell is cached for instant start; data (/api) always comes from the network. */
const VERSION = 'ca-v3';  // bump on every release so visitors get the new version
const SHELL = ['/', '/app.css', '/app.js', '/charts.js', '/vendor/echarts.min.js', '/vendor/Sortable.min.js',
  '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // stale-while-revalidate: answer from cache immediately, refresh the copy in the background
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request);
    const net = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
