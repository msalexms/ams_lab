// CircuitBin — inventario, glosario y proyectos. Habla con la API del servidor (server/index.mjs).
'use strict';

const t = (s, v) => window.I18N.t(s, v);

// configuración: llega de la base de datos (categorias, funciones_pin, dificultades, ajustes)
let CATS = {};  // id → nombre, en el orden de la base de datos
let COLOR_CAT = {}; // id → color de la categoría (tabla categorias, v9): marcas y fondos teñidos
// el color de una categoría como variable CSS (--ams-c) y su cuadradito
const conColor = (cat) => (COLOR_CAT[cat] ? ` style="--ams-c:${COLOR_CAT[cat]}"` : '');
const marcaCat = '<span class="ams-cuadro" aria-hidden="true"></span>';
let FUNC = {};  // id → {nombre, color_claro, color_oscuro, tachado}
let DIF = {};   // nivel → nombre
const MUCHOS = 99;
const TEMAS = {auto: 'Tema: automático', claro: 'Tema: claro', noche: 'Tema: noche'};

const D = {componentes: [], tipos: {}, proyectos: [], categorias: [], funciones: [], dificultades: [], ubicaciones: [], ajustes: {}};
const ui = {sel: new Set(), seleccionando: false, selIA: false, visibles: [], cat: '', ubic: '', revisar: false, proFiltro: 'todos', sinComprobar: false, ajTipos: 'todos', ajBuscar: ''};
const $ = (s) => document.querySelector(s);
const app = $('#app');
const q = $('#q');

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const g = (tipo) => D.tipos[tipo] || {nombre: t('Sin tipo'), categoria: 'otro'};
const catOf = (c) => g(c.tipo).categoria || 'otro';
const byName = (a, b) => a.nombre.localeCompare(b.nombre, I18N.lang());
const comp = (id) => D.componentes.find((c) => c.id === Number(id));
const ubicaciones = () => [...new Set([...D.ubicaciones, ...D.componentes.map((c) => c.ubicacion)].filter(Boolean))].sort((a, b) => a.localeCompare(b, I18N.lang()));
const may = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const dificultad = (p) => [may(DIF[p.dificultad || 1]), p.tiempo].filter(Boolean).join(' · ');

function matches(text, query) {
  const t = norm(text);
  return norm(query).split(/\s+/).filter(Boolean).every((w) => t.includes(w));
}
function compText(c) {
  const f = g(c.tipo);
  return [c.nombre, c.notas, c.ubicacion, f.nombre, f.resumen, ...list(f.alias), list(f.interfaz).join(' ')].join(' ');
}

const unidades = (c) => (c.varios ? MUCHOS : Number(c.cantidad) || 0);
const qtyText = (c) => (c.varios ? 'muchos' : c.cantidad ?? '?');
function stock(tipo) {
  return Math.max(0, ...list(tipo).map((t) => D.componentes.filter((c) => c.tipo === t).reduce((a, c) => a + unidades(c), 0)));
}
const stockText = (tipo) => (stock(tipo) >= MUCHOS ? t('muchos') : stock(tipo));
const faltas = (p) => (p.material || []).filter((m) => !m.opcional && stock(m.tipo) < (m.cantidad || 1));
const estadoProyecto = (p) => {
  const n = faltas(p).length;
  return n ? `<span class="mal">${esc(t(n > 1 ? 'Faltan {n}' : 'Falta {n}', {n}))}</span>` : t('Tienes todo');
};
const proyectosDe = (tipo) => D.proyectos.filter((p) => (p.material || []).some((m) => list(m.tipo).includes(tipo)));
const voltajeDe = (f) => String(f.voltaje || '').split(' · ')[0];

const fotoUrl = (c) => `fotos/${encodeURIComponent(c.foto)}`;
const vacio = (html) => `<div class="vacio">${html}</div>`;

// aviso abajo; con «accion» ({texto, fn}) lleva un botón (p. ej. «Deshacer») y dura más

// ---------- diálogo de confirmación propio (en vez del confirm() del navegador) ----------
// confirmar('¿Borrar X?\n\nNo se puede deshacer.', {si: 'Borrar', peligro: true}) → promesa con true o false.
// La primera línea es la pregunta; lo demás, la explicación. Esc o «Cancelar» = no.
function confirmar(texto, {si = 'Aceptar', no = 'Cancelar', peligro = false} = {}) {
  return new Promise((resolver) => {
    const [titulo, ...resto] = String(texto).split(/\n\s*\n|\n/);
    const d = document.createElement('dialog');
    d.className = 'dialogo';
    d.setAttribute('aria-labelledby', 'dialogo-t');
    d.innerHTML = `<form method="dialog">
      <p class="dialogo-t" id="dialogo-t">${esc(titulo)}</p>
      ${resto.filter((x) => x.trim()).map((x) => `<p class="dialogo-p">${esc(x.trim())}</p>`).join('')}
      <div class="acciones dialogo-acc">
        <button class="btn ${peligro ? 'peligro-prim' : 'prim'}" value="si">${esc(t(si))}</button>
        <button class="btn" value="no">${esc(t(no))}</button>
      </div></form>`;
    document.body.append(d);
    d.addEventListener('close', () => { resolver(d.returnValue === 'si'); d.remove(); }, {once: true});
    d.addEventListener('click', (e) => { if (e.target === d) d.close('no'); }); // tocar fuera = cancelar
    d.showModal();
    d.querySelector(peligro ? 'button[value=no]' : 'button[value=si]').focus(); // si es peligroso, el foco en «Cancelar»
  });
}

// ---------- campo de fotos con el aspecto de la app ----------
// Una tira de miniaturas: cada foto con su ✕ y, al final, un recuadro «+» para añadir otra (hasta «max»). Las fotos
// elegidas viven en el propio <input type=file> (FormData y fotosDelCampo() las leen como siempre): elegir más las SUMA
// a las que había, no las sustituye. «principal»: marca la primera (la que se queda la pieza). «compacto»: en una línea,
// para la foto de una respuesta.
const campoFoto = (etiqueta, ayuda = '', {varias = 0, principal = false, compacto = false} = {}) => {
  const max = varias || 1;
  return `<div class="campo${compacto ? ' campo-compacto' : ''}">${etiqueta ? `<span class="campo-t">${etiqueta}</span>` : ''}
  <div class="archivo${compacto ? ' compacto' : ''}"${principal ? ' data-principal="1"' : ''}>
    <div class="archivo-lista"></div>
    <label class="archivo-mas"><input type="file" name="foto" accept="image/*" class="archivo-input"${max > 1 ? ' multiple' : ''} data-max="${max}">
      <span class="archivo-cruz" aria-hidden="true">+</span><span class="archivo-mas-t">${compacto ? t('Foto') : max > 1 ? t('Añadir fotos') : t('Añadir foto')}</span></label>
  </div>${ayuda ? `<span class="ayuda">${ayuda}</span>` : ''}</div>`;
};
const pesoTxt = (bytes) => { const kb = bytes / 1024; return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1).replace('.', I18N.lang() === 'en' ? '.' : ',')} MB`; };
const ARCHIVOS = new WeakMap(); // input → las fotos elegidas hasta ahora, en orden
function ponerArchivos(input, lista) {
  ARCHIVOS.set(input, lista);
  const dt = new DataTransfer();
  lista.forEach((f) => dt.items.add(f));
  input.files = dt.files;
  pintarArchivo(input);
}
// al elegir en el diálogo del navegador: lo nuevo se añade a lo que había (o lo sustituye, si el campo es de una sola)
function alElegirArchivos(input) {
  const max = Number(input.dataset.max) || 1, antes = ARCHIVOS.get(input) || [];
  const nuevas = [...input.files].filter((f) => f.size && f.type.startsWith('image/'));
  if (input.files.length && !nuevas.length) toast(t('Eso no es una imagen'), true);
  let lista = max === 1 ? (nuevas.length ? nuevas.slice(0, 1) : antes) : [...antes, ...nuevas];
  lista = lista.filter((f, i) => lista.findIndex((x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified) === i); // sin repetir
  if (lista.length > max) { toast(t('Como mucho {max} fotos: me quedo con las {max} primeras', {max})); lista = lista.slice(0, max); }
  ponerArchivos(input, lista);
}
function pintarArchivo(input) {
  const caja = input.closest('.archivo'), max = Number(input.dataset.max) || 1;
  if (!input.files.length) ARCHIVOS.set(input, []); // vaciado desde fuera (input.value = '')
  const fs = ARCHIVOS.get(input) || [];
  (caja.urls || []).forEach((u) => URL.revokeObjectURL(u));
  caja.urls = fs.map((f) => URL.createObjectURL(f));
  caja.classList.toggle('con', fs.length > 0);
  caja.classList.toggle('lleno', fs.length >= max);
  const principal = caja.dataset.principal && fs.length > 1;
  caja.querySelector('.archivo-lista').innerHTML = fs.map((f, i) => `<span class="archivo-foto" title="${esc(f.name)} · ${pesoTxt(f.size)}"><img src="${caja.urls[i]}" alt="">
    ${principal && i === 0 ? `<span class="archivo-pral">${t('de la pieza')}</span>` : ''}
    <button class="archivo-x" type="button" data-i="${i}" aria-label="${esc(t('Quitar la foto {n}', {n: i + 1}))}">✕</button></span>`).join('');
  const t2 = caja.querySelector('.archivo-mas-t');
  if (t2 && !caja.classList.contains('compacto')) t2.textContent = fs.length ? t('Otra') : max > 1 ? t('Añadir fotos') : t('Añadir foto');
}
// fotos de un campo, reducidas a 1600 px en JPEG (las que solo ve el modelo: no hace falta encuadrarlas)
const reducida = async (file) => base64(await jpeg(await lienzoDe(file, 1600)));
const fotosDelCampo = (input) => [...(input?.files || [])].filter((f) => f.size);
document.addEventListener('change', (e) => { if (e.target.classList?.contains('archivo-input')) alElegirArchivos(e.target); });
document.addEventListener('click', (e) => {
  const x = e.target.closest?.('.archivo-x');
  if (!x) return;
  const input = x.closest('.archivo').querySelector('.archivo-input');
  ponerArchivos(input, (ARCHIVOS.get(input) || []).filter((_, i) => i !== Number(x.dataset.i)));
});

function toast(msg, mal = false, accion = null) {
  const t = $('#toast');
  t.textContent = msg;
  if (accion) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-accion';
    b.textContent = t(accion.texto);
    b.addEventListener('click', () => { t.className = ''; accion.fn(); }, {once: true});
    t.append(' ', b);
  }
  t.className = `show ${mal ? 'mal' : ''} ${accion ? 'con-accion' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = ''), accion ? 8000 : 2600);
}

async function api(method, url, body, headers = {}) {
  const opts = {method, headers};
  if (body instanceof Blob) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers = {'content-type': 'application/json', ...headers}; }
  let r;
  try { r = await fetch(url, opts); } catch { throw new Error(t('Sin conexión con el servidor: no se ha guardado')); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}
function guardarLocal(c) {
  const i = D.componentes.findIndex((x) => x.id === c.id);
  if (i >= 0) D.componentes[i] = c; else D.componentes.push(c);
  contadores();
}

// ---------- tema (guardado en la tabla ajustes) ----------
function aplicarTema() {
  const tx = TEMAS[D.ajustes.tema] ? D.ajustes.tema : 'auto';
  document.documentElement.dataset.tema = tx;
  $('#tema').textContent = t(TEMAS[tx]);
}
async function cambiarTema() {
  const orden = Object.keys(TEMAS);
  const sig = orden[(orden.indexOf(D.ajustes.tema) + 1) % orden.length];
  try { await api('PUT', 'api/ajustes/tema', {valor: sig}); D.ajustes.tema = sig; aplicarTema(); }
  catch (err) { toast(err.message, true); }
}

// la foto en un lienzo (lado largo como mucho «max» px), respetando la orientación de la cámara
async function lienzoDe(file, max) {
  let src;
  try { src = await createImageBitmap(file, {imageOrientation: 'from-image'}); }
  catch {
    src = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error(t('No puedo leer esa imagen'))); i.src = URL.createObjectURL(file); });
  }
  const w = src.width, h = src.height, s = Math.min(1, max / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * s); cv.height = Math.round(h * s);
  cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}
const jpeg = (cv) => new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.85));

// ---------- encuadre: un recuadro 4:3 fijo (el formato de las tarjetas); la foto se mueve, se amplía y se gira ----------
// para que todas las piezas salgan igual. Devuelve el JPEG recortado, la foto entera («Sin recortar») o null (cancelado).
const ENC_RATIO = 4 / 3, ENC_ZOOM = 5;
function encuadrar(file) {
  return new Promise(async (resolver) => {
    let S;
    try { S = await lienzoDe(file, 3200); } /* con margen para acercar sin perder detalle */ catch (err) { toast(err.message, true); resolver(null); return; }
    const capa = document.createElement('div');
    capa.className = 'encuadre';
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-modal', 'true');
    capa.setAttribute('aria-label', t('Encuadra la pieza'));
    capa.innerHTML = `<div class="enc-cab"><strong>${t('Encuadra la pieza')}</strong>
        <span>${t('Que quepa entera dentro del recuadro. Arrastra para moverla; pellizca o usa la barra para acercarla.')}</span></div>
      <div class="enc-escena"><canvas class="enc-img"></canvas><div class="enc-marco" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>
      <div class="enc-controles"><label class="enc-zoom-et">${t('Acercar')}<input type="range" class="enc-zoom" min="1" max="${ENC_ZOOM}" step="0.01" value="1"></label>
        <button type="button" class="btn" data-enc="girar">${t('Girar')}</button></div>
      <div class="enc-pie"><button type="button" class="btn" data-enc="cancelar">${t('Cancelar')}</button>
        <button type="button" class="btn" data-enc="entera">${t('Sin recortar')}</button>
        <button type="button" class="btn prim" data-enc="usar">${t('Usar foto')}</button></div>`;
    document.body.append(capa);
    document.body.classList.add('con-encuadre');
    const escena = capa.querySelector('.enc-escena'), img = capa.querySelector('.enc-img'), marcoEl = capa.querySelector('.enc-marco'), zoom = capa.querySelector('.enc-zoom');
    const lim = (v, a, b) => Math.min(b, Math.max(a, v));
    let M = {x: 0, y: 0, w: 1, h: 1}, s = 1, smin = 1, x = 0, y = 0; // marco (px de pantalla), escala y posición de la foto respecto al marco
    const pintar = () => { img.width = S.width; img.height = S.height; img.getContext('2d').drawImage(S, 0, 0); };
    const medir = () => {
      const r = escena.getBoundingClientRect();
      let w = r.width - 32, h = w / ENC_RATIO;
      if (h > r.height - 32) { h = r.height - 32; w = h * ENC_RATIO; }
      M = {x: (r.width - w) / 2, y: (r.height - h) / 2, w, h};
      Object.assign(marcoEl.style, {left: `${M.x}px`, top: `${M.y}px`, width: `${w}px`, height: `${h}px`});
      smin = Math.max(w / S.width, h / S.height); // la foto siempre cubre el recuadro
    };
    const ajustar = () => {
      s = lim(s, smin, smin * ENC_ZOOM);
      x = lim(x, M.w - S.width * s, 0);
      y = lim(y, M.h - S.height * s, 0);
      Object.assign(img.style, {width: `${S.width * s}px`, height: `${S.height * s}px`, transform: `translate(${M.x + x}px, ${M.y + y}px)`});
      zoom.value = String(s / smin);
    };
    const centrar = () => { s = smin; x = (M.w - S.width * s) / 2; y = (M.h - S.height * s) / 2; ajustar(); };
    const acercar = (nueva, px, py) => { // px, py: punto fijo, en px respecto al marco
      const k = lim(nueva, smin, smin * ENC_ZOOM) / s;
      x = px - (px - x) * k; y = py - (py - y) * k; s *= k;
      ajustar();
    };
    pintar(); medir(); centrar();

    // arrastrar con un dedo (o el ratón), pellizcar con dos, rueda en el ordenador
    const dedos = new Map();
    escena.addEventListener('pointerdown', (e) => { escena.setPointerCapture(e.pointerId); dedos.set(e.pointerId, {x: e.clientX, y: e.clientY}); });
    escena.addEventListener('pointermove', (e) => {
      const antes = dedos.get(e.pointerId);
      if (!antes) return;
      const ahora = {x: e.clientX, y: e.clientY};
      if (dedos.size === 1) { x += ahora.x - antes.x; y += ahora.y - antes.y; ajustar(); }
      else if (dedos.size === 2) {
        const otro = [...dedos.entries()].find(([k]) => k !== e.pointerId)[1];
        const d0 = Math.hypot(antes.x - otro.x, antes.y - otro.y), d1 = Math.hypot(ahora.x - otro.x, ahora.y - otro.y);
        const r = escena.getBoundingClientRect();
        x += (ahora.x - antes.x) / 2; y += (ahora.y - antes.y) / 2;
        if (d0 > 0) acercar(s * (d1 / d0), (ahora.x + otro.x) / 2 - r.left - M.x, (ahora.y + otro.y) / 2 - r.top - M.y); else ajustar();
      }
      dedos.set(e.pointerId, ahora);
    });
    const soltar = (e) => dedos.delete(e.pointerId);
    escena.addEventListener('pointerup', soltar);
    escena.addEventListener('pointercancel', soltar);
    escena.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = escena.getBoundingClientRect();
      acercar(s * Math.exp(-e.deltaY / 400), e.clientX - r.left - M.x, e.clientY - r.top - M.y);
    }, {passive: false});
    zoom.addEventListener('input', () => acercar(smin * Number(zoom.value), M.w / 2, M.h / 2));
    const alCambiarTamano = () => { const rel = s / smin; medir(); s = smin * rel; ajustar(); };
    window.addEventListener('resize', alCambiarTamano);
    const tecla = (e) => { if (e.key === 'Escape') cerrar(null); };
    document.addEventListener('keydown', tecla);

    function cerrar(valor) {
      window.removeEventListener('resize', alCambiarTamano);
      document.removeEventListener('keydown', tecla);
      capa.remove();
      document.body.classList.remove('con-encuadre');
      resolver(valor);
    }
    capa.addEventListener('click', async (e) => {
      const accion = e.target.closest('[data-enc]')?.dataset.enc;
      if (accion === 'cancelar') cerrar(null);
      else if (accion === 'girar') { // 90° a la derecha
        const r = document.createElement('canvas');
        r.width = S.height; r.height = S.width;
        const c = r.getContext('2d');
        c.translate(r.width, 0); c.rotate(Math.PI / 2); c.drawImage(S, 0, 0);
        S = r; pintar(); medir(); centrar();
      } else if (accion === 'entera') {
        const k = Math.min(1, 1600 / Math.max(S.width, S.height)), o = document.createElement('canvas');
        o.width = Math.round(S.width * k); o.height = Math.round(S.height * k);
        o.getContext('2d').drawImage(S, 0, 0, o.width, o.height);
        cerrar(await jpeg(o));
      } else if (accion === 'usar') {
        const sw = M.w / s, sh = M.h / s, o = document.createElement('canvas');
        o.width = Math.round(lim(sw, 400, 1600)); o.height = Math.round(o.width / ENC_RATIO);
        o.getContext('2d').drawImage(S, -x / s, -y / s, sw, sh, 0, 0, o.width, o.height);
        cerrar(await jpeg(o));
      }
    });
  });
}
// la foto que se sube: encuadrada por el usuario; null si canceló
async function fotoEncuadrada(file) {
  const blob = await encuadrar(file);
  if (!blob) toast(t('Foto cancelada: no se ha subido nada'));
  return blob;
}
const base64 = (blob) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob); });

async function subirFoto(id, file) {
  const blob = await fotoEncuadrada(file);
  if (!blob) return null;
  toast(t('Subiendo foto…'));
  const c = await api('PUT', `api/componentes/${id}/foto`, blob, {'content-type': 'image/jpeg'});
  guardarLocal(c);
  toast(t('Foto guardada'));
  return c;
}

const revisar = (c) => (c.revisar ? ` <span class="etq-pend">${t('pendiente')}</span>` : '');
const stepper = (c, grande = false) => c.varios
  ? `<span class="muchos">${t('muchos')}</span>`
  : `<div class="stepper ${grande ? 'grande' : ''}"><button data-adj="-1" data-id="${c.id}" aria-label="${esc(t('Quitar uno'))}">−</button>
     <span class="num ${unidades(c) ? '' : 'cero'}">${esc(qtyText(c))}</span>
     <button data-adj="1" data-id="${c.id}" aria-label="${esc(t('Añadir uno'))}">+</button></div>`;

// tabla de pines. Cada fila es UN pin: [pin, uso, función, nota]. Color y nombre de cada función salen de la base de
// datos (claro y noche). Con pocos pines, una tabla sin más. Con muchos (una placa), agrupados por función: cada grupo
// plegado con sus pines en una línea («GPIO 21 · 22 · 32–39») y, al abrirlo, el detalle de cada uno con su nota.
// «En orden» los enseña todos seguidos, como están en la placa. La vista elegida se recuerda mientras dure la visita.
const PINES_AGRUPAR = 8;
const colorPin = (id) => { const x = FUNC[id] || {color_claro: '#888888', color_oscuro: '#888888'}; return `--cc:${esc(x.color_claro)};--co:${esc(x.color_oscuro)}`; };
// «GPIO 21», «GPIO 22», «GPIO 32»…«GPIO 39» → «GPIO 21 · 22 · 32–39» (solo para leerlos de un vistazo)
function resumenPines(nombres) {
  const out = [];
  let prefijo = null, nums = [];
  const cerrar = () => {
    if (!nums.length) return;
    nums.sort((a, b) => a - b); // de menor a mayor: se lee mejor que en el orden de la placa
    const tramos = [];
    for (let i = 0; i < nums.length; i++) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      tramos.push(j - i >= 2 ? `${nums[i]}–${nums[j]}` : nums.slice(i, j + 1).join(' · '));
      i = j;
    }
    out.push(`${prefijo}${tramos.join(' · ')}`);
    nums = [];
  };
  for (const n of nombres) {
    const m = String(n).match(/^(.*?\D)(\d+)$/);
    if (m && m[1] === prefijo) { nums.push(Number(m[2])); continue; }
    cerrar();
    if (m) { prefijo = m[1]; nums = [Number(m[2])]; } else { prefijo = null; out.push(n); }
  }
  cerrar();
  return out.join(' · ');
}
const filaPin = (p, n) => `<tr style="${colorPin(p.fn)}"${FUNC[p.fn]?.tachado ? ' class="tachado"' : ''}>${n != null ? `<td class="n">${n}</td>` : ''}
  <td class="pin"><span class="pin-chip"><i class="dot"></i>${esc(p.pin)}</span></td><td>${esc(p.uso)}${p.nota ? `<div class="sub pin-nota">${esc(p.nota)}</div>` : ''}</td></tr>`;
function tablaPines(f) {
  const pines = list(f.pines).map(([pin, uso, fn, nota]) => ({pin, uso, fn, nota}));
  if (!pines.length) return '';
  const usadas = Object.keys(FUNC).filter((k) => pines.some((p) => p.fn === k));
  const leyenda = `<div class="leyenda">${usadas.map((k) => `<span class="ley-it" style="${colorPin(k)}"><i class="dot"></i>${esc(FUNC[k].nombre)}</span>`).join('')}</div>`;
  const enOrden = `<table class="t t-pines"><thead><tr><th class="n">#</th><th>${t('Pin')}</th><th>${t('Uso')}</th></tr></thead><tbody>${pines.map((p, i) => filaPin(p, i + 1)).join('')}</tbody></table>`;
  const cuenta = `<span class="pines-cnt">${plural(pines.length, 'pin')}</span>`;
  if (pines.length <= PINES_AGRUPAR) return `<div class="pines"><div class="pines-top">${cuenta}</div>${enOrden}${leyenda}</div>`;
  const vista = ui.pinesVista === 'orden' ? 'orden' : 'funcion';
  const grupos = usadas.map((k) => {
    const ps = pines.filter((p) => p.fn === k), notas = ps.filter((p) => p.nota).length;
    return `<details class="pin-grupo" style="${colorPin(k)}"><summary>
      <span class="pin-grupo-etq"><i class="dot"></i><span>${esc(FUNC[k].nombre)}</span><span class="n">${ps.length}</span></span>
      <span class="pin-grupo-mid"><span class="pin-grupo-pines${FUNC[k].tachado ? ' tachado' : ''}">${esc(resumenPines(ps.map((p) => p.pin)))}</span>${notas ? `<span class="etq-pend pin-grupo-notas">${plural(notas, 'nota')}</span>` : ''}</span>
    </summary><div class="pin-grupo-cuerpo"><table class="t t-pines"><tbody>${ps.map((p) => filaPin(p)).join('')}</tbody></table></div></details>`;
  }).join('');
  return `<div class="pines" data-pines-modo="${vista}"><div class="pines-top">${cuenta}
      <div class="seg conmuta" role="group" aria-label="${esc(t('Cómo ver los pines'))}">${[['funcion', t('Por función')], ['orden', t('En orden')]].map(([k, lbl]) =>
        `<button class="${vista === k ? 'on' : ''}" type="button" data-pines-vista="${k}" aria-pressed="${vista === k}">${lbl}</button>`).join('')}</div></div>
    <div class="pines-funcion">${grupos}</div><div class="pines-orden">${enOrden}${leyenda}</div></div>`;
}

// ---------- vistas ----------
// el tipo en la fila de una pieza: solo lo que el nombre de la pieza no dice ya («HC-SR04» + «ultrasonidos»; nada si
// el tipo se llama igual que la pieza)
const PALABRAS_VACIAS = new Set(['de', 'del', 'con', 'la', 'el', 'los', 'las', 'para', 'por', 'en', 'of', 'with', 'for', 'in', 'the', 'and', 'to']);
function tipoEnFila(c) {
  if (!c.tipo || !D.tipos[c.tipo]) return '';
  const t = g(c.tipo).nombre, pieza = norm(c.nombre).replace(/[^a-z0-9]+/g, ' ');
  const nuevas = norm(t).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !PALABRAS_VACIAS.has(w) && !pieza.includes(w));
  if (!nuevas.length) return '';
  return norm(t).startsWith(norm(c.nombre)) ? t.slice(c.nombre.length).replace(/^[\s(·:,-]+|[)\s]+$/g, '') || t : t;
}
// ---------- disposición AMSTech (mockup aprobado el 23/11/2026) ----------
// iconos de línea (heredan el color del texto)
const ico = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICO = {
  camara: ico('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  galeria: ico('<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 18l5-5 3 3 2-2 4 4"/>'),
  varias: ico('<rect x="4" y="6" width="7" height="7" rx="1"/><rect x="13" y="11" width="7" height="7" rx="1"/><path d="M4 17h6M14 7h6"/>'),
  lapiz: ico('<path d="M5 19l1-4L16 5l3 3L9 18z"/><path d="M14 7l3 3"/>'),
  mas: ico('<path d="M12 5v14M5 12h14"/>'),
  rejilla: ico('<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>'),
  lista: ico('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
  chispa: ico('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/>'),
  aviso: ico('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>'),
  filtros: ico('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
};
// la categoría de una pieza: cuadradito de su color + nombre
const etqCat = (cat, cls = 'pz-cat') => `<span class="${cls}"${conColor(cat)}>${marcaCat}<span class="pz-cat-t">${esc(CATS[cat] || t('Otros'))}</span></span>`;
// imagen de una pieza: su foto o el dibujo de su tipo sobre el color de su categoría (sin dibujo, solo el color)
const imgPieza = (c, cls) => (c.foto ? `<span class="${cls}"><img src="${fotoUrl(c)}" alt="" loading="lazy"></span>`
  : `<span class="${cls} dibujo"${conColor(catOf(c))}>${c.tipo ? `<img src="img/tipos/${esc(c.tipo)}.svg" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`);
const cuenta = (c) => `<span class="cuenta num${unidades(c) || c.varios ? '' : ' cero'}">${esc(qtyText(c))}</span>`;
const etqPend = (c) => (c.revisar ? `<span class="etq-pend">${t('pendiente')}</span>` : '');

// lista: miniatura, nombre y categoría; en escritorio, sitio, tensión e interfaces en columnas y el − n +;
// en el móvil, la cantidad en un recuadro que al tocarlo se convierte en − n +
function filaComp(c) {
  const f = c.tipo && D.tipos[c.tipo] ? g(c.tipo) : null, tipo = tipoEnFila(c);
  return `<div class="fila fila-pieza${ui.cuentaAbierta === c.id ? ' editando' : ''}">
    <a class="fila-main" href="#/c/${c.id}">${imgPieza(c, 'fila-img')}
      <div><div class="nombre">${esc(c.nombre)}${revisar(c)}</div>
      <div class="sub">${etqCat(catOf(c))}${tipo ? `<span class="solo-escritorio"> · ${esc(tipo)}</span>` : ''}${c.ubicacion ? `<span class="solo-movil"> · ${esc(c.ubicacion)}</span>` : ''}</div></div></a>
    <div class="fila-cols solo-escritorio"><span>${esc(c.ubicacion) || '<span class="gris">—</span>'}</span><span>${f ? esc(voltajeDe(f)) : ''}</span>
      <span>${f ? esc(list(f.interfaz).slice(0, 2).join(', ')) : ''}</span></div>
    ${c.varios ? '' : `<button class="cuenta-btn num" type="button" data-cuenta="${c.id}" aria-label="${esc(t('Cambiar la cantidad ({q})', {q: qtyText(c)}))}">${esc(qtyText(c))}</button>`}
    ${stepper(c)}</div>`;
}
const cabInventario = () => `<div class="fila fila-cab solo-escritorio" aria-hidden="true"><div class="fila-main">${t('Pieza')}</div>
  <div class="fila-cols"><span>${t('Sitio')}</span><span>${t('Tensión')}</span><span>${t('Interfaz')}</span></div><div class="fila-cant">${t('Cantidad')}</div></div>`;

// cuadrícula: foto o dibujo arriba, la cantidad en la esquina y debajo nombre, categoría y sitio
function tarjetaComp(c) {
  return `<a class="tarjeta" href="#/c/${c.id}">${imgPieza(c, 'tarjeta-img')}${etqPend(c)}${cuenta(c)}
    <span class="tarjeta-txt"><span class="nombre">${esc(c.nombre)}</span>
      <span class="tarjeta-meta">${etqCat(catOf(c))}<span class="sitio">${esc(c.ubicacion || t('sin sitio'))}</span></span></span></a>`;
}
const vistaInv = () => (D.ajustes.vista_inventario === 'cuadricula' ? 'cuadricula' : 'lista');

// en una lista filtrada: «también hay N tipos y M proyectos con eso» → búsqueda en todo
function tambien(query, aqui) {
  if (!query) return '';
  const r = buscarTodo(query), partes = [];
  if (aqui !== 'piezas' && r.piezas.length) partes.push(plural(r.piezas.length, 'pieza'));
  if (aqui !== 'tipos' && r.tipos.length) partes.push(plural(r.tipos.length, 'tipo'));
  if (aqui !== 'proyectos' && r.proyectos.length) partes.push(plural(r.proyectos.length, 'proyecto'));
  return partes.length ? `<p class="tambien">${t('También con «{q}»: ', {q: esc(query)})}<a href="#/buscar">${partes.join(', ')} →</a></p>` : '';
}

// la caja azul: lo principal de la pantalla es añadir piezas con la IA (solo escritorio; en el móvil, el «+»)
function cajaIA() {
  if (!D.ia?.activa) return `<section class="caja-ia solo-escritorio"><span class="caja-ia-ico">${ICO.camara}</span>
    <div><b class="caja-ia-t">${t('Añadir con IA')}</b><p>${t('Pon tu clave de OpenCode Go y la IA identificará tus piezas por foto: nombre, tipo y pines.')}</p></div>
    <div class="caja-ia-bot"><a class="btn blanco" href="#/ia/ajustes">${t('Configurar la IA')}</a></div></section>`;
  return `<section class="caja-ia solo-escritorio"><span class="caja-ia-ico">${ICO.camara}</span>
    <div><b class="caja-ia-t">${t('Añadir con IA')}</b><p>${t('Haz una foto a una pieza (o a varias a la vez): la IA propone nombre, tipo y pines, y tú lo revisas antes de guardar.')}
      <a href="#/ia">${t('Con foto y texto →')}</a></p></div>
    <div class="caja-ia-bot"><label class="btn amarillo" tabindex="0">${t('Foto con IA')}<input type="file" accept="image/*" class="foto-directa" hidden></label>
      <a class="btn blanco" href="#/ia/varias">${t('Varias piezas')}</a></div></section>`;
}

function vInventario() {
  const query = q.value.trim(), todas = D.componentes;
  let cs = todas.slice();
  const porCat = {};
  cs.forEach((c) => (porCat[catOf(c)] = (porCat[catOf(c)] || 0) + 1));
  if (query) cs = cs.filter((c) => matches(compText(c), query));
  if (ui.cat) cs = cs.filter((c) => catOf(c) === ui.cat);
  if (ui.ubic) cs = cs.filter((c) => (ui.ubic === '∅' ? !c.ubicacion : c.ubicacion === ui.ubic));
  if (ui.revisar) cs = cs.filter((c) => c.revisar);
  if (ui.sinFoto) cs = cs.filter((c) => !c.foto);
  const n = (fn) => todas.filter(fn).length, sitios = ubicaciones(), orden = Object.keys(CATS);
  const activos = [ui.ubic, ui.revisar, ui.sinFoto].filter(Boolean).length;
  const opCat = (k, nombre, cuantas, cls) => `<button class="${cls}${ui.cat === k ? ' on' : ''}" type="button" data-cat="${k}"${k ? conColor(k) : ''} aria-pressed="${ui.cat === k}">${k ? marcaCat : '<span class="ams-cuadro todas" aria-hidden="true"></span>'}${esc(nombre)}<span class="n">${cuantas}</span></button>`;
  const catsVisibles = orden.filter((k) => porCat[k]);

  // lateral (escritorio): categorías y «Mostrar»; en el móvil las categorías van en una tira y «Mostrar» se abre con el botón de filtros
  const lado = `<aside class="lado" aria-label="${esc(t('Filtros'))}">
    <h2 class="lado-t solo-escritorio">${t('Categorías')}</h2>
    <div class="lado-caja lado-cats solo-escritorio">${opCat('', t('Todas'), todas.length, 'lado-op')}${catsVisibles.map((k) => opCat(k, CATS[k], porCat[k], 'lado-op')).join('')}</div>
    <h2 class="lado-t">${t('Mostrar')}</h2>
    <div class="lado-caja lado-mostrar">
      <label class="lado-op"><input type="checkbox" id="rev" ${ui.revisar ? 'checked' : ''}>${t('Con «pendiente»')}<span class="n">${n((c) => c.revisar)}</span></label>
      <label class="lado-op"><input type="checkbox" id="sin-sitio" ${ui.ubic === '∅' ? 'checked' : ''}>${t('Sin sitio')}<span class="n">${n((c) => !c.ubicacion)}</span></label>
      <label class="lado-op"><input type="checkbox" id="sin-foto" ${ui.sinFoto ? 'checked' : ''}>${t('Sin foto')}<span class="n">${n((c) => !c.foto)}</span></label>
      ${sitios.length ? `<label class="lado-sitio"><span>${t('Sitio')}</span><select id="ubic" class="sel"><option value="">${t('Cualquier sitio')}</option>
        ${sitios.map((u) => `<option ${ui.ubic === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>` : ''}
    </div></aside>`;
  const cab = `<div class="inv-cab"><h1>${t('Inventario')} <small>${piezasTxt(todas.length)}</small></h1>
    <button class="btn icono solo-movil${ui.filtros || activos ? ' on' : ''}" id="filtros-abrir" type="button" aria-expanded="${!!ui.filtros}" aria-label="${esc(t('Filtros y vista'))}">${ICO.filtros}${activos ? `<span class="n">${activos}</span>` : ''}</button>
    <div class="inv-acciones">
      <div class="seg" role="group" aria-label="${esc(t('Vista'))}">${[['cuadricula', t('Cuadrícula'), ICO.rejilla], ['lista', t('Lista'), ICO.lista]].map(([k, v, i]) =>
        `<button type="button" class="${vistaInv() === k ? 'on' : ''}" data-vista-inv="${k}" aria-pressed="${vistaInv() === k}">${i}${v}</button>`).join('')}</div>
      <button class="btn${ui.seleccionando ? ' on' : ''}" id="sel-modo" type="button">${ui.seleccionando ? t('Terminar') : t('Seleccionar')}</button>
      <a class="btn solo-escritorio" href="#/nuevo">${ICO.mas}${t('A mano')}</a>
    </div></div>
    <div class="chips solo-movil">${opCat('', t('Todas'), todas.length, 'chip')}${catsVisibles.map((k) => opCat(k, CATS[k], porCat[k], 'chip')).join('')}</div>`;

  let cuerpo;
  const sel = ui.seleccionando, rejilla = vistaInv() === 'cuadricula';
  if (!todas.length) cuerpo = vacio(t('Aún no hay piezas. Pulsa + para añadir la primera.'));
  else if (!cs.length) cuerpo = tambien(query, 'piezas') + vacio(t('Nada coincide con el filtro.'));
  else {
    cs.sort((a, b) => orden.indexOf(catOf(a)) - orden.indexOf(catOf(b)) || byName(a, b));
    ui.visibles = cs.map((c) => c.id);
    const cabSel = sel ? `<div class="sel-cab"><span class="gris">${t('Elige las piezas:')}</span>
      <button class="f" type="button" data-sel="visibles">${t('Todas las que se ven ({n})', {n: cs.length})}</button>
      <button class="f" type="button" data-sel="ninguna">${t('Ninguna')}</button></div>` : '';
    cuerpo = tambien(query, 'piezas') + cabSel + (rejilla
      ? `<div class="rejilla">${cs.map(sel ? tarjetaSel : tarjetaComp).join('')}</div>`
      : `<div class="lista-piezas${sel ? ' sel' : ''}">${sel ? '' : cabInventario()}${cs.map(sel ? filaSel : filaComp).join('')}</div>`);
  }
  return `<div class="inv${ui.filtros ? ' filtros-abiertos' : ''}">${lado}<div class="inv-main">${cab}${sel ? '' : cajaIA()}
    <div id="pend-aviso" aria-live="polite"></div>${cuerpo}</div></div>${sel ? `<div class="sel-hueco"></div>${barraSel()}` : ''}`;
}

// ---------- varias piezas a la vez: elegir en el Inventario, editarlas juntas y corregirlas con la IA ----------
// ui.sel: ids elegidos (se mantienen al ir a «Editar juntas»); ui.seleccionando: el Inventario está en modo elegir
const MAX_LOTE_IA = 30;
const selIds = () => [...ui.sel].filter((id) => comp(id));
const piezasTxt = (n) => I18N.plural(n, 'pieza');
function filaSel(c) {
  const marcada = ui.sel.has(c.id);
  return `<label class="fila fila-sel${marcada ? ' marcada' : ''}"><input type="checkbox" class="sel-pieza" value="${c.id}" ${marcada ? 'checked' : ''} aria-label="${esc(t('Elegir {n}', {n: c.nombre}))}">
    ${imgPieza(c, 'fila-img')}
    <span class="fila-sel-txt"><span class="nombre">${esc(c.nombre)}${revisar(c)}</span>
      <span class="sub">${[c.tipo ? g(c.tipo).nombre : '', c.ubicacion].filter(Boolean).map(esc).join(' · ')}</span></span>
    <span class="der num">${esc(qtyText(c))}</span></label>`;
}
function tarjetaSel(c) {
  const marcada = ui.sel.has(c.id);
  return `<label class="tarjeta tarjeta-sel${marcada ? ' marcada' : ''}">
    <input type="checkbox" class="sel-pieza" value="${c.id}" ${marcada ? 'checked' : ''} aria-label="${esc(t('Elegir {n}', {n: c.nombre}))}">
    ${imgPieza(c, 'tarjeta-img')}${cuenta(c)}
    <span class="tarjeta-txt"><span class="nombre">${esc(c.nombre)}</span>
      <span class="tarjeta-meta">${etqCat(catOf(c))}<span class="sitio">${esc(c.ubicacion || t('sin sitio'))}</span></span></span></label>`;
}
// barra fija abajo con lo que se puede hacer con las elegidas
function barraSel() {
  const n = selIds().length, ia = D.ia?.activa;
  if (ui.selIA) {
    const m = (MODELOS_IA || []).find((x) => x.id === D.ia?.modelo);
    const coste = m?.coste_medio?.dolares ?? (m ? ((m.precio.entrada ?? 0) * 6000 + (m.precio.salida ?? 0) * 900) / 1e6 : null);
    return `<div class="sel-barra sel-barra-ia" id="sel-barra" role="region" aria-label="${esc(t('Corregir con IA las elegidas'))}">
      <p><strong>${t('Corregir {piezas} con IA.', {piezas: piezasTxt(n)})}</strong> ${n > MAX_LOTE_IA ? `<span class="mal">${t('Como mucho {max} a la vez.', {max: MAX_LOTE_IA})}</span>`
        : t('Una consulta por pieza{coste}; después revisas los cambios de todas en una pantalla.', {coste: coste != null ? t(' (≈ {c} en total)', {c: dolares(coste * n)}) : ''})}</p>
      <textarea id="sel-ia-texto" rows="2" maxlength="1000" placeholder="${esc(t('Qué corregir (opcional, vale para todas): «revisa los pines», «pon el nombre con el modelo»…'))}"></textarea>
      <div class="sel-botones"><button class="btn prim" type="button" data-sel-acc="ia-enviar" ${n && n <= MAX_LOTE_IA ? '' : 'disabled'}>${t(n === 1 ? 'Pedir 1 corrección' : 'Pedir {n} correcciones', {n})}</button>
        <button class="btn" type="button" data-sel-acc="ia-cancelar">${t('Cancelar')}</button></div></div>`;
  }
  return `<div class="sel-barra" id="sel-barra" role="region" aria-label="${esc(t('Piezas elegidas'))}">
    <span class="sel-n">${n ? t(n === 1 ? '<strong>{n}</strong> elegida' : '<strong>{n}</strong> elegidas', {n}) : t('Toca las piezas para elegirlas')}</span>
    <div class="sel-botones">
      <button class="btn prim" type="button" data-sel-acc="editar" ${n ? '' : 'disabled'}>${t('Editar juntas')}</button>
      ${ia ? `<button class="btn" type="button" data-sel-acc="ia" ${n ? '' : 'disabled'}>${t('Corregir con IA')}</button>` : ''}
      ${menuMas([
        `<button role="menuitem" type="button" data-sel-acc="pendiente" ${n ? '' : 'disabled'}>${t('Marcar como pendientes')}</button>`,
        `<button role="menuitem" type="button" data-sel-acc="sin-pendiente" ${n ? '' : 'disabled'}>${t('Quitar la marca de pendiente')}</button>`,
        `<button role="menuitem" type="button" class="peligro" data-sel-acc="borrar" ${n ? '' : 'disabled'}>${t('Borrar las elegidas')}</button>`])}
    </div></div>`;
}
const refrescarBarraSel = () => { const b = $('#sel-barra'); if (b) b.outerHTML = barraSel(); };

async function accionSel(acc) {
  const ids = selIds();
  if (acc === 'editar') { location.hash = '#/lote'; return; }
  if (acc === 'ia') { ui.selIA = true; if (!MODELOS_IA && D.ia?.activa) modelosIA().then(refrescarBarraSel).catch(() => {}); refrescarBarraSel(); $('#sel-ia-texto')?.focus(); return; }
  if (acc === 'ia-cancelar') { ui.selIA = false; refrescarBarraSel(); return; }
  if (acc === 'ia-enviar') {
    const r = await api('POST', 'api/ia/revisar-lote', {ids, texto: $('#sel-ia-texto')?.value || ''});
    salirSeleccion();
    location.hash = `#/ia/lote/${r.lote}`;
    return;
  }
  if (acc === 'pendiente' || acc === 'sin-pendiente') {
    await api('POST', 'api/componentes/lote', {piezas: ids.map((id) => ({id, revisar: acc === 'pendiente'}))});
    await cargar(); contadores();
    toast(t(acc === 'pendiente' ? '{piezas} marcadas como pendientes' : 'Marca quitada a {piezas}', {piezas: piezasTxt(ids.length)}));
    route();
    return;
  }
  if (acc === 'borrar') {
    if (!(await confirmar(t('¿Borrar {piezas}?\nPodrás deshacerlo durante 2 minutos.', {piezas: piezasTxt(ids.length)}), {si: 'Borrar', peligro: true}))) return;
    const r = await api('POST', 'api/componentes/lote/borrar', {ids});
    D.componentes = D.componentes.filter((c) => !ids.includes(c.id));
    salirSeleccion(); contadores(); route();
    toast(t('{piezas} borradas', {piezas: piezasTxt(r.borradas)}), false, {texto: 'Deshacer', fn: async () => {
      try { await api('POST', 'api/componentes/restaurar', {tokens: r.deshacer}); await cargar(); contadores(); route(); toast(t('Recuperadas')); }
      catch (err) { toast(err.message, true); }
    }});
  }
}
function salirSeleccion() { ui.seleccionando = false; ui.sel.clear(); ui.selIA = false; }

// ---- «Editar juntas»: una tabla con las elegidas; arriba, «A todas» para poner lo mismo a todas ----
function opcionesTiposLista(sel) {
  return `<option value="">${t('Sin tipo')}</option>` + Object.keys(CATS).map((cat) => {
    const ts = Object.entries(D.tipos).filter(([k, tp]) => tp.categoria === cat && (!tp.archivado || k === sel)).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, I18N.lang()));
    return ts.length ? `<optgroup label="${esc(CATS[cat])}">${ts.map(([k, tp]) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${esc(tp.nombre)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}
function vLote() {
  const cs = selIds().map(comp).sort(byName);
  if (!cs.length) return `${migas([`<a href="#/">${t('Inventario')}</a>`, `<span>${t('Editar varias')}</span>`])}${vacio(t('No hay piezas elegidas. En el Inventario, pulsa «Seleccionar» y toca las que quieras.'))}`;
  return `${migas([`<a href="#/">${t('Inventario')}</a>`, `<span>${t('Editar {piezas}', {piezas: piezasTxt(cs.length)})}</span>`])}
    <div class="plano">
      ${cabIA(t('Editar {piezas}', {piezas: piezasTxt(cs.length)}), t('Cambia lo que quieras: solo se guarda lo que cambies. Con «A todas» les pones lo mismo a todas de una vez.'))}
      <section class="caja bloque-caja lote-todas">
        <h3 class="rotulo">${t('A todas')}</h3>
        <div class="lote-todas-filas">
          <label>${t('Sitio')}<input id="lt-sitio" list="ubics" maxlength="120" placeholder="${esc(t('Cajita 3'))}"></label>
          <button class="btn mini" type="button" data-lote-todas="sitio">${t('Poner')}</button>
          <label>${t('Tipo')}<select id="lt-tipo">${opcionesTiposLista('')}</select></label>
          <button class="btn mini" type="button" data-lote-todas="tipo">${t('Poner')}</button>
          <span class="lote-todas-pend">${t('Pendiente')}</span>
          <span class="lote-todas-botones"><button class="btn mini" type="button" data-lote-todas="pend-si">${t('Marcar')}</button>
            <button class="btn mini" type="button" data-lote-todas="pend-no">${t('Quitar')}</button></span>
        </div>
      </section>
      <form id="form-lote" class="caja bloque-caja lote" autocomplete="off">
        <div class="lote-cab" aria-hidden="true"><span>${t('Nombre')}</span><span>${t('Cantidad')}</span><span>${t('Sitio')}</span><span>${t('Tipo')}</span><span>${t('Pendiente')}</span></div>
        ${cs.map((c) => `<div class="lote-fila" data-id="${c.id}">
          <label class="lote-celda lc-nombre"><span class="ed-et">${t('Nombre')}</span><input name="nombre" maxlength="200" required value="${esc(c.nombre)}"></label>
          <label class="lote-celda lc-cantidad"><span class="ed-et">${t('Cantidad')}</span><input name="cantidad" type="number" min="0" inputmode="numeric"
            value="${c.varios ? '' : esc(c.cantidad ?? '')}" placeholder="${c.varios ? esc(t('muchas')) : esc(t('Cantidad'))}"></label>
          <label class="lote-celda lc-sitio"><span class="ed-et">${t('Sitio')}</span><input name="ubicacion" list="ubics" maxlength="120" value="${esc(c.ubicacion)}" placeholder="${esc(t('Sitio'))}"></label>
          <label class="lote-celda lc-tipo"><span class="ed-et">${t('Tipo')}</span><select name="tipo">${opcionesTiposLista(c.tipo || '')}</select></label>
          <label class="lote-celda lc-pend"><input type="checkbox" name="revisar" ${c.revisar ? 'checked' : ''}><span class="ed-et">${t('Pendiente')}</span></label>
        </div>`).join('')}
        <datalist id="ubics">${ubicaciones().map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
        <div class="acciones"><button class="btn prim" type="submit">${t('Guardar cambios')}</button><a class="btn" href="#/">${t('Cancelar')}</a></div>
      </form>
    </div>`;
}
function ponerATodas(que) {
  const filas = document.querySelectorAll('#form-lote .lote-fila');
  if (que === 'sitio') { const v = $('#lt-sitio').value.trim(); filas.forEach((f) => (f.querySelector('[name=ubicacion]').value = v)); toast(v ? t('Sitio «{v}» puesto a todas (falta guardar)', {v}) : t('Sitio vaciado en todas (falta guardar)')); }
  if (que === 'tipo') { const v = $('#lt-tipo').value; filas.forEach((f) => (f.querySelector('[name=tipo]').value = v)); toast(t('Tipo «{v}» puesto a todas (falta guardar)', {v: v ? g(v).nombre : t('Sin tipo')})); }
  if (que === 'pend-si' || que === 'pend-no') { filas.forEach((f) => (f.querySelector('[name=revisar]').checked = que === 'pend-si')); toast(t('Hecho en todas (falta guardar)')); }
}
async function guardarLote(form) {
  const piezas = [];
  for (const f of form.querySelectorAll('.lote-fila')) {
    const c = comp(f.dataset.id), v = (n) => f.querySelector(`[name=${n}]`);
    if (!c) continue;
    const p = {id: c.id};
    const nombre = v('nombre').value.trim();
    if (nombre && nombre !== c.nombre) p.nombre = nombre;
    const cant = v('cantidad').value.trim();
    if (c.varios ? cant !== '' : cant !== String(c.cantidad ?? '')) p.cantidad = cant === '' ? null : cant;
    if (v('ubicacion').value.trim() !== (c.ubicacion || '')) p.ubicacion = v('ubicacion').value.trim();
    if (v('tipo').value !== (c.tipo || '')) p.tipo = v('tipo').value || null;
    if (v('revisar').checked !== !!c.revisar) p.revisar = v('revisar').checked;
    if (Object.keys(p).length > 1) piezas.push(p);
  }
  if (!piezas.length) { toast(t('No has cambiado nada')); return; }
  await api('POST', 'api/componentes/lote', {piezas});
  await cargar(); contadores();
  salirSeleccion();
  location.hash = '#/';
  toast(t(piezas.length === 1 ? '{piezas} guardada' : '{piezas} guardadas', {piezas: piezasTxt(piezas.length)}));
}

// ---- correcciones de varias piezas: todas en una pantalla; se aplica lo marcado de todas a la vez ----
const LOTE = {id: null, desmarcados: new Set()};
function filaCambio(c, extra = '') {
  return `<span class="nombre">${esc(c.etiqueta)}${c.tipoCambio === 'nuevo' ? ` <span class="gris">${t('· nuevo')}</span>` : c.tipoCambio === 'quitado' ? ` <span class="gris">${t('· se quita')}</span>` : ''}</span>
    ${c.antes ? `<span class="ia-antes">${esc(c.antes)}</span>` : ''}
    ${c.despues ? `<span class="ia-ahora">${esc(c.despues)}</span>` : ''}${extra}`;
}
function vLoteIA(id) {
  return `${migas([`<a href="#/pendientes">${t('Cambios pendientes')}</a>`, `<span>${t('Lote')}</span>`])}<div class="plano ia-plano" id="lote-zona" data-lote="${esc(id)}"><p class="gris">${t('Cargando…')}</p></div>`;
}
function htmlLote(ts) {
  if (ts[0].clase === 'alta') return htmlLoteAltas(ts);
  const listas = ts.filter((t2) => t2.estado !== 'pendiente').length;
  const tarea = (tr) => {
    const c = comp(tr.objetivo?.componente_id), cambios = tr.propuesta?.cambios || [];
    const estado = {pendiente: t('pensando…'), propuesta: cambios.length ? plural(cambios.length, 'cambio') : t('nada que cambiar'),
      aplicada: t('aplicada'), descartada: t('descartada'), error: t('error')}[tr.estado] || tr.estado;
    const clsEtq = tr.estado === 'error' ? ' ams-etiqueta--mal' : tr.estado === 'aplicada' ? ' ams-etiqueta--ok' : tr.estado === 'pendiente' ? ' ams-etiqueta--amarilla' : '';
    const cuerpo = tr.estado === 'error' ? `<p class="mal">${esc(tr.error || t('Error'))}</p>`
      : tr.estado === 'propuesta' ? `${cambios.map((x) => `<label class="ia-cambio-fila"><input type="checkbox" class="lote-cambio" data-tarea="${tr.id}" value="${esc(x.id)}"
          ${LOTE.desmarcados.has(`${tr.id}:${x.id}`) ? '' : 'checked'}><span>${filaCambio(x)}</span></label>`).join('')}
        ${tr.propuesta.dudas?.length ? `<p class="ayuda">${tr.propuesta.dudas.length === 1 ? t('La IA tiene una duda: ') : t('La IA tiene {n} dudas: ', {n: tr.propuesta.dudas.length})}<a href="#/ia/${tr.id}">${t('ábrela para contestar')}</a>${t(' (o para ver la vista previa).')}</p>` : ''}` : '';
    return `<section class="caja bloque-caja lote-tarea lote-${tr.estado}">
      <div class="lote-t"><a class="nombre" href="${c ? `#/c/${c.id}` : '#/'}">${esc(tr.objetivo_nombre || c?.nombre || '¿?')}</a>
        <span class="ams-etiqueta${clsEtq}">${esc(estado)}</span>${tr.estado === 'propuesta' ? `<a class="btn mini lote-abrir" href="#/ia/${tr.id}">${t('Abrir')}</a>` : ''}</div>${cuerpo}</section>`;
  };
  const quedan = ts.some((tr) => tr.estado === 'propuesta' || tr.estado === 'error');
  return `${cabIA(t('Correcciones de {piezas}', {piezas: piezasTxt(ts.length)}), listas < ts.length
      ? t('Pensando… {a} de {b} listas. Puedes ir mirando las que ya han llegado.', {a: listas, b: ts.length})
      : t('Marca lo que quieras aplicar. Lo que no marques se queda como está.'))}
    ${listas < ts.length ? `<div class="ia-progreso" role="progressbar" aria-label="${esc(t('La IA está pensando'))}"><span></span></div>` : ''}
    ${ts.map(tarea).join('')}
    ${quedan ? `<div class="acciones lote-acciones">
      <button class="btn prim" type="button" id="lote-aplicar">${t('Aplicar lo marcado')}</button>
      <button class="btn" type="button" data-lote-marcar="todo">${t('Marcar todo')}</button>
      <button class="btn" type="button" data-lote-marcar="nada">${t('Ninguno')}</button>
      <button class="btn peligro" type="button" id="lote-descartar">${t('Descartar lo que quede')}</button></div>` : `<p class="gris">${t('Ya no queda nada por revisar en este lote.')}</p>`}`;
}
function contarLote() {
  const g2 = $('#lote-guardar');
  if (g2) { const n = document.querySelectorAll('.lote-cambio:checked').length; g2.textContent = n ? t('Guardar {piezas}', {piezas: piezasTxt(n)}) : t('Marca alguna pieza'); g2.disabled = !n; return; }
  const b = $('#lote-aplicar');
  if (!b) return;
  const marcados = document.querySelectorAll('.lote-cambio:checked'), piezas = new Set([...marcados].map((x) => x.dataset.tarea)).size;
  b.textContent = marcados.length ? t('Aplicar {cambios} en {piezas}', {cambios: plural(marcados.length, 'cambio'), piezas: piezasTxt(piezas)}) : t('Marca algún cambio');
  b.disabled = !marcados.length;
}
async function iaLote(id) {
  const zona = $('#lote-zona');
  if (!zona || zona.dataset.lote !== id) return;
  if (LOTE.id !== id) { LOTE.id = id; LOTE.desmarcados = new Set(); }
  let ts;
  try { ts = await api('GET', `api/ia/lotes/${encodeURIComponent(id)}`); } catch (err) { zona.innerHTML = `<p class="mal pad">${esc(err.message)}</p>`; return; }
  if (!ts.length) { zona.innerHTML = `<p class="gris pad">${t('Ese lote no existe.')}</p>`; return; }
  zona.innerHTML = htmlLote(ts);
  contarLote();
  if (ts.some((tr) => tr.estado === 'pendiente')) { const h = location.hash; setTimeout(() => { if (location.hash === h) iaLote(id); }, 3000); }
}
async function aplicarLote(boton) {
  const porTarea = {};
  document.querySelectorAll('.lote-cambio:checked').forEach((x) => (porTarea[x.dataset.tarea] ||= []).push(x.value));
  const tareas = Object.keys(porTarea);
  if (!tareas.length) throw new Error(t('Marca algún cambio'));
  boton.disabled = true;
  boton.textContent = t('Aplicando…');
  let bien = 0, cambios = 0;
  const mal = [];
  for (const tr of tareas) { // una a una: si dos piezas comparten tipo, la segunda ve la ficha ya cambiada
    try { const r = await api('POST', `api/ia/tareas/${tr}/aplicar-cambios`, {ids: porTarea[tr]}); bien++; cambios += r.aplicados; }
    catch (err) { mal.push(err.message); }
  }
  await cargar(); contadores();
  await iaLote(LOTE.id);
  toast(t(cambios === 1 ? '{cambios} aplicado en {piezas}' : '{cambios} aplicados en {piezas}', {cambios: plural(cambios, 'cambio'), piezas: piezasTxt(bien)}) + (mal.length ? t('; {n} no (ábrelas: {msg})', {n: mal.length, msg: mal[0]}) : ''), mal.length > 0);
}
async function descartarLote() {
  const ts = await api('GET', `api/ia/lotes/${encodeURIComponent(LOTE.id)}`);
  const quedan = ts.filter((tr) => tr.estado === 'propuesta' || tr.estado === 'error');
  const altas = ts[0]?.clase === 'alta';
  if (!quedan.length || !(await confirmar(altas ? t('¿Descartar las {piezas} que quedan sin guardar?\nNo se añaden al inventario.', {piezas: piezasTxt(quedan.length)})
    : t('¿Descartar las {n} correcciones que quedan?\nNo se cambia nada de tus piezas ni de sus fichas.', {n: quedan.length}), {si: 'Descartar', peligro: true}))) return;
  for (const tr of quedan) await api('POST', `api/ia/tareas/${tr.id}/descartar`).catch(() => {});
  await iaLote(LOTE.id);
  toast(t('Descartadas'));
}


// ---------- búsqueda en todo (piezas, tipos y proyectos) ----------
function buscarTodo(query) {
  const piezas = D.componentes.filter((c) => matches(compText(c), query)).sort(byName);
  const tipos = Object.entries(D.tipos).map(([k, t]) => ({k, ...t})).filter((t) => !t.archivado && matches([t.k, t.nombre, t.resumen,
    CATS[t.categoria], ...list(t.alias), ...list(t.interfaz), ...list(t.pines).flat(), ...list(t.datos).flat()].join(' '), query)).sort(byName);
  const proyectos = D.proyectos.filter((p) => matches(textoProyecto(p), query));
  return {piezas, tipos, proyectos};
}
const filaTipo = (tp) => `<div class="fila"><a class="fila-main" href="#/g/${esc(tp.k)}"><span class="fila-img dibujo"${conColor(tp.categoria || 'otro')}><img src="img/tipos/${esc(tp.k)}.svg" alt="" loading="lazy" onerror="this.remove()"></span><div><div class="nombre">${esc(tp.nombre)}${tp.revisado === 0 ? ` <span class="etq-pend">${t('sin comprobar')}</span>` : ''}</div>
  <div class="sub">${esc(tp.resumen || '')}</div></div></a>
  <div class="der"><div class="${stock(tp.k) ? '' : 'gris'}">${stock(tp.k) ? t('Tienes {n}', {n: stockText(tp.k)}) : t('No tienes')}</div><div class="sub">${esc(voltajeDe(tp))}</div></div></div>`;

function vBuscar() {
  const query = q.value.trim();
  if (!query) return `<div class="vista-cab"><h1>${t('Buscar')}</h1></div><p class="gris">${t('Escribe arriba. Busca en las piezas (nombre, notas, sitio), en el glosario (nombre, alias, interfaces, pines y datos) y en los proyectos.')}</p>`;
  const r = buscarTodo(query), n = r.piezas.length + r.tipos.length + r.proyectos.length;
  const grupo = (titulo, items, html) => (items.length ? `<section class="grupo"><h3 class="grupo-t">${titulo}<span class="n">${items.length}</span></h3>${html}</section>` : '');
  return `<div class="vista-cab"><h1>${t('«{q}»', {q: esc(query)})} <small>${plural(n, 'resultado')}</small></h1></div>${n ? '' : vacio(t('Nada con «{q}».', {q: esc(query)}))}
    ${grupo(t('Piezas'), r.piezas, r.piezas.map(filaComp).join(''))}
    ${grupo(t('Tipos'), r.tipos, r.tipos.map(filaTipo).join(''))}
    ${grupo(t('Proyectos'), r.proyectos, listaProyectos(r.proyectos))}`;
}

// sección plegada (cerrada al abrir la ficha); no sale si no tiene nada
const plegable = (titulo, html, n = null) => (html ? `<details class="plegable"><summary>${titulo}${n != null ? `<span class="n">${n}</span>` : ''}</summary>
  <div class="plegable-cuerpo">${html}</div></details>` : '');
// menú «⋯»: acciones que se usan poco
const menuMas = (items) => `<details class="mas"><summary class="btn" aria-label="${esc(t('Más acciones'))}">⋯</summary>
  <div class="mas-menu" role="menu">${items.filter(Boolean).join('')}</div></details>`;

// ---------- fichas de pieza y de tipo: dos columnas (mockup del 23/11/2026) ----------
// izquierda: la imagen grande y lo de esta pieza (o tus piezas del tipo); derecha: nombre, acciones, avisos, pines y ficha del tipo.
// En el móvil todo va en una columna: imagen, nombre, acciones, avisos, esta pieza, pines y ficha del tipo.
const migas = (partes) => `<nav class="migas" aria-label="${esc(t('Estás en'))}">${partes.join('<span class="migas-sep" aria-hidden="true">/</span>')}</nav>`;
// cajetín de 2, 3 o 4 columnas: una celda que se queda sola en su fila se estira para no dejar huecos
function cajetin(celdas, cols = 2) {
  const cs = celdas.filter(Boolean).map(([k, v, ancho]) => ({k, v, ancho: !!ancho, span: 1}));
  let col = 0;
  cs.forEach((c, i) => {
    if (c.ancho) {
      if (col > 0) cs[i - 1].span = cols - col + 1;
      c.span = cols;
      col = 0;
    } else col = (col + 1) % cols;
  });
  if (col > 0 && cs.length) cs[cs.length - 1].span = cols - col + 1;
  return `<dl class="cajetin${cols !== 2 ? ` cajetin-${cols}` : ''}">${cs.map((c) =>
    `<div${c.ancho ? ' class="ancho"' : c.span > 1 ? ` style="grid-column:span ${c.span}"` : ''}><dt>${c.k}</dt><dd>${c.v}</dd></div>`).join('')}</dl>`;
}
const imagenGrande = ({foto = '', tipo = '', cat, pie}) => `<figure class="fi-img${foto ? ' con-foto' : ''}"${conColor(cat)}>
  ${foto ? `<a class="fi-img-marco" href="${foto}" target="_blank" aria-label="${esc(t('Ver la foto grande'))}"><img src="${foto}" alt=""></a>`
    : `<span class="fi-img-marco">${tipo ? `<img src="img/tipos/${esc(tipo)}.svg" alt="" onerror="this.remove()">` : ''}</span>`}
  <figcaption>${pie}</figcaption></figure>`;
const notaOjo = (f) => (f.ojo ? `<div class="ams-aviso aviso-ojo"><b>${ICO.aviso}${t('Ojo')}</b><p>${esc(f.ojo)}</p></div>` : '');
// disposición fija de la ficha (opción B): la «Ficha del tipo» va siempre en la columna izquierda (bajo la foto y
// «Esta pieza»); los pines ocupan siempre todo el ancho de la derecha y «Proyectos que la usan» va en su propia caja
// debajo. En el móvil: foto, cabecera, acciones, avisos, esta pieza, pines, ficha del tipo y proyectos.
function fichaDelTipo(f, tipo, ps, pie = '') {
  const pines = tablaPines(f), nPines = list(f.pines).length;
  const celdas = [[t('Tensión'), esc(voltajeDe(f)) || '—'], [t('Pines'), nPines || '—'],
    list(f.interfaz).length ? [t('Interfaces'), esc(list(f.interfaz).join(', ')), true] : null,
    ...list(f.datos).map(([k, v]) => [esc(k), esc(v)]),
    list(f.alias).length ? [t('Otros nombres'), esc(list(f.alias).join(', ')), true] : null,
    [t('Estado'), f.revisado === 0 ? `<span class="etq-pend">${t('Sin comprobar')}</span>` : t('Comprobada ✓')]];
  const secPines = pines ? `<section class="fi-pines"><h2 class="rotulo">${t('Pines')}</h2><div class="caja">${pines}</div></section>` : '';
  const secPro = ps.length ? `<section class="fi-proyectos-sec"><h2 class="rotulo">${t('Proyectos que la usan')}</h2><div class="caja fi-proyectos">${listaProyectos(ps)}</div></section>` : '';
  const secTipo = `<section class="fi-tipo"><h2 class="rotulo">${t('Ficha del tipo')}</h2><div class="caja fi-tipo-caja">${cajetin(celdas)}
      ${pie ? `<p class="meta">${pie}</p>` : ''}</div></section>`;
  return {der: `${secPines}${secPro}`, izq: secTipo};
}

function vComponente(id) {
  const c = comp(id);
  if (!c) return vacio(t('No existe esa pieza.'));
  const f = g(c.tipo), conTipo = !!(c.tipo && D.tipos[c.tipo]), cat = catOf(c), ia = D.ia?.activa;
  const delTipo = conTipo ? D.componentes.filter((x) => x.tipo === c.tipo).length : 0;
  const ps = conTipo ? proyectosDe(c.tipo) : [];
  const ft = conTipo ? fichaDelTipo(f, c.tipo, ps, `${delTipo > 1 ? t('La comparten tus {n} piezas de este tipo', {n: delTipo}) : t('Común a todas las piezas de este tipo')} ·
    <a href="#/g/${esc(c.tipo)}/editar">${t('Editar la ficha del tipo')}</a>`) : {der: '', izq: ''};
  const datos = list(c.datos).length ? c.datos.map(([k, v]) => [esc(k), esc(v)]) : [[t('Datos propios'), '—']];
  const esta = `<section class="caja fi-esta"><div class="fi-esta-cab"><h2 class="rotulo">${t('Esta pieza')}</h2>
      ${c.revisar ? `<button class="btn mini" id="quitar-pendiente" type="button">${t('Hecho: quitar «pendiente»')}</button>`
        : `<button class="btn mini" id="marcar-pendiente" type="button">${t('Marcar pendiente')}</button>`}</div>
    ${c.revisar ? `<p class="fi-pend">${t('La marcaste para mirar algo de ella más tarde.')}</p>` : ''}
    ${cajetin([[t('Cantidad'), stepper(c, true)], [t('Sitio'), esc(c.ubicacion || t('Sin sitio'))],
      [t('Tipo'), conTipo ? `<a href="#/g/${esc(c.tipo)}">${esc(f.nombre)}</a>${f.archivado ? t(' (archivado)') : ''}` : t('Sin tipo'), true],
      [t('Categoría'), etqCat(cat)], ...datos])}
    ${c.notas ? `<div class="fi-notas"><h3 class="rotulo">${t('Notas')}</h3><p class="notas">${esc(c.notas)}</p></div>` : ''}</section>`;
  return `${migas([`<a href="#/" data-cat="">${t('Inventario')}</a>`, `<a href="#/" data-cat="${esc(cat)}">${esc(CATS[cat] || t('Otros'))}</a>`, `<span>${esc(c.nombre)}</span>`])}
    <article class="fi">
      <div class="fi-izq">
        ${imagenGrande({foto: c.foto ? fotoUrl(c) : '', tipo: conTipo ? c.tipo : '', cat,
          pie: `<span>${c.foto ? t('Foto de la pieza') : conTipo ? t('Dibujo del tipo · aún sin foto') : t('Aún sin foto')}</span>
            <label class="btn mini">${ICO.camara}${c.foto ? t('Cambiar foto') : t('Añadir foto')}<input type="file" accept="image/*" id="foto2" hidden></label>`})}
        ${esta}
        ${ft.izq}
      </div>
      <div class="fi-der">
        <header class="fi-cab">${etqCat(cat, 'etq-cat')}<h1>${esc(c.nombre)}${c.revisar ? ` <span class="etq-pend">${t('pendiente')}</span>` : ''}</h1>
          ${conTipo && f.resumen ? `<p class="fi-resumen">${esc(f.resumen)}</p>` : ''}</header>
        <div class="fi-acciones">
          <a class="btn${ia ? '' : ' prim'}" href="#/editar/${c.id}">${ICO.lapiz}${t('Editar')}</a>
          <label class="btn">${ICO.camara}${t('Foto')}<input type="file" accept="image/*" id="foto" hidden></label>
          ${ia ? `<button class="btn prim" type="button" id="ia-abrir" aria-expanded="false">${ICO.chispa}${t('Corregir con IA')}</button>` : ''}
          ${menuMas([
            conTipo ? `<a role="menuitem" href="#/g/${esc(c.tipo)}/editar">${t('Editar la ficha del tipo')}</a>` : '',
            c.foto ? `<button role="menuitem" type="button" id="quitar-foto">${t('Quitar la foto')}</button>` : '',
            `<button role="menuitem" type="button" class="peligro" id="borrar">${t('Borrar esta pieza')}</button>`])}
        </div>
        ${panelRevisar('pieza', c.id, c.tipo ? t('La IA repasa esta pieza y la ficha de su tipo.') : t('La IA repasa esta pieza.'))}
        ${conTipo ? notaOjo(f) : ''}
        ${conTipo && f.revisado === 0 ? avisoIA(c.tipo, true) : ''}
        ${conTipo ? ft.der
          : `<p class="gris">${t('Esta pieza no tiene tipo. Ponle uno en «Editar» y verás aquí sus pines, su tensión y sus datos.')}</p>`}
        <div class="plegables">${plegableHist('pieza', c.id, conTipo ? c.tipo : '')}</div>
        <p class="meta">${t('Actualizado {fecha}', {fecha: esc(c.actualizado)})}</p>
      </div>
    </article>`;
}

function vTipo(tipo) {
  const f = D.tipos[tipo];
  if (!f) return vacio(t('Ese tipo no está en el glosario.'));
  const cs = D.componentes.filter((c) => c.tipo === tipo).sort(byName);
  const ps = proyectosDe(tipo), cat = f.categoria || 'otro';
  const orig = {seed: 'del catálogo base', ia: 'de la IA', usuario: 'escrita por ti'}[f.origen];
  const ft = fichaDelTipo(f, tipo, ps, orig ? t('Ficha {origen}', {origen: t(orig)}) : '');
  const tuyas = `<section class="caja fi-esta"><div class="fi-esta-cab"><h2 class="rotulo">${t('Tus piezas de este tipo')}</h2>
      <a class="btn mini" href="#/nuevo?tipo=${esc(tipo)}">${ICO.mas}${t('Añadir')}</a></div>
    ${cs.length ? `<div class="lista-piezas">${cs.map(filaComp).join('')}</div>` : `<p class="gris">${t('No tienes ninguna todavía.')}</p>`}</section>`;
  return `${migas([`<a href="#/glosario">${t('Glosario')}</a>`, `<span>${esc(CATS[cat] || t('Otros'))}</span>`, `<span>${esc(f.nombre)}</span>`])}
    <article class="fi">
      <div class="fi-izq">
        ${imagenGrande({tipo, cat, pie: `<span>${t('Dibujo del tipo')}${stock(tipo) ? t(' · tienes {n}', {n: stockText(tipo)}) : ''}</span>`})}
        ${tuyas}
        ${ft.izq}
      </div>
      <div class="fi-der">
        <header class="fi-cab">${etqCat(cat, 'etq-cat')}<h1>${esc(f.nombre)}</h1>${f.resumen ? `<p class="fi-resumen">${esc(f.resumen)}</p>` : ''}</header>
        <div class="fi-acciones">
          <a class="btn prim" href="#/g/${esc(tipo)}/editar">${ICO.lapiz}${t('Editar ficha')}</a>
          <a class="btn" href="#/nuevo?tipo=${esc(tipo)}">${ICO.mas}${t('Añadir pieza')}</a>
          ${D.ia?.activa ? `<button class="btn" type="button" id="ia-abrir" aria-expanded="false">${ICO.chispa}${t('Corregir con IA')}</button>` : ''}
          ${menuMas([
            `<button role="menuitem" type="button" data-tipo-archivar="${esc(tipo)}" data-v="${f.archivado ? 0 : 1}">${f.archivado ? t('Recuperar del archivo') : t('Archivar (ocultar)')}</button>`,
            `<a role="menuitem" href="#/ajustes/tipos?t=${esc(tipo)}">${t('Fusionar o borrar…')}</a>`])}
        </div>
        ${panelRevisar('tipo', tipo, t('La IA repasa la ficha; los cambios valen para todas las piezas de este tipo.'))}
        ${f.archivado ? `<p class="nota">${t('Archivado: no sale en el glosario ni al elegir tipo.')} <button class="btn mini" data-tipo-archivar="${esc(tipo)}" data-v="0">${t('Recuperar')}</button></p>` : ''}
        ${notaOjo(f)}
        ${f.revisado === 0 ? avisoIA(tipo, true) : ''}
        ${ft.der}
        <div class="plegables">${plegableHist('tipo', tipo)}</div>
      </div>
    </article>`;
}

// ---------- selector de tipo con búsqueda (fase D) ----------
// un campo de texto que filtra los tipos por nombre, alias, interfaz o categoría; el id va en un campo oculto (name="tipo")
const nombreSel = (sel, nuevo) => (sel === '__nuevo' ? nuevo : sel ? g(sel).nombre : '');
function selectorTipo(sel, nuevo = t('Nuevo tipo…')) {
  return `<div class="combo" data-nuevo="${esc(nuevo)}">
    <input type="hidden" name="tipo" id="tipo" value="${esc(sel || '')}">
    <input class="combo-q" type="text" value="${esc(nombreSel(sel, nuevo))}" placeholder="${esc(t('Sin tipo · escribe para buscar (ESP32, relé, I2C…)'))}"
      autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="tipo-lista" aria-label="${esc(t('Tipo'))}">
    <div class="combo-lista" id="tipo-lista" role="listbox" hidden></div></div>`;
}
function opcionesCombo(combo) {
  const query = combo.querySelector('.combo-q').value.trim(), sel = combo.querySelector('#tipo').value;
  // si el texto es justo el nombre elegido, enseña todo (se acaba de abrir)
  const filtro = query && query !== nombreSel(sel, combo.dataset.nuevo) ? query : '';
  const ts = Object.entries(D.tipos).filter(([k, tp]) => (!tp.archivado || k === sel)
    && (!filtro || matches([k, tp.nombre, CATS[tp.categoria], ...list(tp.alias), ...list(tp.interfaz)].join(' '), filtro)));
  const orden = Object.keys(CATS);
  ts.sort((a, b) => orden.indexOf(a[1].categoria) - orden.indexOf(b[1].categoria) || a[1].nombre.localeCompare(b[1].nombre, I18N.lang()));
  const op = (valor, texto, sub = '') => `<button type="button" class="combo-op${valor === sel ? ' on' : ''}" role="option" data-valor="${esc(valor)}"
    aria-selected="${valor === sel}"><span>${esc(texto)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</button>`;
  combo.querySelector('.combo-lista').innerHTML = (filtro ? '' : op('', t('Sin tipo')))
    + ts.slice(0, 60).map(([k, tp]) => op(k, tp.nombre, CATS[tp.categoria] || '')).join('')
    + (ts.length > 60 ? `<p class="combo-mas">${t('{n} más: escribe para afinar', {n: ts.length - 60})}</p>` : '')
    + (!ts.length ? `<p class="combo-mas">${t('Ningún tipo con «{q}»', {q: esc(filtro)})}</p>` : '')
    + op('__nuevo', combo.dataset.nuevo, t('crear una ficha nueva'));
}
function abrirCombo(combo) {
  opcionesCombo(combo);
  combo.querySelector('.combo-lista').hidden = false;
  combo.querySelector('.combo-q').setAttribute('aria-expanded', 'true');
}
function cerrarCombo(combo) {
  const lista = combo.querySelector('.combo-lista');
  lista.hidden = true;
  combo.querySelector('.combo-q').setAttribute('aria-expanded', 'false');
  combo.querySelector('.combo-q').value = nombreSel(combo.querySelector('#tipo').value, combo.dataset.nuevo); // sin elegir: vuelve lo que había
}
function elegirTipo(combo, valor) {
  combo.querySelector('#tipo').value = valor;
  cerrarCombo(combo);
  const nt = $('#nuevo-tipo');
  if (nt) nt.hidden = valor !== '__nuevo';
}

// ---------- tablas editables: pines y datos (fase D) ----------
// cada fila: sus campos y botones para subir, bajar y quitar. Se leen con leerEditor(form, nombre).
const COLS = {
  pines: [{k: 'pin', t: 'Pin', clase: 'mono', max: 60, ph: 'GPIO4'}, {k: 'uso', t: 'Uso', max: 60, ph: 'Datos del sensor'}, {k: 'fn', t: 'Función', funcion: true},
    {k: 'nota', t: 'Nota', max: 200, ph: 'también… / solo entrada'}],
  datos: [{k: 'clave', t: 'Dato', max: 60, ph: 'Corriente máx.'}, {k: 'valor', t: 'Valor', max: 200, ph: '20 mA'}],
  material: [{k: 'tipo', t: 'Pieza', tipos: 'Elige el tipo…'}, {k: 'alt', t: 'O bien', tipos: 'o bien… (nada)'}, {k: 'cantidad', t: 'Cant.', num: true},
    {k: 'nota', t: 'Nota', max: 200, ph: 'nota'}, {k: 'opcional', t: 'Opcional', check: true}],
  conexiones: [{k: 'desde', t: 'Desde', clase: 'mono', max: 80, ph: 'PIR OUT'}, {k: 'hasta', t: 'Hasta', clase: 'mono', max: 80, ph: 'GPIO27'}, {k: 'nota', t: 'Nota', max: 200, ph: 'nota'}],
  pasos: [{k: 'texto', t: 'Paso', area: true, max: 600, ph: 'Qué hay que hacer'}],
};
const colorFn = (id) => { const x = FUNC[id] || {color_claro: '#888888', color_oscuro: '#888888'}; return `--cc:${esc(x.color_claro)};--co:${esc(x.color_oscuro)}`; };
// asa para arrastrar la fila (seis puntos, dibujados: nada de emojis)
const ASA = '<svg viewBox="0 0 10 16" aria-hidden="true"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></svg>';
function filaEditor(nombre, valores = []) {
  return `<div class="ed-fila"><button type="button" class="ed-asa" aria-label="${esc(t('Mover la fila: arrástrala, o usa las flechas arriba y abajo'))}">${ASA}</button>${COLS[nombre].map((c, i) => c.funcion
    ? `<label class="ed-celda ed-fn" style="${colorFn(valores[i] || 'otro')}"><span class="ed-et">${t(c.t)}</span><i class="dot"></i>
        <select data-col="${i}">${Object.entries(FUNC).map(([k, f]) => `<option value="${esc(k)}" ${k === (valores[i] || 'otro') ? 'selected' : ''}>${esc(f.nombre)}</option>`).join('')}</select></label>`
    : c.tipos ? `<label class="ed-celda"><span class="ed-et">${t(c.t)}</span><select data-col="${i}" aria-label="${esc(t(c.t))}">${opcionesTiposLista(valores[i] || '').replace(t('Sin tipo'), t(c.tipos))}</select></label>`
    : c.num ? `<label class="ed-celda"><span class="ed-et">${t(c.t)}</span><input data-col="${i}" type="number" min="1" max="9999" inputmode="numeric" aria-label="${esc(t(c.t))}" value="${esc(valores[i] || 1)}"></label>`
    : c.check ? `<label class="ed-celda ed-check"><input data-col="${i}" type="checkbox" ${valores[i] ? 'checked' : ''}><span>${t(c.t)}</span></label>`
    : c.area ? `<label class="ed-celda"><span class="ed-et">${t(c.t)}</span><textarea data-col="${i}" rows="2" maxlength="${c.max}" placeholder="${esc(t(c.ph))}">${esc(valores[i] || '')}</textarea></label>`
    : `<label class="ed-celda"><span class="ed-et">${t(c.t)}</span><input data-col="${i}" class="${c.clase || ''}" maxlength="${c.max}" value="${esc(valores[i] || '')}" placeholder="${esc(t(c.ph))}"></label>`).join('')}
    <button type="button" class="btn mini peligro ed-quitar" data-ed-quitar aria-label="${esc(t('Quitar fila'))}">✕</button></div>`;
}
function editorFilas(nombre, filas, {etiqueta, boton, ayuda = '', campo = nombre} = {}) {
  return `<fieldset class="ed ed-${nombre}" data-ed="${campo}" data-cols="${nombre}">
    <legend>${etiqueta}</legend>${ayuda ? `<p class="ayuda">${ayuda}</p>` : ''}
    <div class="ed-cab" aria-hidden="true"><span></span>${COLS[nombre].map((c) => `<span>${t(c.t)}</span>`).join('')}<span></span></div>
    <div class="ed-filas">${list(filas).map((f) => filaEditor(nombre, f)).join('')}</div>
    <button type="button" class="btn mini" data-ed-anadir>${boton}</button></fieldset>`;
}
const leerEditor = (raiz, campo) => [...(raiz.querySelector(`[data-ed="${campo}"]`)?.querySelectorAll('.ed-fila') || [])]
  .map((f) => [...f.querySelectorAll('[data-col]')].map((x) => (x.type === 'checkbox' ? (x.checked ? '1' : '') : x.value.trim()))).filter((v) => v[0]);
// un pin por fila: si en el nombre hay varios («GPIO 16 · 17», «GPIO 32–39», «SDA, SCL»), el servidor devuelve la tabla
// con una fila por pin (misma regla que al guardar y que para la IA) y se repinta
const VARIOS_PINES = /[·,;]|\sy\s|\d\s*[–-]\s*\D*\d+$|^[a-zA-Z]\s*[–-]\s*[a-zA-Z]$/;
async function separarEnEditor(input) {
  const ed = input.closest('.ed-pines');
  if (!ed || !VARIOS_PINES.test(input.value.trim())) return;
  const filas = [...ed.querySelectorAll('.ed-fila')].map((f) => [...f.querySelectorAll('[data-col]')].map((x) => x.value.trim())).filter((v) => v[0]);
  try {
    const r = await api('POST', 'api/pines/separar', {pines: filas});
    if (r.pines.length === filas.length && r.pines.every((p, i) => p[0] === filas[i][0])) return; // era un solo pin
    ed.querySelector('.ed-filas').innerHTML = r.pines.map((p) => filaEditor('pines', p)).join('');
    toast(r.pines.length > filas.length ? t('Separado: ahora hay {pines}, uno por fila', {pines: plural(r.pines.length, 'pin')}) : t('Pines repetidos juntados: mira sus notas'));
  } catch (err) { toast(err.message, true); }
}
function clicEditor(t) {
  const ed = t.closest('.ed');
  if (!ed) return false;
  const fila = t.closest('.ed-fila');
  if ('edAnadir' in t.dataset) {
    ed.querySelector('.ed-filas').insertAdjacentHTML('beforeend', filaEditor(ed.dataset.cols));
    ed.querySelector('.ed-fila:last-child :is(input, select, textarea)')?.focus();
  } else if ('edQuitar' in t.dataset) fila.remove();
  else return false;
  return true;
}

// arrastrar filas por el asa (dedo o ratón): la fila sigue al dedo y cambia de sitio al pasar la mitad de la vecina;
// cerca del borde de la pantalla, la página se desplaza sola. Con el teclado, flechas arriba y abajo sobre el asa.
let arrastre = null;
// cambia la fila de sitio con su vecina. Se mueve la VECINA, no la fila: si se sacara del documento la que se está
// arrastrando, el navegador perdería el seguimiento del dedo y la fila se quedaría «enganchada»
function moverFila(fila, dir) {
  const otra = dir < 0 ? fila.previousElementSibling : fila.nextElementSibling;
  if (!otra) return 0;
  const salto = otra.getBoundingClientRect().height + (parseFloat(getComputedStyle(fila.parentElement).rowGap) || 0);
  if (dir < 0) fila.after(otra); else fila.before(otra);
  return dir * salto;
}
function seguirArrastre() {
  const a = arrastre;
  if (!a) return;
  let dy = a.y + scrollY - a.y0;
  // cambia de sitio con la vecina en cuanto la fila pasa su mitad (con tope: nunca un bucle sin fin)
  for (let vueltas = 0; vueltas < 100; vueltas++) {
    const prev = a.fila.previousElementSibling, next = a.fila.nextElementSibling;
    const hp = prev?.getBoundingClientRect().height || 0, hn = next?.getBoundingClientRect().height || 0;
    let salto = 0;
    if (prev && hp > 0 && dy < -hp / 2) salto = moverFila(a.fila, -1);
    else if (next && hn > 0 && dy > hn / 2) salto = moverFila(a.fila, 1);
    if (!salto) break;
    a.y0 += salto;
    dy = a.y + scrollY - a.y0;
  }
  a.fila.style.transform = `translateY(${dy}px)`;
}
// mientras se arrastra se escucha en toda la ventana (el dedo puede salirse de la app); al soltar, cancelar,
// perder el seguimiento o cambiar de pestaña, la fila se suelta siempre
function soltarFila() {
  const a = arrastre;
  if (!a) return;
  arrastre = null;
  cancelAnimationFrame(a.raf);
  removeEventListener('pointermove', moverArrastre);
  removeEventListener('pointerup', alSoltar);
  removeEventListener('pointercancel', alSoltar);
  removeEventListener('blur', soltarFila);
  a.asa.removeEventListener('lostpointercapture', soltarFila);
  try { a.asa.releasePointerCapture(a.id); } catch {}
  a.fila.style.transform = '';
  a.fila.classList.remove('arrastrando');
  document.body.classList.remove('arrastrando-fila');
}
function moverArrastre(e) {
  if (!arrastre || e.pointerId !== arrastre.id) return;
  e.preventDefault();
  arrastre.y = e.clientY;
  seguirArrastre();
}
function alSoltar(e) { if (arrastre && e.pointerId === arrastre.id) soltarFila(); }
app.addEventListener('pointerdown', (e) => {
  const asa = e.target.closest('.ed-asa');
  if (!asa || e.button > 0) return;
  e.preventDefault();
  soltarFila(); // por si quedaba otro a medias
  const fila = asa.closest('.ed-fila');
  arrastre = {fila, asa, id: e.pointerId, y: e.clientY, y0: e.clientY + scrollY};
  try { asa.setPointerCapture(e.pointerId); } catch {}
  addEventListener('pointermove', moverArrastre, {passive: false});
  addEventListener('pointerup', alSoltar);
  addEventListener('pointercancel', alSoltar);
  addEventListener('blur', soltarFila);
  asa.addEventListener('lostpointercapture', soltarFila);
  fila.classList.add('arrastrando');
  document.body.classList.add('arrastrando-fila');
  // desplazamiento automático cerca de los bordes (la barra de abajo del móvil cuenta como borde)
  const bajo = document.querySelector('#barra')?.getBoundingClientRect().height || 0;
  const paso = () => {
    if (!arrastre) return;
    const v = arrastre.y < 90 ? -Math.ceil((90 - arrastre.y) / 6) : arrastre.y > innerHeight - bajo - 90 ? Math.ceil((arrastre.y - innerHeight + bajo + 90) / 6) : 0;
    if (v) { scrollBy(0, v); seguirArrastre(); }
    arrastre.raf = requestAnimationFrame(paso);
  };
  arrastre.raf = requestAnimationFrame(paso);
});
document.addEventListener('visibilitychange', soltarFila);
app.addEventListener('keydown', (e) => {
  if (!e.target.classList?.contains('ed-asa') || !/^Arrow(Up|Down)$/.test(e.key)) return;
  e.preventDefault();
  moverFila(e.target.closest('.ed-fila'), e.key === 'ArrowUp' ? -1 : 1);
  e.target.focus();
});

function vForm(id, tipoInicial = '') {
  const c = id ? comp(id) : {nombre: '', tipo: D.tipos[tipoInicial] ? tipoInicial : '', cantidad: 1, varios: 0, ubicacion: '', notas: '', revisar: 0, datos: []};
  if (!c) return vacio(t('No existe esa pieza.'));
  return `${migas(id ? [`<a href="#/">${t('Inventario')}</a>`, `<a href="#/c/${id}">${esc(c.nombre)}</a>`, `<span>${t('Editar')}</span>`] : [`<a href="#/">${t('Inventario')}</a>`, `<span>${t('Nueva pieza')}</span>`])}
    <div class="plano">
      ${cabIA(id ? t('Editar pieza') : t('Nueva pieza'), '', !id ? `<p class="ia-atajo"><a class="btn mini" href="#/ia">${ICO.chispa}${t('O que la IA la rellene a partir de una foto →')}</a></p>` : '')}
      <form id="form" class="form caja" autocomplete="off">
        <label>${t('Nombre')}<input name="nombre" required maxlength="200" value="${esc(c.nombre)}" placeholder="ESP32-WROOM-32 DevKit"></label>
        <div class="campo"><span class="campo-t">${t('Tipo')}</span>${selectorTipo(c.tipo)}</div>
        <div id="nuevo-tipo" class="nuevo-tipo" hidden>
          <label>${t('Nombre del tipo')}<input name="tipoNombre" maxlength="120" placeholder="${esc(t('Relé de 5 V'))}"></label>
          <label>${t('Categoría')}<select name="tipoCat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        </div>
        <div class="dos">
          <label>${t('Cantidad')}<input name="cantidad" type="number" min="0" inputmode="numeric" value="${c.varios ? '' : esc(c.cantidad ?? '')}" ${c.varios ? 'disabled' : ''}></label>
          <label class="check"><input type="checkbox" name="varios" ${c.varios ? 'checked' : ''}> ${t('Hay muchos (sin contar)')}</label>
        </div>
        <label>${t('Sitio')}<input name="ubicacion" list="ubics" maxlength="120" value="${esc(c.ubicacion)}" placeholder="${esc(t('Cajita 3'))}"></label>
        <datalist id="ubics">${ubicaciones().map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
        <label>${t('Notas')}<textarea name="notas" rows="3" maxlength="2000">${esc(c.notas)}</textarea></label>
        ${editorFilas('datos', c.datos, {campo: 'datos_pieza', etiqueta: t('Datos de esta pieza'), boton: t('Añadir dato'),
          ayuda: t('Lo que cambia de una pieza a otra del mismo tipo: «Valor» → «220 Ω», «Color» → «rojo».')})}
        ${id ? '' : campoFoto(t('Foto (opcional)'))}
        <label class="check"><input type="checkbox" name="revisar" ${c.revisar ? 'checked' : ''}> ${t('Pendiente: quiero mirar algo de esta pieza más tarde')}</label>
        <div class="acciones">
          <button class="btn prim" type="submit">${t('Guardar')}</button>
          ${id ? `<button class="btn peligro" type="button" id="borrar">${t('Borrar pieza')}</button>` : ''}
        </div>
      </form>
    </div>`;
}

async function guardarForm(form, id) {
  const fd = new FormData(form);
  let tipo = fd.get('tipo');
  if (tipo === '__nuevo') {
    const tp = await api('POST', 'api/tipos', {nombre: fd.get('tipoNombre'), categoria: fd.get('tipoCat')});
    D.tipos[tp.id] = {nombre: tp.nombre, categoria: tp.categoria, pines: []};
    tipo = tp.id;
  }
  const varios = !!fd.get('varios');
  const body = {nombre: fd.get('nombre'), tipo: tipo || null, varios, cantidad: varios ? null : fd.get('cantidad'),
    ubicacion: fd.get('ubicacion'), notas: fd.get('notas'), revisar: !!fd.get('revisar'), datos: leerEditor(form, 'datos_pieza')};
  const c = id ? await api('PATCH', `api/componentes/${id}`, body) : await api('POST', 'api/componentes', body);
  guardarLocal(c);
  const foto = fd.get('foto');
  if (!(foto && foto.size && await subirFoto(c.id, foto))) toast(t('Guardado'));
  location.hash = `#/c/${c.id}`;
}

function vGlosario() {
  const query = q.value.trim();
  const activos = Object.entries(D.tipos).map(([k, f]) => ({k, ...f})).filter((tp) => !tp.archivado);
  let tipos = activos;
  if (query) tipos = tipos.filter((tp) => matches([tp.k, tp.nombre, tp.resumen, ...list(tp.alias), list(tp.interfaz).join(' ')].join(' '), query));
  // filtro «Sin comprobar»: las fichas que escribió la IA y nadie ha revisado (solo aparece si hay alguna)
  const sinComprobar = activos.filter((tp) => tp.revisado === 0).length;
  if (!sinComprobar) ui.sinComprobar = false;
  if (ui.sinComprobar) tipos = tipos.filter((tp) => tp.revisado === 0);
  const cab = `<div class="vista-cab"><h1>${t('Glosario')} <small>${plural(activos.length, 'tipo')}</small></h1></div>`;
  const filtros = sinComprobar ? `<div class="filtros"><div class="cats">
    <button class="f ${ui.sinComprobar ? '' : 'on'}" data-glo="todo">${t('Todo')}<span class="n">${activos.length}</span></button>
    <button class="f ${ui.sinComprobar ? 'on' : ''}" data-glo="sin">${t('Sin comprobar')}<span class="n">${sinComprobar}</span></button></div></div>` : '';
  if (!tipos.length) return cab + filtros + tambien(query, 'tipos') + vacio(t('Nada coincide.'));
  return cab + filtros + tambien(query, 'tipos') + Object.keys(CATS).map((cat) => {
    const ts = tipos.filter((tp) => (tp.categoria || 'otro') === cat).sort(byName);
    return ts.length ? `<section class="grupo"${conColor(cat)}><h3 class="grupo-t">${marcaCat}${CATS[cat]}<span class="n">${ts.length}</span></h3>${ts.map(filaTipo).join('')}</section>` : '';
  }).join('');
}

// ---------- editar la ficha de un tipo a mano (fase D) ----------
// la ficha se pide al servidor con su «huella»: si alguien la cambia mientras editas, al guardar no se pisa (409)
function vEditarTipo(tipo) {
  if (!D.tipos[tipo]) return vacio(t('Ese tipo no está en el glosario.'));
  return `${migas([`<a href="#/glosario">${t('Glosario')}</a>`, `<a href="#/g/${esc(tipo)}">${esc(D.tipos[tipo].nombre)}</a>`, `<span>${t('Editar ficha')}</span>`])}
    <div class="plano" id="ed-tipo" data-tipo="${esc(tipo)}"><p class="gris">${t('Cargando…')}</p></div>`;
}
async function editarTipoCargar() {
  const zona = $('#ed-tipo');
  if (!zona) return;
  let f;
  try { f = await api('GET', `api/tipos/${encodeURIComponent(zona.dataset.tipo)}/ficha`); } catch (err) { zona.innerHTML = `<p class="mal">${esc(err.message)}</p>`; return; }
  const piezas = D.componentes.filter((c) => c.tipo === f.id).length;
  zona.innerHTML = `${cabIA(t('Editar ficha · {nombre}', {nombre: esc(f.nombre)}), piezas > 1 ? t('La usan {n} piezas: los cambios se verán en todas.', {n: piezas}) : '')}
    ${f.origen === 'seed' ? `<p class="nota">${t('Es del catálogo base. Al guardar pasa a ser tuya: las actualizaciones del catálogo ya no la cambiarán.')}</p>` : ''}
    ${f.revisado === 0 ? `<p class="nota nota-ia">${t('La escribió la IA. Al guardar queda como comprobada por ti.')}</p>` : ''}
    <form id="form-ficha" class="form ancho caja" autocomplete="off" data-huella="${esc(f.huella)}" data-tipo="${esc(f.id)}">
      <div class="dos">
        <label>${t('Nombre')}<input name="nombre" required maxlength="120" value="${esc(f.nombre)}"></label>
        <label>${t('Categoría')}<select name="categoria">${Object.entries(CATS).map(([k, v]) => `<option value="${esc(k)}" ${k === f.categoria ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      </div>
      <label>${t('Resumen')}<textarea name="resumen" rows="2" maxlength="400">${esc(f.resumen)}</textarea></label>
      <div class="dos">
        <label>${t('Tensión')}<input name="voltaje" maxlength="120" value="${esc(f.voltaje)}" placeholder="${esc(t('3,3 V · 5 V tolerante'))}"></label>
        <label>${t('Interfaces')}<input name="interfaz" value="${esc(list(f.interfaz).join(', '))}" placeholder="I2C, UART"><span class="ayuda">${t('Separadas por comas')}</span></label>
      </div>
      <label>${t('Otros nombres')}<input name="alias" value="${esc(list(f.alias).join(', '))}" placeholder="${esc(t('DHT-11, sensor de humedad'))}"><span class="ayuda">${t('Separados por comas: sirven para buscar')}</span></label>
      <label>${t('Ojo (advertencia)')}<textarea name="ojo" rows="2" maxlength="400" placeholder="${esc(t('No conectar a 5 V sin divisor'))}">${esc(f.ojo)}</textarea></label>
      ${editorFilas('pines', f.pines, {etiqueta: t('Pines'), boton: t('Añadir pin'), ayuda: t('Un pin por fila, en el orden de la placa. La función da el color del pin en todas las fichas; en la nota, lo que haya que saber de ese pin («También: UART2 RX», «Solo entrada»). Si escribes varios en una fila («GPIO 16 · 17», «GPIO 32–39»), se separan solos.')})}
      ${editorFilas('datos', f.datos, {etiqueta: t('Datos'), boton: t('Añadir dato'), ayuda: t('Iguales para todas las piezas de este tipo: «Corriente máx.» → «20 mA».')})}
      <div class="acciones">
        <button class="btn prim" type="submit">${t('Guardar ficha')}</button>
        <a class="btn" href="#/g/${esc(f.id)}">${t('Cancelar')}</a>
      </div>
    </form>`;
}
async function guardarFicha(form) {
  const fd = new FormData(form), tipo = form.dataset.tipo;
  await api('PUT', `api/tipos/${encodeURIComponent(tipo)}/ficha`, {
    huella: form.dataset.huella, nombre: fd.get('nombre'), categoria: fd.get('categoria'), resumen: fd.get('resumen'), voltaje: fd.get('voltaje'),
    interfaz: comas(fd.get('interfaz')), alias: comas(fd.get('alias')), ojo: fd.get('ojo'), pines: leerEditor(form, 'pines'), datos: leerEditor(form, 'datos'),
  });
  await cargar();
  contadores();
  location.hash = `#/g/${encodeURIComponent(tipo)}`;
  toast(t('Ficha guardada'));
}

// ---------- proyectos (v8): listado por estado con miniaturas, ficha con pestañas (tablero, bitácora, archivos) ----------
const ESTADOS_PRO = {en_marcha: 'En marcha', pausa: 'En pausa', idea: 'Ideas', terminado: 'Terminados'}; // en el orden del listado
const ESTADO_PRO = {idea: 'Idea', en_marcha: 'En marcha', pausa: 'En pausa', terminado: 'Terminado'};
const COLUMNAS = {hacer: 'Por hacer', curso: 'En curso', hecho: 'Hecho'};
const proyecto = (id) => D.proyectos.find((p) => p.id === id);
const proActual = () => decodeURIComponent(location.hash.split('?')[0].split('/')[2] || '');
const nTareas = (p) => (p.tareas ? p.tareas.hacer + p.tareas.curso + p.tareas.hecho : 0);
const textoProyecto = (p) => [p.nombre, p.resumen, ...(p.material || []).flatMap((m) => list(m.tipo).map((tp) => g(tp).nombre))].join(' ');
function guardarProLocal(p) {
  const i = D.proyectos.findIndex((x) => x.id === p.id);
  if (i >= 0) D.proyectos[i] = p; else D.proyectos.push(p);
  D.proyectos.sort(byName);
  contadores();
}
// tus piezas que valen para un hueco del material (primero las que tienen foto)
const piezasDe = (m) => D.componentes.filter((c) => list(m.tipo).includes(c.tipo)).sort((a, b) => !!b.foto - !!a.foto || byName(a, b));
// miniatura de un hueco del material: la foto de una de tus piezas; si no hay, el dibujo del tipo (los del catálogo base)
function miniMaterial(m) {
  const c = piezasDe(m).find((x) => x.foto);
  if (c) return `<img class="thumb mini" src="${fotoUrl(c)}" alt="" title="${esc(c.nombre)}" loading="lazy">`;
  const tp = list(m.tipo).find((k) => D.tipos[k]?.origen === 'seed');
  return tp ? `<img class="thumb mini dibujo"${conColor(g(tp).categoria || 'otro')} src="img/tipos/${esc(tp)}.svg" alt="" title="${esc(g(tp).nombre)}" loading="lazy" onerror="this.remove()">` : '';
}

// filas de proyectos. Con «minis», la tira de fotos de las piezas (listado de Proyectos); sin ella, el estado va junto al nombre
function listaProyectos(ps, minis = false) {
  return ps.map((p) => {
    const tira = minis ? (p.material || []).filter((m) => !m.opcional).map(miniMaterial).filter(Boolean).slice(0, 8).join('') : '';
    const n = nTareas(p);
    const avance = [n ? t('{hecho}/{total} tareas', {hecho: p.tareas.hecho, total: n}) : '', p.notas ? plural(p.notas, 'nota') : ''].filter(Boolean).join(' · ');
    const estado = !minis && p.estado && p.estado !== 'idea' ? ` <span class="gris">· ${esc(t(ESTADO_PRO[p.estado]).toLowerCase())}</span>` : '';
    return `<div class="fila fila-pro"><a class="fila-main" href="#/p/${esc(p.id)}"><div>
      <div class="nombre">${esc(p.nombre)}${estado}</div><div class="sub">${esc(p.resumen || '')}</div>
      ${tira ? `<div class="minis">${tira}</div>` : ''}</div></a>
      <div class="der"><div>${p.estado === 'terminado' ? t('Terminado') : estadoProyecto(p)}</div><div class="sub">${esc(dificultad(p))}</div>
        ${avance ? `<div class="sub">${esc(avance)}</div>` : ''}</div></div>`;
  }).join('');
}

function vProyectos() {
  const query = q.value.trim();
  const nuevo = `<a class="btn prim" href="#/proyecto-nuevo">${ICO.mas}${t('Nuevo proyecto')}</a>`;
  const cab = `<div class="vista-cab"><h1>${t('Proyectos')} <small>${plural(D.proyectos.length, 'proyecto')}</small></h1>${nuevo}</div>`;
  if (!D.proyectos.length) return cab + vacio(`${t('Aún no hay proyectos.')}<br>${nuevo}`);
  const abiertos = D.proyectos.filter((p) => p.estado !== 'terminado');
  const poco = (p) => { const f = faltas(p).length; return f > 0 && f <= 2; };
  const filtros = {
    todos: [t('Todos'), D.proyectos], en_marcha: [t('En marcha'), D.proyectos.filter((p) => p.estado === 'en_marcha')],
    ya: [t('Puedo hacerlo ya'), abiertos.filter((p) => !faltas(p).length)], poco: [t('Me falta poco'), abiertos.filter(poco)],
    terminado: [t('Terminados'), D.proyectos.filter((p) => p.estado === 'terminado')],
  };
  if (!filtros[ui.proFiltro]) ui.proFiltro = 'todos';
  let ps = filtros[ui.proFiltro][1];
  if (query) ps = ps.filter((p) => matches(textoProyecto(p), query));
  ps = ps.slice().sort((a, b) => faltas(a).length - faltas(b).length || (a.dificultad || 1) - (b.dificultad || 1) || byName(a, b));
  const barra = `<div class="filtros"><div class="cats">${Object.entries(filtros).filter(([k, [, l]]) => l.length || k === 'todos' || k === ui.proFiltro).map(([k, [lbl, l]]) =>
    `<button class="f ${ui.proFiltro === k ? 'on' : ''}" data-pf="${k}">${lbl}<span class="n">${l.length}</span></button>`).join('')}</div></div>`;
  if (!ps.length) return cab + barra + tambien(query, 'proyectos') + vacio(t('Ninguno en este filtro.'));
  return cab + barra + tambien(query, 'proyectos') + Object.entries(ESTADOS_PRO).map(([k, titulo]) => {
    const items = ps.filter((p) => (p.estado || 'idea') === k);
    return items.length ? `<section class="grupo"><h3 class="grupo-t">${t(titulo)}<span class="n">${items.length}</span></h3>${listaProyectos(items, true)}</section>` : '';
  }).join('');
}

// lo del usuario en el proyecto abierto (bitácora, tablero y archivos): se pide al entrar y se guarda para no parpadear
const PRO = {id: null, det: null};
const PRO_TABS = {ficha: 'Ficha', tablero: 'Tablero', bitacora: 'Bitácora', archivos: 'Archivos'};
function tabsProyecto(p, tab) {
  const n = nTareas(p), cuenta = {tablero: n ? `${p.tareas.hecho}/${n}` : '', bitacora: p.notas || '', archivos: p.archivos || ''};
  return Object.entries(PRO_TABS).map(([k, lbl]) => `<a class="${k === tab ? 'on' : ''}" href="#/p/${esc(p.id)}${k === 'ficha' ? '' : `/${k}`}"
    ${k === tab ? 'aria-current="page"' : ''}>${t(lbl)}${cuenta[k] ? `<span class="n">${cuenta[k]}</span>` : ''}</a>`).join('');
}

function vProyecto(id, sub) {
  const p = proyecto(id);
  if (!p) return vacio(t('No existe ese proyecto.'));
  if (sub === 'editar') return vProyectoForm(p);
  const tab = PRO_TABS[sub] ? sub : 'ficha';
  const listo = PRO.id === p.id && PRO.det;
  return `${migas([`<a href="#/proyectos">${t('Proyectos')}</a>`, `<span>${esc(p.nombre)}</span>`])}
    <div class="plano pro-plano">
      ${cabIA(esc(p.nombre), p.resumen)}
      <div class="pro-barra">
        <label class="pro-estado">${t('Estado')}
          <select id="pro-estado" class="sel">${Object.entries(ESTADO_PRO).map(([k, v]) => `<option value="${k}" ${k === (p.estado || 'idea') ? 'selected' : ''}>${t(v)}</option>`).join('')}</select></label>
        <a class="btn" href="#/p/${esc(p.id)}/editar">${ICO.lapiz}${t('Editar')}</a>
        ${menuMas([`<button role="menuitem" type="button" class="peligro" data-pro="borrar">${t('Borrar este proyecto')}</button>`])}
      </div>
      <nav class="seg pro-tabs" id="pro-tabs" aria-label="${esc(t('Partes del proyecto'))}">${tabsProyecto(p, tab)}</nav>
      <div id="pro-zona" class="pro-zona" data-id="${esc(p.id)}" data-tab="${tab}">${tab === 'ficha' ? fichaProyecto(p)
        : listo ? PRO_PINTAR[tab](p, PRO.det) : `<p class="gris">${t('Cargando…')}</p>`}</div>
    </div>`;
}

function fichaProyecto(p) {
  const material = `<table class="t t-material"><thead><tr><th class="mini-c"></th><th class="n">${t('Cant.')}</th><th>${t('Pieza')}</th><th class="der">${t('Tienes')}</th></tr></thead><tbody>
    ${(p.material || []).map((m) => {
      const tiene = stock(m.tipo), pide = m.cantidad || 1, ok = tiene >= pide;
      const nombre = list(m.tipo).map((tp) => `<a href="#/g/${esc(tp)}">${esc(g(tp).nombre)}</a>`).join(t(' o '));
      const nota = [m.opcional ? t('opcional') : '', m.nota].filter(Boolean).map(esc).join(' · ');
      const tuyas = piezasDe(m);
      // qué piezas tuyas valen y dónde están (si solo es una y no tiene sitio, no añade nada al nombre del tipo)
      const donde = tuyas.length === 1 && !tuyas[0].ubicacion ? '' : tuyas.slice(0, 3).map((c) => `<a href="#/c/${c.id}">${esc(c.nombre)}</a>${c.ubicacion ? ` (${esc(c.ubicacion)})` : ''}`).join(', ');
      return `<tr><td class="mini-c">${miniMaterial(m)}</td><td class="n">${pide}</td>
        <td>${nombre}${nota ? `<div class="sub">${nota}</div>` : ''}${donde ? `<div class="sub">${t('Tuyas: ')}${donde}${tuyas.length > 3 ? t(' y {n} más', {n: tuyas.length - 3}) : ''}</div>` : ''}</td>
        <td class="der num ${ok || m.opcional ? '' : 'mal'}">${tiene >= MUCHOS ? t('muchos') : tiene}</td></tr>`;
    }).join('') || `<tr><td colspan="4" class="gris">${t('Sin material apuntado.')}</td></tr>`}</tbody></table>
    ${faltas(p).length ? `<div class="acciones"><button class="btn mini" type="button" data-pro="copiar-faltas">${t('Copiar lo que falta')}</button></div>` : ''}`;
  const con = p.conexiones?.length ? `<section><h2 class="rotulo">${t('Conexiones')}</h2><div class="caja pro-caja"><table class="t"><thead><tr><th>${t('Desde')}</th><th>${t('Hasta')}</th></tr></thead><tbody>
    ${p.conexiones.map(([a, b, n]) => `<tr><td class="pin">${esc(a)}</td><td class="pin">${esc(b)}${n ? `<div class="sub" style="font-family:var(--letra)">${esc(n)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div></section>` : '';
  const pasos = p.pasos?.length ? `<section><h2 class="rotulo">${t('Pasos')}</h2><div class="caja pro-caja"><ol class="pasos">${p.pasos.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div></section>` : '';
  const origPro = {seed: 'del catálogo base', ia: 'propuesto por la IA', usuario: 'tuyo'}[p.origen];
  return `<div class="caja pro-resumen">${cajetin([[t('Dificultad'), esc(may(DIF[p.dificultad || 1]))], [t('Tiempo'), esc(p.tiempo || '—')], [t('Piezas'), estadoProyecto(p)]], 3)}</div>
    <div class="pro-dos"><section><h2 class="rotulo">${t('Material')}</h2><div class="caja pro-caja">${material}</div></section>
      <div class="pro-der">${con}${pasos}${con || pasos ? '' : `<div class="caja pro-caja"><p class="gris">${t('Sin conexiones ni pasos: añádelos en «Editar».')}</p></div>`}</div></div>
    <div class="plegables">${plegableHist('proyecto', p.id)}</div>
    <p class="meta">${origPro ? t('Proyecto {origen}', {origen: t(origPro)}) : ''}</p>`;
}

// tablero: tres columnas; cada tarea se mueve con las flechas (en el móvil las columnas van una debajo de otra)
function tableroProyecto(p, det) {
  const claves = new Set(det.tareas.map((tr) => claveTxt(tr.texto)));
  const faltanPasos = (p.pasos || []).some((s) => !claves.has(claveTxt(s).slice(0, 300)));
  const cols = Object.entries(COLUMNAS);
  return `<div class="caja pro-caja pro-tablero-cab"><form id="form-pro-tarea" class="form sin-pad pro-anadir" autocomplete="off">
      <input name="texto" maxlength="300" required placeholder="${esc(t('Soldar los pines del sensor'))}" aria-label="${esc(t('Tarea nueva'))}">
      <button class="btn prim" type="submit">${t('Añadir')}</button></form>
    ${faltanPasos ? `<p class="sub pro-pasos-atajo"><button class="btn mini" type="button" data-pro="pasos">${t('Pasar los pasos al tablero')}</button>${t(' Crea una tarea por cada paso del proyecto.')}</p>` : ''}</div>
    <div class="tablero">${cols.map(([k, nombre], i) => {
      const ts = det.tareas.filter((tr) => tr.columna === k);
      const mover = (tr, j, flecha) => (cols[j] ? `<button class="btn mini" type="button" data-pro="mover" data-id="${tr.id}" data-col="${cols[j][0]}" aria-label="${esc(t('Pasar a «{col}»', {col: t(cols[j][1])}))}" title="${esc(t('Pasar a «{col}»', {col: t(cols[j][1])}))}">${flecha}</button>` : '');
      return `<section class="caja tab-col"><h3>${t(nombre)}<span class="n">${ts.length}</span></h3>${ts.map((tr) => `<div class="tarea${k === 'hecho' ? ' hecha' : ''}">
        <span class="tarea-t">${esc(tr.texto)}</span><span class="tarea-b">${mover(tr, i - 1, '←')}${mover(tr, i + 1, '→')}
        <button class="btn mini peligro" type="button" data-pro="borrar-tarea" data-id="${tr.id}" aria-label="${esc(t('Borrar la tarea'))}">✕</button></span></div>`).join('')
        || `<p class="gris tab-vacia">${t('Nada.')}</p>`}</section>`;
    }).join('')}</div>`;
}

function bitacoraProyecto(p, det) {
  return `<form id="form-pro-nota" class="form caja" autocomplete="off">
      <label>${t('Nota nueva')}<textarea name="texto" rows="3" maxlength="4000" placeholder="${esc(t('Qué has hecho, qué falla, qué falta comprar…'))}"></textarea></label>
      ${campoFoto(t('Foto (opcional)'))}
      <div class="acciones"><button class="btn prim" type="submit">${t('Apuntar')}</button></div>
    </form>
    <div class="bitacora">${det.notas.map((n) => `<article class="caja apunte">
      <header><span class="gris" title="${esc(fechaCompleta(n.fecha))}">${esc(cuando(n.fecha))}</span>
        <button class="btn mini peligro" type="button" data-pro="borrar-nota" data-id="${n.id}">${t('Borrar')}</button></header>
      ${n.texto ? `<p class="notas">${esc(n.texto)}</p>` : ''}
      ${n.foto ? `<a class="apunte-foto" href="fotos/${encodeURIComponent(n.foto)}" target="_blank" aria-label="${esc(t('Ver la foto grande'))}"><img src="fotos/${encodeURIComponent(n.foto)}" alt="" loading="lazy"></a>` : ''}
    </article>`).join('') || `<p class="gris">${t('Aún no has apuntado nada de este proyecto.')}</p>`}</div>`;
}

function archivosProyecto(p, det) {
  const url = (a) => `fotos/${encodeURIComponent(a.fichero)}`;
  const pie = (a) => `<span class="nombre">${esc(a.nombre)}</span><span class="sub">${esc(tamano(a.bytes))} · ${esc(cuando(a.fecha))}</span>`;
  const borrar = (a) => `<button class="btn mini peligro" type="button" data-pro="borrar-archivo" data-id="${a.id}">${t('Borrar')}</button>`;
  const imgs = det.archivos.filter((a) => a.tipo.startsWith('image/')), docs = det.archivos.filter((a) => !a.tipo.startsWith('image/'));
  return `<div class="caja pro-caja pro-subir"><label class="btn prim">${t('Subir diagrama o PDF')}<input type="file" id="pro-archivo" accept="image/*,application/pdf" hidden></label>
      <span class="sub">${t('Esquemas de conexión, capturas, hojas de datos. Las imágenes se reducen a 2400 px; los PDF, hasta 20 MB.')}</span></div>
    ${imgs.length ? `<div class="diagramas">${imgs.map((a) => `<figure class="caja diagrama"><a href="${url(a)}" target="_blank" aria-label="${esc(t('Ver «{n}» grande', {n: a.nombre}))}"><img src="${url(a)}" alt="" loading="lazy"></a>
      <figcaption><span class="diagrama-t">${pie(a)}</span>${borrar(a)}</figcaption></figure>`).join('')}</div>` : ''}
    ${docs.length ? `<div class="caja pro-docs">${docs.map((a) => `<div class="fila"><a class="fila-main" href="${url(a)}" target="_blank"><span class="thumb pdf" aria-hidden="true">PDF</span><div>${pie(a)}</div></a>${borrar(a)}</div>`).join('')}</div>` : ''}
    ${det.archivos.length ? '' : `<p class="gris">${t('Ningún archivo todavía.')}</p>`}`;
}
const PRO_PINTAR = {tablero: tableroProyecto, bitacora: bitacoraProyecto, archivos: archivosProyecto};

// pinta la pestaña abierta con lo que devuelve el servidor (y pone al día los recuentos del listado)
function pintarProyecto(det) {
  if (det) {
    PRO.id = det.id; PRO.det = det;
    const p = proyecto(det.id);
    if (p) {
      p.tareas = Object.fromEntries(Object.keys(COLUMNAS).map((k) => [k, det.tareas.filter((t) => t.columna === k).length]));
      p.notas = det.notas.length; p.archivos = det.archivos.length;
    }
  }
  const zona = $('#pro-zona'), p = zona && proyecto(zona.dataset.id);
  if (!p || PRO.id !== p.id || !PRO_PINTAR[zona.dataset.tab]) return;
  zona.innerHTML = PRO_PINTAR[zona.dataset.tab](p, PRO.det);
  $('#pro-tabs').innerHTML = tabsProyecto(p, zona.dataset.tab);
}
async function cargarProyecto() {
  const zona = $('#pro-zona');
  if (!zona || zona.dataset.tab === 'ficha') return;
  try { pintarProyecto(await api('GET', `api/proyectos/${encodeURIComponent(zona.dataset.id)}`)); }
  catch (err) { if (PRO.id !== zona.dataset.id) zona.innerHTML = `<p class="mal">${esc(err.message)}</p>`; }
}

// botones de la ficha de un proyecto (data-pro)
async function clicProyecto(el) {
  const id = proActual(), p = proyecto(id), base = `api/proyectos/${encodeURIComponent(id)}`, a = el.dataset.pro;
  if (a === 'mover') { el.disabled = true; pintarProyecto(await api('PATCH', `${base}/tareas/${el.dataset.id}`, {columna: el.dataset.col})); }
  else if (a === 'borrar-tarea') { el.disabled = true; pintarProyecto(await api('DELETE', `${base}/tareas/${el.dataset.id}`)); }
  else if (a === 'pasos') { el.disabled = true; pintarProyecto(await api('POST', `${base}/tareas`, {pasos: true})); }
  else if (a === 'borrar-nota') {
    if (!(await confirmar(t('¿Borrar esta nota de la bitácora?\nNo se puede deshacer.'), {si: 'Borrar', peligro: true}))) return;
    pintarProyecto(await api('DELETE', `${base}/notas/${el.dataset.id}`));
  } else if (a === 'borrar-archivo') {
    if (!(await confirmar(t('¿Borrar este archivo del proyecto?\nNo se puede deshacer.'), {si: 'Borrar', peligro: true}))) return;
    pintarProyecto(await api('DELETE', `${base}/archivos/${el.dataset.id}`));
  } else if (a === 'copiar-faltas') {
    const txt = t('Para «{nombre}» me falta:\n', {nombre: p.nombre}) + faltas(p).map((m) => `- ${m.cantidad || 1} × ${list(m.tipo).map((k) => g(k).nombre).join(t(' o '))} (${t('tengo {n}', {n: stockText(m.tipo)})})`).join('\n');
    try { await navigator.clipboard.writeText(txt); toast(t('Lista copiada')); } catch { toast(t('No se ha podido copiar (hace falta HTTPS o localhost)'), true); }
  } else if (a === 'borrar') {
    const suyo = [nTareas(p) ? plural(nTareas(p), 'tarea') : '', p.notas ? plural(p.notas, 'nota') : '', p.archivos ? plural(p.archivos, 'archivo') : ''].filter(Boolean);
    if (!(await confirmar(t('¿Borrar el proyecto «{nombre}»?\n{extra}No se puede deshacer.', {nombre: p.nombre, extra: suyo.length ? t('Se borran también sus {items}. ', {items: suyo.join(', ')}) : ''}), {si: 'Borrar proyecto', peligro: true}))) return;
    await api('DELETE', base);
    D.proyectos = D.proyectos.filter((x) => x.id !== id);
    if (PRO.id === id) { PRO.id = null; PRO.det = null; }
    contadores();
    location.hash = '#/proyectos';
    toast(t('Borrado «{nombre}»', {nombre: p.nombre}));
  }
}
async function cambiarEstadoPro(sel) {
  const p = await api('PATCH', `api/proyectos/${encodeURIComponent(proActual())}`, {estado: sel.value});
  guardarProLocal(p);
  toast(t('Estado: {e}', {e: t(ESTADO_PRO[p.estado]).toLowerCase()}));
}
// imagen → JPEG de 2400 px como mucho, sobre blanco (los PNG con transparencia saldrían en negro); PDF → tal cual
async function subirArchivoPro(file) {
  let cuerpo = file, tipo = file.type;
  if (tipo.startsWith('image/')) {
    const cv = await lienzoDe(file, 2400), fondo = document.createElement('canvas');
    fondo.width = cv.width; fondo.height = cv.height;
    const ctx = fondo.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, fondo.width, fondo.height); ctx.drawImage(cv, 0, 0);
    cuerpo = await jpeg(fondo); tipo = 'image/jpeg';
  } else if (tipo !== 'application/pdf') throw new Error(t('Tiene que ser una imagen o un PDF'));
  if (cuerpo.size > 20 * 1024 * 1024) throw new Error(t('El archivo es demasiado grande (máx. 20 MB)'));
  toast(t('Subiendo…'));
  const nombre = file.name.replace(/\.[^.]+$/, '').slice(0, 120);
  pintarProyecto(await api('POST', `api/proyectos/${encodeURIComponent(proActual())}/archivos?nombre=${encodeURIComponent(nombre)}`, cuerpo, {'content-type': tipo}));
  toast(t('Archivo guardado'));
}
async function anadirTareaPro(form) {
  pintarProyecto(await api('POST', `api/proyectos/${encodeURIComponent(proActual())}/tareas`, {texto: new FormData(form).get('texto')}));
  if (matchMedia('(hover: hover)').matches) $('#form-pro-tarea [name=texto]')?.focus(); // en el móvil, sin reabrir el teclado
}
async function anadirNotaPro(form) {
  const fd = new FormData(form), foto = fd.get('foto');
  const body = {texto: fd.get('texto')};
  if (foto && foto.size) body.foto = await base64(await jpeg(await lienzoDe(foto, 1600)));
  if (!String(body.texto).trim() && !body.foto) throw new Error(t('Escribe algo o pon una foto'));
  pintarProyecto(await api('POST', `api/proyectos/${encodeURIComponent(proActual())}/notas`, body));
  toast(t('Apuntado'));
}

// crear o editar la receta de un proyecto: nombre, material (tipos del glosario), conexiones y pasos
function vProyectoForm(p) {
  const x = p || {nombre: '', resumen: '', dificultad: 1, tiempo: '', material: [], conexiones: [], pasos: []};
  const volver = p ? `#/p/${esc(p.id)}` : '#/proyectos';
  return `${migas(p ? [`<a href="#/proyectos">${t('Proyectos')}</a>`, `<a href="#/p/${esc(p.id)}">${esc(p.nombre)}</a>`, `<span>${t('Editar')}</span>`] : [`<a href="#/proyectos">${t('Proyectos')}</a>`, `<span>${t('Nuevo proyecto')}</span>`])}
    <div class="plano">
      ${cabIA(p ? t('Editar proyecto') : t('Nuevo proyecto'), p ? '' : t('Apunta la idea con lo que sepas: el material, las conexiones y los pasos se pueden completar más tarde.'))}
      ${p?.origen === 'seed' ? `<p class="nota">${t('Es del catálogo base. Al guardar pasa a ser tuyo: las actualizaciones del catálogo ya no lo cambiarán.')}</p>` : ''}
      <form id="form-proyecto" class="form ancho caja" autocomplete="off" data-id="${esc(p?.id || '')}">
        <label>${t('Nombre')}<input name="nombre" required maxlength="120" value="${esc(x.nombre)}" placeholder="${esc(t('Estación meteorológica'))}"></label>
        <label>${t('Resumen')}<textarea name="resumen" rows="2" maxlength="600" placeholder="${esc(t('Qué hace, en una o dos frases'))}">${esc(x.resumen || '')}</textarea></label>
        <div class="dos">
          <label>${t('Dificultad')}<select name="dificultad">${Object.entries(DIF).map(([k, v]) => `<option value="${k}" ${Number(k) === (x.dificultad || 1) ? 'selected' : ''}>${esc(may(v))}</option>`).join('')}</select></label>
          <label>${t('Tiempo')}<input name="tiempo" maxlength="40" value="${esc(x.tiempo || '')}" placeholder="${esc(t('2 h'))}"></label>
        </div>
        ${editorFilas('material', x.material.map((m) => [list(m.tipo)[0] || '', list(m.tipo)[1] || '', m.cantidad || 1, m.nota || '', m.opcional ? '1' : '']),
          {etiqueta: t('Material'), boton: t('Añadir pieza'), ayuda: t('Elige cada pieza por su tipo del glosario. «O bien» es otro tipo que también vale.')})}
        ${editorFilas('conexiones', x.conexiones, {etiqueta: t('Conexiones'), boton: t('Añadir conexión'), ayuda: t('De qué pin a qué pin.')})}
        ${editorFilas('pasos', x.pasos.map((s) => [s]), {etiqueta: t('Pasos'), boton: t('Añadir paso'), ayuda: t('En orden. Luego puedes pasarlos al tablero como tareas.')})}
        <div class="acciones">
          <button class="btn prim" type="submit">${t('Guardar proyecto')}</button>
          <a class="btn" href="${volver}">${t('Cancelar')}</a>
        </div>
      </form>
    </div>`;
}
async function guardarProyectoForm(form) {
  const fd = new FormData(form), id = form.dataset.id;
  const body = {nombre: fd.get('nombre'), resumen: fd.get('resumen'), dificultad: Number(fd.get('dificultad')) || 1, tiempo: fd.get('tiempo'),
    material: leerEditor(form, 'material').map(([tipo, alt, cantidad, nota, opcional]) => ({tipo: [tipo, alt].filter(Boolean), cantidad: Number(cantidad) || 1, nota, opcional: !!opcional})),
    conexiones: leerEditor(form, 'conexiones'), pasos: leerEditor(form, 'pasos').map(([s]) => s)};
  const p = id ? await api('PUT', `api/proyectos/${encodeURIComponent(id)}`, body) : await api('POST', 'api/proyectos', body);
  guardarProLocal(p);
  location.hash = `#/p/${encodeURIComponent(p.id)}`;
  toast(id ? t('Proyecto guardado') : t('Proyecto creado'));
}

// ---------- IA: «Añadir con IA» (el modelo propone, el usuario confirma) ----------
// fecha de SQLite («2026-11-09 17:20:02», en UTC) → milisegundos
const fechaSql = (s) => Date.parse(String(s || '').replace(' ', 'T') + 'Z');

// espera mientras el modelo piensa: línea de progreso, qué está pasando, segundos y el esqueleto de la ficha
// (no hay progreso real que medir: los textos dicen lo que se sabe y dan una salida si tarda mucho)
function vistaEspera(foto, modelo, titulo = t('Analizando…')) {
  return `${cabIA(titulo)}
    <div class="ia-progreso" role="progressbar" aria-label="${esc(t('El modelo está pensando'))}"><span></span></div>
    <p class="ia-paso" role="status"><span id="ia-paso">${t('Enviando al modelo…')}</span> · <span id="ia-seg" class="num">0 s</span>
      ${modelo ? `<span class="gris"> · ${esc(nombreModelo(modelo))}</span>` : ''}</p>
    <div class="caja bloque-caja ia-espera">
      <div class="ia-esqueleto" aria-hidden="true">
        <div class="esq esq-titulo"></div><div class="esq esq-linea"></div>
        <div class="esq-specs"><div class="esq"></div><div class="esq"></div><div class="esq"></div><div class="esq"></div></div>
        <div class="esq esq-fila"></div><div class="esq esq-fila"></div><div class="esq esq-fila"></div><div class="esq esq-fila corta"></div>
      </div>
      ${foto}
    </div>`;
}
let ticContador = null;
function arrancarContador(zona) {
  clearInterval(ticContador);
  const tic = () => {
    const seg = $('#ia-seg'), paso = $('#ia-paso');
    if (!seg || !zona.isConnected || !zona.dataset.espera) { clearInterval(ticContador); return; }
    const s = Math.max(0, Math.floor((Date.now() - Number(zona.dataset.inicio)) / 1000));
    seg.textContent = `${s} s`;
    paso.textContent = s < 4 ? t('Enviando al modelo…')
      : s < 30 ? t('El modelo está mirando la pieza…')
      : s < 90 ? t('Sigue pensando: algunos modelos tardan hasta un minuto…')
      : t('Está tardando mucho. Puedes salir: la propuesta te esperará en «Añadir con IA».');
  };
  tic();
  ticContador = setInterval(tic, 1000);
}
const avisoIA = (tipo, conBoton = false) => `<div class="nota nota-ia"><p><span class="nota-t">${t('Sin comprobar')}</span> ${t('Esta ficha la escribió la IA: comprueba la tensión y los pines antes de conectar nada.')}</p>
  ${conBoton ? `<button class="btn mini" id="revisada" data-tipo="${esc(tipo)}">${t('Ya la he comprobado')}</button>` : ''}</div>`;
const ESTADO_IA = {pendiente: 'Analizando…', propuesta: 'Esperando a que la mires', error: 'Error', aplicada: 'Guardada', descartada: 'Descartada'};
const comas = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

// las dos formas de añadir con IA, como pestañas (misma cabecera en las dos pantallas)
const modosIA = (actual) => `<nav class="seg ia-modos" aria-label="${esc(t('Qué quieres añadir'))}">${[['#/ia', t('Una pieza'), 'una'], ['#/ia/varias', t('Varias piezas en una foto'), 'varias']]
  .map(([h, lbl, k]) => `<a class="${k === actual ? 'on' : ''}" href="${h}"${k === actual ? ' aria-current="page"' : ''}>${lbl}</a>`).join('')}</nav>`;
// nombre de una tarea de la IA en las listas. Una pieza que sale de una foto con varias aún no tiene propuesta: se
// enseña el nombre con el que se la vio (va en la pista que se le da al modelo), no la pista entera
const nombreTareaIA = (tr) => (tr.clase === 'revisar' ? t('Correcciones para «{n}»', {n: tr.objetivo_nombre || '¿?'}) : tr.clase === 'detectar' ? t('Foto con varias piezas')
  : tr.propuesta?.nombre || (String(tr.texto || '').match(/^Esta pieza sale de una foto con varias\. Allí se vio como «([^»]+)»/) || [])[1] || tr.texto || t('Pieza sin nombre'));
function vIA(id) {
  if (id === 'ajustes') return `${migas([`<a href="#/ia">${t('Añadir con IA')}</a>`, `<span>${t('Configuración')}</span>`])}<div class="plano" id="ia-ajustes"><p class="gris">${t('Cargando…')}</p></div>`;
  if (id === 'varias') return vIAVarias();
  if (id) return `${migas([`<a class="back" href="#/ia">${t('Añadir con IA')}</a>`, `<span id="ia-miga">${t('Propuesta')}</span>`])}<div class="plano ia-plano" id="ia-zona"><p class="gris">${t('Cargando…')}</p></div>`;
  if (!D.ia?.activa) return `${migas([`<a href="#/">${t('Inventario')}</a>`, `<span>${t('Añadir con IA')}</span>`])}${vacio(`${t('Falta la clave de OpenCode Go. ')}<a class="btn prim" href="#/ia/ajustes">${t('Configurar')}</a>`)}`;
  return `${migas([`<a href="#/">${t('Inventario')}</a>`, `<span>${t('Añadir con IA')}</span>`])}
    <div class="plano">
      ${cabIA(t('Añadir con IA'), t('Haz una foto de la pieza y añade lo que sepas. La IA propone el nombre, el tipo y la ficha; tú lo miras y lo corriges antes de guardar.'))}
      ${modosIA('una')}
      <form id="form-ia" class="form caja" autocomplete="off">
        ${campoFoto(t('Fotos'), t('Hasta 4: por delante, por detrás, la serigrafía de cerca. La primera será la foto de la pieza.'), {varias: 4, principal: true})}
        <label>${t('Lo que sepas (opcional)')}<textarea name="texto" rows="2" maxlength="1000" placeholder="${esc(t('Sensor de humedad del kit de Freenove, 3 pines'))}"></textarea></label>
        <label>${t('Modelo')}<select name="modelo" id="ia-modelo-alta"><option value="">${t('El de siempre ({m})', {m: esc(nombreModelo(D.ia.modelo))})}</option></select>
          <span class="ayuda">${t('Solo para esta pieza, por si una difícil merece otro. El de siempre y la clave se cambian en ')}<a href="#/ia/ajustes">${t('Ajustes → IA')}</a>.</span></label>
        <p class="nota" id="ia-aviso-modelo" hidden></p>
        <div class="acciones"><button class="btn prim" type="submit">${t('Analizar')}</button></div>
      </form>
    </div>
    <div id="ia-abiertas"></div>`;
}

// configuración: clave (nunca se vuelve a mostrar) y modelo, elegido de los que el catálogo de Go marca con fotos
// y salida estructurada. Al guardar, el servidor valida el formato y hace una llamada mínima de prueba.
// coste en dólares con pocos decimales
const dolares = (n) => {
  if (n == null) return '?';
  const sep = I18N.lang() === 'en' ? '.' : ',';
  return n < 0.0001 ? `<0${sep}0001 $` : `${(n < 0.01 ? n.toFixed(4) : n.toFixed(3)).replace('.', sep)} $`;
};
// lo que cuesta de verdad una pieza con cada modelo: la media de tus consultas, o una estimación si aún no hay
// (≈ 6000 tokens de entrada —instrucciones, lista de tipos y foto— y 900 de salida)
const costePieza = (m) => (m.coste_medio
  ? t('≈ {c} por pieza · media de tus {n}', {c: dolares(m.coste_medio.dolares), n: plural(m.coste_medio.consultas, 'consulta')})
  : t('≈ {c} por pieza (estimado)', {c: dolares(((m.precio.entrada ?? 0) * 6000 + (m.precio.salida ?? 0) * 900) / 1e6)}));
let MODELOS_IA = null;
// lo que NO sabe hacer un modelo, en pocas palabras (vacío si lo hace todo)
const limitesModelo = (m) => [m.vision ? '' : t('no ve fotos'), m.estructurada ? '' : t('sin formato fijo')].filter(Boolean);
const modeloIA = (id) => MODELOS_IA?.find((m) => m.id === (id || D.ia?.modelo)) || null;
// nombre legible de un modelo («Claude Haiku 5.5») si ya tenemos el catálogo; si no, su identificador
const nombreModelo = (id) => MODELOS_IA?.find((m) => m.id === id)?.nombre || id || '';
async function modelosIA(forzar = false) {
  if (!MODELOS_IA || forzar) MODELOS_IA = await api('GET', 'api/ia/modelos');
  return MODELOS_IA;
}

// cuánto razona el modelo antes de responder (tabla ajustes «ia_razonar»); con lo que significa para el modelo elegido
const RAZONAR = {
  poco: {nombre: 'Poco', sub: 'Rápido y barato. Suficiente para casi todas las piezas.'},
  medio: {nombre: 'Medio', sub: 'Piensa más: para placas raras o serigrafías difíciles. Tarda y cuesta más.'},
  mucho: {nombre: 'Mucho', sub: 'Lo máximo que admita el modelo. Lento y bastante más caro: solo si lo demás falla.'},
};
// lo que pide la app al modelo con cada nivel (igual que server/ia.mjs → esfuerzoPara)
function esfuerzoDe(m, nivel) {
  const l = m?.esfuerzos || [];
  if (m?.api === 'messages' && nivel === 'poco') return t('sin pensamiento');
  if (!l.length) return m?.api === 'messages' ? t(nivel === 'medio' ? 'pensamiento corto' : 'pensamiento largo') : t('lo que decida el modelo');
  return nivel === 'mucho' ? l[l.length - 1] : nivel === 'medio' ? (l.includes('medium') ? 'medium' : l[Math.floor((l.length - 1) / 2)]) : l[0];
}
function bloqueRazonar(m) {
  const actual = RAZONAR[D.ajustes.ia_razonar] ? D.ajustes.ia_razonar : 'poco';
  const nota = !m ? '' : !m.razona ? t('{m} no razona: este ajuste no le cambia nada.', {m: esc(m.nombre)})
    : `${t('Con {m}: ', {m: esc(m.nombre)})}${Object.keys(RAZONAR).map((k) => `${t(RAZONAR[k].nombre).toLowerCase()} = ${esc(esfuerzoDe(m, k))}`).join(' · ')}.`;
  return `<h3>${t('Cuánto razona')}</h3>
    <p class="ayuda">${t('Antes de responder, el modelo «piensa». Más razonamiento acierta más en piezas difíciles, pero tarda más y cuesta más (lo que piensa se cobra como respuesta). Vale para «Añadir con IA» y «Corregir con IA».')}</p>
    <div class="ia-modelos" role="radiogroup" aria-label="${esc(t('Cuánto razona'))}">${Object.entries(RAZONAR).map(([k, v]) => `
      <label class="ia-modelo"><input type="radio" name="ia-razonar" value="${k}" ${k === actual ? 'checked' : ''}>
        <span><span class="nombre">${t(v.nombre)}${k === 'poco' ? `<span class="gris">${t(' · recomendado')}</span>` : ''}</span><span class="sub">${t(v.sub)}</span></span></label>`).join('')}</div>
    ${nota ? `<p class="ayuda">${nota}</p>` : ''}`;
}

async function iaAjustes() {
  const zona = $('#ia-ajustes');
  if (!zona) return;
  let cfg, lista = [], fallo = '';
  try { cfg = await api('GET', 'api/ia/config'); } catch (err) { zona.innerHTML = `<p class="mal">${esc(err.message)}</p>`; return; }
  try { lista = await modelosIA(true); } catch (err) { fallo = err.message; }
  const origen = {web: t('guardada en la app'), entorno: t('de la variable IA_CLAVE del servidor')}[cfg.origen_clave];
  const fuera = cfg.modelo && lista.length && !lista.some((m) => m.id === cfg.modelo);
  zona.innerHTML = `${cabIA(t('Configuración de la IA'), t('Proveedor: OpenCode Go. Salen todos sus modelos de chat; los que no ven fotos o no devuelven datos con formato fijo llevan el aviso.'))}
    <section class="caja bloque-caja ia-bloque">
      <h3>${t('Modelo de siempre')}</h3>
      <p class="ayuda">${t('Toca otro para cambiarlo. Se comprueba al momento con tu clave: no hace falta volver a ponerla.')}</p>
      ${lista.length ? `<div class="ia-modelos" role="radiogroup" aria-label="${esc(t('Modelo de siempre'))}">${lista.map((m) => `
        <label class="ia-modelo"><input type="radio" name="ia-modelo" value="${esc(m.id)}" ${m.id === cfg.modelo ? 'checked' : ''}>
          <span><span class="nombre">${esc(m.nombre)}${m.recomendado ? `<span class="gris">${t(' · recomendado')}</span>` : ''}</span>
          <span class="sub">${esc(costePieza(m))}</span>
          ${m.vision ? '' : `<span class="sub aviso">${t('No ve fotos: solo sirve con texto, y no puede con «Varias piezas en una foto».')}</span>`}
          ${m.estructurada ? '' : `<span class="sub aviso">${t('Sin formato fijo: la app saca los datos de su texto. Falla más y deja más cosas por comprobar.')}</span>`}
          <span class="sub">${esc(m.descripcion)}</span></span></label>`).join('')}</div>`
        : `<p class="mal">${esc(fallo || t('No hay modelos disponibles'))}</p>`}
      ${fuera ? `<p class="aviso">${t('El modelo actual («{m}») ya no está en el catálogo: elige otro.', {m: esc(cfg.modelo)})}</p>` : ''}
      <p class="ayuda" id="ia-modelo-estado" role="status"></p>
    </section>
    <section class="caja bloque-caja ia-bloque" id="ia-razonar-zona">${bloqueRazonar(lista.find((m) => m.id === cfg.modelo))}</section>
    <section class="caja bloque-caja ia-bloque">
      <h3>${t('Clave de OpenCode Go')}</h3>
      <p>${cfg.clave ? `${esc(cfg.clave)} · ${esc(origen)}` : `<span class="mal">${t('Sin clave: la IA no funciona hasta que pongas una.')}</span>`}</p>
      ${cfg.clave ? `<div class="acciones"><button class="btn" type="button" id="ia-cambiar-clave">${t('Cambiar clave')}</button></div>` : ''}
      <form id="form-ia-config" class="form sin-pad" autocomplete="off" ${cfg.clave ? 'hidden' : ''}>
        <label>${cfg.clave ? t('Clave nueva') : t('Clave')}
          <input name="clave" type="password" autocomplete="off" spellcheck="false" minlength="16" maxlength="300" pattern="[!-~]{16,300}"
            placeholder="${esc(t('Pega aquí la clave de tu suscripción a Go'))}" required>
          <span class="ayuda">${t('La encontrarás en la consola de OpenCode (suscripción Go). La app la guarda en su base de datos y no la vuelve a enseñar; ojo: va dentro de las copias de seguridad.')}</span></label>
        <div class="acciones">
          <button class="btn prim" type="submit">${t('Probar y guardar')}</button>
          ${cfg.origen_clave === 'web' ? `<button class="btn peligro" type="button" id="ia-quitar">${t('Quitar la clave')}</button>` : ''}
        </div>
      </form>
    </section>`;
}

// cambiar el modelo de siempre con un toque: se comprueba con la clave guardada; si falla, vuelve al anterior
async function cambiarModeloIA(radio) {
  const estado = $('#ia-modelo-estado'), radios = [...document.querySelectorAll('input[name=ia-modelo]')];
  const anterior = D.ia?.modelo;
  radios.forEach((r) => (r.disabled = true));
  estado.className = 'ayuda';
  estado.textContent = t('Comprobando con OpenCode Go…');
  try {
    D.ia = await api('PUT', 'api/ia/config', {modelo: radio.value});
    const z = $('#ia-razonar-zona');
    if (z) z.innerHTML = bloqueRazonar((MODELOS_IA || []).find((m) => m.id === radio.value));
    estado.textContent = t('Listo: {m} es ahora el modelo de siempre.', {m: radio.closest('label').querySelector('.nombre').firstChild.textContent});
  } catch (err) {
    estado.className = 'mal';
    estado.textContent = err.message;
    const r = radios.find((x) => x.value === anterior);
    if (r) r.checked = true;
  } finally { radios.forEach((r) => (r.disabled = false)); }
}

async function guardarAjustesIA(form) {
  const clave = String(new FormData(form).get('clave') || '').trim();
  if (!/^[!-~]{16,300}$/.test(clave)) throw new Error(t('La clave no tiene buen formato (16–300 caracteres, sin espacios)'));
  toast(t('Comprobando con OpenCode Go…'));
  D.ia = await api('PUT', 'api/ia/config', {clave});
  toast(t('Clave comprobada y guardada'));
  location.hash = '#/ia';
}

// rellena el desplegable «Modelo para esta pieza» de la pantalla de alta
async function llenarModelosAlta() {
  const sel = $('#ia-modelo-alta');
  if (!sel) return;
  try {
    const lista = await modelosIA();
    const actual = lista.find((m) => m.id === D.ia?.modelo);
    if (actual) {
      sel.options[0].textContent = t('El de siempre ({m})', {m: `${actual.nombre} · ${costePieza(actual)}`});
      const a = $('#ia-modelo-siempre');
      if (a) a.textContent = actual.nombre;
    }
    sel.insertAdjacentHTML('beforeend', lista.filter((m) => m.id !== D.ia?.modelo && (!sel.dataset.soloFotos || m.vision))
      .map((m) => `<option value="${esc(m.id)}">${esc(m.nombre)}${limitesModelo(m).length ? ` (${limitesModelo(m).join(', ')})` : ''} · ${esc(costePieza(m))}</option>`).join(''));
    avisoModeloAlta();
  } catch {}
}
// con un modelo que no ve fotos, el campo de la foto se apaga (y se dice por qué); sin formato fijo, solo se avisa
function avisoModeloAlta() {
  const sel = $('#ia-modelo-alta'), aviso = $('#ia-aviso-modelo');
  if (!sel || !aviso) return;
  const m = modeloIA(sel.value), form = sel.form, input = form.querySelector('.archivo-input');
  const sinFotos = !!m && !m.vision, varias = form.id === 'form-ia-varias';
  if (input) {
    if (sinFotos && input.value) { input.value = ''; pintarArchivo(input); }
    input.disabled = sinFotos;
    input.closest('.archivo').classList.toggle('apagado', sinFotos);
  }
  const b = form.querySelector('[type=submit]');
  if (varias && b) b.disabled = sinFotos;
  const partes = !m ? [] : [
    sinFotos ? (varias ? t('{m} no ve fotos: no puede separar las piezas. Elige otro modelo.', {m: m.nombre}) : t('{m} no ve fotos: no se puede subir foto. Describe la pieza con texto (lo que pone en la serigrafía, cuántos pines tiene…).', {m: m.nombre})) : '',
    m.estructurada ? '' : t('{m} no devuelve datos con formato fijo: puede fallar o dejar más cosas por comprobar.', {m: m.nombre})].filter(Boolean);
  aviso.hidden = !partes.length;
  aviso.textContent = partes.join(' ');
}

// ---------- foto con varias piezas: el modelo las separa, tú eliges cuáles, y cada una se identifica con su recorte ----------
function vIAVarias() {
  if (!D.ia?.activa) return `${migas([`<a href="#/">${t('Inventario')}</a>`, `<span>${t('Añadir con IA')}</span>`])}${vacio(`${t('Falta la clave de OpenCode Go. ')}<a class="btn prim" href="#/ia/ajustes">${t('Configurar')}</a>`)}`;
  return `${migas([`<a href="#/">${t('Inventario')}</a>`, `<span>${t('Añadir con IA')}</span>`])}
    <div class="plano">
      ${cabIA(t('Añadir con IA'), t('Pon las piezas separadas sobre un fondo liso y hazles una foto desde arriba. La IA las separa, tú eliges cuáles dar de alta y después identifica cada una con su recorte. Nada se guarda hasta que lo confirmes.'))}
      ${modosIA('varias')}
      <form id="form-ia-varias" class="form caja" autocomplete="off">
        ${campoFoto(t('Foto con las piezas'), t('Mejor pocas y que se lean (hasta 40). Con muchas piezas pequeñas, haz varias fotos.'))}
        <label>${t('Lo que sepas de ellas (opcional)')}<textarea name="texto" rows="2" maxlength="1000" placeholder="${esc(t('Son del kit de sensores de Freenove'))}"></textarea></label>
        <label>${t('Modelo')}<select name="modelo" id="ia-modelo-alta" data-solo-fotos="1"><option value="">${t('El de siempre ({m})', {m: esc(nombreModelo(D.ia.modelo))})}</option></select>
          <span class="ayuda">${t('Solo salen los que ven fotos. Gasta una consulta para separarlas y otra por cada pieza que elijas.')}</span></label>
        <p class="nota" id="ia-aviso-modelo" hidden></p>
        <div class="acciones"><button class="btn prim" type="submit">${t('Separar las piezas')}</button></div>
      </form>
    </div>`;
}
async function enviarVarias(form) {
  const fd = new FormData(form), file = fd.get('foto');
  if (!file || !file.size) throw new Error(t('Elige la foto con las piezas'));
  toast(t('Enviando la foto…'));
  const foto = await base64(await jpeg(await lienzoDe(file, 2000))); // entera, sin encuadrar: los recortes salen de ella
  const tr = await api('POST', 'api/ia/detectar', {texto: fd.get('texto'), foto, modelo: fd.get('modelo') || undefined});
  location.hash = `#/ia/${tr.id}`;
}
// recuadro de una pieza con un margen del 8 % (los modelos no afinan los bordes); sin recuadro, la foto entera
const cajaConMargen = (c) => {
  if (!c) return {x: 0, y: 0, ancho: 1000, alto: 1000};
  const mx = c.ancho * 0.08, my = c.alto * 0.08, x = Math.max(0, c.x - mx), y = Math.max(0, c.y - my);
  return {x, y, ancho: Math.min(1000 - x, c.ancho + 2 * mx), alto: Math.min(1000 - y, c.alto + 2 * my)};
};
function recortar(img, caja, max) {
  const c = cajaConMargen(caja), W = img.naturalWidth, H = img.naturalHeight;
  const sx = c.x / 1000 * W, sy = c.y / 1000 * H, sw = Math.max(1, c.ancho / 1000 * W), sh = Math.max(1, c.alto / 1000 * H);
  const k = Math.min(1, max / Math.max(sw, sh)), cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sw * k)); cv.height = Math.max(1, Math.round(sh * k));
  cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return cv;
}
let DETECCION = null; // la tarea que se está mirando
function vistaDeteccion(tr) {
  DETECCION = tr;
  const p = tr.propuesta, url = `fotos/${encodeURIComponent(tr.foto)}`;
  const meta = `<p class="ia-meta"><span>${esc(nombreModelo(tr.modelo))}</span>${costeTexto(p.coste) ? `<span>${esc(costeTexto(p.coste))}</span>` : ''}</p>`;
  return `${cabIA(t('{piezas} en la foto', {piezas: plural(p.piezas.length, 'pieza')}), t('Desmarca las que no quieras y corrige el nombre si hace falta (es solo una pista). Después la IA identifica cada una con su recorte y te las enseña juntas para guardarlas.'), meta)}
    ${p.dudas?.length ? `<div class="ams-aviso aviso-ojo"><b>${ICO.aviso}${t('Ojo')}</b><p>${p.dudas.map(esc).join(' ')}</p></div>` : ''}
    <div class="det">
      <div class="caja bloque-caja det-foto-caja"><div class="det-foto"><img id="det-img" src="${url}" alt="${esc(t('La foto con las piezas numeradas'))}">
        ${p.piezas.map((x, i) => (x.caja ? `<span class="det-caja" data-i="${i}" style="left:${x.caja.x / 10}%;top:${x.caja.y / 10}%;width:${x.caja.ancho / 10}%;height:${x.caja.alto / 10}%"><b>${i + 1}</b></span>` : '')).join('')}</div></div>
      <div class="caja bloque-caja det-lista">${p.piezas.map((x, i) => `<div class="det-pieza" data-i="${i}">
        <label class="det-marca"><input type="checkbox" class="det-ok" checked aria-label="${esc(t('Dar de alta la pieza {n}', {n: i + 1}))}"><b>${i + 1}</b></label>
        <span class="det-mini" data-i="${i}"></span>
        <div class="det-datos"><input class="det-nombre" maxlength="200" value="${esc(x.nombre)}" aria-label="${esc(t('Nombre de la pieza {n}', {n: i + 1}))}">
          ${x.descripcion ? `<span class="sub">${esc(x.descripcion)}</span>` : ''}${x.caja ? '' : `<span class="sub aviso">${t('Sin recuadro: se usará la foto entera.')}</span>`}</div>
        <label class="det-cant">${t('Cant.')}<input type="number" class="det-cantidad" min="1" inputmode="numeric" value="${esc(x.cantidad ?? 1)}"></label>
      </div>`).join('')}</div>
    </div>
    <div class="acciones lote-acciones">
      <button class="btn prim" type="button" id="det-crear" data-id="${tr.id}">${t('Identificar las marcadas')}</button>
      <button class="btn" type="button" data-det-marcar="todo">${t('Marcar todas')}</button>
      <button class="btn" type="button" data-det-marcar="nada">${t('Ninguna')}</button>
      <button class="btn peligro" type="button" id="ia-descartar" data-id="${tr.id}" data-volver="#/ia/varias">${t('Descartar')}</button>
    </div>`;
}
// miniaturas de cada pieza (recortes de la foto) y texto del botón
function pintarDeteccion() {
  const img = $('#det-img');
  if (!img || !DETECCION) return;
  const hacer = () => document.querySelectorAll('.det-mini').forEach((m) => { if (!m.firstChild) m.append(recortar(img, DETECCION.propuesta.piezas[m.dataset.i].caja, 160)); });
  if (img.complete && img.naturalWidth) hacer(); else img.addEventListener('load', hacer, {once: true});
  contarDeteccion();
}
function contarDeteccion() {
  const b = $('#det-crear');
  if (!b) return;
  const n = document.querySelectorAll('.det-ok:checked').length;
  document.querySelectorAll('.det-pieza').forEach((f) => { const ok = f.querySelector('.det-ok').checked; f.classList.toggle('fuera', !ok);
    document.querySelector(`.det-caja[data-i="${f.dataset.i}"]`)?.classList.toggle('fuera', !ok); });
  b.textContent = n ? t('Identificar {piezas} ({consultas})', {piezas: piezasTxt(n), consultas: plural(n, 'consulta')}) : t('Marca alguna pieza');
  b.disabled = !n;
}
async function crearDeteccion(boton) {
  const img = $('#det-img'), tr = DETECCION;
  if (!img?.naturalWidth) throw new Error(t('La foto aún no ha cargado'));
  boton.disabled = true;
  boton.textContent = t('Recortando…');
  const piezas = [];
  for (const f of document.querySelectorAll('.det-pieza')) {
    if (!f.querySelector('.det-ok').checked) continue;
    const x = tr.propuesta.piezas[f.dataset.i];
    piezas.push({nombre: f.querySelector('.det-nombre').value.trim() || x.nombre, descripcion: x.descripcion, cantidad: Number(f.querySelector('.det-cantidad').value) || 1,
      foto: await base64(await jpeg(recortar(img, x.caja, 1200)))});
  }
  toast(t('Enviando {piezas}…', {piezas: piezasTxt(piezas.length)}));
  const r = await api('POST', `api/ia/tareas/${tr.id}/crear-piezas`, {piezas});
  location.hash = `#/ia/lote/${r.lote}`;
}

// ---- lote de piezas nuevas (de una foto con varias): se guardan las marcadas tal como las propone la IA ----
function htmlLoteAltas(ts) {
  const listas = ts.filter((tr) => tr.estado !== 'pendiente').length;
  const tarea = (tr) => {
    const p = tr.propuesta || {};
    const tipo = p.tipo_existente ? esc(g(p.tipo_existente).nombre) : p.tipo_nuevo ? `${esc(p.tipo_nuevo.nombre)} <span class="aviso">${t('· tipo nuevo, sin comprobar')}</span>` : t('Sin tipo');
    const estado = {pendiente: t('identificando…'), propuesta: t('confianza {c}', {c: t(p.confianza || '?')}), aplicada: t('guardada'), descartada: t('descartada'), error: t('error')}[tr.estado] || tr.estado;
    const mini = `<span class="fila-img">${tr.foto ? `<img src="fotos/${encodeURIComponent(tr.foto)}" alt="" loading="lazy">` : ''}</span>`;
    const cuerpo = tr.estado === 'error' ? `<p class="mal">${esc(tr.error || t('Error'))}</p>`
      : tr.estado === 'propuesta' ? `<p class="sub">${tipo} · ${p.cantidad ?? 1} ${t('ud.')}</p>` : '';
    // la confianza y las dudas como etiquetas; en las demás, su estado
    const etqs = tr.estado === 'propuesta' ? `${etqConfianza(p.confianza)}${p.dudas?.length ? `<span class="ams-etiqueta ams-etiqueta--amarilla">${plural(p.dudas.length, 'duda')}</span>` : ''}`
      : `<span class="ams-etiqueta${tr.estado === 'error' ? ' ams-etiqueta--mal' : tr.estado === 'aplicada' ? ' ams-etiqueta--ok' : ''}">${esc(estado)}</span>`;
    const nombre = esc(p.nombre || t('Pieza sin identificar'));
    return `<section class="lote-tarea lote-alta lote-${tr.estado}">
      ${tr.estado === 'propuesta' ? `<input type="checkbox" class="lote-cambio" data-tarea="${tr.id}" value="alta" aria-label="${esc(t('Guardar {nombre}', {nombre}))}" ${LOTE.desmarcados.has(`${tr.id}:alta`) ? '' : 'checked'}>` : '<span></span>'}
      ${mini}
      <div class="lote-alta-main"><div class="lote-t">${tr.estado === 'aplicada' && tr.componente_id ? `<a class="nombre" href="#/c/${tr.componente_id}">${nombre}</a>` : `<span class="nombre">${nombre}</span>`}
        <span class="lote-etqs">${etqs}</span></div>${cuerpo}</div>
      ${tr.estado === 'propuesta' ? `<a class="btn mini lote-abrir" href="#/ia/${tr.id}">${p.dudas?.length ? t('Contestar') : t('Abrir')}</a>` : '<span></span>'}</section>`;
  };
  const quedan = ts.some((tr) => tr.estado === 'propuesta' || tr.estado === 'error');
  return `${cabIA(t('{piezas} de una foto', {piezas: piezasTxt(ts.length)}), listas < ts.length
      ? t('Identificando… {a} de {b} listas. Puedes ir mirando las que ya han llegado.', {a: listas, b: ts.length})
      : t('Guarda las marcadas tal como están, o abre una para corregirla, contestar sus dudas o ponerle sitio. Las fichas nuevas quedan «sin comprobar».'))}
    ${listas < ts.length ? `<div class="ia-progreso" role="progressbar" aria-label="${esc(t('La IA está identificando las piezas'))}"><span></span></div>` : ''}
    <div class="caja lote-lista">${ts.map(tarea).join('')}</div>
    ${quedan ? `<div class="acciones lote-acciones">
      <button class="btn prim" type="button" id="lote-guardar">${t('Guardar las marcadas')}</button>
      <button class="btn" type="button" data-lote-marcar="todo">${t('Marcar todas')}</button>
      <button class="btn" type="button" data-lote-marcar="nada">${t('Ninguna')}</button>
      <button class="btn peligro" type="button" id="lote-descartar">${t('Descartar lo que quede')}</button></div>` : `<p class="gris">${t('Ya no queda nada por revisar de esta foto.')}</p>`}`;
}
async function guardarLoteAltas(boton) {
  const ids = [...document.querySelectorAll('.lote-cambio:checked')].map((x) => Number(x.dataset.tarea));
  if (!ids.length) throw new Error(t('Marca alguna pieza'));
  boton.disabled = true;
  boton.textContent = t('Guardando…');
  const r = await api('POST', `api/ia/lotes/${encodeURIComponent(LOTE.id)}/guardar`, {ids});
  await cargar(); contadores();
  await iaLote(LOTE.id);
  toast(t(r.guardadas.length === 1 ? '{piezas} guardada' : '{piezas} guardadas', {piezas: piezasTxt(r.guardadas.length)}) + (r.fallos.length ? `; ${r.fallos.length} (${r.fallos[0].error})` : ''), r.fallos.length > 0);
}

// lista de tareas abiertas (debajo del formulario): nada se pierde si cierras la pestaña mientras el modelo piensa
async function iaAbiertas() {
  const zona = $('#ia-abiertas');
  if (!zona) return;
  try {
    const p = await api('GET', 'api/ia/pendientes'), n = p.lotes.length + p.tareas.length, MAX = 6;
    const filas = [...p.lotes.map(filaLotePendiente), ...p.tareas.map(filaPendiente)];
    zona.innerHTML = n ? `<section class="grupo"><h3 class="grupo-t">${t('Sin terminar')}<span class="n">${n}</span></h3>${filas.slice(0, MAX).join('')}
      <p class="sub ia-abiertas-mas"><a href="#/pendientes">${n > MAX ? t('Ver las {n} en «Cambios pendientes»', {n}) : t('Verlo en «Cambios pendientes»')} →</a></p></section>` : '';
    if (p.lotes.some((l) => l.estados.pendiente) || p.tareas.some((tr) => tr.estado === 'pendiente')) setTimeout(() => { if (location.hash === '#/ia') iaAbiertas(); }, 4000);
  } catch {}
}

async function iaTarea(id) {
  const zona = $('#ia-zona');
  if (!zona) return;
  let tr;
  try { tr = await api('GET', `api/ia/tareas/${id}`); } catch (err) { zona.innerHTML = `<p class="mal">${esc(err.message)}</p>`; return; }
  const foto = tr.foto ? `<img class="foto ia-foto" src="fotos/${encodeURIComponent(tr.foto)}" alt="">` : '';
  const atras = document.querySelector('a.back'), miga = $('#ia-miga');
  if (atras && tr.clase === 'revisar') { atras.href = volverRevision(tr); atras.textContent = textoVolver(tr); }
  else if (atras && tr.lote) { atras.href = `#/ia/lote/${encodeURIComponent(tr.lote)}`; atras.textContent = t('Las piezas de la foto'); }
  else if (atras && desdePendientes(tr)) { atras.href = '#/pendientes'; atras.textContent = t('Cambios pendientes'); }
  if (miga) miga.textContent = tr.clase === 'revisar' ? t('Correcciones') : tr.clase === 'detectar' ? t('Piezas en la foto') : t('Propuesta');
  if (tr.estado === 'pendiente') {
    // la pantalla de espera se pinta UNA vez (si no, la animación y el contador se reiniciarían en cada consulta)
    const clave = `${tr.id}-${tr.rondas}`;
    if (zona.dataset.espera !== clave) {
      zona.dataset.espera = clave;
      const lleva = Math.max(0, (fechaSql(tr.ahora) - fechaSql(tr.actualizada)) / 1000) || 0; // segundos que lleva, según el servidor
      zona.dataset.inicio = String(Date.now() - lleva * 1000);
      zona.innerHTML = vistaEspera(foto, tr.modelo_pedido || D.ia?.modelo, tr.clase === 'revisar' ? t('Repasando la ficha…') : tr.clase === 'detectar' ? t('Separando las piezas…') : t('Analizando…'));
      arrancarContador(zona);
    }
    const h = location.hash;
    setTimeout(() => { if (location.hash === h) iaTarea(id); }, 2500);
    return;
  }
  // pinta el resultado con un fundido corto (sin animación si el sistema pide reducir movimiento)
  const pintar = (html) => {
    delete zona.dataset.espera;
    zona.innerHTML = html;
    zona.classList.remove('aparece');
    void zona.offsetWidth;
    zona.classList.add('aparece');
  };
  if (tr.estado === 'error') {
    pintar(`${cabIA(t('No ha salido'), tr.error || t('Error desconocido'))}
      ${foto ? `<div class="caja bloque-caja">${foto}</div>` : ''}
      <div class="acciones"><a class="btn prim" href="${tr.clase === 'revisar' ? fichaRevision(tr) : tr.clase === 'detectar' ? '#/ia/varias' : '#/ia'}">${t('Probar otra vez')}</a>
        <button class="btn peligro" id="ia-descartar" data-id="${tr.id}">${t('Descartar')}</button></div>`);
    return;
  }
  if (tr.estado !== 'propuesta') {
    const enlace = tr.clase === 'revisar' ? `<a class="btn" href="${volverRevision(tr)}">${textoVolver(tr)}</a>`
      : tr.clase === 'detectar' && tr.propuesta?.lote ? `<a class="btn" href="#/ia/lote/${esc(tr.propuesta.lote)}">${t('Ver las piezas de la foto')}</a>`
      : tr.componente_id ? `<a class="btn" href="#/c/${tr.componente_id}">${t('Ver la pieza')}</a>` : '';
    pintar(`${cabIA(t(ESTADO_IA[tr.estado]))}${enlace ? `<div class="acciones">${enlace}</div>` : ''}`);
    return;
  }
  if (tr.clase === 'revisar') { pintar(vistaCambios(tr)); return; }
  if (tr.clase === 'detectar') { pintar(vistaDeteccion(tr)); pintarDeteccion(); return; }
  const p = tr.propuesta, n = p.tipo_nuevo || {}, sel = p.tipo_existente || (p.tipo_nuevo ? '__nuevo' : '');
  // como una ficha: la foto grande a la izquierda y, a la derecha, las dudas y el formulario en cajas
  const meta = `<p class="ia-meta">${etqConfianza(p.confianza)}<span>${esc(nombreModelo(tr.modelo))}</span>${costeTexto(p.coste) ? `<span>${esc(costeTexto(p.coste))}</span>` : ''}${tr.rondas ? `<span>${t('Vuelta {n}', {n: tr.rondas + 1})}</span>` : ''}</p>`;
  const tira = tiraFotos(tr);
  pintar(`${cabIA(t('Revisa la propuesta'), t('Corrige lo que haga falta, mira cómo quedará y guarda. Nada se ha guardado todavía.'), meta)}
    <div class="seg ia-pestanas" role="group" aria-label="${esc(t('Vista'))}">
      <button class="on" type="button" data-ia-vista="editar" aria-pressed="true">${t('Editar')}</button>
      <button type="button" data-ia-vista="previa" aria-pressed="false">${t('Vista previa')}</button>
    </div>
    <div id="ia-previa" hidden></div>
    <div class="ia-cuerpo${tr.foto ? '' : ' sin-foto'}" id="ia-editar">
    ${tr.foto ? `<aside class="ia-lado"><figure class="fi-img con-foto"><a class="fi-img-marco" href="fotos/${encodeURIComponent(tr.foto)}" target="_blank" rel="noopener" aria-label="${esc(t('Ver la foto grande'))}"><img src="fotos/${encodeURIComponent(tr.foto)}" alt=""></a>
      ${tira ? `<figcaption>${tira}</figcaption>` : ''}</figure></aside>` : ''}
    <div class="ia-principal">
    ${dudasIA(tr, p)}
    <form id="form-ia-ok" class="form caja" autocomplete="off" data-id="${tr.id}" data-foto="${tr.foto ? `fotos/${encodeURIComponent(tr.foto)}` : ''}">
      <label>${t('Nombre')}<input name="nombre" required maxlength="200" value="${esc(p.nombre)}"></label>
      <div class="campo"><span class="campo-t">${t('Tipo')}</span>${selectorTipo(sel, p.tipo_nuevo ? t('Nuevo: {n} (propuesto por la IA)', {n: p.tipo_nuevo.nombre}) : t('Nuevo tipo…'))}</div>
      <div id="nuevo-tipo" class="nuevo-tipo" ${sel === '__nuevo' ? '' : 'hidden'}>
        <p class="nota nota-ia">${t('Ficha nueva escrita por la IA: quedará marcada como «sin comprobar».')}</p>
        <label>${t('Nombre del tipo')}<input name="tn_nombre" maxlength="120" value="${esc(n.nombre || '')}"></label>
        <label>${t('Categoría')}<select name="tn_categoria">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k === (n.categoria || 'otro') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>${t('Resumen')}<textarea name="tn_resumen" rows="2" maxlength="400">${esc(n.resumen || '')}</textarea></label>
        <label>${t('Tensión')}<input name="tn_voltaje" maxlength="120" value="${esc(n.voltaje || '')}"></label>
        <label>${t('Interfaces (separadas por comas)')}<input name="tn_interfaz" value="${esc(list(n.interfaz).join(', '))}"></label>
        <label>${t('Otros nombres (separados por comas)')}<input name="tn_alias" value="${esc(list(n.alias).join(', '))}"></label>
        ${editorFilas('pines', n.pines, {campo: 'tn_pines', etiqueta: t('Pines'), boton: t('Añadir pin'), ayuda: t('Un pin por fila, en el orden de la placa. La función da el color del pin; en la nota, lo que haya que saber de ese pin. Si escribes varios en una fila, se separan solos.')})}
        ${editorFilas('datos', n.datos, {campo: 'tn_datos', etiqueta: t('Datos del tipo'), boton: t('Añadir dato'), ayuda: t('Iguales para todas las piezas de este tipo.')})}
        <label>${t('Ojo (advertencia)')}<textarea name="tn_ojo" rows="2" maxlength="400">${esc(n.ojo || '')}</textarea></label>
      </div>
      ${editorFilas('datos', p.datos_pieza, {campo: 'datos_pieza', etiqueta: t('Datos de esta pieza'), boton: t('Añadir dato')})}
      <div class="dos">
        <label>${t('Cantidad')}<input name="cantidad" type="number" min="0" inputmode="numeric" value="${esc(p.cantidad ?? 1)}"></label>
        <label class="check"><input type="checkbox" name="varios"> ${t('Hay muchos (sin contar)')}</label>
      </div>
      <label>${t('Sitio')}<input name="ubicacion" list="ubics" maxlength="120" placeholder="${esc(t('Cajita 3'))}"></label>
      <datalist id="ubics">${ubicaciones().map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
      <label>${t('Notas')}<textarea name="notas" rows="2" maxlength="2000"></textarea></label>
      <div class="acciones">
        <button class="btn prim" type="submit">${t('Guardar pieza')}</button>
        <button class="btn peligro" type="button" id="ia-descartar" data-id="${tr.id}"${tr.lote ? ` data-volver="#/ia/lote/${esc(tr.lote)}"` : ''}>${t('Descartar')}</button>
      </div>
    </form></div></div>`);
}

async function enviarIA(form) {
  const fd = new FormData(form);
  const [file, ...otras] = fotosDelCampo(form.querySelector('.archivo-input'));
  let foto = null;
  if (file) { // la primera es la que se queda la pieza: se encuadra como siempre
    const blob = await encuadrar(file);
    if (!blob) throw new Error(t('Foto cancelada: no se ha enviado nada'));
    foto = await base64(blob);
  }
  toast(otras.length ? t('Enviando {n} fotos…', {n: otras.length + 1}) : t('Enviando…'));
  const fotos = await Promise.all(otras.map(reducida));
  const tr = await api('POST', 'api/ia/alta', {texto: fd.get('texto'), foto, fotos, modelo: fd.get('modelo') || undefined});
  location.hash = `#/ia/${tr.id}`;
}

// lo que hay ahora mismo en el formulario de la propuesta (sirve para guardar, para la vista previa y para repensar)
function leerFormIA(form) {
  const fd = new FormData(form);
  const varios = !!fd.get('varios');
  const body = {
    nombre: fd.get('nombre'), tipo: fd.get('tipo') || null, varios, cantidad: varios ? null : fd.get('cantidad'),
    ubicacion: fd.get('ubicacion'), notas: fd.get('notas'), datos_pieza: leerEditor(form, 'datos_pieza'),
  };
  if (body.tipo === '__nuevo') body.tipo_nuevo = {
    nombre: fd.get('tn_nombre'), categoria: fd.get('tn_categoria'), resumen: fd.get('tn_resumen'), voltaje: fd.get('tn_voltaje'),
    interfaz: comas(fd.get('tn_interfaz')), alias: comas(fd.get('tn_alias')), ojo: fd.get('tn_ojo'),
    datos: leerEditor(form, 'tn_datos'), pines: leerEditor(form, 'tn_pines'),
  };
  return body;
}

// las otras fotos que ha mirado el modelo (las de más al empezar y las de las respuestas), en pequeño
function tiraFotos(tr, todas = false) {
  const fs = (tr.fotos || []).filter((f) => todas || f !== tr.foto);
  if (!fs.length || (todas && fs.length < 2)) return '';
  return `<div class="ia-tira${todas ? ' pad' : ''}">${todas ? '' : `<span class="ayuda">${t('También ha mirado:')}</span>`}${fs.map((f) =>
    `<a href="fotos/${encodeURIComponent(f)}" target="_blank" rel="noopener"><img src="fotos/${encodeURIComponent(f)}" alt="" loading="lazy"></a>`).join('')}</div>`;
}
// cabecera de las pantallas de la IA (fuera de caja, como la de una ficha) y la confianza como etiqueta
const cabIA = (titulo, texto = '', extra = '') => `<header class="ia-cab"><h1>${titulo}</h1>${texto ? `<p>${esc(texto)}</p>` : ''}${extra}</header>`;
const etqConfianza = (c) => `<span class="ams-etiqueta ${c === 'alta' ? 'ams-etiqueta--ok' : c === 'media' ? 'ams-etiqueta--amarilla' : 'ams-etiqueta--mal'}">${t('Confianza {c}', {c: esc(t(c || '?'))})}</span>`;
const costeTexto = (c) => {
  if (!c || c.dolares == null) return '';
  const sep = I18N.lang() === 'en' ? '.' : ',';
  return `≈ ${c.dolares < 0.0001 ? `<0${sep}0001` : c.dolares.toFixed(4).replace('.', sep)} $`;
};

// dudas del modelo, cada una con su hueco para contestar y, si el modelo ve fotos, su foto («¿qué pone en la
// serigrafía?» → la foto de la serigrafía). Debajo, lo que quieras añadir y más fotos sueltas. «Responder y repensar»
// le manda todo junto con lo que hayas corregido en el formulario, y el modelo rehace la propuesta (como mucho 5 vueltas)
function dudasIA(tr, p) {
  const quedan = (tr.rondas || 0) < 5, correccion = tr.clase === 'revisar';
  const m = modeloIA(tr.modelo_pedido || tr.modelo), usadas = tr.fotos?.length || 0, libres = Math.min(4, 8 - usadas);
  const puedeFotos = quedan && (!m || m.vision) && libres > 0;
  // lo que no es una pregunta (avisos de la app: «se han corregido solos algunos campos») no lleva hueco para contestar
  const avisos = (p.dudas || []).filter((d) => !d.includes('?'));
  p = {...p, dudas: (p.dudas || []).filter((d) => d.includes('?'))};
  // las respuestas que propone el modelo para cada duda (propuesta.opciones[pregunta]): se eligen con un toque
  const ops = (d) => list(p.opciones?.[d]);
  return `<section class="ia-dudas pad" id="ia-dudas" data-libres="${puedeFotos ? libres : 0}">
    <h3>${p.dudas?.length ? (p.dudas.length === 1 ? t('La IA tiene una duda') : t('La IA tiene {n} dudas', {n: p.dudas.length})) : t('¿Algo que aclarar?')}</h3>
    ${avisos.map((d) => `<p class="ia-aviso">${esc(d)}</p>`).join('')}
    ${p.dudas?.length ? `<ol class="ia-preguntas">${p.dudas.map((d, i) => `<li><p>${esc(d)}</p>
      ${ops(d).length ? `<div class="ia-ops" role="group" aria-label="${esc(t('Respuestas propuestas a la duda {n}', {n: i + 1}))}">${ops(d).map((o) =>
        `<button class="ia-op" type="button" data-op="${esc(o)}" aria-pressed="false">${esc(o)}</button>`).join('')}</div>` : ''}
      <div class="ia-resp-fila"><input class="ia-resp" data-duda="${esc(d)}" maxlength="500" placeholder="${esc(ops(d).length ? t('Elige una o escribe otra respuesta') : t('Tu respuesta'))}" autocomplete="off" aria-label="${esc(t('Respuesta a la duda {n}', {n: i + 1}))}">
        ${puedeFotos ? campoFoto('', '', {compacto: true}) : ''}</div></li>`).join('')}</ol>` : ''}
    <label class="ia-extra">${p.dudas?.length ? t('Algo más (opcional)') : correccion ? t('Qué más tiene que corregir o saber') : t('Qué más tiene que saber')}
      <textarea id="ia-extra" rows="2" maxlength="1000" placeholder="${esc(correccion ? t('Tiene 16 MB de flash · Añade el consumo') : t('Tiene 3 pines · Es la versión en placa'))}"></textarea></label>
    ${puedeFotos ? campoFoto(p.dudas?.length ? t('Más fotos (opcional)') : t('Fotos (opcional)'), t('La serigrafía de cerca, la otra cara… Hasta {libres} en esta vuelta{contando}{usadas}.', {
      libres, contando: p.dudas?.length ? t(', contando las de las respuestas') : '', usadas: usadas ? t(' (la consulta lleva {usadas} de 8)', {usadas}) : '',
    }), {varias: libres}) : ''}
    <div class="acciones">${quedan
      ? `<button class="btn prim" type="button" id="ia-responder" data-id="${tr.id}">${t('Responder y repensar')}</button>
         <span class="ayuda">${correccion ? t('La IA vuelve a mirar la ficha con tus respuestas y rehace los cambios. Gasta otra consulta.') : t('Rehace la propuesta con tus respuestas y con lo que hayas corregido abajo. Gasta otra consulta.')}</span>`
      : `<span class="ayuda">${t('Ya van 5 vueltas: {msg}.', {msg: correccion ? t('aplica lo que te sirva y corrige a mano el resto') : t('corrige a mano lo que falte y guarda')})}</span>`}</div>
  </section>`;
}

// vista previa: la ficha tal como se verá en el inventario, con la misma disposición AMSTech que la ficha real (.fi)
function vistaPreviaIA(b, urlFoto) {
  const nuevo = b.tipo === '__nuevo';
  const tipoId = !nuevo && b.tipo && D.tipos[b.tipo] ? b.tipo : '';
  const f = nuevo ? {...b.tipo_nuevo, revisado: 0} : tipoId ? g(tipoId) : null;
  const cat = f ? (f.categoria || 'otro') : 'otro';
  const ps = tipoId ? proyectosDe(tipoId) : [];
  const ft = f ? fichaDelTipo(f, tipoId, ps, nuevo ? t('Ficha nueva propuesta por la IA (quedará sin comprobar)') : t('Común a todas las piezas de este tipo')) : {der: '', izq: ''};
  const datos = list(b.datos_pieza).length ? b.datos_pieza.map(([k, v]) => [esc(k), esc(v)]) : [[t('Datos propios'), '—']];
  const cant = b.varios ? `<span class="muchos">${t('muchos')}</span>` : `<span class="num">${esc(b.cantidad === '' || b.cantidad == null ? '?' : b.cantidad)}</span>`;
  const esta = `<section class="caja fi-esta"><div class="fi-esta-cab"><h2 class="rotulo">${t('Esta pieza')}</h2></div>
    ${cajetin([[t('Cantidad'), cant], [t('Sitio'), esc(b.ubicacion || t('Sin sitio'))],
      [t('Tipo'), f ? `${esc(f.nombre)}${nuevo ? ` <span class="etq-pend">${t('nuevo')}</span>` : ''}` : t('Sin tipo'), true],
      [t('Categoría'), etqCat(cat)], ...datos])}
    ${b.notas ? `<div class="fi-notas"><h3 class="rotulo">${t('Notas')}</h3><p class="notas">${esc(b.notas)}</p></div>` : ''}</section>`;
  return `<div class="caja previa-barra"><span class="ams-etiqueta ams-etiqueta--amarilla">${t('Vista previa')}</span>
      <p>${t('Así quedará{extra}. Aún no se ha guardado nada.', {extra: nuevo ? t(' la pieza, y el tipo nuevo «{n}» en el glosario', {n: esc(f.nombre)}) : t(' la pieza')})}</p>
      <button class="btn mini" type="button" data-ia-vista="editar">${t('Volver a editar')}</button></div>
    <article class="fi">
      <div class="fi-izq">
        ${imagenGrande({foto: urlFoto, tipo: tipoId, cat, pie: `<span>${urlFoto ? t('Foto de la pieza') : tipoId ? t('Dibujo del tipo · aún sin foto') : t('Aún sin foto')}</span>`})}
        ${esta}
        ${ft.izq}
      </div>
      <div class="fi-der">
        <header class="fi-cab">${etqCat(cat, 'etq-cat')}<h1>${esc(b.nombre || t('(sin nombre)'))}</h1>
          ${f?.resumen ? `<p class="fi-resumen">${esc(f.resumen)}</p>` : ''}</header>
        ${f ? notaOjo(f) : ''}
        ${nuevo || f?.revisado === 0 ? avisoIA('') : ''}
        ${f ? ft.der : `<p class="gris">${t('Sin tipo: no se verán pines ni ficha técnica.')}</p>`}
      </div>
    </article>
    <div class="acciones"><button class="btn prim" type="button" id="ia-guardar-previa">${t('Guardar pieza')}</button>
      <button class="btn" type="button" data-ia-vista="editar">${t('Volver a editar')}</button></div>`;
}

function verVistaIA(vista) {
  const form = $('#form-ia-ok'), previa = $('#ia-previa'), editar = $('#ia-editar');
  if (!form || !previa) return;
  const ver = vista === 'previa';
  if (ver) previa.innerHTML = vistaPreviaIA(leerFormIA(form), form.dataset.foto);
  previa.hidden = !ver;
  if (editar) editar.hidden = ver;
  document.querySelectorAll('.ia-pestanas [data-ia-vista]').forEach((b) => {
    const on = b.dataset.iaVista === vista;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

async function responderIA(boton) {
  const zona = $('#ia-dudas');
  // cada duda con su respuesta y su foto (una foto sola ya es una respuesta)
  const dudas = [...zona.querySelectorAll('.ia-preguntas li')].map((li) => ({duda: li.querySelector('.ia-resp').dataset.duda,
    respuesta: li.querySelector('.ia-resp').value.trim(), archivos: fotosDelCampo(li.querySelector('.archivo-input'))})).filter((r) => r.respuesta || r.archivos.length);
  const extra = ($('#ia-extra')?.value || '').trim();
  const sueltas = fotosDelCampo([...zona.querySelectorAll('.archivo-input')].find((i) => !i.closest('.ia-preguntas')));
  const nFotos = sueltas.length + dudas.reduce((n, r) => n + r.archivos.length, 0), libres = Number(zona.dataset.libres) || 0;
  if (!dudas.length && !extra && !nFotos) throw new Error(t('Contesta alguna duda, escribe algo más o añade una foto antes de repensar'));
  if (nFotos > libres) throw new Error(t('En esta vuelta caben {libres} fotos y has puesto {n}: quita {sobre}', {libres, n: nFotos, sobre: nFotos - libres}));
  boton.disabled = true;
  toast(nFotos ? t('Repensando con tus respuestas y {fotos}…', {fotos: nFotos === 1 ? t('la foto') : `${nFotos} ${t('fotos')}`}) : t('Repensando con tus respuestas…'));
  const respuestas = await Promise.all(dudas.map(async (r) => ({duda: r.duda, respuesta: r.respuesta, fotos: await Promise.all(r.archivos.map(reducida))})));
  const fotos = await Promise.all(sueltas.map(reducida));
  const form = $('#form-ia-ok'); // solo en un alta: lo que el usuario ya ha corregido de la propuesta
  await api('POST', `api/ia/tareas/${boton.dataset.id}/responder`, {respuestas, extra, fotos, ...(form ? {propuesta: leerFormIA(form)} : {})});
  iaTarea(boton.dataset.id); // vuelve a «Analizando…» y se actualiza sola
}

async function aplicarIA(form) {
  const body = leerFormIA(form);
  const r = await api('POST', `api/ia/tareas/${form.dataset.id}/aplicar`, body);
  await cargar(); // trae la pieza, la ficha nueva (si la hay) y los contadores
  contadores();
  toast(t('Guardada'));
  location.hash = LOTE.id && ui.origenTarea?.desde === `#/ia/lote/${LOTE.id}` ? ui.origenTarea.desde : `#/c/${r.componente.id}`;
}

// ---------- Ajustes (fase B): IA, categorías, tipos, sitios, datos y tema ----------
const plural = (n, uno) => I18N.plural(n, uno);

// ---------- cambios pendientes: correcciones y altas a medias (para no perder un lote al salir de su pantalla) ----------
// fecha del servidor (UTC «AAAA-MM-DD HH:MM:SS») → «hace 5 min», «hoy 14:32», «ayer 09:10», «3 nov 14:32»
function cuando(s) {
  const ts = fechaSql(s);
  if (!ts) return '';
  const d = new Date(ts), seg = (Date.now() - ts) / 1000;
  if (seg < 60) return t('ahora');
  if (seg < 3600) return t('hace {n} min', {n: Math.floor(seg / 60)});
  const hora = d.toLocaleTimeString(I18N.loc(), {hour: '2-digit', minute: '2-digit'});
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (d >= hoy) return t('hoy {hora}', {hora});
  if (d >= hoy - 864e5) return t('ayer {hora}', {hora});
  return `${d.toLocaleDateString(I18N.loc(), {day: 'numeric', month: 'short', ...(d.getFullYear() !== hoy.getFullYear() ? {year: 'numeric'} : {})})} ${hora}`;
}
// el nombre bonito de los modelos («Claude Haiku 5.5») necesita el catálogo: si aún no está, se pide y se vuelve a pintar
const conModelos = (fn) => { if (!MODELOS_IA && D.ia?.activa) modelosIA().then(fn).catch(() => {}); };
const fechaCompleta = (s) => (fechaSql(s) ? new Date(fechaSql(s)).toLocaleString(I18N.loc(), {dateStyle: 'full', timeStyle: 'medium'}) : '');

function vPendientes() {
  return `${migas([`<a href="#/">${t('Inventario')}</a>`, `<span>${t('Cambios pendientes')}</span>`])}<div class="plano" id="pend-zona"><p class="gris">${t('Cargando…')}</p></div>`;
}
const estadosLote = (e) => [e.propuesta ? plural(e.propuesta, 'lista') : '', e.pendiente ? t('{n} preparándose', {n: e.pendiente}) : '',
  e.error ? `<span class="mal">${t('{n} con error', {n: e.error})}</span>` : ''].filter(Boolean).join(' · ');
function estadoTarea(tr) {
  if (tr.estado === 'error') return `<span class="ams-etiqueta ams-etiqueta--mal">${t('Error')}</span>`;
  if (tr.estado === 'pendiente') return `<span class="ams-etiqueta ams-etiqueta--amarilla">${t('Preparándose…')}</span>`;
  if (tr.clase === 'detectar') return `<span class="ams-etiqueta">${t('{piezas} por elegir', {piezas: plural(tr.propuesta?.piezas?.length || 0, 'pieza')})}</span>`;
  if (tr.clase !== 'revisar') return `<span class="ams-etiqueta ams-etiqueta--ok">${t('Lista para revisar')}</span>`;
  const n = tr.propuesta?.cambios?.length || 0;
  return `<span class="ams-etiqueta">${n ? plural(n, 'cambio') : t('Nada que cambiar')}</span>`;
}
function filaPendiente(tr) {
  const nombre = nombreTareaIA(tr);
  const modelo = nombreModelo(tr.modelo || tr.modelo_pedido || D.ia?.modelo);
  return `<div class="fila"><a class="fila-main" href="#/ia/${tr.id}">${tr.foto ? `<span class="fila-img"><img src="fotos/${encodeURIComponent(tr.foto)}" alt="" loading="lazy"></span>` : ''}
      <div><div class="nombre">${esc(nombre)}</div><div class="sub">${esc(cuando(tr.creada))}${modelo ? ` · ${esc(modelo)}` : ''}${tr.texto && tr.clase === 'revisar' ? ` · «${esc(tr.texto)}»` : ''}</div></div></a>
    <div class="der">${estadoTarea(tr)}${tr.estado !== 'pendiente' ? `<button class="btn mini" type="button" data-pend-descartar="tarea:${tr.id}">${t('Descartar')}</button>` : ''}</div></div>`;
}
function filaLotePendiente(l) {
  const mas = l.piezas.length > 4 ? t(' y {n} más', {n: l.piezas.length - 4}) : '';
  const abiertas = (l.estados.propuesta || 0) + (l.estados.error || 0);
  return `<div class="fila"><a class="fila-main" href="#/ia/lote/${esc(l.lote)}">
      <div><div class="nombre">${l.clase === 'alta' ? t('{piezas} de una foto', {piezas: piezasTxt(l.total)}) : t('Correcciones de {piezas} a la vez', {piezas: piezasTxt(l.total)})}</div>
        <div class="sub">${esc(l.piezas.slice(0, 4).join(', '))}${mas}${l.texto ? ` · «${esc(l.texto)}»` : ''}</div>
        <div class="sub">${esc(cuando(l.creada))}${l.cambios ? ` · ${t('{cambios} por mirar', {cambios: plural(l.cambios, 'cambio')})}` : ''}</div></div></a>
    <div class="der"><span class="ams-etiqueta">${estadosLote(l.estados)}</span>${abiertas ? `<button class="btn mini" type="button" data-pend-descartar="lote:${esc(l.lote)}">${t('Descartar')}</button>` : ''}</div></div>`;
}
async function cargarPendientes() {
  const zona = $('#pend-zona');
  if (!zona) return;
  let p;
  try { p = await api('GET', 'api/ia/pendientes'); } catch (err) { zona.innerHTML = `<p class="mal">${esc(err.message)}</p>`; return; }
  const revisar = p.tareas.filter((tr) => tr.clase === 'revisar'), altas = p.tareas.filter((tr) => tr.clase !== 'revisar');
  const grupo = (titulo, filas) => (filas.length ? `<section class="grupo"><h3 class="grupo-t">${titulo}<span class="n">${filas.length}</span></h3>${filas.join('')}</section>` : '');
  zona.innerHTML = `${cabIA(t('Cambios pendientes'), t('Correcciones y piezas nuevas que esperan a que las revises, las que aún se están preparando y las que fallaron. Nada se aplica hasta que lo marcas.'))}
    ${p.total ? '' : vacio(t('No hay nada pendiente. Si dejas a medias unas correcciones o una pieza nueva, aparecerán aquí.'))}
    ${grupo(t('Varias piezas a la vez'), p.lotes.map(filaLotePendiente))}
    ${grupo(t('Correcciones'), revisar.map(filaPendiente))}
    ${grupo(t('Piezas nuevas'), altas.map(filaPendiente))}
    <p class="sub">${t('Lo que ya aplicaste o descartaste está en {enlace}.', {enlace: `<a href="#/ajustes/historial?g=ia">${t('Ajustes → Historial')}</a>`})}</p>`;
  if (p.tareas.length) conModelos(() => { if (location.hash === '#/pendientes') cargarPendientes(); });
  const pensando = p.lotes.some((l) => l.estados.pendiente) || p.tareas.some((tr) => tr.estado === 'pendiente');
  if (pensando) setTimeout(() => { if (location.hash === '#/pendientes') cargarPendientes(); }, 4000);
}
async function descartarPendiente(valor) {
  const [clase, id] = valor.split(':');
  let ids = [Number(id)];
  if (clase === 'lote') {
    ids = (await api('GET', `api/ia/lotes/${encodeURIComponent(id)}`)).filter((tr) => tr.estado === 'propuesta' || tr.estado === 'error').map((tr) => tr.id);
    if (!ids.length || !(await confirmar(t('¿Descartar las {n} correcciones que quedan en este lote?\nNo se cambia nada de tus piezas ni de sus fichas.', {n: ids.length}), {si: t('Descartar'), peligro: true}))) return;
  } else if (!(await confirmar(t('¿Descartar este cambio pendiente?\nNo se cambia nada.'), {si: t('Descartar'), peligro: true}))) return;
  for (const tid of ids) await api('POST', `api/ia/tareas/${tid}/descartar`).catch(() => {});
  CUENTA_PEND = null;
  await cargarPendientes();
  await iaAbiertas(); // la lista «Sin terminar» de «Añadir con IA», si es la que está en pantalla
  toast(ids.length === 1 ? t('Descartada') : t('{n} descartadas', {n: ids.length}));
}

// aviso en el Inventario cuando la IA tiene algo sin terminar
let CUENTA_PEND = null;
function pintarAvisoPend() {
  const z = $('#pend-aviso'), c = CUENTA_PEND;
  if (!z || !c) return;
  z.innerHTML = c.tareas ? `<a class="pend-aviso" href="#/pendientes"><span class="nota-t">${t('Cambios pendientes')}</span>
    <span>${c.grupos === 1 ? t('Tienes 1 sin revisar') : t('Tienes {n} sin revisar', {n: c.grupos})}${c.pensando ? ` (${t('{n} aún preparándose', {n: c.pensando})})` : ''}</span><span class="gris">${t('Ver →')}</span></a>` : '';
}
async function avisoPendientes() {
  pintarAvisoPend(); // lo último que se supo, sin esperar
  try { CUENTA_PEND = await api('GET', 'api/ia/pendientes/cuenta'); } catch { return; }
  pintarAvisoPend();
}

// ---------- historial de cambios (Ajustes → Historial, y el de cada pieza o ficha) ----------
const HIST = {grupo: '', q: '', filas: [], mas: false, cargando: false};
const GRUPOS_HIST = {'': 'Todo', piezas: 'Piezas', fichas: 'Fichas', ia: 'IA', catalogo: 'Catálogo', proyectos: 'Proyectos', sistema: 'Copias y ajustes'};
const OBJETO_HIST = {pieza: 'pieza', tipo: 'ficha', categoria: 'categoría', sitio: 'sitio', ia: 'IA', copia: 'copia', ajustes: 'ajuste', proyecto: 'proyecto'};
const quienHist = (r) => (r.quien === 'ia' ? `${t('IA')}${r.modelo ? ` · ${esc(nombreModelo(r.modelo))}` : ''}` : r.quien === 'sistema' ? t('Sistema') : t('Tú'));
function enlaceHist(r) {
  if (!r.nombre) return '';
  if (r.objeto === 'pieza' && comp(r.objeto_id)) return `<a href="#/c/${esc(r.objeto_id)}">${esc(r.nombre)}</a>`;
  if (r.objeto === 'tipo' && D.tipos[r.objeto_id]) return `<a href="#/g/${encodeURIComponent(r.objeto_id)}">${esc(r.nombre)}</a>`;
  if (r.objeto === 'proyecto' && proyecto(r.objeto_id)) return `<a href="#/p/${encodeURIComponent(r.objeto_id)}">${esc(r.nombre)}</a>`;
  return esc(r.nombre);
}
function filaHist(r, conObjeto = true) {
  const d = r.detalle || {}, cambios = d.cambios || [];
  const extra = [
    d.cantidad ? `${t('Tenía: {c}', {c: esc(d.cantidad)})}${d.sitio ? ` · ${t('en {sitio}', {sitio: esc(d.sitio)})}` : ''}${d.tipo ? ` · ${esc(d.tipo)}` : ''}` : '',
    d.antes ? t('El estado anterior se guardó como {nombre}', {nombre: esc(d.antes)}) : '',
    d.lote ? `<a href="#/ia/lote/${esc(d.lote)}">${t('Ver el lote')}</a>` : '',
    d.orden ? t('Orden nuevo: {lista}', {lista: esc(d.orden.join(', '))}) : '',
    d.texto ? `«${esc(d.texto)}»` : '',
  ].filter(Boolean);
  const objeto = conObjeto && r.nombre ? `<span class="hist-obj">${enlaceHist(r)} <span class="gris">· ${t(OBJETO_HIST[r.objeto] || r.objeto)}</span></span>` : '';
  const cab = `<span class="hist-cuando" title="${esc(fechaCompleta(r.fecha))}">${esc(cuando(r.fecha))}</span>
    <span class="hist-quien hist-${r.quien}">${quienHist(r)}</span>
    <span class="hist-que">${objeto}<span class="hist-res">${esc(r.resumen)}</span></span>`;
  if (!cambios.length && !extra.length) return `<div class="hist">${cab}</div>`;
  return `<details class="hist"><summary>${cab}</summary><div class="hist-det">
    ${cambios.map((c) => `<div class="hist-c"><span class="hist-campo">${esc(c.campo)}</span>
      <span class="ia-antes">${esc(c.antes) || `<span class="gris">(${t('vacío')})</span>`}</span><span class="ia-ahora">${esc(c.despues) || `<span class="gris">(${t('vacío')})</span>`}</span></div>`).join('')}
    ${extra.length ? `<p class="sub">${extra.join(' · ')}</p>` : ''}</div></details>`;
}
function ajHistorial() {
  return `${cabIA(t('Historial'), t('Todo lo que ha cambiado, de lo más nuevo a lo más antiguo: lo que haces tú, lo que la IA corrige (con el modelo que usó) y lo que hace el sistema. Toca una línea para ver el antes y el después.'))}
    <div class="filtros hist-filtros">
      <div class="cats">${Object.entries(GRUPOS_HIST).map(([k, v]) => `<button class="f ${HIST.grupo === k ? 'on' : ''}" type="button" data-hist-grupo="${k}">${t(v)}</button>`).join('')}</div>
      <input id="hist-q" class="buscar-mini" type="search" placeholder="${esc(t('Buscar nombre o modelo'))}" value="${esc(HIST.q)}" autocomplete="off" aria-label="${esc(t('Buscar en el historial'))}">
    </div>
    <section class="caja bloque-caja hist-lista" id="hist-lista">${HIST.filas.length ? HIST.filas.map((r) => filaHist(r)).join('') : `<p class="gris">${HIST.cargando ? t('Cargando…') : t('Nada por aquí todavía.')}</p>`}</section>
    ${HIST.mas ? `<div class="acciones"><button class="btn" type="button" id="hist-mas">${t('Cargar más')}</button></div>` : ''}`;
}
async function histCargar(desdeCero) {
  const zona = $('#aj-zona');
  if (!zona || zona.dataset.sec !== 'historial') return;
  if (desdeCero) { HIST.filas = []; HIST.mas = false; }
  HIST.cargando = true;
  if (desdeCero) zona.innerHTML = ajHistorial();
  const qs = new URLSearchParams({limite: '60', ...(HIST.grupo ? {grupo: HIST.grupo} : {}), ...(HIST.q ? {q: HIST.q} : {}),
    ...(HIST.filas.length ? {antes: String(HIST.filas[HIST.filas.length - 1].id)} : {})});
  try {
    const r = await api('GET', `api/auditoria?${qs}`);
    HIST.filas = HIST.filas.concat(r.filas);
    HIST.mas = r.mas;
  } catch (err) { HIST.cargando = false; zona.innerHTML = `<p class="mal pad">${esc(err.message)}</p>`; return; }
  HIST.cargando = false;
  const foco = document.activeElement?.id === 'hist-q' ? document.activeElement.selectionStart : null;
  zona.innerHTML = ajHistorial();
  if (foco != null) { const i = $('#hist-q'); i.focus(); i.setSelectionRange(foco, foco); }
  if (HIST.filas.some((r) => r.modelo)) conModelos(() => { const z = $('#aj-zona'); if (z?.dataset.sec === 'historial') z.innerHTML = ajHistorial(); });
}
let HIST_ESPERA = null;
// historial de una pieza o de una ficha: se carga al abrir el desplegable
const plegableHist = (objeto, id, tipo = '') => `<details class="plegable" data-historial="${objeto}:${esc(id)}" data-tipo="${esc(tipo || '')}"><summary>${t('Historial')}</summary>
  <div class="plegable-cuerpo"><p class="gris">${t('Cargando…')}</p></div></details>`;
async function cargarHistDe(det) {
  const [objeto, ...resto] = det.dataset.historial.split(':'), id = resto.join(':');
  const cuerpo = det.querySelector('.plegable-cuerpo');
  try {
    const tipo = det.dataset.tipo || '';
    const r = await api('GET', `api/auditoria?${new URLSearchParams({objeto, id, limite: '100', ...(tipo ? {tipo} : {})})}`);
    cuerpo.innerHTML = r.filas.length ? `${tipo ? `<p class="sub">${t('Los cambios de la pieza y los de la ficha de su tipo (marcados «ficha»).')}</p>` : ''}
      <div class="hist-lista">${r.filas.map((x) => filaHist(x, x.objeto !== objeto)).join('')}</div>
      ${r.mas ? `<p class="sub">${t('Solo los 100 últimos. {enlace}', {enlace: `<a href="#/ajustes/historial">${t('Todo el historial')}</a>`})}</p>` : ''}` : `<p class="gris">${t('Sin cambios apuntados todavía.')}</p>`;
    if (r.filas.some((x) => x.modelo)) conModelos(() => cargarHistDe(det));
  } catch (err) { cuerpo.innerHTML = `<p class="mal">${esc(err.message)}</p>`; }
}

// ---------- registro del servidor (Ajustes → Registro) ----------
const REG = {nivel: 'todo', q: '', datos: null};
const NIVELES_REG = {todo: 'Todo', avisos: 'Avisos y errores', errores: 'Solo errores'};
function ajRegistro() {
  const d = REG.datos;
  const linea = (l) => `<div class="reg-l reg-${l.nivel}"><span class="reg-h" title="${esc(new Date(l.fecha).toLocaleString(I18N.loc()))}">${esc(new Date(l.fecha).toLocaleTimeString(I18N.loc()))}</span><span class="reg-t">${esc(l.texto)}</span></div>`;
  return `${cabIA(t('Registro del servidor'), t('Los últimos mensajes del servidor: arranque, copias, lo que hace la IA, cada cambio que llega y los errores. Se guardan en memoria y se borran al reiniciar.'))}
    <div class="filtros hist-filtros">
      <div class="cats">${Object.entries(NIVELES_REG).map(([k, v]) => `<button class="f ${REG.nivel === k ? 'on' : ''}" type="button" data-reg-nivel="${k}">${t(v)}</button>`).join('')}</div>
      <input id="reg-q" class="buscar-mini" type="search" placeholder="${esc(t('Buscar en el registro'))}" value="${esc(REG.q)}" autocomplete="off" aria-label="${esc(t('Buscar en el registro'))}">
      <button class="btn mini" type="button" id="reg-copiar">${t('Copiar')}</button>
    </div>
    ${d ? `<p class="sub">${t('Arrancó {fecha} · {n} mensajes guardados (como mucho {max}) · se actualiza solo', {fecha: esc(new Date(d.arranque).toLocaleString(I18N.loc(), {dateStyle: 'medium', timeStyle: 'short'})), n: d.guardadas, max: d.maximo})}</p>
      <div class="ams-terminal registro" id="reg-lista">${d.lineas.length ? d.lineas.map(linea).join('') : `<p class="ams-gris">${t('Nada que coincida.')}</p>`}</div>` : `<p class="gris">${t('Cargando…')}</p>`}`;
}
async function regCargar() {
  const zona = $('#aj-zona');
  if (!zona || zona.dataset.sec !== 'registro') return;
  const h = location.hash;
  try {
    const nuevo = await api('GET', `api/registro?${new URLSearchParams({nivel: REG.nivel, q: REG.q})}`);
    const cambia = !REG.datos || nuevo.ultimo !== REG.datos.ultimo || nuevo.lineas.length !== REG.datos.lineas.length || !$('#reg-lista');
    REG.datos = nuevo;
    if (cambia) {
      const foco = document.activeElement?.id === 'reg-q' ? document.activeElement.selectionStart : null;
      zona.innerHTML = ajRegistro();
      if (foco != null) { const i = $('#reg-q'); i.focus(); i.setSelectionRange(foco, foco); }
    }
  } catch (err) { zona.innerHTML = `<p class="mal pad">${esc(err.message)}</p>`; return; }
  clearTimeout(regCargar.t);
  regCargar.t = setTimeout(() => { if (location.hash === h) regCargar(); }, 5000);
}

const SECCIONES = {ia: 'IA', categorias: 'Categorías', tipos: 'Tipos', sitios: 'Sitios', formato: 'Uniformar formato', datos: 'Datos y copias', historial: 'Historial', registro: 'Registro'};

function vAjustes(sec) {
  if (sec && SECCIONES[sec]) {
    const id = sec === 'ia' ? 'ia-ajustes' : 'aj-zona';
    return `${migas([`<a href="#/ajustes">${t('Ajustes')}</a>`, `<span>${esc(t(SECCIONES[sec]))}</span>`])}<div class="plano" id="${id}" data-sec="${sec}"><p class="gris">${t('Cargando…')}</p></div>`;
  }
  const tipos = Object.values(D.tipos), archivados = tipos.filter((tp) => tp.archivado).length;
  const fila = (href, nombre, sub) => `<div class="fila"><a class="fila-main" href="${href}"><div><div class="nombre">${nombre}</div>
    <div class="sub">${sub}</div></div></a><span class="gris">→</span></div>`;
  const grupo = (titulo, filas) => `<section class="grupo"><h3 class="grupo-t">${titulo}</h3>${filas.join('')}</section>`;
  const pend = CUENTA_PEND?.grupos ? `<span class="etq-pend">${t('{n} sin revisar', {n: CUENTA_PEND.grupos})}</span> ` : '';
  const razNom = t((RAZONAR[D.ajustes.ia_razonar] || RAZONAR.poco).nombre).toLowerCase();
  const archTxt = archivados ? ` · ${plural(archivados, 'archivado')}` : '';
  return `<div class="plano aj-menu">
      ${cabIA(t('Ajustes'), t('Lo que cambies aquí se ve al momento en el inventario y el glosario.'))}
      ${grupo(t('IA'), [
        fila('#/ajustes/ia', t('Modelo y clave'), D.ia?.activa ? `${t('Conectada')} · ${esc(nombreModelo(D.ia.modelo))} · ${t('razona {nivel}', {nivel: esc(razNom)})} · ${t('clave')} ${esc(D.ia.clave)}` : `<span class="mal">${t('Sin clave')}</span>`),
        fila('#/pendientes', t('Cambios pendientes'), `${pend}${t('correcciones y piezas nuevas que dejaste a medias')}`)])}
      ${grupo(t('Catálogo'), [
        fila('#/ajustes/categorias', t('Categorías'), `${plural(D.categorias.length, 'categoría')} · ${t('renombrar, ordenar, añadir, borrar')}`),
        fila('#/ajustes/tipos', t('Tipos'), `${plural(tipos.length - archivados, 'tipo')}${archTxt} · ${t('archivar, fusionar, borrar')}`),
        fila('#/ajustes/sitios', t('Sitios'), `${plural(ubicaciones().length, 'sitio')} · ${t('renombrar, juntar, borrar')}`),
        fila('#/ajustes/formato', t('Uniformar formato'), t('Que todo esté escrito igual: «3,3 V», «I2C», «Corriente máx.»'))])}
      ${grupo(t('Aspecto'), [
        `<div class="fila"><div class="fila-main"><div><div class="nombre">${t('Tema')}</div><div class="sub">${t('Claro de día, grafito de noche o según el sistema')}</div></div></div>
          <div class="seg" role="group" aria-label="${esc(t('Tema'))}">${Object.entries({auto: 'Automático', claro: 'Claro', noche: 'Noche'}).map(([k, v]) =>
            `<button type="button" class="${(D.ajustes.tema || 'auto') === k ? 'on' : ''}" data-poner-tema="${k}" aria-pressed="${(D.ajustes.tema || 'auto') === k}">${t(v)}</button>`).join('')}</div></div>`,
        `<div class="fila"><div class="fila-main"><div><div class="nombre">${t('Idioma')}</div><div class="sub">${t('Interfaz y respuestas de la IA')}</div></div></div>
          <div class="seg" role="group" aria-label="${esc(t('Idioma'))}">${Object.entries({en: 'English', es: 'Español'}).map(([k, v]) =>
            `<button type="button" class="${(D.ajustes.idioma || 'en') === k ? 'on' : ''}" data-poner-idioma="${k}" aria-pressed="${(D.ajustes.idioma || 'en') === k}">${v}</button>`).join('')}</div></div>`])}
      ${grupo(t('Datos y actividad'), [
        fila('#/ajustes/datos', t('Copias de seguridad'), t('Hacer una copia, descargarla, restaurar y exportar')),
        fila('#/ajustes/historial', t('Historial'), t('Quién cambió qué y cuándo: tú, la IA (con su modelo) o el sistema')),
        fila('#/ajustes/registro', t('Registro'), t('Mensajes del servidor: arranque, copias, IA y errores'))])}
    </div>`;
}

// carga y pinta el apartado abierto (los datos vienen siempre del servidor: lo que se ve es lo que hay)
async function ajCargar() {
  const zona = $('#aj-zona');
  if (!zona) return;
  const sec = zona.dataset.sec;
  try {
    if (sec === 'categorias') zona.innerHTML = ajCategorias(await api('GET', 'api/categorias'));
    if (sec === 'tipos') zona.innerHTML = ajTipos(await api('GET', 'api/tipos'));
    if (sec === 'sitios') zona.innerHTML = ajSitios(await api('GET', 'api/ubicaciones'));
    if (sec === 'formato') { zona.innerHTML = ajFormato(await api('GET', 'api/ajustes/formato')); contarFormato(); }
    if (sec === 'datos') zona.innerHTML = ajDatos(await api('GET', 'api/ajustes/resumen'));
    if (sec === 'historial') await histCargar(true);
    if (sec === 'registro') { zona.innerHTML = ajRegistro(); await regCargar(); }
  } catch (err) { zona.innerHTML = `<p class="mal pad">${esc(err.message)}</p>`; }
}
// tras un cambio en el catálogo: recarga los datos de toda la app y el apartado
async function ajRefrescar(msg) {
  await cargar();
  contadores();
  await ajCargar();
  if (msg) toast(msg);
}

function ajCategorias(cats) {
  return `${cabIA(t('Categorías'), t('Cámbiales el nombre escribiendo encima, ordénalas con las flechas o bórralas. «Otros» no se borra: es donde va lo que no tiene sitio.'))}
    <section class="caja bloque-caja"><div class="aj-lista">${cats.map((c, i) => `
      <div class="aj-fila aj-cat" data-cat-fila="${esc(c.id)}"${conColor(c.id)}>
        <span class="aj-cat-nom">${marcaCat}<input class="aj-nombre" data-cat-nombre="${esc(c.id)}" value="${esc(c.nombre)}" maxlength="60" aria-label="${esc(t('Nombre de la categoría'))}"></span>
        <span class="sub">${plural(c.tipos, 'tipo')}</span>
        <span class="aj-botones">
          <button class="btn mini" data-cat-mover="${esc(c.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('Subir {nombre}', {nombre: c.nombre}))}">↑</button>
          <button class="btn mini" data-cat-mover="${esc(c.id)}" data-dir="1" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="${esc(t('Bajar {nombre}', {nombre: c.nombre}))}">↓</button>
          <button class="btn mini peligro" data-cat-borrar="${esc(c.id)}" data-tipos="${c.tipos}" ${c.id === 'otro' ? `disabled title="${esc(t('Es la categoría de reserva'))}"` : ''}>${t('Borrar')}</button>
        </span>
        <div class="aj-panel" hidden></div>
      </div>`).join('')}</div></section>
    <form id="aj-cat-nueva" class="form caja" autocomplete="off">
      <label>${t('Nueva categoría')}<input name="nombre" maxlength="60" required placeholder="${esc(t('Relés y potencia'))}"></label>
      <div class="acciones"><button class="btn prim" type="submit">${t('Añadir')}</button></div>
    </form>`;
}

const ORIGEN_TXT = {seed: 'catálogo base', ia: 'IA', usuario: 'tuyo'};
function ajTipos(tipos) {
  const f = ui.ajTipos || 'todos', query = norm(ui.ajBuscar || '');
  const filtros = {
    todos: ['Todos', (tp) => !tp.archivado], sin: ['Sin comprobar', (tp) => !tp.archivado && tp.revisado === 0],
    ia: ['De la IA', (tp) => !tp.archivado && tp.origen === 'ia'], vacios: ['Sin piezas', (tp) => !tp.archivado && !tp.piezas],
    archivados: ['Archivados', (tp) => tp.archivado === 1],
  };
  const lista = tipos.filter(filtros[f][1]).filter((tp) => !query || norm(`${tp.nombre} ${tp.id}`).includes(query));
  const destinos = (sin) => Object.keys(CATS).map((cat) => {
    const ts = tipos.filter((tp) => !tp.archivado && tp.categoria === cat && tp.id !== sin);
    return ts.length ? `<optgroup label="${esc(CATS[cat])}">${ts.map((tp) => `<option value="${esc(tp.id)}">${esc(tp.nombre)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  return `${cabIA(t('Tipos'), t('Archivar lo oculta sin borrar nada. Fusionar pasa las piezas y los proyectos a otro tipo. Borrar solo se puede si nada lo usa.'))}
    <div class="filtros"><div class="cats">${Object.entries(filtros).map(([k, [nombre, fn]]) =>
      `<button class="f ${f === k ? 'on' : ''}" data-aj-tipos="${k}">${t(nombre)}<span class="n">${tipos.filter(fn).length}</span></button>`).join('')}</div>
      <input id="aj-buscar" class="aj-buscar" type="search" placeholder="${esc(t('Buscar tipo'))}" value="${esc(ui.ajBuscar || '')}" autocomplete="off"></div>
    ${lista.length ? `<section class="caja bloque-caja"><div class="aj-lista">${lista.map((tp) => {
      const usos = [tp.piezas ? plural(tp.piezas, 'pieza') : '', tp.proyectos ? plural(tp.proyectos, 'proyecto') : ''].filter(Boolean).join(' · ');
      return `<div class="aj-fila aj-tipo" data-tipo="${esc(tp.id)}">
        <div><a class="nombre" href="#/g/${esc(tp.id)}">${esc(tp.nombre)}</a>${tp.revisado === 0 ? ` <span class="etq-pend">${t('sin comprobar')}</span>` : ''}
          <div class="sub">${etqCat(tp.categoria || 'otro')} · ${usos || t('sin uso')} · ${esc(t(ORIGEN_TXT[tp.origen] || tp.origen))}</div></div>
        <span class="aj-botones">
          <button class="btn mini" data-tipo-archivar="${esc(tp.id)}" data-v="${tp.archivado ? 0 : 1}">${tp.archivado ? t('Recuperar') : t('Archivar')}</button>
          ${tp.archivado ? '' : `<button class="btn mini" data-tipo-fusionar="${esc(tp.id)}">${t('Fusionar…')}</button>`}
          <button class="btn mini peligro" data-tipo-borrar="${esc(tp.id)}" ${usos ? `disabled title="${esc(t('No se puede borrar: lo usan {usos}. Archívalo o fusiónalo con otro.', {usos}))}"` : ''}>${t('Borrar')}</button>
        </span>
        <div class="aj-panel" hidden>${tp.archivado ? '' : `<label>${t('Sus piezas y proyectos pasan a')}
          <select data-fusion-destino="${esc(tp.id)}"><option value="">${t('Elige el tipo que se queda…')}</option>${destinos(tp.id)}</select></label>
          <div class="acciones"><button class="btn prim mini" data-tipo-fusionar-ok="${esc(tp.id)}">${t('Fusionar')}</button>
          <button class="btn mini" data-aj-cerrar>${t('Cancelar')}</button></div>`}</div>
      </div>`;
    }).join('')}</div></section>` : vacio(t('Nada en este filtro.'))}`;
}

// Uniformar formato: lo que cambiaría en las fichas y en los datos de las piezas para que todo esté escrito igual
function ajFormato(r) {
  const grupos = new Map();
  for (const c of r.cambios) { const k = `${c.objeto}:${c.objeto_id}`; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(c); }
  const enlace = (c) => (c.objeto === 'tipo' ? `#/g/${encodeURIComponent(c.objeto_id)}` : `#/c/${esc(c.objeto_id)}`);
  return `${cabIA(t('Uniformar formato'), t('La app escribe siempre igual las tensiones y las unidades («3,3 V», «20 mA»), las interfaces («I2C») y los nombres de los datos («Corriente máx.»). Aquí sale lo que ya está guardado de otra manera: marca lo que quieras dejar igual que el resto. Solo cambia cómo está escrito, no lo que dice, y no gasta consultas de la IA.'))}
    ${r.cambios.length ? [...grupos.values()].map((cs) => `<section class="caja bloque-caja formato-grupo">
      <p class="lote-t"><a class="nombre" href="${enlace(cs[0])}">${esc(cs[0].nombre)}</a><span class="ams-etiqueta">${cs[0].objeto === 'tipo' ? t('ficha') : t('pieza')}</span></p>
      ${cs.map((c) => `<label class="ia-cambio-fila"><input type="checkbox" class="formato-cambio" value="${esc(c.id)}" checked><span>${filaCambio(c)}</span></label>`).join('')}</section>`).join('')
      + `<div class="acciones lote-acciones">
        <button class="btn prim" type="button" id="formato-aplicar">${t('Aplicar lo marcado')}</button>
        <button class="btn" type="button" data-formato-marcar="todo">${t('Marcar todo')}</button>
        <button class="btn" type="button" data-formato-marcar="nada">${t('Ninguno')}</button></div>`
      : `<div class="caja bloque-caja"><p>${t('Todo está ya escrito con el mismo formato.')}</p></div>`}
    ${r.interfaces.length ? `<section class="caja bloque-caja"><h3 class="grupo-t">${t('Interfaces en uso')}<span class="n">${r.interfaces.length}</span></h3>
      <p class="sub">${t('La app no puede saber si dos nombres distintos son la misma cosa («Analógica» y «1 pin analógico»). Si ves dos que lo son, edita la ficha y deja uno: la IA usará el que quede.')}</p>
      <p class="formato-lista">${r.interfaces.map((x) => `<span class="ams-etiqueta">${esc(x.nombre)} <span class="gris">×${x.n}</span></span>`).join('')}</p></section>` : ''}`;
}
function contarFormato() {
  const b = $('#formato-aplicar');
  if (!b) return;
  const n = document.querySelectorAll('.formato-cambio:checked').length;
  b.textContent = n ? t('Aplicar {cambios}', {cambios: plural(n, 'cambio')}) : t('Marca algún cambio');
  b.disabled = !n;
}
async function aplicarFormato(boton) {
  const ids = [...document.querySelectorAll('.formato-cambio:checked')].map((x) => x.value);
  boton.disabled = true;
  boton.textContent = t('Aplicando…');
  const r = await api('POST', 'api/ajustes/formato', {ids});
  await cargar(); contadores();
  $('#aj-zona').innerHTML = ajFormato(r);
  contarFormato();
  toast(t('{cambios} de formato aplicados', {cambios: plural(r.aplicados, 'cambio')}));
}

function ajSitios(sitios) {
  return `${cabIA(t('Sitios'), t('Donde guardas las piezas. Si renombras uno con el nombre de otro, se juntan. Al borrar uno, sus piezas se quedan «sin sitio».'))}
    ${sitios.length ? `<section class="caja bloque-caja"><div class="aj-lista">${sitios.map((s) => `
      <div class="aj-fila">
        <input class="aj-nombre" data-sitio-nombre="${s.id}" value="${esc(s.nombre)}" maxlength="120" aria-label="${esc(t('Nombre del sitio'))}">
        <span class="sub">${plural(s.piezas, 'pieza')}</span>
        <span class="aj-botones"><button class="btn mini peligro" data-sitio-borrar="${s.id}" data-piezas="${s.piezas}" data-nombre="${esc(s.nombre)}">${t('Borrar')}</button></span>
      </div>`).join('')}</div></section>` : vacio(t('Aún no hay sitios: se crean al poner «Sitio» en una pieza.'))}`;
}

const fechaLarga = (iso) => (iso ? new Date(iso).toLocaleString(I18N.loc(), {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'}) : '');
const tamano = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', I18N.lang() === 'en' ? '.' : ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
// copias de cada día, manuales y las que se hacen solas antes de migrar o de restaurar
const claseCopia = (n) => t(n.startsWith('lab-antes-restaurar') ? 'antes de restaurar' : n.startsWith('lab-antes-') ? 'antes de una migración'
  : /^lab-\d{4}-\d{2}-\d{2}\.db$/.test(n) ? 'diaria' : 'manual');

function ajDatos(r) {
  const u = r.copias.ultima;
  const archTxt = r.archivados ? ` (+${plural(r.archivados, 'archivado')})` : '';
  return `${cabIA(t('Datos y copias'), t('Copias de seguridad: descárgalas para guardarlas fuera del servidor y restáuralas si algo sale mal.'))}
    <div class="caja pro-resumen">${cajetin([[t('Piezas'), r.piezas], [t('Fotos'), r.fotos], [t('Tipos'), `${r.tipos}${archTxt}`], [t('Categorías'), r.categorias],
      [t('Sitios'), r.sitios], [t('Proyectos'), r.proyectos], [t('Versión de los datos'), `v${r.version}`]], 4)}</div>
    <section class="caja bloque-caja ia-bloque">
      <h3>${t('Exportar')}</h3>
      <p class="ayuda">${t('Un solo archivo .tar.gz con la base de datos y las {n} fotos. Sirve para restaurarlo aquí o en otro servidor. Incluye la clave de la IA: guárdalo en un sitio seguro.', {n: r.fotos})}</p>
      <div class="acciones"><a class="btn prim" href="api/copia/exportar" download>${t('Descargar copia completa')}</a>
        <a class="btn" href="api/exportar" download>${t('Datos en JSON (solo lectura)')}</a></div>
    </section>
    <section class="caja bloque-caja ia-bloque" id="aj-importar-zona">
      <h3>${t('Restaurar desde un archivo')}</h3>
      <p class="ayuda">${t('El .tar.gz que exporta la app, o un .db suelto (una copia diaria). Primero se comprueba y te enseña qué contiene; no cambia nada hasta que confirmes.')}</p>
      <div class="acciones"><label class="btn">${t('Elegir archivo…')}<input type="file" id="aj-importar" accept=".gz,.tgz,.tar.gz,.db,application/gzip,application/x-gzip" hidden></label></div>
      <p class="ayuda" id="aj-importar-estado" role="status"></p>
      <div id="aj-restaurar"></div>
    </section>
    <section class="caja bloque-caja ia-bloque">
      <h3>${t('Copias en el servidor')}</h3>
      <p class="ayuda">${t('Se hace una al día sola y se guardan {max} diarias ({guardadas} copias ahora, contando las especiales).', {max: r.copias.maximo, guardadas: r.copias.guardadas})}
        ${u ? t('Última: {fecha}.', {fecha: esc(fechaLarga(u.fecha))}) : `<span class="mal">${t('Aún no hay ninguna.')}</span>`} ${t('Carpeta:')} <span class="mono">${esc(r.copias.carpeta)}</span></p>
      <div class="acciones"><button class="btn" type="button" id="aj-copia">${t('Hacer copia ahora')}</button></div>
      ${r.copias.lista.length ? `<table class="t copias"><thead><tr><th>${t('Fecha')}</th><th>${t('Clase')}</th><th class="der">${t('Tamaño')}</th><th></th></tr></thead><tbody>
        ${r.copias.lista.map((c) => `<tr><td class="num">${esc(fechaLarga(c.fecha))}</td><td class="gris">${esc(claseCopia(c.nombre))}</td>
          <td class="der num">${tamano(c.bytes)}</td><td class="der"><span class="aj-botones">
            <a class="btn mini" href="api/copias/${encodeURIComponent(c.nombre)}" download>${t('Descargar')}</a>
            <button class="btn mini" type="button" data-copia-preparar="${esc(c.nombre)}">${t('Restaurar…')}</button></span></td></tr>`).join('')}</tbody></table>
        <p class="ayuda">${t('Las copias del servidor solo llevan la base de datos: las fotos están en su carpeta de copias y no se borran nunca.')}</p>` : ''}
    </section>`;
}

// lo que se va a restaurar frente a lo que hay ahora; nada cambia hasta pulsar «Restaurar»
function panelRestaurar(r) {
  const fila = (k, a, b) => `<tr><td class="gris">${k}</td><td class="der num">${esc(a)}</td><td class="der num">${esc(b)}</td></tr>`;
  const de = {archivo: t('el archivo subido'), base: t('la base de datos subida'), copia: t('la copia del servidor {nombre}', {nombre: r.copia || ''})}[r.origen] || t('la copia');
  return `<div class="restaurar aparece">
    <h3>${t('Restaurar {origen}', {origen: esc(de)})}</h3>
    <table class="t"><thead><tr><th></th><th class="der">${t('Ahora')}</th><th class="der">${t('Copia')}</th></tr></thead><tbody>
      ${fila(t('Piezas'), r.actual.piezas, r.piezas)}${fila(t('Tipos'), r.actual.tipos + r.actual.archivados, r.tipos)}${fila(t('Proyectos'), r.actual.proyectos, r.proyectos)}
      ${fila(t('Fotos'), r.actual.fotos, r.origen === 'archivo' ? t('{n} en el archivo', {n: r.fotos}) : t('las de ahora'))}
      ${fila(t('Versión de los datos'), `v${r.actual.version}`, `v${r.version}${r.version < r.actual.version ? t(' (se actualiza al restaurar)') : ''}`)}
      ${r.exportado ? fila(t('Fecha'), '—', fechaLarga(r.exportado)) : ''}</tbody></table>
    <p class="nota nota-peligro">${t('Se sustituye todo lo de ahora: inventario, glosario, proyectos, ajustes y la clave de la IA. Antes se guarda una copia del estado actual en el servidor («antes de restaurar»), así que se puede volver atrás. Las fotos no se borran.')}</p>
    <div class="acciones"><button class="btn prim peligro-prim" type="button" data-restaurar="${esc(r.token)}">${t('Restaurar')}</button>
      <button class="btn" type="button" data-restaurar-cancelar>${t('Cancelar')}</button></div></div>`;
}

// subida con progreso (XMLHttpRequest: fetch no da el progreso de subida)
function subirCopia(file) {
  const estado = $('#aj-importar-estado'), zona = $('#aj-restaurar');
  zona.innerHTML = '';
  estado.className = 'ayuda';
  estado.textContent = t('Subiendo {nombre} ({tam})…', {nombre: file.name, tam: tamano(file.size)});
  const x = new XMLHttpRequest();
  x.open('POST', 'api/copia/preparar');
  x.setRequestHeader('content-type', 'application/octet-stream');
  x.upload.onprogress = (e) => { if (e.lengthComputable) estado.textContent = t('Subiendo {nombre}: {pct} %', {nombre: file.name, pct: Math.round((e.loaded / e.total) * 100)}); };
  x.upload.onload = () => { estado.textContent = t('Comprobando el archivo…'); };
  x.onerror = () => { estado.className = 'mal'; estado.textContent = t('Sin conexión con el servidor: no se ha subido'); };
  x.onload = () => {
    let r = {};
    try { r = JSON.parse(x.responseText); } catch {}
    if (x.status !== 200) { estado.className = 'mal'; estado.textContent = r.error || `Error ${x.status}`; return; }
    estado.textContent = t('Archivo comprobado: está bien. Mira lo que contiene antes de restaurar.');
    zona.innerHTML = panelRestaurar(r);
    zona.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  };
  x.send(file);
}

async function restaurarCopia(boton) {
  if (!(await confirmar(t('¿Restaurar esta copia?\nSe sustituye todo lo de ahora. Antes se guarda una copia del estado actual en el servidor.'), {si: t('Restaurar'), peligro: true}))) return;
  boton.disabled = true;
  boton.textContent = t('Restaurando…');
  try {
    const r = await api('POST', 'api/copia/restaurar', {token: boton.dataset.restaurar});
    MODELOS_IA = null;
    await cargar();
    aplicarTema();
    contadores();
    location.hash = '#/ajustes/datos';
    await ajCargar();
    toast(`${t('Restaurada:')} ${plural(r.piezas, 'pieza')}${r.fotos ? ` ${t('y {fotos} nuevas', {fotos: plural(r.fotos, 'foto')})}` : ''}`);
  } catch (err) { boton.disabled = false; boton.textContent = t('Restaurar'); toast(err.message, true); }
}

async function clicAjustes(el) {
  const d = el.dataset, fila = el.closest('.aj-fila'), panel = fila?.querySelector('.aj-panel');
  if (d.ponerTema) { await api('PUT', 'api/ajustes/tema', {valor: d.ponerTema}); D.ajustes.tema = d.ponerTema; aplicarTema(); route(); return true; }
  if (d.ponerIdioma) { await api('PUT', 'api/ajustes/idioma', {valor: d.ponerIdioma}); D.ajustes.idioma = d.ponerIdioma; aplicarIdioma(); aplicarTema(); contadores(); route(); return true; }
  if ('ajCerrar' in d) { el.closest('.aj-panel').hidden = true; return true; }
  if (d.ajTipos) { ui.ajTipos = d.ajTipos; await ajCargar(); return true; }
  if (el.id === 'aj-copia') { el.disabled = true; const r = await api('POST', 'api/copias'); await ajCargar(); toast(t('Copia hecha: {nombre}', {nombre: r.nombre})); return true; }
  if (d.copiaPreparar) {
    el.disabled = true;
    try {
      const r = await api('POST', `api/copias/${encodeURIComponent(d.copiaPreparar)}/preparar`);
      const zona = $('#aj-restaurar');
      zona.innerHTML = panelRestaurar(r);
      $('#aj-importar-estado').textContent = '';
      zona.closest('section').scrollIntoView({block: 'start', behavior: 'smooth'});
    } finally { el.disabled = false; }
    return true;
  }
  if (d.restaurar) { await restaurarCopia(el); return true; }
  if ('restaurarCancelar' in d) {
    await api('DELETE', 'api/copia/preparada').catch(() => {});
    $('#aj-restaurar').innerHTML = '';
    $('#aj-importar-estado').textContent = t('Cancelado: no se ha cambiado nada.');
    return true;
  }
  if (d.catMover) {
    const ids = [...document.querySelectorAll('[data-cat-fila]')].map((e) => e.dataset.catFila), i = ids.indexOf(d.catMover), j = i + Number(d.dir);
    if (j < 0 || j >= ids.length) return true;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api('PUT', 'api/categorias/orden', {ids});
    await ajRefrescar();
    return true;
  }
  if (d.catBorrar) {
    const n = Number(d.tipos), nombre = fila.querySelector('.aj-nombre').value;
    if (!n) {
      if (!(await confirmar(t('¿Borrar la categoría «{nombre}»?', {nombre}), {si: t('Borrar'), peligro: true}))) return true;
      await api('DELETE', `api/categorias/${d.catBorrar}`);
      await ajRefrescar(t('Categoría «{nombre}» borrada', {nombre}));
      return true;
    }
    panel.innerHTML = `<label>${n === 1 ? t('Su tipo pasa a') : t('Sus {n} tipos pasan a', {n})}
        <select data-cat-destino>${D.categorias.filter((c) => c.id !== d.catBorrar).map((c) => `<option value="${esc(c.id)}" ${c.id === 'otro' ? 'selected' : ''}>${esc(I18N.cat(c.id, c.nombre))}</option>`).join('')}</select></label>
      <div class="acciones"><button class="btn prim mini peligro" data-cat-borrar-ok="${esc(d.catBorrar)}">${t('Mover y borrar «{nombre}»', {nombre: esc(nombre)})}</button>
        <button class="btn mini" data-aj-cerrar>${t('Cancelar')}</button></div>`;
    panel.hidden = false;
    return true;
  }
  if (d.catBorrarOk) {
    const destino = panel.querySelector('[data-cat-destino]').value;
    const r = await api('DELETE', `api/categorias/${d.catBorrarOk}?destino=${encodeURIComponent(destino)}`);
    await ajRefrescar(t('Borrada; {tipos} a «{destino}»', {tipos: plural(r.movidos, 'tipo'), destino: CATS[destino] || destino}));
    return true;
  }
  if (d.tipoArchivar) {
    const archivar = d.v === '1';
    await api('PATCH', `api/tipos/${d.tipoArchivar}`, {archivado: archivar});
    if ($('#aj-zona')) await ajRefrescar(archivar ? t('Archivado: ya no sale en el glosario') : t('Recuperado'));
    else { await cargar(); contadores(); route(); toast(archivar ? t('Archivado') : t('Recuperado')); }
    return true;
  }
  if (d.tipoFusionar) { panel.hidden = !panel.hidden; return true; }
  if (d.tipoFusionarOk) {
    const destino = panel.querySelector('[data-fusion-destino]').value;
    if (!destino) { toast(t('Elige el tipo que se queda'), true); return true; }
    const a = D.tipos[d.tipoFusionarOk]?.nombre, b = D.tipos[destino]?.nombre;
    if (!(await confirmar(t('¿Fusionar «{a}» en «{b}»?\nSus piezas y proyectos pasan a «{b}» y «{a}» desaparece. No se puede deshacer.', {a, b}), {si: t('Fusionar'), peligro: true}))) return true;
    const r = await api('POST', `api/tipos/${d.tipoFusionarOk}/fusionar`, {destino});
    await ajRefrescar(t('Fusionado: {piezas} pasan a «{b}»', {piezas: plural(r.piezas, 'pieza'), b}));
    return true;
  }
  if (d.tipoBorrar) {
    const nombre = D.tipos[d.tipoBorrar]?.nombre;
    if (!(await confirmar(t('¿Borrar el tipo «{nombre}»?\nNo se puede deshacer.', {nombre}), {si: t('Borrar'), peligro: true}))) return true;
    await api('DELETE', `api/tipos/${d.tipoBorrar}`);
    await ajRefrescar(t('Tipo «{nombre}» borrado', {nombre}));
    return true;
  }
  if (d.sitioBorrar) {
    const n = Number(d.piezas);
    if (!(await confirmar(n ? t('¿Borrar el sitio «{nombre}»?\nSus {piezas} se quedan sin sitio.', {nombre: d.nombre, piezas: plural(n, 'pieza')}) : t('¿Borrar el sitio «{nombre}»?', {nombre: d.nombre}), {si: t('Borrar'), peligro: true}))) return true;
    await api('DELETE', `api/ubicaciones/${d.sitioBorrar}`);
    await ajRefrescar(t('Sitio borrado'));
    return true;
  }
  return false;
}

// renombrar categoría o sitio al salir del campo; si el sitio ya existe, se juntan (preguntando antes)
async function cambioAjustes(input) {
  const nuevo = input.value.trim();
  if (!nuevo || nuevo === input.defaultValue) { input.value = input.defaultValue; return; }
  try {
    if (input.dataset.catNombre) {
      await api('PATCH', `api/categorias/${input.dataset.catNombre}`, {nombre: nuevo});
      await ajRefrescar(t('Guardado'));
    } else {
      const otro = [...document.querySelectorAll('[data-sitio-nombre]')].find((x) => x !== input && x.defaultValue.toLowerCase() === nuevo.toLowerCase());
      if (otro && !(await confirmar(t('¿Juntar con «{nombre}»?\nYa hay un sitio con ese nombre: las piezas de este pasan a ese.', {nombre: otro.defaultValue}), {si: t('Juntar')}))) { input.value = input.defaultValue; return; }
      const r = await api('PATCH', `api/ubicaciones/${input.dataset.sitioNombre}`, {nombre: nuevo});
      await ajRefrescar(r.fusionado ? t('Juntados: {piezas} en «{nombre}»', {piezas: plural(r.piezas, 'pieza'), nombre: r.nombre}) : t('Guardado'));
    }
  } catch (err) { input.value = input.defaultValue; toast(err.message, true); }
}

// ---------- «Corregir con IA» (fase C): el modelo corrige la ficha y aquí se eligen los cambios ----------
// «ficha.datos», «pieza.notas»… (como los nombra el modelo) → nombre que se entiende
const CAMPOS_FICHA = {nombre: 'Nombre del tipo', categoria: 'Categoría', resumen: 'Resumen', voltaje: 'Tensión', tension: 'Tensión',
  interfaz: 'Interfaces', interfaces: 'Interfaces', alias: 'Otros nombres', pines: 'Pines', pin: 'Pines', datos: 'Datos del tipo',
  ojo: 'Advertencia («Ojo»)', advertencias: 'Advertencia («Ojo»)'};
const CAMPOS_PIEZA = {nombre: 'Nombre de la pieza', tipo: 'Tipo de la pieza', notas: 'Notas de la pieza', datos: 'Datos de la pieza', datos_pieza: 'Datos de la pieza'};
function nombreCampo(campo) {
  const m = norm(campo).match(/^(ficha|tipo|pieza)[.:s]+([a-z_]+)/) || [null, 'ficha', norm(campo).match(/^[a-z_]+/)?.[0]];
  const nombre = (m[1] === 'pieza' ? CAMPOS_PIEZA : CAMPOS_FICHA)[m[2]];
  return nombre ? t(nombre) : may(String(campo).replace(/^(ficha|tipo|pieza)./i, '').replace(/[._]/g, ' '));
}
const fichaRevision = (tr) => (tr.objetivo?.componente_id ? `#/c/${tr.objetivo.componente_id}` : tr.objetivo?.tipo_id ? `#/g/${encodeURIComponent(tr.objetivo.tipo_id)}` : '#/ia');
const desdePendientes = (tr) => ui.origenTarea?.hash === `#/ia/${tr.id}` && ui.origenTarea.desde === '#/pendientes';
const volverRevision = (tr) => (tr.lote ? `#/ia/lote/${encodeURIComponent(tr.lote)}` : desdePendientes(tr) ? '#/pendientes' : fichaRevision(tr));
const textoVolver = (tr) => t(tr.lote ? 'Volver al lote' : desdePendientes(tr) ? 'Volver a cambios pendientes' : 'Volver a la ficha');

// desplegable en la ficha (pieza o tipo): qué revisar y una foto, ambos opcionales
function panelRevisar(objetivo, id, ayuda) {
  if (!D.ia?.activa) return '';
  return `<details class="ia-revisar"><summary class="btn">${t('Corregir con IA')}</summary>
    <form id="form-revisar" class="form sin-pad" autocomplete="off" data-objetivo="${objetivo}" data-id="${esc(id)}">
      <p class="ayuda">${esc(ayuda)} ${t('Te enseña solo lo que cambiaría y tú eliges qué aplicar.')}</p>
      <label>${t('Qué corregir (opcional)')}<textarea name="texto" rows="2" maxlength="1000" placeholder="${esc(t('Los pines están al revés · Añade el consumo'))}"></textarea></label>
      ${campoFoto(t('Fotos (opcional)'), t('Hasta 4. Sin ninguna, la IA mira la foto que ya tiene la pieza.'), {varias: 4})}
      <div class="acciones"><button class="btn prim" type="submit">${t('Pedir correcciones')}</button></div>
    </form></details>`;
}

async function enviarRevision(form) {
  const fd = new FormData(form);
  const [foto = null, ...fotos] = await Promise.all(fotosDelCampo(form.querySelector('.archivo-input')).map(reducida));
  const tr = await api('POST', 'api/ia/revisar', {objetivo: form.dataset.objetivo, id: form.dataset.id, texto: fd.get('texto'), foto, fotos});
  location.hash = `#/ia/${tr.id}`;
}

// los cambios propuestos: cada uno con su casilla (marcados al empezar), antes tachado y ahora en claro
// vista previa de una corrección: la ficha tal como quedaría con SOLO los cambios marcados, aplicados aquí (sin guardar
// nada) con la misma regla que el servidor (server/revision.mjs → aplicarCambios): pines y datos emparejados por su nombre
const claveTxt = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
function aplicarEnLocal(tr, ids) {
  const p = tr.propuesta, o = p.objetivo || {};
  const base = o.tipo_id && D.tipos[o.tipo_id];
  const tipo = base ? {...base, alias: [...list(base.alias)], interfaz: [...list(base.interfaz)], pines: list(base.pines).map((x) => [...x]), datos: list(base.datos).map((x) => [...x])} : null;
  const pc = o.componente_id ? comp(o.componente_id) : null;
  const pieza = pc ? {nombre: pc.nombre, notas: pc.notas || '', datos_pieza: list(pc.datos).map((x) => [...x])} : null;
  const marcados = p.cambios.filter((c) => ids.includes(c.id));
  let otroTipo = null; // la pieza pasa a otro tipo (uno que ya existe o uno nuevo)
  for (const c of marcados) {
    const obj = c.ambito === 'tipo' ? tipo : pieza;
    if (!obj || c.campo === 'ordenPines') continue; // el orden de los pines, después de los demás cambios
    if (c.ambito === 'pieza' && c.campo === 'tipo') {
      const f = c.nuevo?.existente ? D.tipos[c.nuevo.existente] : c.nuevo?.nuevo;
      if (f) otroTipo = {...f, revisado: c.nuevo?.nuevo ? 0 : f.revisado, alias: [...list(f.alias)], interfaz: [...list(f.interfaz)],
        pines: list(f.pines).map((x) => [...x]), datos: list(f.datos).map((x) => [...x])};
      continue;
    }
    if (c.campo === 'pin' || c.campo === 'dato' || c.campo === 'datoPieza') {
      const prop = c.campo === 'pin' ? 'pines' : c.campo === 'dato' ? 'datos' : 'datos_pieza', k = c.id.split('.').slice(2).join('.');
      const i = obj[prop].findIndex((x) => claveTxt(x[0]) === k);
      if (c.nuevo) { if (i >= 0) obj[prop][i] = [...c.nuevo]; else obj[prop].push([...c.nuevo]); } else if (i >= 0) obj[prop].splice(i, 1);
    } else obj[c.campo] = Array.isArray(c.nuevo) ? [...c.nuevo] : c.nuevo;
  }
  const orden = marcados.find((c) => c.campo === 'ordenPines');
  if (orden && tipo) { // igual que reordenar() del servidor: los de la lista, en su orden y con su nombre; los demás, quietos
    const pos = new Map(orden.nuevo.map((x, i) => [claveTxt(x), i])), huecos = [], suyos = [];
    tipo.pines.forEach((p, i) => { if (pos.has(claveTxt(p[0]))) { huecos.push(i); suyos.push([orden.nuevo[pos.get(claveTxt(p[0]))], ...p.slice(1)]); } });
    suyos.sort((x, y) => pos.get(claveTxt(x[0])) - pos.get(claveTxt(y[0])));
    huecos.forEach((h, i) => (tipo.pines[h] = suyos[i]));
  }
  if (tipo && marcados.some((c) => c.ambito === 'tipo')) tipo.revisado = 0; // lo cambia la IA: «sin comprobar»
  return {tipo: otroTipo || tipo, pieza, pc, marcados};
}
function previaRevision(tr, ids) {
  const {tipo, pieza, pc, marcados} = aplicarEnLocal(tr, ids);
  const tipoId = tr.propuesta.objetivo?.tipo_id || '';
  const cat = tipo ? (tipo.categoria || 'otro') : 'otro';
  const ps = tipoId ? proyectosDe(tipoId) : [];
  const ft = tipo ? fichaDelTipo(tipo, tipoId, ps, t('Vista previa con los cambios marcados')) : {der: '', izq: ''};
  const esta = pieza
    ? `<section class="caja fi-esta"><div class="fi-esta-cab"><h2 class="rotulo">${t('Esta pieza')}</h2></div>
        ${cajetin([[t('Cantidad'), pc.varios ? `<span class="muchos">${t('muchos')}</span>` : `<span class="num">${esc(qtyText(pc))}</span>`],
          [t('Sitio'), esc(pc.ubicacion || t('Sin sitio'))],
          [t('Tipo'), tipo ? esc(tipo.nombre) : t('Sin tipo'), true],
          [t('Categoría'), etqCat(cat)],
          ...(pieza.datos_pieza.length ? pieza.datos_pieza.map(([k, v]) => [esc(k), esc(v)]) : [[t('Datos propios'), '—']])])}
        ${pieza.notas ? `<div class="fi-notas"><h3 class="rotulo">${t('Notas')}</h3><p class="notas">${esc(pieza.notas)}</p></div>` : ''}</section>`
    : '';
  const barra = `<div class="caja previa-barra"><span class="ams-etiqueta ams-etiqueta--amarilla">${t('Vista previa')}</span>
    <div class="previa-txt"><p>${marcados.length === 1
      ? t('Así quedaría con el cambio marcado. Aún no se ha guardado nada.')
      : marcados.length
        ? t('Así quedaría con los {n} cambios marcados. Aún no se ha guardado nada.', {n: marcados.length})
        : t('No hay ningún cambio marcado: la ficha se quedaría como está.')}</p>
      ${marcados.length ? `<p class="sub">${t('Cambia: {lista}', {lista: marcados.map((c) => esc(c.etiqueta)).join(' · ')})}</p>` : ''}</div>
    <button class="btn mini" type="button" data-rev-vista="cambios">${t('Volver a cambios')}</button></div>`;
  return `${barra}
    <article class="fi">
      <div class="fi-izq">
        ${imagenGrande({foto: pc?.foto ? fotoUrl(pc) : '', tipo: tipoId, cat,
          pie: `<span>${pc?.foto ? t('Foto de la pieza') : tipoId ? t('Dibujo del tipo') : t('Sin foto')}</span>`})}
        ${esta}
        ${ft.izq}
      </div>
      <div class="fi-der">
        <header class="fi-cab">${etqCat(cat, 'etq-cat')}<h1>${esc(pieza ? pieza.nombre : tipo?.nombre || '')}</h1>
          ${tipo?.resumen ? `<p class="fi-resumen">${esc(tipo.resumen)}</p>` : ''}</header>
        ${tipo ? notaOjo(tipo) : ''}
        ${tipo && tipo.revisado === 0 ? avisoIA('') : ''}
        ${tipo ? ft.der : `<p class="gris">${t('Sin tipo: no se verán pines ni ficha técnica.')}</p>`}
      </div>
    </article>`;
}
function verVistaRevision(vista, tr) {
  const previa = $('#rev-previa'), cambios = $('#rev-cambios'), dudas = $('#ia-dudas');
  if (!previa || !cambios || !tr) return;
  const ver = vista === 'previa';
  if (ver) previa.innerHTML = previaRevision(tr, [...document.querySelectorAll('.ia-cambio:checked')].map((x) => x.value));
  previa.hidden = !ver;
  cambios.hidden = ver;
  if (dudas) dudas.hidden = ver;
  document.querySelectorAll('.ia-pestanas [data-rev-vista]').forEach((b) => {
    const on = b.dataset.revVista === vista;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
let REVISION = null; // la corrección que está en pantalla (para la vista previa)

function vistaCambios(tr) {
  REVISION = tr;
  const p = tr.propuesta, volver = volverRevision(tr), tipoId = p.objetivo?.tipo_id;
  const piezasTipo = tipoId ? D.componentes.filter((c) => c.tipo === tipoId).length : 0;
  const fila = (c) => `<label class="ia-cambio-fila"><input type="checkbox" class="ia-cambio" value="${esc(c.id)}" checked>
    <span><span class="nombre">${esc(c.etiqueta)}${c.tipoCambio === 'nuevo' ? ` <span class="gris">· ${t('nuevo')}</span>` : c.tipoCambio === 'quitado' ? ` <span class="gris">· ${t('se quita')}</span>` : ''}</span>
      ${c.antes ? `<span class="ia-antes">${esc(c.antes)}</span>` : ''}
      ${c.despues ? `<span class="ia-ahora">${esc(c.despues)}</span>` : ''}</span></label>`;
  const grupo = (ambito, titulo, ayuda) => {
    const cs = p.cambios.filter((c) => c.ambito === ambito);
    return cs.length ? `<section class="caja bloque-caja ia-grupo"><h3>${titulo}</h3>${ayuda ? `<p class="ayuda">${ayuda}</p>` : ''}${cs.map(fila).join('')}</section>` : '';
  };
  const nombreTipo = tipoId ? D.tipos[tipoId]?.nombre || tipoId : '';
  const meta = `<p class="ia-meta">${etqConfianza(p.confianza)}<span class="ams-etiqueta">${plural(p.cambios.length, 'cambio')}</span><span>${esc(nombreModelo(tr.modelo))}</span>${costeTexto(p.coste) ? `<span>${esc(costeTexto(p.coste))}</span>` : ''}${tr.rondas ? `<span>${t('Vuelta {n}', {n: tr.rondas + 1})}</span>` : ''}</p>`;
  const fotoTxt = (tr.fotos?.length || 1) > 1
    ? t('Ha mirado {n} fotos{extras}.', {n: tr.fotos.length, extras: tr.foto_de_pieza ? t(' (la de la pieza y las que añadiste)') : ''})
    : tr.foto_de_pieza ? t('Ha mirado la foto que ya tenía la pieza.') : t('Ha mirado la foto que adjuntaste.');
  return `${cabIA(t('Correcciones para «{nombre}»', {nombre: esc(tr.objetivo_nombre || '')}), p.cambios.length
      ? t('Marca los cambios que quieras aplicar. Lo que no marques se queda como está.')
      : t('La IA no ve nada que cambiar.'), meta)}
    ${tr.foto ? `<div class="caja bloque-caja ia-fotos-rev"><p class="ayuda">${fotoTxt}</p>${tiraFotos(tr, true)}</div>` : ''}
    ${p.cambios.length ? `<div class="seg ia-pestanas" role="group" aria-label="${esc(t('Vista'))}">
      <button class="on" type="button" data-rev-vista="cambios" aria-pressed="true">${t('Cambios')}</button>
      <button type="button" data-rev-vista="previa" aria-pressed="false">${t('Vista previa')}</button></div>` : ''}
    <div id="rev-previa" hidden></div>
    ${dudasIA(tr, p)}
    <div id="rev-cambios" class="rev-cambios">
    ${grupo('tipo', t('Ficha del tipo «{nombre}»', {nombre: esc(nombreTipo)}), piezasTipo > 1 ? t('La usan {n} piezas: los cambios se verán en todas. La ficha quedará «sin comprobar» hasta que la mires.', {n: piezasTipo}) : t('La ficha quedará «sin comprobar» hasta que la mires.'))}
    ${grupo('pieza', t('Esta pieza'), '')}
    ${p.motivos?.length ? `<details class="plegable ia-motivos"><summary>${t('Por qué')}<span class="n">${p.motivos.length}</span></summary><div class="plegable-cuerpo"><ul>${p.motivos.map((m) => `<li><strong>${esc(nombreCampo(m.campo))}</strong>: ${esc(m.motivo)}</li>`).join('')}</ul></div></details>` : ''}
    </div>
    <div class="acciones lote-acciones">
      ${p.cambios.length ? `<button class="btn prim" type="button" id="ia-aplicar-cambios" data-id="${tr.id}" data-volver="${volver}">${t('Aplicar {cambios}', {cambios: plural(p.cambios.length, 'cambio')})}</button>
        <button class="btn" type="button" data-ia-marcar="todo">${t('Marcar todo')}</button>
        <button class="btn" type="button" data-ia-marcar="nada">${t('Ninguno')}</button>` : `<a class="btn prim" href="${volver}">${textoVolver(tr)}</a>`}
      <button class="btn peligro" type="button" id="ia-descartar" data-id="${tr.id}" data-volver="${volver}">${t('Descartar')}</button>
    </div>`;
}

function contarCambios() {
  const b = $('#ia-aplicar-cambios');
  if (!b) return;
  const n = document.querySelectorAll('.ia-cambio:checked').length;
  b.textContent = n ? t('Aplicar {cambios}', {cambios: plural(n, 'cambio')}) : t('Marca algún cambio');
  b.disabled = !n;
}

async function aplicarRevisionIA(boton) {
  const ids = [...document.querySelectorAll('.ia-cambio:checked')].map((x) => x.value);
  if (!ids.length) throw new Error(t('Marca algún cambio'));
  boton.disabled = true;
  boton.textContent = t('Aplicando…');
  const r = await api('POST', `api/ia/tareas/${boton.dataset.id}/aplicar-cambios`, {ids});
  await cargar();
  contadores();
  location.hash = boton.dataset.volver;
  toast(t('{cambios} aplicados', {cambios: plural(r.aplicados, 'cambio')}));
}

// ---------- router ----------
function route() {
  const [ruta, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [v = '', arg = '', sub = ''] = ruta.split('/').map(decodeURIComponent);
  const map = {
    '': ['inventario', vInventario], c: ['inventario', () => vComponente(arg)],
    nuevo: ['inventario', () => vForm(null, new URLSearchParams(qs).get('tipo') || '')], editar: ['inventario', () => vForm(arg)],
    proyectos: ['proyectos', vProyectos], p: ['proyectos', () => vProyecto(arg, sub)], 'proyecto-nuevo': ['proyectos', () => vProyectoForm(null)],
    glosario: ['glosario', vGlosario], g: ['glosario', () => (sub === 'editar' ? vEditarTipo(arg) : vTipo(arg))],
    ia: ['inventario', () => (arg === 'lote' ? vLoteIA(sub) : vIA(arg))],
    lote: ['inventario', vLote],
    pendientes: ['inventario', vPendientes],
    ajustes: ['ajustes', () => vAjustes(arg)],
    buscar: ['buscar', vBuscar],
  };
  const [tab, fn] = map[v] || map[''];
  document.querySelectorAll('#nav a, #barra a').forEach((a) => a.classList.toggle('on', a.dataset.v === tab));
  cerrarMenuFab();
  app.innerHTML = fn();
  document.title = `CircuitBin · ${t(tab)}`;
  if (v === 'g' && sub === 'editar') editarTipoCargar();
  if (v === 'p') cargarProyecto();
  if (v === 'ia') { if (arg === 'ajustes') iaAjustes(); else if (arg === 'lote') iaLote(sub); else if (arg === 'varias') llenarModelosAlta(); else if (arg) iaTarea(arg); else { iaAbiertas(); llenarModelosAlta(); } }
  if (v === '') avisoPendientes();
  if (v === 'pendientes') cargarPendientes();
  if (v === 'ajustes' && arg === 'historial') { const g = new URLSearchParams(qs).get('g'); if (g != null && g in GRUPOS_HIST) HIST.grupo = g; }
  if (v !== '' && v !== 'lote' && ui.seleccionando) salirSeleccion(); // la selección vive en el Inventario y en «Editar juntas»
  if (v === 'ajustes') {
    const tp = new URLSearchParams(qs).get('t');
    if (arg === 'tipos' && tp) { ui.ajBuscar = D.tipos[tp]?.nombre || tp; ui.ajTipos = D.tipos[tp]?.archivado ? 'archivados' : 'todos'; }
    if (arg === 'ia') iaAjustes(); else if (arg) ajCargar();
    else {
      if (!MODELOS_IA && D.ia?.activa) modelosIA().then(() => { if (location.hash === '#/ajustes') route(); }).catch(() => {});
      if (!CUENTA_PEND) avisoPendientes().then(() => { if (location.hash === '#/ajustes' && CUENTA_PEND?.grupos) route(); }).catch(() => {});
    }
  }
  if (v === 'proyecto-nuevo' && matchMedia('(hover: hover)').matches) $('#form-proyecto [name=nombre]').focus();
  if (v === 'nuevo' && matchMedia('(hover: hover)').matches) $('#form [name=nombre]').focus(); // en el móvil, sin abrir el teclado
}

function contadores() {
  $('#n-inv').textContent = D.componentes.length || '';
  $('#n-pro').textContent = D.proyectos.length || '';
  $('#n-glo').textContent = Object.values(D.tipos).filter((tp) => !tp.archivado).length || '';
}

// ---------- eventos ----------
app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-cat],[data-cuenta],[data-pf],[data-adj],#quitar-foto,#quitar-pendiente,#marcar-pendiente,#ia-abrir,#borrar,#revisada,#ia-descartar,#ia-quitar,[data-ia-vista],#ia-responder,#ia-guardar-previa,#ia-cambiar-clave,[data-glo],[data-poner-tema],[data-poner-idioma],[data-cat-mover],[data-cat-borrar],[data-cat-borrar-ok],[data-aj-cerrar],[data-aj-tipos],[data-tipo-archivar],[data-tipo-fusionar],[data-tipo-fusionar-ok],[data-tipo-borrar],[data-sitio-borrar],#aj-copia,[data-ia-marcar],#ia-aplicar-cambios,[data-rev-vista],[data-vista-inv],#sel-modo,[data-sel],[data-sel-acc],[data-lote-todas],[data-lote-marcar],#lote-aplicar,#lote-descartar,.combo-op,[data-ed-anadir],[data-ed-quitar],[data-copia-preparar],[data-restaurar],[data-restaurar-cancelar],[data-pend-descartar],[data-hist-grupo],#hist-mas,[data-reg-nivel],#reg-copiar,[data-pro],#det-crear,[data-det-marcar],#lote-guardar,#filtros-abrir,#formato-aplicar,[data-formato-marcar],[data-pines-vista],[data-op]');
  if (!el || !app.contains(el)) return; // solo botones de la propia vista (no el <html>, que lleva data-* del tema)
  if (el.dataset.cuenta) { // móvil: el recuadro de la cantidad se convierte en − n + (y se queda así mientras ajustas)
    ui.cuentaAbierta = Number(el.dataset.cuenta);
    document.querySelectorAll('.fila-pieza.editando').forEach((x) => x.classList.remove('editando'));
    el.closest('.fila-pieza').classList.add('editando');
    el.closest('.fila-pieza').querySelector('[data-adj]')?.focus();
    return;
  }
  // sin redibujar la vista: el selector de tipo y las tablas editables viven dentro de formularios a medio rellenar
  if (el.classList.contains('combo-op')) { elegirTipo(el.closest('.combo'), el.dataset.valor); return; }
  if (el.dataset.op != null) { // una respuesta propuesta por la IA: la pone en su campo (otra vez: la quita)
    const li = el.closest('li'), campo = li.querySelector('.ia-resp');
    campo.value = el.getAttribute('aria-pressed') === 'true' ? '' : el.dataset.op;
    marcarOpciones(li);
    return;
  }
  if (el.id === 'ia-abrir') { // el panel de la IA se abre debajo de la fila de acciones
    const d = $('.ia-revisar');
    d.open = !d.open;
    el.setAttribute('aria-expanded', String(d.open));
    if (d.open) d.querySelector('textarea')?.focus({preventScroll: true});
    return;
  }
  if (el.dataset.pinesVista) {
    ui.pinesVista = el.dataset.pinesVista;
    const caja = el.closest('.pines');
    caja.dataset.pinesModo = ui.pinesVista;
    caja.querySelectorAll('[data-pines-vista]').forEach((b) => { const on = b.dataset.pinesVista === ui.pinesVista; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    return;
  }
  if (clicEditor(el)) return;
  try {
    if (el.dataset.pro) { await clicProyecto(el); return; }
    if (el.id === 'sel-modo') { if (ui.seleccionando) salirSeleccion(); else ui.seleccionando = true; route(); return; }
    if (el.dataset.sel) { if (el.dataset.sel === 'visibles') ui.visibles.forEach((id) => ui.sel.add(id)); else ui.sel.clear(); route(); return; }
    if (el.dataset.selAcc) { if (!el.disabled) await accionSel(el.dataset.selAcc); return; }
    if (el.dataset.loteTodas) { ponerATodas(el.dataset.loteTodas); return; }
    if (el.dataset.loteMarcar) {
      document.querySelectorAll('.lote-cambio').forEach((x) => { x.checked = el.dataset.loteMarcar === 'todo'; LOTE.desmarcados[x.checked ? 'delete' : 'add'](`${x.dataset.tarea}:${x.value}`); });
      contarLote(); return;
    }
    if (el.id === 'lote-aplicar') { try { await aplicarLote(el); } catch (err) { toast(err.message, true); contarLote(); } return; }
    if (el.id === 'lote-descartar') { await descartarLote(); return; }
    if (el.id === 'formato-aplicar') { try { await aplicarFormato(el); } catch (err) { toast(err.message, true); contarFormato(); } return; }
    if (el.dataset.formatoMarcar) { document.querySelectorAll('.formato-cambio').forEach((x) => (x.checked = el.dataset.formatoMarcar === 'todo')); contarFormato(); return; }
    if (el.id === 'lote-guardar') { try { await guardarLoteAltas(el); } catch (err) { toast(err.message, true); contarLote(); } return; }
    if (el.id === 'det-crear') { try { await crearDeteccion(el); } catch (err) { toast(err.message, true); contarDeteccion(); } return; }
    if (el.dataset.detMarcar) { document.querySelectorAll('.det-ok').forEach((x) => (x.checked = el.dataset.detMarcar === 'todo')); contarDeteccion(); return; }
    if (el.dataset.pendDescartar) { await descartarPendiente(el.dataset.pendDescartar); return; }
    if (el.dataset.histGrupo != null) { HIST.grupo = el.dataset.histGrupo; await histCargar(true); return; }
    if (el.id === 'hist-mas') { el.disabled = true; el.textContent = t('Cargando…'); await histCargar(false); return; }
    if (el.dataset.regNivel) { REG.nivel = el.dataset.regNivel; REG.datos = null; await regCargar(); return; }
    if (el.id === 'reg-copiar') {
      const txt = (REG.datos?.lineas || []).slice().reverse().map((l) => `${l.fecha} ${l.nivel.toUpperCase()} ${l.texto}`).join('\n');
      try { await navigator.clipboard.writeText(txt); toast(t('Registro copiado')); } catch { toast(t('No se ha podido copiar (hace falta HTTPS o localhost)'), true); }
      return;
    }
    if (el.dataset.vistaInv) { // Lista / Cuadrícula del inventario (atributo propio: no confundir con otras «vistas»)
      await api('PUT', 'api/ajustes/vista_inventario', {valor: el.dataset.vistaInv});
      D.ajustes.vista_inventario = el.dataset.vistaInv;
      route();
      return;
    }
    if (el.id === 'ia-cambiar-clave') { $('#form-ia-config').hidden = false; el.closest('.acciones').hidden = true; $('#form-ia-config [name=clave]').focus(); return; }
    if (el.dataset.glo) { ui.sinComprobar = el.dataset.glo === 'sin'; route(); return; }
    if (await clicAjustes(el)) return;
    if (el.dataset.iaMarcar) { document.querySelectorAll('.ia-cambio').forEach((x) => (x.checked = el.dataset.iaMarcar === 'todo')); contarCambios(); return; }
    if (el.id === 'ia-aplicar-cambios') { try { await aplicarRevisionIA(el); } catch (err) { el.disabled = false; toast(err.message, true); } return; }
    if (el.dataset.iaVista) { verVistaIA(el.dataset.iaVista); return; }
    if (el.dataset.revVista) { verVistaRevision(el.dataset.revVista, REVISION); return; }
    if (el.id === 'ia-guardar-previa') { verVistaIA('editar'); $('#form-ia-ok').requestSubmit(); return; }
    if (el.id === 'ia-responder') { try { await responderIA(el); } catch (err) { el.disabled = false; toast(err.message, true); } return; } // sin redibujar: no se pierde lo editado
    if (el.id === 'ia-quitar') {
      if (!(await confirmar(t('¿Quitar la clave de OpenCode Go?\nLa IA dejará de funcionar hasta que pongas otra.'), {si: t('Quitar la clave'), peligro: true}))) return;
      D.ia = await api('PUT', 'api/ia/config', {quitarClave: true});
      toast(t('Clave quitada'));
      location.hash = '#/ia';
      return;
    }
    if (el.id === 'ia-descartar') {
      if (!(await confirmar(t('¿Descartar esta propuesta?\nNo se guarda nada.'), {si: t('Descartar'), peligro: true}))) return;
      await api('POST', `api/ia/tareas/${el.dataset.id}/descartar`);
      toast(t('Descartada'));
      location.hash = el.dataset.volver || '#/ia';
      return;
    }
    if (el.id === 'revisada') {
      await api('PATCH', `api/tipos/${el.dataset.tipo}`, {revisado: true});
      D.tipos[el.dataset.tipo].revisado = 1;
      toast(t('Ficha comprobada: ya no sale el aviso'));
    } else if (el.dataset.adj) {
      e.preventDefault();
      el.disabled = true;
      guardarLocal(await api('POST', `api/componentes/${el.dataset.id}/ajuste`, {delta: Number(el.dataset.adj)}));
    } else if (el.dataset.cat !== undefined) ui.cat = el.dataset.cat;
    else if (el.dataset.pf) ui.proFiltro = el.dataset.pf;
    else if (el.id === 'filtros-abrir') ui.filtros = !ui.filtros;
    else if (el.id === 'quitar-pendiente' || el.id === 'marcar-pendiente') {
      const marcar = el.id === 'marcar-pendiente';
      guardarLocal(await api('PATCH', `api/componentes/${location.hash.split('/')[2]}`, {revisar: marcar}));
      toast(marcar ? t('Marcada como pendiente') : t('Marca quitada'));
    } else if (el.id === 'quitar-foto') {
      if (!(await confirmar(t('¿Quitar la foto de esta pieza?'), {si: t('Quitar'), peligro: true}))) return;
      guardarLocal(await api('DELETE', `api/componentes/${location.hash.split('/')[2]}/foto`));
    } else if (el.id === 'borrar') {
      const id = location.hash.split('/')[2], nombre = comp(id)?.nombre || t('la pieza');
      const r = await api('DELETE', `api/componentes/${id}`);
      D.componentes = D.componentes.filter((c) => c.id !== Number(id));
      contadores();
      location.hash = '#/';
      toast(t('Borrada «{nombre}»', {nombre}), false, {texto: t('Deshacer'), fn: async () => {
        try {
          const x = await api('POST', 'api/componentes/restaurar', {token: r.deshacer});
          await cargar(); contadores();
          location.hash = `#/c/${x.id}`;
          toast(t('Recuperada'));
        } catch (err) { toast(err.message, true); }
      }});
      return;
    }
    route();
  } catch (err) { toast(err.message, true); route(); }
});
app.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.id === 'ubic') { ui.ubic = el.value; route(); }
  if (el.id === 'rev') { ui.revisar = el.checked; route(); }
  if (el.id === 'sin-sitio') { ui.ubic = el.checked ? '∅' : ''; route(); }
  if (el.id === 'sin-foto') { ui.sinFoto = el.checked; route(); }
  if (el.id === 'pro-estado') { try { await cambiarEstadoPro(el); } catch (err) { toast(err.message, true); route(); } }
  if (el.id === 'pro-archivo' && el.files[0]) { const f = el.files[0]; el.value = ''; try { await subirArchivoPro(f); } catch (err) { toast(err.message, true); } }
  if (el.name === 'ia-modelo') cambiarModeloIA(el);
  if (el.id === 'ia-modelo-alta') avisoModeloAlta();
  if (el.classList.contains('det-ok')) contarDeteccion();
  if (el.classList.contains('formato-cambio')) contarFormato();
  if (el.name === 'ia-razonar') {
    const antes = D.ajustes.ia_razonar;
    try { await api('PUT', 'api/ajustes/ia_razonar', {valor: el.value}); D.ajustes.ia_razonar = el.value; toast(t('La IA razonará: {nivel}', {nivel: t(RAZONAR[el.value].nombre).toLowerCase()})); }
    catch (err) { D.ajustes.ia_razonar = antes; toast(err.message, true); iaAjustes(); }
  }
  if (el.dataset.catNombre || el.dataset.sitioNombre) cambioAjustes(el);
  if (el.classList.contains('ia-cambio')) contarCambios();
  if (el.classList.contains('sel-pieza')) {
    const id = Number(el.value);
    if (el.checked) ui.sel.add(id); else ui.sel.delete(id);
    el.closest('.fila-sel, .tarjeta-sel')?.classList.toggle('marcada', el.checked);
    if (!ui.selIA) refrescarBarraSel();
  }
  if (el.classList.contains('lote-cambio')) { LOTE.desmarcados[el.checked ? 'delete' : 'add'](`${el.dataset.tarea}:${el.value}`); contarLote(); }
  if (el.id === 'aj-importar' && el.files[0]) { subirCopia(el.files[0]); el.value = ''; }
  if (el.matches('.ed-fn select')) el.closest('.ed-fn').style.cssText = colorFn(el.value); // el punto de color sigue a la función
  if (el.matches('.ed-pines .ed-fila [data-col="0"]')) separarEnEditor(el);
  if (el.name === 'varios') { const n = el.form.querySelector('[name=cantidad]'); n.disabled = el.checked; if (!el.checked && !n.value) n.value = 1; }
  if ((el.id === 'foto' || el.id === 'foto2') && el.files[0]) {
    try { await subirFoto(Number(location.hash.split('/')[2]), el.files[0]); route(); } catch (err) { toast(err.message, true); }
  }
});
app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const b = e.target.querySelector('[type=submit]');
  b.disabled = true;
  b.dataset.texto ||= b.textContent;
  if (e.target.id === 'form-ia' || e.target.id === 'form-ia-varias') b.textContent = t('Enviando…');
  if (e.target.id === 'form-ia-config') b.textContent = t('Comprobando…');
  try {
    if (e.target.id === 'form-ia') await enviarIA(e.target);
    else if (e.target.id === 'form-ia-varias') await enviarVarias(e.target);
    else if (e.target.id === 'form-ia-config') await guardarAjustesIA(e.target);
    else if (e.target.id === 'form-revisar') await enviarRevision(e.target);
    else if (e.target.id === 'aj-cat-nueva') {
      const nombre = new FormData(e.target).get('nombre');
      await api('POST', 'api/categorias', {nombre});
      await ajRefrescar(t('Categoría «{nombre}» añadida', {nombre}));
    }
    else if (e.target.id === 'form-ia-ok') await aplicarIA(e.target);
    else if (e.target.id === 'form-ficha') await guardarFicha(e.target);
    else if (e.target.id === 'form-proyecto') await guardarProyectoForm(e.target);
    else if (e.target.id === 'form-pro-tarea') await anadirTareaPro(e.target);
    else if (e.target.id === 'form-pro-nota') await anadirNotaPro(e.target);
    else if (e.target.id === 'form-lote') { await guardarLote(e.target); b.disabled = false; }
    else await guardarForm(e.target, location.hash.startsWith('#/editar/') ? location.hash.split('/')[2] : null);
  } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = b.dataset.texto; }
});
$('#tema').addEventListener('click', cambiarTema);

// ---------- botón «+» (móvil): foto con IA directa, elegir foto o a mano ----------
// con la foto se lanza el análisis al momento (2 toques); lo que quieras añadir, luego con «Responder y repensar»
function cerrarMenuFab() { const m = $('#fab-menu'); if (m) m.hidden = true; $('#fab')?.setAttribute('aria-expanded', 'false'); }
$('#fab').addEventListener('click', (e) => {
  e.preventDefault();
  const m = $('#fab-menu'), abrir = m.hidden;
  m.hidden = !abrir;
  e.currentTarget.setAttribute('aria-expanded', String(abrir));
});
document.addEventListener('click', (e) => { if (!e.target.closest('#fab, #fab-menu')) cerrarMenuFab(); });
// menú «⋯» de las fichas: se cierra al tocar fuera o al elegir algo
document.addEventListener('click', (e) => document.querySelectorAll('details.mas[open]').forEach((d) => {
  if (!d.contains(e.target) || e.target.closest('.mas-menu > a, .mas-menu > button')) d.open = false;
}));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  cerrarMenuFab();
  document.querySelectorAll('details.mas[open]').forEach((d) => { d.open = false; if (d.contains(document.activeElement)) d.querySelector('summary')?.focus(); }); // «⋯» y «Añadir pieza»
});
async function fotoDirectaIA(file) {
  cerrarMenuFab();
  if (!D.ia?.activa) { toast(t('Primero pon la clave de OpenCode Go')); location.hash = '#/ia/ajustes'; return; }
  await modelosIA().catch(() => {});
  const m = modeloIA();
  if (m && !m.vision) { toast(t('{nombre} no ve fotos: elige otro modelo o describe la pieza con texto', {nombre: m.nombre}), true); location.hash = '#/ia'; return; }
  const blob = await fotoEncuadrada(file);
  if (!blob) return;
  toast(t('Enviando foto…'));
  const foto = await base64(blob);
  const tr = await api('POST', 'api/ia/alta', {foto});
  location.hash = `#/ia/${tr.id}`;
}
// «Foto con IA» de la caja azul (escritorio): lo mismo que el del móvil (también con Intro o Espacio)
app.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('label.btn[tabindex]')) { e.preventDefault(); e.target.querySelector('input')?.click(); }
});
app.addEventListener('change', async (e) => {
  if (!e.target.classList.contains('foto-directa')) return;
  const f = e.target.files[0];
  e.target.value = '';
  e.target.closest('details')?.removeAttribute('open');
  if (f) try { await fotoDirectaIA(f); } catch (err) { toast(err.message, true); }
});
for (const id of ['fab-camara', 'fab-galeria']) $(`#${id}`).addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) try { await fotoDirectaIA(f); } catch (err) { toast(err.message, true); }
});

// buscar: desde una ficha salta a la lista de su pestaña
app.addEventListener('input', (e) => {
  if (e.target.id !== 'aj-buscar') return;
  ui.ajBuscar = e.target.value;
  const qn = norm(ui.ajBuscar);
  document.querySelectorAll('.aj-tipo').forEach((r) => (r.hidden = !!qn && !norm(r.querySelector('.nombre').textContent + ' ' + r.dataset.tipo).includes(qn)));
});

// selector de tipo: se abre al entrar, filtra al escribir, flechas + Intro para elegir, Esc para cerrar
app.addEventListener('focusin', (e) => { if (e.target.classList.contains('combo-q')) { abrirCombo(e.target.closest('.combo')); e.target.select(); } });
app.addEventListener('focusout', (e) => {
  const combo = e.target.closest?.('.combo');
  if (combo) setTimeout(() => { if (!combo.contains(document.activeElement)) cerrarCombo(combo); }, 0);
});
app.addEventListener('pointerdown', (e) => { if (e.target.closest('.combo-op')) e.preventDefault(); }); // que el campo no pierda el foco antes del clic
app.addEventListener('input', (e) => { if (e.target.classList.contains('combo-q')) abrirCombo(e.target.closest('.combo')); });
// respuesta a una duda escrita a mano: se marca la opción propuesta que coincide (o ninguna)
function marcarOpciones(li) {
  const v = norm(li.querySelector('.ia-resp').value.trim());
  li.querySelectorAll('.ia-op').forEach((o) => o.setAttribute('aria-pressed', String(!!v && norm(o.dataset.op) === v)));
}
app.addEventListener('input', (e) => { if (e.target.classList.contains('ia-resp')) marcarOpciones(e.target.closest('li')); });
// buscar en el historial y en el registro (con una pequeña espera para no preguntar en cada tecla)
app.addEventListener('input', (e) => {
  if (e.target.id !== 'hist-q' && e.target.id !== 'reg-q') return;
  clearTimeout(HIST_ESPERA);
  const v = e.target.value.trim(), es = e.target.id;
  HIST_ESPERA = setTimeout(() => { if (es === 'hist-q') { HIST.q = v; histCargar(true); } else { REG.q = v; REG.datos = null; regCargar(); } }, 300);
});
// el historial de una pieza o ficha se pide al abrir su desplegable (toggle no burbujea: en captura)
app.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.open && d.dataset?.historial && !d.dataset.cargado) { d.dataset.cargado = '1'; cargarHistDe(d); }
}, true);
app.addEventListener('keydown', (e) => {
  if (!e.target.classList.contains('combo-q')) return;
  const combo = e.target.closest('.combo'), lista = combo.querySelector('.combo-lista');
  const ops = [...lista.querySelectorAll('.combo-op')], i = ops.indexOf(lista.querySelector('.combo-op.foco'));
  const mover = (j) => { ops.forEach((o) => o.classList.remove('foco')); const o = ops[(j + ops.length) % ops.length]; o?.classList.add('foco'); o?.scrollIntoView({block: 'nearest'}); };
  if (e.key === 'ArrowDown') { e.preventDefault(); if (lista.hidden) abrirCombo(combo); mover(i + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); mover(i - 1); }
  else if (e.key === 'Enter' && !lista.hidden) { e.preventDefault(); const o = ops[i] || (ops.length === 2 ? ops[0] : null); if (o) elegirTipo(combo, o.dataset.valor); }
  else if (e.key === 'Escape') { e.stopPropagation(); cerrarCombo(combo); }
});

// buscar: en una lista (inventario, glosario, proyectos) la filtra; desde cualquier otro sitio, o con Intro, busca en todo
const vistaActual = () => location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
q.addEventListener('input', () => {
  if (['', 'glosario', 'proyectos', 'buscar'].includes(vistaActual())) route(); else location.hash = '#/buscar';
});
q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && q.value.trim()) { if (vistaActual() === 'buscar') route(); else location.hash = '#/buscar'; q.blur(); } });
// móvil: el buscador va escondido tras la lupa; se abre al tocarla y se cierra al salir de él vacío
$('#buscar-abrir').addEventListener('click', () => { document.body.classList.add('buscando'); q.focus(); });
q.addEventListener('blur', () => { if (!q.value.trim()) document.body.classList.remove('buscando'); });
document.addEventListener('keydown', (e) => {
  const escribiendo = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === '/' && !escribiendo) { e.preventDefault(); q.focus(); q.select(); }
  if (e.key === 'Escape' && document.activeElement === q) { q.value = ''; route(); q.blur(); }
});
window.addEventListener('hashchange', (e) => {
  if (/^#\/ia\/\d+$/.test(location.hash)) ui.origenTarea = {hash: location.hash, desde: e.oldURL ? new URL(e.oldURL).hash : ''};
  ui.cuentaAbierta = null;
  route(); window.scrollTo(0, 0);
});

// móvil: con el teclado abierto se esconde la barra de abajo (iOS la deja flotando en mitad de la pantalla, encima del texto)
const escribe = (el) => !!el && (el.matches('textarea, select, [contenteditable]')
  || (el.tagName === 'INPUT' && !/^(checkbox|radio|file|button|submit|range|hidden)$/.test(el.type)));
document.addEventListener('focusin', (e) => { if (escribe(e.target)) document.body.classList.add('teclado'); });
document.addEventListener('focusout', () => setTimeout(() => { if (!escribe(document.activeElement)) document.body.classList.remove('teclado'); }, 60));

// ---------- datos y modo sin conexión ----------
// sin red, el service worker (sw.js) entrega la última copia de /api/datos con la cabecera x-guardado
function aplicarIdioma() {
  I18N.set(D.ajustes?.idioma || 'en');
  CATS = Object.fromEntries(D.categorias.map((c) => [c.id, I18N.cat(c.id, c.nombre)]));
  FUNC = Object.fromEntries(D.funciones.map((f) => [f.id, {...f, nombre: I18N.fn(f.id, f.nombre)}]));
  DIF = Object.fromEntries(D.dificultades.map((d) => [d.nivel, I18N.dif(d.nivel, d.nombre)]));
  I18N.shell();
}
async function cargar() {
  let r;
  try { r = await fetch('api/datos'); } catch { throw new Error(t('sin conexión y sin copia guardada en este dispositivo')); }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
  Object.assign(D, datos);
  aplicarIdioma();
  COLOR_CAT = Object.fromEntries(D.categorias.map((c) => [c.id, c.color]));
  const guardado = r.headers.get('x-guardado');
  const aviso = $('#sin-red');
  aviso.hidden = !guardado;
  if (guardado) {
    const f = new Date(guardado).toLocaleString(I18N.loc(), {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
    $('#sin-red-txt').textContent = t('Sin conexión · datos del {fecha} · los cambios no se guardan', {fecha: f});
  }
}
async function recargar() {
  try { await cargar(); contadores(); route(); } catch {}
  if (!$('#sin-red').hidden) toast(t('Sigue sin conexión'), true);
}
$('#sin-red-btn').addEventListener('click', recargar);
window.addEventListener('online', () => { if (!$('#sin-red').hidden) recargar(); });
// con la huella de esta versión (la pone el servidor en index.html): un sw.js nuevo por versión, sin copias viejas de proxies
const VERSION_WEB = document.querySelector('meta[name=version-web]')?.content || '';
if ('serviceWorker' in navigator) navigator.serviceWorker.register(`sw.js${VERSION_WEB ? `?v=${VERSION_WEB}` : ''}`).catch(() => {}); // solo con HTTPS o localhost

(async function init() {
  try {
    await cargar();
  } catch (err) {
    app.innerHTML = vacio(t('No puedo hablar con el servidor: {msg}', {msg: esc(err.message)}));
    return;
  }
  aplicarTema();
  contadores();
  route();
})();
