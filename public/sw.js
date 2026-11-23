// [AMS] lab — service worker: consultar el inventario sin conexión.
//   · la web y los datos (/api/datos): primero la red; si no hay, lo último que se guardó
//   · fotos: se guardan al verlas (no cambian nunca: cada foto nueva tiene otro nombre)
//   · dibujos del glosario: se sirven de la copia y se actualizan por detrás
// Solo funciona con HTTPS o en localhost (p. ej. `tailscale serve`), es una regla del navegador.
'use strict';
// la huella de la versión llega en la URL del propio sw.js (?v=…): cada versión tiene su copia y borra las anteriores
const V = new URL(self.location.href).searchParams.get('v') || '';
const conV = (p) => (V ? `${p}?v=${V}` : p);
const WEB = V ? `ams-web-${V}` : 'ams-web-v2';
const FOTOS = 'ams-fotos';
const BASE = self.registration.scope;
const u = (p) => new URL(p, BASE).href;
const DATOS = u('api/datos');
// letras y estilos compartidos de AMSTech (public/amstech-ui): latín y latín extendido
const LETRAS = ['bricolage-grotesque-latin-opsz-normal', 'bricolage-grotesque-latin-ext-opsz-normal',
  ...[400, 500, 600, 700, 800].flatMap((w) => [`figtree-latin-${w}-normal`, `figtree-latin-ext-${w}-normal`]),
  ...[400, 500].flatMap((w) => [`dm-mono-latin-${w}-normal`, `dm-mono-latin-ext-${w}-normal`])].map((f) => `amstech-ui/fuentes/${f}.woff2`);
const ESTILOS = ['amstech-ui/fuentes.css', 'amstech-ui/tokens.css', 'amstech-ui/componentes.css', 'style.css'].map(conV);
const PRECARGA = ['./', 'index.html', conV('i18n.js'), conV('app.js'), ...ESTILOS, 'icon.svg', 'manifest.webmanifest', ...LETRAS].map(u);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(WEB).then((c) => c.addAll(PRECARGA)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== WEB && k !== FOTOS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// red primero; si falla, la copia (marcada con la fecha en que se guardó)
async function redPrimero(req, clave = req) {
  const cache = await caches.open(WEB);
  try {
    const r = await fetch(req);
    if (r.ok) {
      const h = new Headers(r.headers);
      h.set('x-guardado', new Date().toISOString());
      await cache.put(clave, new Response(await r.clone().blob(), {status: r.status, headers: h}));
      if (req.url === DATOS) limpiarFotos(r.clone());
    }
    return r;
  } catch (err) {
    const copia = await cache.match(clave, {ignoreSearch: true});
    if (copia) return copia;
    throw err;
  }
}

async function copiaPrimero(req, nombre, actualizar) {
  const cache = await caches.open(nombre);
  const copia = await cache.match(req);
  if (copia && !actualizar) return copia;
  const red = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; });
  if (copia) { red.catch(() => {}); return copia; }
  return red;
}

// borra de la copia las fotos que ya no usa ninguna pieza
async function limpiarFotos(r) {
  try {
    const {componentes = []} = await r.json();
    const usadas = new Set(componentes.filter((c) => c.foto).map((c) => u(`fotos/${encodeURIComponent(c.foto)}`)));
    const cache = await caches.open(FOTOS);
    for (const req of await cache.keys()) if (!usadas.has(req.url)) await cache.delete(req);
  } catch {}
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(BASE)) return;
  const p = req.url.slice(BASE.length);
  if (req.mode === 'navigate') return e.respondWith(redPrimero(req, u('./')));
  if (req.url === DATOS) return e.respondWith(redPrimero(req));
  if (p.startsWith('api/')) return; // el resto de la API, siempre a la red
  if (p.startsWith('fotos/')) return e.respondWith(copiaPrimero(req, FOTOS, false));
  if (p.startsWith('img/')) return e.respondWith(copiaPrimero(req, WEB, true));
  e.respondWith(redPrimero(req));
});
