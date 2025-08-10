/* ==============================
   HS Blackjack — sw.js
   Offline caching + versioning
   ============================== */

const VERSION = 'all-2025-08-10';
const CACHE = 'bjack-'+VERSION;
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './sw.js?v='+VERSION
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('bjack-')&&k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if(url.origin!==location.origin) return;
  const isHTML = e.request.mode==='navigate' || e.request.destination==='document' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  if(isHTML){ e.respondWith(networkFirst(e.request)); } else { e.respondWith(cacheFirst(e.request)); }
});
async function networkFirst(req){
  try{
    const fresh = await fetch(req,{cache:'no-store'});
    const c = await caches.open(CACHE); c.put(req,fresh.clone()); return fresh;
  }catch(e){
    const c = await caches.open(CACHE); return (await c.match(req)) || (await c.match('./index.html'));
  }
}
async function cacheFirst(req){
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if(hit) return hit;
  const fresh = await fetch(req);
  c.put(req,fresh.clone());
  return fresh;
}