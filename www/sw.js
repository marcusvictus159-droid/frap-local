// sw.js — solo para la versión web/PWA (iPhone). En la app de Android todo va
// empaquetado en el APK y este archivo no se usa.
//
// Estrategia: "guardar al instante, actualizar en segundo plano". La app abre
// siempre desde lo guardado (funciona sin internet) y, si hay red, baja la
// versión nueva para la próxima vez. Sube VERSION cuando publiques cambios.
const VERSION = 'frap-local-v2';
const PRECACHE = [
  './', 'index.html', 'login.html', 'dashboard.html', 'frap.html', 'servicio.html',
  'checklist.html', 'perfil.html', 'ajustes.html', 'historial.html', 'calculadoras.html',
  'app-config.js', 'local-core.js', 'theme.css', 'gps-ubicacion.js', 'frap-pdf.js', 'offline-sync.js', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'silueta.png', 'logo_cruz_roja.png',
  'vendor/bootstrap.min.css', 'vendor/bootstrap.bundle.min.js', 'vendor/bootstrap-icons.css',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/fonts/barlow-condensed-latin-600-normal.woff2', 'vendor/fonts/barlow-condensed-latin-700-normal.woff2', 'vendor/fonts/barlow-condensed-latin-800-normal.woff2',
  'vendor/pdf-lib.min.js', 'vendor/html5-qrcode.min.js', 'vendor/signature_pad.umd.min.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(VERSION).then((cache) =>
    Promise.allSettled(PRECACHE.map((u) => cache.add(u)))
  ));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Telegram y demás: directo a la red
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const guardado = await cache.match(req, { ignoreSearch: true });
      const red = fetch(req).then((resp) => {
        if (resp && resp.ok) cache.put(req, resp.clone());
        return resp;
      }).catch(() => null);
      return guardado || (await red) || new Response('Sin conexión', { status: 503 });
    })
  );
});
