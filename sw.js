// Service worker: deixa o app abrir sem internet (so os arquivos do proprio app; dados nunca passam por aqui).
const VERSAO = '0.0.1'; // mudar junto com index.html (data-versao), config.js (VERSAO) e app.js (VERSAO_APP)
const ARQUIVOS = ['./', 'index.html', 'app.js', 'config.js', 'db.worker.js', 'manifest.webmanifest',
  'lib/sqlite3.mjs', 'lib/sqlite3.wasm', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Microsoft/Graph: sempre direto
  e.respondWith(
    fetch(e.request).then((r) => { const c = r.clone(); caches.open(VERSAO).then((x) => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
