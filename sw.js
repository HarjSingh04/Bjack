// Service Worker — HS Blackjack (auto-bump on each commit by edit)
const CACHE_VERSION = Date.now();
const CACHE_NAME = `bjack-cache-${CACHE_VERSION}`;
const ASSETS = ['./','./index.html','./style.css','./script.js','./sw.js'];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k=>k.startsWith('bjack-cache-') && k!==CACHE_NAME).map(k=>caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', (e)=>{
  const url = new URL(e.request.url);
  if(url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp=>{
      return caches.open(CACHE_NAME).then(c=>{ c.put(e.request, resp.clone()); return resp; });
    }))
  );
});
