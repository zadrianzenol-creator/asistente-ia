/* Service worker: permite instalar la app y abrir la interfaz sin conexión.
 * Las respuestas de IA SIEMPRE necesitan internet: /api/* nunca se cachea.
 * Al publicar cambios, sube VERSION para que los usuarios reciban la actualización. */
const VERSION = 'v3';
const CACHE = 'asistente-' + VERSION;
const SHELL = [
  '/', '/index.html', '/style.css', '/app.js', '/docs.js', '/export.js', '/theme.js', '/manifest.webmanifest', '/privacidad.html', '/privacy.js',
  '/vendor/katex/katex.min.js', '/vendor/katex/katex.min.css', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));   // sin skipWaiting: el usuario decide cuándo actualizar
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('asistente-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    // Páginas: red primero, caché si no hay conexión.
    e.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    );
    return;
  }
  // Recursos: caché primero y se refresca en segundo plano.
  e.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
