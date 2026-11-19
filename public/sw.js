// Service worker de la version web (GitHub Pages, appli installée) : l'app marche hors ligne après la
// première visite. Les démos ne passent jamais par ici : elles sont lues localement, jamais en réseau.
// Un cache par version de l'app (sw.js?v=…) : une mise à jour remplace tout
const CACHE = `celeste-${new URL(self.location.href).searchParams.get('v') ?? 'dev'}`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Pages : réseau d'abord (nouvelle version dès qu'elle est en ligne), cache hors ligne
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); return res; })
      .catch(() => caches.match('./').then((r) => r ?? caches.match(req))));
    return;
  }
  // Fichiers versionnés (assets/ au nom haché), radars, géométrie 3D, icônes : cache d'abord
  e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
