// [AMS] lab — inventario, glosario y proyectos. Habla con la API del servidor (server/index.mjs).
'use strict';

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
const g = (tipo) => D.tipos[tipo] || {nombre: 'Sin tipo', categoria: 'otro'};
const catOf = (c) => g(c.tipo).categoria || 'otro';
const byName = (a, b) => a.nombre.localeCompare(b.nombre, 'es');
const comp = (id) => D.componentes.find((c) => c.id === Number(id));
const ubicaciones = () => [...new Set([...D.ubicaciones, ...D.componentes.map((c) => c.ubicacion)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
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
const stockText = (tipo) => (stock(tipo) >= MUCHOS ? 'muchos' : stock(tipo));
const faltas = (p) => (p.material || []).filter((m) => !m.opcional && stock(m.tipo) < (m.cantidad || 1));
const estadoProyecto = (p) => {
  const n = faltas(p).length;
  return n ? `<span class="mal">Falta${n > 1 ? 'n' : ''} ${n}</span>` : 'Tienes todo';
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
        <button class="btn ${peligro ? 'peligro-prim' : 'prim'}" value="si">${esc(si)}</button>
        <button class="btn" value="no">${esc(no)}</button>
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
      <span class="archivo-cruz" aria-hidden="true">+</span><span class="archivo-mas-t">${compacto ? 'Foto' : max > 1 ? 'Añadir fotos' : 'Añadir foto'}</span></label>
  </div>${ayuda ? `<span class="ayuda">${ayuda}</span>` : ''}</div>`;
};
const pesoTxt = (bytes) => { const kb = bytes / 1024; return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1).replace('.', ',')} MB`; };
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
  if (input.files.length && !nuevas.length) toast('Eso no es una imagen', true);
  let lista = max === 1 ? (nuevas.length ? nuevas.slice(0, 1) : antes) : [...antes, ...nuevas];
  lista = lista.filter((f, i) => lista.findIndex((x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified) === i); // sin repetir
  if (lista.length > max) { toast(`Como mucho ${max} fotos: me quedo con las ${max} primeras`); lista = lista.slice(0, max); }
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
    ${principal && i === 0 ? '<span class="archivo-pral">de la pieza</span>' : ''}
    <button class="archivo-x" type="button" data-i="${i}" aria-label="Quitar la foto ${i + 1}">✕</button></span>`).join('');
  const t = caja.querySelector('.archivo-mas-t');
  if (t && !caja.classList.contains('compacto')) t.textContent = fs.length ? 'Otra' : max > 1 ? 'Añadir fotos' : 'Añadir foto';
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
    b.textContent = accion.texto;
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
  try { r = await fetch(url, opts); } catch { throw new Error('Sin conexión con el servidor: no se ha guardado'); }
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
  const t = TEMAS[D.ajustes.tema] ? D.ajustes.tema : 'auto';
  document.documentElement.dataset.tema = t;
  $('#tema').textContent = TEMAS[t];
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
    src = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('No puedo leer esa imagen')); i.src = URL.createObjectURL(file); });
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
    capa.setAttribute('aria-label', 'Encuadrar la foto');
    capa.innerHTML = `<div class="enc-cab"><strong>Encuadra la pieza</strong>
        <span>Que quepa entera dentro del recuadro. Arrastra para moverla; pellizca o usa la barra para acercarla.</span></div>
      <div class="enc-escena"><canvas class="enc-img"></canvas><div class="enc-marco" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>
      <div class="enc-controles"><label class="enc-zoom-et">Acercar<input type="range" class="enc-zoom" min="1" max="${ENC_ZOOM}" step="0.01" value="1"></label>
        <button type="button" class="btn" data-enc="girar">Girar</button></div>
      <div class="enc-pie"><button type="button" class="btn" data-enc="cancelar">Cancelar</button>
        <button type="button" class="btn" data-enc="entera">Sin recortar</button>
        <button type="button" class="btn prim" data-enc="usar">Usar foto</button></div>`;
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
  if (!blob) toast('Foto cancelada: no se ha subido nada');
  return blob;
}
const base64 = (blob) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob); });

async function subirFoto(id, file) {
  const blob = await fotoEncuadrada(file);
  if (!blob) return null;
  toast('Subiendo foto…');
  const c = await api('PUT', `api/componentes/${id}/foto`, blob, {'content-type': 'image/jpeg'});
  guardarLocal(c);
  toast('Foto guardada');
  return c;
}

const revisar = (c) => (c.revisar ? ' <span class="aviso">· pendiente</span>' : '');
const stepper = (c, grande = false) => c.varios
  ? '<span class="muchos">muchos</span>'
  : `<div class="stepper ${grande ? 'grande' : ''}"><button data-adj="-1" data-id="${c.id}" aria-label="Quitar uno">−</button>
     <span class="num ${unidades(c) ? '' : 'cero'}">${esc(qtyText(c))}</span>
     <button data-adj="1" data-id="${c.id}" aria-label="Añadir uno">+</button></div>`;
const specs = (pares) => `<dl class="specs">${pares.filter(([, v]) => v !== '' && v != null)
  .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const cabecera = (titulo, cat, resumen) => `<header class="hoja-cab"><h1>${titulo}</h1>${cat ? `<span class="cat">${esc(cat)}</span>` : ''}</header>
  ${resumen ? `<p class="resumen">${esc(resumen)}</p>` : '<div class="sin-resumen"></div>'}`;

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
  <td class="pin"><i class="dot"></i>${esc(p.pin)}</td><td>${esc(p.uso)}${p.nota ? `<div class="sub pin-nota">${esc(p.nota)}</div>` : ''}</td></tr>`;
function tablaPines(f) {
  const pines = list(f.pines).map(([pin, uso, fn, nota]) => ({pin, uso, fn, nota}));
  if (!pines.length) return '';
  const usadas = Object.keys(FUNC).filter((k) => pines.some((p) => p.fn === k));
  const leyenda = `<p class="leyenda">${usadas.map((k) => `<span style="${colorPin(k)}"><i class="dot"></i>${esc(FUNC[k].nombre)}</span>`).join('')}</p>`;
  const enOrden = `<table class="t"><thead><tr><th class="n">#</th><th>Pin</th><th>Uso</th></tr></thead><tbody>${pines.map((p, i) => filaPin(p, i + 1)).join('')}</tbody></table>`;
  if (pines.length <= PINES_AGRUPAR) return `<h3>Pines</h3>${enOrden}${leyenda}`;
  const vista = ui.pinesVista === 'orden' ? 'orden' : 'funcion';
  const grupos = usadas.map((k) => {
    const ps = pines.filter((p) => p.fn === k), notas = ps.filter((p) => p.nota).length;
    return `<details class="pin-grupo" style="${colorPin(k)}"><summary><i class="dot"></i><span class="pin-grupo-t">${esc(FUNC[k].nombre)}<span class="n">${ps.length}</span></span>
      <span class="pin-grupo-pines${FUNC[k].tachado ? ' tachado' : ''}">${esc(resumenPines(ps.map((p) => p.pin)))}</span>${notas ? `<span class="pin-grupo-notas">${plural(notas, 'nota')}</span>` : ''}</summary>
      <table class="t"><tbody>${ps.map((p) => filaPin(p)).join('')}</tbody></table></details>`;
  }).join('');
  return `<div class="pines" data-pines-modo="${vista}"><div class="pines-cab"><h3>Pines<span class="n">${pines.length}</span></h3>
      <span class="conmuta" role="group" aria-label="Cómo ver los pines">${[['funcion', 'Por función'], ['orden', 'En orden']].map(([k, t]) =>
        `<button class="f ${vista === k ? 'on' : ''}" type="button" data-pines-vista="${k}" aria-pressed="${vista === k}">${t}</button>`).join('')}</span></div>
    <div class="pines-funcion">${grupos}</div><div class="pines-orden">${enOrden}${leyenda}</div></div>`;
}

// ---------- vistas ----------
// el tipo en la fila de una pieza: solo lo que el nombre de la pieza no dice ya («HC-SR04» + «ultrasonidos»; nada si
// el tipo se llama igual que la pieza)
const PALABRAS_VACIAS = new Set(['de', 'del', 'con', 'la', 'el', 'los', 'las', 'para', 'por', 'en']);
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
const etqCat = (cat, cls = 'pz-cat') => `<span class="${cls}"${conColor(cat)}>${marcaCat}<span class="pz-cat-t">${esc(CATS[cat] || 'Otros')}</span></span>`;
// imagen de una pieza: su foto o el dibujo de su tipo sobre el color de su categoría (sin dibujo, solo el color)
const imgPieza = (c, cls) => (c.foto ? `<span class="${cls}"><img src="${fotoUrl(c)}" alt="" loading="lazy"></span>`
  : `<span class="${cls} dibujo"${conColor(catOf(c))}>${c.tipo ? `<img src="img/tipos/${esc(c.tipo)}.svg" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`);
const cuenta = (c) => `<span class="cuenta num${unidades(c) || c.varios ? '' : ' cero'}">${esc(qtyText(c))}</span>`;
const etqPend = (c) => (c.revisar ? '<span class="etq-pend">pendiente</span>' : '');

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
    ${c.varios ? '' : `<button class="cuenta-btn num" type="button" data-cuenta="${c.id}" aria-label="Cambiar la cantidad (${esc(qtyText(c))})">${esc(qtyText(c))}</button>`}
    ${stepper(c)}</div>`;
}
const CAB_INVENTARIO = `<div class="fila fila-cab solo-escritorio" aria-hidden="true"><div class="fila-main">Pieza</div>
  <div class="fila-cols"><span>Sitio</span><span>Tensión</span><span>Interfaz</span></div><div class="fila-cant">Cantidad</div></div>`;

// cuadrícula: foto o dibujo arriba, la cantidad en la esquina y debajo nombre, categoría y sitio
function tarjetaComp(c) {
  return `<a class="tarjeta" href="#/c/${c.id}">${imgPieza(c, 'tarjeta-img')}${etqPend(c)}${cuenta(c)}
    <span class="tarjeta-txt"><span class="nombre">${esc(c.nombre)}</span>
      <span class="tarjeta-meta">${etqCat(catOf(c))}<span class="sitio">${esc(c.ubicacion || 'sin sitio')}</span></span></span></a>`;
}
const vistaInv = () => (D.ajustes.vista_inventario === 'cuadricula' ? 'cuadricula' : 'lista');

// en una lista filtrada: «también hay N tipos y M proyectos con eso» → búsqueda en todo
function tambien(query, aqui) {
  if (!query) return '';
  const r = buscarTodo(query), partes = [];
  if (aqui !== 'piezas' && r.piezas.length) partes.push(plural(r.piezas.length, 'pieza'));
  if (aqui !== 'tipos' && r.tipos.length) partes.push(plural(r.tipos.length, 'tipo'));
  if (aqui !== 'proyectos' && r.proyectos.length) partes.push(plural(r.proyectos.length, 'proyecto'));
  return partes.length ? `<p class="tambien">También con «${esc(query)}»: <a href="#/buscar">${partes.join(', ')} →</a></p>` : '';
}

// la caja azul: lo principal de la pantalla es añadir piezas con la IA (solo escritorio; en el móvil, el «+»)
function cajaIA() {
  if (!D.ia?.activa) return `<section class="caja-ia solo-escritorio"><span class="caja-ia-ico">${ICO.camara}</span>
    <div><b class="caja-ia-t">Añadir con IA</b><p>Pon tu clave de OpenCode Go y la IA identificará tus piezas por foto: nombre, tipo y pines.</p></div>
    <div class="caja-ia-bot"><a class="btn blanco" href="#/ia/ajustes">Configurar la IA</a></div></section>`;
  return `<section class="caja-ia solo-escritorio"><span class="caja-ia-ico">${ICO.camara}</span>
    <div><b class="caja-ia-t">Añadir con IA</b><p>Haz una foto a una pieza (o a varias a la vez): la IA propone nombre, tipo y pines, y tú lo revisas antes de guardar.
      <a href="#/ia">Con foto y texto →</a></p></div>
    <div class="caja-ia-bot"><label class="btn amarillo" tabindex="0">Foto con IA<input type="file" accept="image/*" class="foto-directa" hidden></label>
      <a class="btn blanco" href="#/ia/varias">Varias piezas</a></div></section>`;
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
  const lado = `<aside class="lado" aria-label="Filtros">
    <h2 class="lado-t solo-escritorio">Categorías</h2>
    <div class="lado-caja lado-cats solo-escritorio">${opCat('', 'Todas', todas.length, 'lado-op')}${catsVisibles.map((k) => opCat(k, CATS[k], porCat[k], 'lado-op')).join('')}</div>
    <h2 class="lado-t">Mostrar</h2>
    <div class="lado-caja lado-mostrar">
      <label class="lado-op"><input type="checkbox" id="rev" ${ui.revisar ? 'checked' : ''}>Con «pendiente»<span class="n">${n((c) => c.revisar)}</span></label>
      <label class="lado-op"><input type="checkbox" id="sin-sitio" ${ui.ubic === '∅' ? 'checked' : ''}>Sin sitio<span class="n">${n((c) => !c.ubicacion)}</span></label>
      <label class="lado-op"><input type="checkbox" id="sin-foto" ${ui.sinFoto ? 'checked' : ''}>Sin foto<span class="n">${n((c) => !c.foto)}</span></label>
      ${sitios.length ? `<label class="lado-sitio"><span>Sitio</span><select id="ubic" class="sel"><option value="">Cualquier sitio</option>
        ${sitios.map((u) => `<option ${ui.ubic === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>` : ''}
    </div></aside>`;
  const cab = `<div class="inv-cab"><h1>Inventario <small>${piezasTxt(todas.length)}</small></h1>
    <button class="btn icono solo-movil${ui.filtros || activos ? ' on' : ''}" id="filtros-abrir" type="button" aria-expanded="${!!ui.filtros}" aria-label="Filtros y vista">${ICO.filtros}${activos ? `<span class="n">${activos}</span>` : ''}</button>
    <div class="inv-acciones">
      <div class="seg" role="group" aria-label="Vista">${[['cuadricula', 'Cuadrícula', ICO.rejilla], ['lista', 'Lista', ICO.lista]].map(([k, v, i]) =>
        `<button type="button" class="${vistaInv() === k ? 'on' : ''}" data-vista-inv="${k}" aria-pressed="${vistaInv() === k}">${i}${v}</button>`).join('')}</div>
      <button class="btn${ui.seleccionando ? ' on' : ''}" id="sel-modo" type="button">${ui.seleccionando ? 'Terminar' : 'Seleccionar'}</button>
      <a class="btn solo-escritorio" href="#/nuevo">${ICO.mas}A mano</a>
    </div></div>
    <div class="chips solo-movil">${opCat('', 'Todas', todas.length, 'chip')}${catsVisibles.map((k) => opCat(k, CATS[k], porCat[k], 'chip')).join('')}</div>`;

  let cuerpo;
  const sel = ui.seleccionando, rejilla = vistaInv() === 'cuadricula';
  if (!todas.length) cuerpo = vacio('Aún no hay piezas. Pulsa + para añadir la primera.');
  else if (!cs.length) cuerpo = tambien(query, 'piezas') + vacio('Nada coincide con el filtro.');
  else {
    cs.sort((a, b) => orden.indexOf(catOf(a)) - orden.indexOf(catOf(b)) || byName(a, b));
    ui.visibles = cs.map((c) => c.id);
    const cabSel = sel ? `<div class="sel-cab"><span class="gris">Elige las piezas:</span>
      <button class="f" type="button" data-sel="visibles">Todas las que se ven (${cs.length})</button>
      <button class="f" type="button" data-sel="ninguna">Ninguna</button></div>` : '';
    cuerpo = tambien(query, 'piezas') + cabSel + (rejilla
      ? `<div class="rejilla">${cs.map(sel ? tarjetaSel : tarjetaComp).join('')}</div>`
      : `<div class="lista-piezas${sel ? ' sel' : ''}">${sel ? '' : CAB_INVENTARIO}${cs.map(sel ? filaSel : filaComp).join('')}</div>`);
  }
  return `<div class="inv${ui.filtros ? ' filtros-abiertos' : ''}">${lado}<div class="inv-main">${cab}${sel ? '' : cajaIA()}
    <div id="pend-aviso" aria-live="polite"></div>${cuerpo}</div></div>${sel ? `<div class="sel-hueco"></div>${barraSel()}` : ''}`;
}

// ---------- varias piezas a la vez: elegir en el Inventario, editarlas juntas y corregirlas con la IA ----------
// ui.sel: ids elegidos (se mantienen al ir a «Editar juntas»); ui.seleccionando: el Inventario está en modo elegir
const MAX_LOTE_IA = 30;
const selIds = () => [...ui.sel].filter((id) => comp(id));
const piezasTxt = (n) => `${n} pieza${n === 1 ? '' : 's'}`;
function filaSel(c) {
  const marcada = ui.sel.has(c.id);
  return `<label class="fila fila-sel${marcada ? ' marcada' : ''}"><input type="checkbox" class="sel-pieza" value="${c.id}" ${marcada ? 'checked' : ''} aria-label="Elegir ${esc(c.nombre)}">
    ${imgPieza(c, 'fila-img')}
    <span class="fila-sel-txt"><span class="nombre">${esc(c.nombre)}${revisar(c)}</span>
      <span class="sub">${[c.tipo ? g(c.tipo).nombre : '', c.ubicacion].filter(Boolean).map(esc).join(' · ')}</span></span>
    <span class="der num">${esc(qtyText(c))}</span></label>`;
}
function tarjetaSel(c) {
  const marcada = ui.sel.has(c.id);
  return `<label class="tarjeta tarjeta-sel${marcada ? ' marcada' : ''}">
    <input type="checkbox" class="sel-pieza" value="${c.id}" ${marcada ? 'checked' : ''} aria-label="Elegir ${esc(c.nombre)}">
    ${imgPieza(c, 'tarjeta-img')}${cuenta(c)}
    <span class="tarjeta-txt"><span class="nombre">${esc(c.nombre)}</span>
      <span class="tarjeta-meta">${etqCat(catOf(c))}<span class="sitio">${esc(c.ubicacion || 'sin sitio')}</span></span></span></label>`;
}
// barra fija abajo con lo que se puede hacer con las elegidas
function barraSel() {
  const n = selIds().length, ia = D.ia?.activa;
  if (ui.selIA) {
    const m = (MODELOS_IA || []).find((x) => x.id === D.ia?.modelo);
    const coste = m?.coste_medio?.dolares ?? (m ? ((m.precio.entrada ?? 0) * 6000 + (m.precio.salida ?? 0) * 900) / 1e6 : null);
    return `<div class="sel-barra sel-barra-ia" id="sel-barra" role="region" aria-label="Corregir con IA las elegidas">
      <p><strong>Corregir ${piezasTxt(n)} con IA.</strong> ${n > MAX_LOTE_IA ? `<span class="mal">Como mucho ${MAX_LOTE_IA} a la vez.</span>`
        : `Una consulta por pieza${coste != null ? ` (≈ ${dolares(coste * n)} en total)` : ''}; después revisas los cambios de todas en una pantalla.`}</p>
      <textarea id="sel-ia-texto" rows="2" maxlength="1000" placeholder="Qué corregir (opcional, vale para todas): «revisa los pines», «pon el nombre con el modelo»…"></textarea>
      <div class="sel-botones"><button class="btn prim" type="button" data-sel-acc="ia-enviar" ${n && n <= MAX_LOTE_IA ? '' : 'disabled'}>Pedir ${n} correcci${n === 1 ? 'ón' : 'ones'}</button>
        <button class="btn" type="button" data-sel-acc="ia-cancelar">Cancelar</button></div></div>`;
  }
  return `<div class="sel-barra" id="sel-barra" role="region" aria-label="Piezas elegidas">
    <span class="sel-n">${n ? `<strong>${n}</strong> elegida${n === 1 ? '' : 's'}` : 'Toca las piezas para elegirlas'}</span>
    <div class="sel-botones">
      <button class="btn prim" type="button" data-sel-acc="editar" ${n ? '' : 'disabled'}>Editar juntas</button>
      ${ia ? `<button class="btn" type="button" data-sel-acc="ia" ${n ? '' : 'disabled'}>Corregir con IA</button>` : ''}
      ${menuMas([
        `<button role="menuitem" type="button" data-sel-acc="pendiente" ${n ? '' : 'disabled'}>Marcar como pendientes</button>`,
        `<button role="menuitem" type="button" data-sel-acc="sin-pendiente" ${n ? '' : 'disabled'}>Quitar la marca de pendiente</button>`,
        `<button role="menuitem" type="button" class="peligro" data-sel-acc="borrar" ${n ? '' : 'disabled'}>Borrar las elegidas</button>`])}
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
    toast(acc === 'pendiente' ? `${piezasTxt(ids.length)} marcadas como pendientes` : `Marca quitada a ${piezasTxt(ids.length)}`);
    route();
    return;
  }
  if (acc === 'borrar') {
    if (!(await confirmar(`¿Borrar ${piezasTxt(ids.length)}?\nPodrás deshacerlo durante 2 minutos.`, {si: 'Borrar', peligro: true}))) return;
    const r = await api('POST', 'api/componentes/lote/borrar', {ids});
    D.componentes = D.componentes.filter((c) => !ids.includes(c.id));
    salirSeleccion(); contadores(); route();
    toast(`${piezasTxt(r.borradas)} borradas`, false, {texto: 'Deshacer', fn: async () => {
      try { await api('POST', 'api/componentes/restaurar', {tokens: r.deshacer}); await cargar(); contadores(); route(); toast('Recuperadas'); }
      catch (err) { toast(err.message, true); }
    }});
  }
}
function salirSeleccion() { ui.seleccionando = false; ui.sel.clear(); ui.selIA = false; }

// ---- «Editar juntas»: una tabla con las elegidas; arriba, «A todas» para poner lo mismo a todas ----
function opcionesTiposLista(sel) {
  return '<option value="">Sin tipo</option>' + Object.keys(CATS).map((cat) => {
    const ts = Object.entries(D.tipos).filter(([k, t]) => t.categoria === cat && (!t.archivado || k === sel)).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, 'es'));
    return ts.length ? `<optgroup label="${esc(CATS[cat])}">${ts.map(([k, t]) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}
function vLote() {
  const cs = selIds().map(comp).sort(byName);
  if (!cs.length) return `<a class="back" href="#/">← Inventario</a>${vacio('No hay piezas elegidas. En el Inventario, pulsa «Seleccionar» y toca las que quieras.')}`;
  return `<a class="back" href="#/">← Inventario</a>
    <article class="hoja">
      ${cabecera(`Editar ${piezasTxt(cs.length)}`, '', 'Cambia lo que quieras: solo se guarda lo que cambies. Con «A todas» les pones lo mismo a todas de una vez.')}
      <section class="pad lote-todas">
        <h3>A todas</h3>
        <div class="lote-todas-filas">
          <label>Sitio<input id="lt-sitio" list="ubics" maxlength="120" placeholder="Cajita 3"></label>
          <button class="btn mini" type="button" data-lote-todas="sitio">Poner</button>
          <label>Tipo<select id="lt-tipo">${opcionesTiposLista('')}</select></label>
          <button class="btn mini" type="button" data-lote-todas="tipo">Poner</button>
          <span class="lote-todas-pend">Pendiente</span>
          <span class="lote-todas-botones"><button class="btn mini" type="button" data-lote-todas="pend-si">Marcar</button>
            <button class="btn mini" type="button" data-lote-todas="pend-no">Quitar</button></span>
        </div>
      </section>
      <form id="form-lote" class="lote" autocomplete="off">
        <div class="lote-cab" aria-hidden="true"><span>Nombre</span><span>Cantidad</span><span>Sitio</span><span>Tipo</span><span>Pendiente</span></div>
        ${cs.map((c) => `<div class="lote-fila" data-id="${c.id}">
          <label class="lote-celda lc-nombre"><span class="ed-et">Nombre</span><input name="nombre" maxlength="200" required value="${esc(c.nombre)}"></label>
          <label class="lote-celda lc-cantidad"><span class="ed-et">Cantidad</span><input name="cantidad" type="number" min="0" inputmode="numeric"
            value="${c.varios ? '' : esc(c.cantidad ?? '')}" placeholder="${c.varios ? 'muchas' : 'Cantidad'}"></label>
          <label class="lote-celda lc-sitio"><span class="ed-et">Sitio</span><input name="ubicacion" list="ubics" maxlength="120" value="${esc(c.ubicacion)}" placeholder="Sitio"></label>
          <label class="lote-celda lc-tipo"><span class="ed-et">Tipo</span><select name="tipo">${opcionesTiposLista(c.tipo || '')}</select></label>
          <label class="lote-celda lc-pend"><input type="checkbox" name="revisar" ${c.revisar ? 'checked' : ''}><span class="ed-et">Pendiente</span></label>
        </div>`).join('')}
        <datalist id="ubics">${ubicaciones().map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
        <div class="acciones"><button class="btn prim" type="submit">Guardar cambios</button><a class="btn" href="#/">Cancelar</a></div>
      </form>
    </article>`;
}
function ponerATodas(que) {
  const filas = document.querySelectorAll('#form-lote .lote-fila');
  if (que === 'sitio') { const v = $('#lt-sitio').value.trim(); filas.forEach((f) => (f.querySelector('[name=ubicacion]').value = v)); toast(v ? `Sitio «${v}» puesto a todas (falta guardar)` : 'Sitio vaciado en todas (falta guardar)'); }
  if (que === 'tipo') { const v = $('#lt-tipo').value; filas.forEach((f) => (f.querySelector('[name=tipo]').value = v)); toast(`Tipo «${v ? g(v).nombre : 'Sin tipo'}» puesto a todas (falta guardar)`); }
  if (que === 'pend-si' || que === 'pend-no') { filas.forEach((f) => (f.querySelector('[name=revisar]').checked = que === 'pend-si')); toast('Hecho en todas (falta guardar)'); }
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
  if (!piezas.length) { toast('No has cambiado nada'); return; }
  await api('POST', 'api/componentes/lote', {piezas});
  await cargar(); contadores();
  salirSeleccion();
  location.hash = '#/';
  toast(`${piezasTxt(piezas.length)} guardada${piezas.length === 1 ? '' : 's'}`);
}

// ---- correcciones de varias piezas: todas en una pantalla; se aplica lo marcado de todas a la vez ----
const LOTE = {id: null, desmarcados: new Set()};
function filaCambio(c, extra = '') {
  return `<span class="nombre">${esc(c.etiqueta)}${c.tipoCambio === 'nuevo' ? ' <span class="gris">· nuevo</span>' : c.tipoCambio === 'quitado' ? ' <span class="gris">· se quita</span>' : ''}</span>
    ${c.antes ? `<span class="ia-antes">${esc(c.antes)}</span>` : ''}
    ${c.despues ? `<span class="ia-ahora">${esc(c.despues)}</span>` : ''}${extra}`;
}
function vLoteIA(id) {
  return `<a class="back" href="#/pendientes">← Cambios pendientes</a><article class="hoja" id="lote-zona" data-lote="${esc(id)}"><p class="gris pad">Cargando…</p></article>`;
}
function htmlLote(ts) {
  if (ts[0].clase === 'alta') return htmlLoteAltas(ts);
  const listas = ts.filter((t) => t.estado !== 'pendiente').length;
  const tarea = (t) => {
    const c = comp(t.objetivo?.componente_id), cambios = t.propuesta?.cambios || [];
    const estado = {pendiente: 'pensando…', propuesta: cambios.length ? `${cambios.length} cambio${cambios.length === 1 ? '' : 's'}` : 'nada que cambiar',
      aplicada: 'aplicada', descartada: 'descartada', error: 'error'}[t.estado] || t.estado;
    const cuerpo = t.estado === 'error' ? `<p class="mal">${esc(t.error || 'Error')}</p>`
      : t.estado === 'propuesta' ? `${cambios.map((x) => `<label class="ia-cambio-fila"><input type="checkbox" class="lote-cambio" data-tarea="${t.id}" value="${esc(x.id)}"
          ${LOTE.desmarcados.has(`${t.id}:${x.id}`) ? '' : 'checked'}><span>${filaCambio(x)}</span></label>`).join('')}
        ${t.propuesta.dudas?.length ? `<p class="ayuda">La IA tiene ${t.propuesta.dudas.length === 1 ? 'una duda' : `${t.propuesta.dudas.length} dudas`}: <a href="#/ia/${t.id}">ábrela para contestar</a> (o para ver la vista previa).</p>` : ''}` : '';
    return `<section class="pad lote-tarea lote-${t.estado}">
      <div class="lote-t"><a class="nombre" href="${c ? `#/c/${c.id}` : '#/'}">${esc(t.objetivo_nombre || c?.nombre || '¿?')}</a>
        <span class="gris">· ${esc(estado)}</span>${t.estado === 'propuesta' ? `<a class="lote-abrir" href="#/ia/${t.id}">Abrir</a>` : ''}</div>${cuerpo}</section>`;
  };
  const quedan = ts.some((t) => t.estado === 'propuesta' || t.estado === 'error');
  return `${cabecera(`Correcciones de ${piezasTxt(ts.length)}`, '', listas < ts.length
      ? `Pensando… ${listas} de ${ts.length} listas. Puedes ir mirando las que ya han llegado.`
      : 'Marca lo que quieras aplicar. Lo que no marques se queda como está.')}
    ${listas < ts.length ? '<div class="ia-progreso" role="progressbar" aria-label="La IA está pensando"><span></span></div>' : ''}
    ${ts.map(tarea).join('')}
    ${quedan ? `<div class="acciones pad lote-acciones">
      <button class="btn prim" type="button" id="lote-aplicar">Aplicar lo marcado</button>
      <button class="btn" type="button" data-lote-marcar="todo">Marcar todo</button>
      <button class="btn" type="button" data-lote-marcar="nada">Ninguno</button>
      <button class="btn peligro" type="button" id="lote-descartar">Descartar lo que quede</button></div>` : '<p class="pad gris">Ya no queda nada por revisar en este lote.</p>'}`;
}
function contarLote() {
  const g2 = $('#lote-guardar');
  if (g2) { const n = document.querySelectorAll('.lote-cambio:checked').length; g2.textContent = n ? `Guardar ${piezasTxt(n)}` : 'Marca alguna pieza'; g2.disabled = !n; return; }
  const b = $('#lote-aplicar');
  if (!b) return;
  const marcados = document.querySelectorAll('.lote-cambio:checked'), piezas = new Set([...marcados].map((x) => x.dataset.tarea)).size;
  b.textContent = marcados.length ? `Aplicar ${marcados.length} cambio${marcados.length === 1 ? '' : 's'} en ${piezasTxt(piezas)}` : 'Marca algún cambio';
  b.disabled = !marcados.length;
}
async function iaLote(id) {
  const zona = $('#lote-zona');
  if (!zona || zona.dataset.lote !== id) return;
  if (LOTE.id !== id) { LOTE.id = id; LOTE.desmarcados = new Set(); }
  let ts;
  try { ts = await api('GET', `api/ia/lotes/${encodeURIComponent(id)}`); } catch (err) { zona.innerHTML = `<p class="mal pad">${esc(err.message)}</p>`; return; }
  if (!ts.length) { zona.innerHTML = `<p class="gris pad">Ese lote no existe.</p>`; return; }
  zona.innerHTML = htmlLote(ts);
  contarLote();
  if (ts.some((t) => t.estado === 'pendiente')) { const h = location.hash; setTimeout(() => { if (location.hash === h) iaLote(id); }, 3000); }
}
async function aplicarLote(boton) {
  const porTarea = {};
  document.querySelectorAll('.lote-cambio:checked').forEach((x) => (porTarea[x.dataset.tarea] ||= []).push(x.value));
  const tareas = Object.keys(porTarea);
  if (!tareas.length) throw new Error('Marca algún cambio');
  boton.disabled = true;
  boton.textContent = 'Aplicando…';
  let bien = 0, cambios = 0;
  const mal = [];
  for (const t of tareas) { // una a una: si dos piezas comparten tipo, la segunda ve la ficha ya cambiada
    try { const r = await api('POST', `api/ia/tareas/${t}/aplicar-cambios`, {ids: porTarea[t]}); bien++; cambios += r.aplicados; }
    catch (err) { mal.push(err.message); }
  }
  await cargar(); contadores();
  await iaLote(LOTE.id);
  toast(`${cambios} cambio${cambios === 1 ? '' : 's'} aplicado${cambios === 1 ? '' : 's'} en ${piezasTxt(bien)}${mal.length ? `; ${mal.length} no (ábrelas: ${mal[0]})` : ''}`, mal.length > 0);
}
async function descartarLote() {
  const ts = await api('GET', `api/ia/lotes/${encodeURIComponent(LOTE.id)}`);
  const quedan = ts.filter((t) => t.estado === 'propuesta' || t.estado === 'error');
  const altas = ts[0]?.clase === 'alta';
  if (!quedan.length || !(await confirmar(altas ? `¿Descartar las ${piezasTxt(quedan.length)} que quedan sin guardar?\nNo se añaden al inventario.`
    : `¿Descartar las ${quedan.length} correcciones que quedan?\nNo se cambia nada de tus piezas ni de sus fichas.`, {si: 'Descartar', peligro: true}))) return;
  for (const t of quedan) await api('POST', `api/ia/tareas/${t.id}/descartar`).catch(() => {});
  await iaLote(LOTE.id);
  toast('Descartadas');
}


// ---------- búsqueda en todo (piezas, tipos y proyectos) ----------
function buscarTodo(query) {
  const piezas = D.componentes.filter((c) => matches(compText(c), query)).sort(byName);
  const tipos = Object.entries(D.tipos).map(([k, t]) => ({k, ...t})).filter((t) => !t.archivado && matches([t.k, t.nombre, t.resumen,
    CATS[t.categoria], ...list(t.alias), ...list(t.interfaz), ...list(t.pines).flat(), ...list(t.datos).flat()].join(' '), query)).sort(byName);
  const proyectos = D.proyectos.filter((p) => matches(textoProyecto(p), query));
  return {piezas, tipos, proyectos};
}
const filaTipo = (t) => `<div class="fila"><a class="fila-main" href="#/g/${esc(t.k)}"><div><div class="nombre">${esc(t.nombre)}${t.revisado === 0 ? ' <span class="aviso">· sin comprobar</span>' : ''}</div>
  <div class="sub">${esc(t.resumen || '')}</div></div></a>
  <div class="der"><div class="${stock(t.k) ? '' : 'gris'}">${stock(t.k) ? `Tienes ${stockText(t.k)}` : 'No tienes'}</div><div class="sub">${esc(voltajeDe(t))}</div></div></div>`;

function vBuscar() {
  const query = q.value.trim();
  if (!query) return `<h1 class="titulo-vista">Buscar</h1><p class="gris">Escribe arriba. Busca en las piezas (nombre, notas, sitio), en el glosario
    (nombre, alias, interfaces, pines y datos) y en los proyectos.</p>`;
  const r = buscarTodo(query), n = r.piezas.length + r.tipos.length + r.proyectos.length;
  const grupo = (titulo, items, html) => (items.length ? `<section class="grupo"><h3 class="grupo-t">${titulo}<span class="n">${items.length}</span></h3>${html}</section>` : '');
  return `<h1 class="titulo-vista">«${esc(query)}» <span class="gris">· ${plural(n, 'resultado')}</span></h1>${n ? '' : vacio(`Nada con «${esc(query)}».`)}
    ${grupo('Piezas', r.piezas, r.piezas.map(filaComp).join(''))}
    ${grupo('Tipos', r.tipos, r.tipos.map(filaTipo).join(''))}
    ${grupo('Proyectos', r.proyectos, listaProyectos(r.proyectos))}`;
}

// ---------- fichas (pieza y tipo): arriba lo que se consulta con la pieza en la mano (cuántas, dónde, avisos y pines);
// lo demás, plegado. Las acciones, en una fila de botones pequeños con un menú «⋯» para lo que se usa poco.
const lineaTecnica = (f) => (voltajeDe(f) || list(f.interfaz).length ? `<p class="sec-datos">${[
  voltajeDe(f) ? `<span><span class="gris">Tensión</span> ${esc(voltajeDe(f))}</span>` : '',
  list(f.interfaz).length ? `<span><span class="gris">Interfaces</span> ${esc(list(f.interfaz).join(', '))}</span>` : ''].join('')}</p>` : '');
const tablaDatos = (pares) => (list(pares).length ? `<table class="t datos"><tbody>${pares.map(([k, v]) =>
  `<tr><td class="gris">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>` : '');
// sección plegada (cerrada al abrir la ficha); no sale si no tiene nada
const plegable = (titulo, html, n = null) => (html ? `<details class="plegable"><summary>${titulo}${n != null ? `<span class="n">${n}</span>` : ''}</summary>
  <div class="plegable-cuerpo">${html}</div></details>` : '');
// menú «⋯»: acciones que se usan poco
const menuMas = (items) => `<details class="mas"><summary class="btn" aria-label="Más acciones">⋯</summary>
  <div class="mas-menu" role="menu">${items.filter(Boolean).join('')}</div></details>`;
// cabecera compacta: imagen pequeña (foto o dibujo), nombre, una línea de datos y, si toca, el contador
const cabFicha = ({img = '', titulo, linea, extra = ''}) => `<header class="pz-cab${img ? '' : ' sin-img'}">${img}
  <div class="pz-tit"><h1>${titulo}</h1>${linea ? `<p class="pz-linea">${linea}</p>` : ''}${extra}</div></header>`;

// ---------- fichas de pieza y de tipo: dos columnas (mockup del 23/11/2026) ----------
// izquierda: la imagen grande y lo de esta pieza (o tus piezas del tipo); derecha: nombre, acciones, avisos, pines y ficha del tipo.
// En el móvil todo va en una columna: imagen, nombre, acciones, avisos, esta pieza, pines y ficha del tipo.
const migas = (partes) => `<nav class="migas" aria-label="Estás en">${partes.join('<span class="migas-sep" aria-hidden="true">/</span>')}</nav>`;
// cajetín de dos columnas: una celda que se queda sola en su fila ocupa las dos (sin huecos)
function cajetin(celdas) {
  const cs = celdas.filter(Boolean).map(([k, v, ancho]) => ({k, v, ancho: !!ancho}));
  let col = 0;
  cs.forEach((c, i) => {
    if (c.ancho) { if (col === 1) cs[i - 1].ancho = true; col = 0; } else col = 1 - col;
  });
  if (col === 1 && cs.length) cs[cs.length - 1].ancho = true;
  return `<dl class="cajetin">${cs.map((c) => `<div${c.ancho ? ' class="ancho"' : ''}><dt>${c.k}</dt><dd>${c.v}</dd></div>`).join('')}</dl>`;
}
const imagenGrande = ({foto = '', tipo = '', cat, pie}) => `<figure class="fi-img${foto ? ' con-foto' : ''}"${conColor(cat)}>
  ${foto ? `<a class="fi-img-marco" href="${foto}" target="_blank" aria-label="Ver la foto grande"><img src="${foto}" alt=""></a>`
    : `<span class="fi-img-marco">${tipo ? `<img src="img/tipos/${esc(tipo)}.svg" alt="" onerror="this.remove()">` : ''}</span>`}
  <figcaption>${pie}</figcaption></figure>`;
const notaOjo = (f) => (f.ojo ? `<div class="ams-aviso aviso-ojo"><b>${ICO.aviso}Ojo</b><p>${esc(f.ojo)}</p></div>` : '');
// pines y, al lado, la ficha del tipo (tensión, pines, interfaces, estado, datos y proyectos). Las placas con muchos pines
// (agrupados por función) ocupan todo el ancho y la ficha del tipo va debajo
function fichaDelTipo(f, tipo, ps, pie = '') {
  const pines = tablaPines(f), nPines = list(f.pines).length;
  const celdas = [['Tensión', esc(voltajeDe(f)) || '—'], ['Pines', nPines || '—'],
    list(f.interfaz).length ? ['Interfaces', esc(list(f.interfaz).join(', ')), true] : null,
    ...list(f.datos).map(([k, v]) => [esc(k), esc(v)]),
    list(f.alias).length ? ['Otros nombres', esc(list(f.alias).join(', ')), true] : null,
    ['Estado', f.revisado === 0 ? '<span class="aviso">Sin comprobar</span>' : 'Comprobada ✓']];
  return `<div class="fi-dos${!pines || nPines > PINES_AGRUPAR ? ' una' : ''}">
    ${pines ? `<section class="fi-pines"><h2 class="rotulo">Pines</h2><div class="caja">${pines}</div></section>` : ''}
    <section class="fi-tipo"><h2 class="rotulo">Ficha del tipo</h2><div class="caja fi-tipo-caja">${cajetin(celdas)}
      ${ps.length ? `<h3 class="fi-h">Proyectos que la usan</h3><div class="fi-proyectos">${listaProyectos(ps)}</div>` : ''}
      ${pie ? `<p class="meta">${pie}</p>` : ''}</div></section></div>`;
}

function vComponente(id) {
  const c = comp(id);
  if (!c) return vacio('No existe esa pieza.');
  const f = g(c.tipo), conTipo = !!(c.tipo && D.tipos[c.tipo]), cat = catOf(c), ia = D.ia?.activa;
  const delTipo = conTipo ? D.componentes.filter((x) => x.tipo === c.tipo).length : 0;
  const ps = conTipo ? proyectosDe(c.tipo) : [];
  const datos = list(c.datos).length ? c.datos.map(([k, v]) => [esc(k), esc(v)]) : [['Datos propios', '—']];
  const esta = `<section class="caja fi-esta"><div class="fi-esta-cab"><h2 class="rotulo">Esta pieza</h2>
      ${c.revisar ? '<button class="btn mini" id="quitar-pendiente" type="button">Hecho: quitar «pendiente»</button>'
        : '<button class="btn mini" id="marcar-pendiente" type="button">Marcar pendiente</button>'}</div>
    ${c.revisar ? '<p class="fi-pend">La marcaste para mirar algo de ella más tarde.</p>' : ''}
    ${cajetin([['Cantidad', stepper(c, true)], ['Sitio', esc(c.ubicacion || 'Sin sitio')],
      ['Tipo', conTipo ? `<a href="#/g/${esc(c.tipo)}">${esc(f.nombre)}</a>${f.archivado ? ' (archivado)' : ''}` : 'Sin tipo', true],
      ['Categoría', etqCat(cat)], ...datos])}
    ${c.notas ? `<div class="fi-notas"><h3 class="rotulo">Notas</h3><p class="notas">${esc(c.notas)}</p></div>` : ''}</section>`;
  return `${migas(['<a href="#/" data-cat="">Inventario</a>', `<a href="#/" data-cat="${esc(cat)}">${esc(CATS[cat] || 'Otros')}</a>`, `<span>${esc(c.nombre)}</span>`])}
    <article class="fi">
      <div class="fi-izq">
        ${imagenGrande({foto: c.foto ? fotoUrl(c) : '', tipo: conTipo ? c.tipo : '', cat,
          pie: `<span>${c.foto ? 'Foto de la pieza' : conTipo ? 'Dibujo del tipo · aún sin foto' : 'Aún sin foto'}</span>
            <label class="btn mini">${ICO.camara}${c.foto ? 'Cambiar foto' : 'Añadir foto'}<input type="file" accept="image/*" id="foto2" hidden></label>`})}
        ${esta}
      </div>
      <div class="fi-der">
        <header class="fi-cab">${etqCat(cat, 'etq-cat')}<h1>${esc(c.nombre)}${c.revisar ? ' <span class="etq-pend">pendiente</span>' : ''}</h1>
          ${conTipo && f.resumen ? `<p class="fi-resumen">${esc(f.resumen)}</p>` : ''}</header>
        <div class="fi-acciones">
          <a class="btn${ia ? '' : ' prim'}" href="#/editar/${c.id}">${ICO.lapiz}Editar</a>
          <label class="btn">${ICO.camara}Foto<input type="file" accept="image/*" id="foto" hidden></label>
          ${ia ? `<button class="btn prim" type="button" id="ia-abrir" aria-expanded="false">${ICO.chispa}Corregir con IA</button>` : ''}
          ${menuMas([
            conTipo ? `<a role="menuitem" href="#/g/${esc(c.tipo)}/editar">Editar la ficha del tipo</a>` : '',
            c.foto ? '<button role="menuitem" type="button" id="quitar-foto">Quitar la foto</button>' : '',
            '<button role="menuitem" type="button" class="peligro" id="borrar">Borrar esta pieza</button>'])}
        </div>
        ${panelRevisar('pieza', c.id, c.tipo ? 'La IA repasa esta pieza y la ficha de su tipo.' : 'La IA repasa esta pieza.')}
        ${conTipo ? notaOjo(f) : ''}
        ${conTipo && f.revisado === 0 ? avisoIA(c.tipo, true) : ''}
        ${conTipo ? fichaDelTipo(f, c.tipo, ps, `${delTipo > 1 ? `La comparten tus ${delTipo} piezas de este tipo` : 'Común a todas las piezas de este tipo'} ·
            <a href="#/g/${esc(c.tipo)}/editar">Editar la ficha del tipo</a>`)
          : '<p class="gris">Esta pieza no tiene tipo. Ponle uno en «Editar» y verás aquí sus pines, su tensión y sus datos.</p>'}
        <div class="plegables">${plegableHist('pieza', c.id, conTipo ? c.tipo : '')}</div>
        <p class="meta">Actualizado ${esc(c.actualizado)}</p>
      </div>
    </article>`;
}

function vTipo(tipo) {
  const f = D.tipos[tipo];
  if (!f) return vacio('Ese tipo no está en el glosario.');
  const cs = D.componentes.filter((c) => c.tipo === tipo).sort(byName);
  const ps = proyectosDe(tipo), cat = f.categoria || 'otro';
  const tuyas = `<section class="caja fi-esta"><div class="fi-esta-cab"><h2 class="rotulo">Tus piezas de este tipo</h2>
      <a class="btn mini" href="#/nuevo?tipo=${esc(tipo)}">${ICO.mas}Añadir</a></div>
    ${cs.length ? `<div class="lista-piezas">${cs.map(filaComp).join('')}</div>` : '<p class="gris">No tienes ninguna todavía.</p>'}</section>`;
  return `${migas(['<a href="#/glosario">Glosario</a>', `<span>${esc(CATS[cat] || 'Otros')}</span>`, `<span>${esc(f.nombre)}</span>`])}
    <article class="fi">
      <div class="fi-izq">
        ${imagenGrande({tipo, cat, pie: `<span>Dibujo del tipo${stock(tipo) ? ` · tienes ${stockText(tipo)}` : ''}</span>`})}
        ${tuyas}
      </div>
      <div class="fi-der">
        <header class="fi-cab">${etqCat(cat, 'etq-cat')}<h1>${esc(f.nombre)}</h1>${f.resumen ? `<p class="fi-resumen">${esc(f.resumen)}</p>` : ''}</header>
        <div class="fi-acciones">
          <a class="btn prim" href="#/g/${esc(tipo)}/editar">${ICO.lapiz}Editar ficha</a>
          <a class="btn" href="#/nuevo?tipo=${esc(tipo)}">${ICO.mas}Añadir pieza</a>
          ${D.ia?.activa ? `<button class="btn" type="button" id="ia-abrir" aria-expanded="false">${ICO.chispa}Corregir con IA</button>` : ''}
          ${menuMas([
            `<button role="menuitem" type="button" data-tipo-archivar="${esc(tipo)}" data-v="${f.archivado ? 0 : 1}">${f.archivado ? 'Recuperar del archivo' : 'Archivar (ocultar)'}</button>`,
            `<a role="menuitem" href="#/ajustes/tipos?t=${esc(tipo)}">Fusionar o borrar…</a>`])}
        </div>
        ${panelRevisar('tipo', tipo, 'La IA repasa la ficha; los cambios valen para todas las piezas de este tipo.')}
        ${f.archivado ? `<p class="nota">Archivado: no sale en el glosario ni al elegir tipo. <button class="btn mini" data-tipo-archivar="${esc(tipo)}" data-v="0">Recuperar</button></p>` : ''}
        ${notaOjo(f)}
        ${f.revisado === 0 ? avisoIA(tipo, true) : ''}
        ${fichaDelTipo(f, tipo, ps, `Ficha ${{seed: 'del catálogo base', ia: 'de la IA', usuario: 'escrita por ti'}[f.origen] || ''}`)}
        <div class="plegables">${plegableHist('tipo', tipo)}</div>
      </div>
    </article>`;
}

// ---------- selector de tipo con búsqueda (fase D) ----------
// un campo de texto que filtra los tipos por nombre, alias, interfaz o categoría; el id va en un campo oculto (name="tipo")
const nombreSel = (sel, nuevo) => (sel === '__nuevo' ? nuevo : sel ? g(sel).nombre : '');
function selectorTipo(sel, nuevo = 'Nuevo tipo…') {
  return `<div class="combo" data-nuevo="${esc(nuevo)}">
    <input type="hidden" name="tipo" id="tipo" value="${esc(sel || '')}">
    <input class="combo-q" type="text" value="${esc(nombreSel(sel, nuevo))}" placeholder="Sin tipo · escribe para buscar (ESP32, relé, I2C…)"
      autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="tipo-lista" aria-label="Tipo">
    <div class="combo-lista" id="tipo-lista" role="listbox" hidden></div></div>`;
}
function opcionesCombo(combo) {
  const query = combo.querySelector('.combo-q').value.trim(), sel = combo.querySelector('#tipo').value;
  // si el texto es justo el nombre elegido, enseña todo (se acaba de abrir)
  const filtro = query && query !== nombreSel(sel, combo.dataset.nuevo) ? query : '';
  const ts = Object.entries(D.tipos).filter(([k, t]) => (!t.archivado || k === sel)
    && (!filtro || matches([k, t.nombre, CATS[t.categoria], ...list(t.alias), ...list(t.interfaz)].join(' '), filtro)));
  const orden = Object.keys(CATS);
  ts.sort((a, b) => orden.indexOf(a[1].categoria) - orden.indexOf(b[1].categoria) || a[1].nombre.localeCompare(b[1].nombre, 'es'));
  const op = (valor, texto, sub = '') => `<button type="button" class="combo-op${valor === sel ? ' on' : ''}" role="option" data-valor="${esc(valor)}"
    aria-selected="${valor === sel}"><span>${esc(texto)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</button>`;
  combo.querySelector('.combo-lista').innerHTML = (filtro ? '' : op('', 'Sin tipo'))
    + ts.slice(0, 60).map(([k, t]) => op(k, t.nombre, CATS[t.categoria] || '')).join('')
    + (ts.length > 60 ? `<p class="combo-mas">${ts.length - 60} más: escribe para afinar</p>` : '')
    + (!ts.length ? `<p class="combo-mas">Ningún tipo con «${esc(filtro)}»</p>` : '')
    + op('__nuevo', combo.dataset.nuevo, 'crear una ficha nueva');
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
  return `<div class="ed-fila"><button type="button" class="ed-asa" aria-label="Mover la fila: arrástrala, o usa las flechas arriba y abajo">${ASA}</button>${COLS[nombre].map((c, i) => c.funcion
    ? `<label class="ed-celda ed-fn" style="${colorFn(valores[i] || 'otro')}"><span class="ed-et">${c.t}</span><i class="dot"></i>
        <select data-col="${i}">${Object.entries(FUNC).map(([k, f]) => `<option value="${esc(k)}" ${k === (valores[i] || 'otro') ? 'selected' : ''}>${esc(f.nombre)}</option>`).join('')}</select></label>`
    : c.tipos ? `<label class="ed-celda"><span class="ed-et">${c.t}</span><select data-col="${i}" aria-label="${c.t}">${opcionesTiposLista(valores[i] || '').replace('Sin tipo', c.tipos)}</select></label>`
    : c.num ? `<label class="ed-celda"><span class="ed-et">${c.t}</span><input data-col="${i}" type="number" min="1" max="9999" inputmode="numeric" aria-label="${c.t}" value="${esc(valores[i] || 1)}"></label>`
    : c.check ? `<label class="ed-celda ed-check"><input data-col="${i}" type="checkbox" ${valores[i] ? 'checked' : ''}><span>${c.t}</span></label>`
    : c.area ? `<label class="ed-celda"><span class="ed-et">${c.t}</span><textarea data-col="${i}" rows="2" maxlength="${c.max}" placeholder="${esc(c.ph)}">${esc(valores[i] || '')}</textarea></label>`
    : `<label class="ed-celda"><span class="ed-et">${c.t}</span><input data-col="${i}" class="${c.clase || ''}" maxlength="${c.max}" value="${esc(valores[i] || '')}" placeholder="${esc(c.ph)}"></label>`).join('')}
    <button type="button" class="btn mini peligro ed-quitar" data-ed-quitar aria-label="Quitar fila">✕</button></div>`;
}
function editorFilas(nombre, filas, {etiqueta, boton, ayuda = '', campo = nombre} = {}) {
  return `<fieldset class="ed ed-${nombre}" data-ed="${campo}" data-cols="${nombre}">
    <legend>${etiqueta}</legend>${ayuda ? `<p class="ayuda">${ayuda}</p>` : ''}
    <div class="ed-cab" aria-hidden="true"><span></span>${COLS[nombre].map((c) => `<span>${c.t}</span>`).join('')}<span></span></div>
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
    toast(r.pines.length > filas.length ? `Separado: ahora hay ${plural(r.pines.length, 'pin', 'pines')}, uno por fila` : 'Pines repetidos juntados: mira sus notas');
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
  if (!c) return vacio('No existe esa pieza.');
  return `<a class="back" href="${id ? `#/c/${id}` : '#/'}">← ${id ? 'Volver' : 'Inventario'}</a>
    <article class="hoja">
      ${cabecera(id ? 'Editar pieza' : 'Nueva pieza')}
      ${!id ? '<p class="ia-atajo"><a href="#/ia">O que la IA la rellene a partir de una foto →</a></p>' : ''}
      <form id="form" class="form" autocomplete="off">
        <label>Nombre<input name="nombre" required maxlength="200" value="${esc(c.nombre)}" placeholder="ESP32-WROOM-32 DevKit"></label>
        <div class="campo"><span class="campo-t">Tipo</span>${selectorTipo(c.tipo)}</div>
        <div id="nuevo-tipo" class="nuevo-tipo" hidden>
          <label>Nombre del tipo<input name="tipoNombre" maxlength="120" placeholder="Relé de 5 V"></label>
          <label>Categoría<select name="tipoCat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        </div>
        <div class="dos">
          <label>Cantidad<input name="cantidad" type="number" min="0" inputmode="numeric" value="${c.varios ? '' : esc(c.cantidad ?? '')}" ${c.varios ? 'disabled' : ''}></label>
          <label class="check"><input type="checkbox" name="varios" ${c.varios ? 'checked' : ''}> Hay muchos (sin contar)</label>
        </div>
        <label>Sitio<input name="ubicacion" list="ubics" maxlength="120" value="${esc(c.ubicacion)}" placeholder="Cajita 3"></label>
        <datalist id="ubics">${ubicaciones().map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
        <label>Notas<textarea name="notas" rows="3" maxlength="2000">${esc(c.notas)}</textarea></label>
        ${editorFilas('datos', c.datos, {campo: 'datos_pieza', etiqueta: 'Datos de esta pieza', boton: 'Añadir dato',
          ayuda: 'Lo que cambia de una pieza a otra del mismo tipo: «Valor» → «220 Ω», «Color» → «rojo».'})}
        ${id ? '' : campoFoto('Foto (opcional)')}
        <label class="check"><input type="checkbox" name="revisar" ${c.revisar ? 'checked' : ''}> Pendiente: quiero mirar algo de esta pieza más tarde</label>
        <div class="acciones">
          <button class="btn prim" type="submit">Guardar</button>
          ${id ? '<button class="btn peligro" type="button" id="borrar">Borrar pieza</button>' : ''}
        </div>
      </form>
    </article>`;
}

async function guardarForm(form, id) {
  const fd = new FormData(form);
  let tipo = fd.get('tipo');
  if (tipo === '__nuevo') {
    const t = await api('POST', 'api/tipos', {nombre: fd.get('tipoNombre'), categoria: fd.get('tipoCat')});
    D.tipos[t.id] = {nombre: t.nombre, categoria: t.categoria, pines: []};
    tipo = t.id;
  }
  const varios = !!fd.get('varios');
  const body = {nombre: fd.get('nombre'), tipo: tipo || null, varios, cantidad: varios ? null : fd.get('cantidad'),
    ubicacion: fd.get('ubicacion'), notas: fd.get('notas'), revisar: !!fd.get('revisar'), datos: leerEditor(form, 'datos_pieza')};
  const c = id ? await api('PATCH', `api/componentes/${id}`, body) : await api('POST', 'api/componentes', body);
  guardarLocal(c);
  const foto = fd.get('foto');
  if (!(foto && foto.size && await subirFoto(c.id, foto))) toast('Guardado');
  location.hash = `#/c/${c.id}`;
}

function vGlosario() {
  const query = q.value.trim();
  let tipos = Object.entries(D.tipos).map(([k, f]) => ({k, ...f})).filter((t) => !t.archivado);
  if (query) tipos = tipos.filter((t) => matches([t.k, t.nombre, t.resumen, ...list(t.alias), list(t.interfaz).join(' ')].join(' '), query));
  // filtro «Sin comprobar»: las fichas que escribió la IA y nadie ha revisado (solo aparece si hay alguna)
  const sinComprobar = Object.values(D.tipos).filter((t) => t.revisado === 0).length;
  if (!sinComprobar) ui.sinComprobar = false;
  if (ui.sinComprobar) tipos = tipos.filter((t) => t.revisado === 0);
  const filtros = sinComprobar ? `<div class="filtros"><div class="cats">
    <button class="f ${ui.sinComprobar ? '' : 'on'}" data-glo="todo">Todo<span class="n">${Object.keys(D.tipos).length}</span></button>
    <button class="f ${ui.sinComprobar ? 'on' : ''}" data-glo="sin">Sin comprobar<span class="n">${sinComprobar}</span></button></div></div>` : '';
  if (!tipos.length) return filtros + tambien(query, 'tipos') + vacio('Nada coincide.');
  return filtros + tambien(query, 'tipos') + Object.keys(CATS).map((cat) => {
    const ts = tipos.filter((t) => (t.categoria || 'otro') === cat).sort(byName);
    return ts.length ? `<section class="grupo"${conColor(cat)}><h3 class="grupo-t">${marcaCat}${CATS[cat]}<span class="n">${ts.length}</span></h3>${ts.map(filaTipo).join('')}</section>` : '';
  }).join('');
}

// ---------- editar la ficha de un tipo a mano (fase D) ----------
// la ficha se pide al servidor con su «huella»: si alguien la cambia mientras editas, al guardar no se pisa (409)
function vEditarTipo(tipo) {
  if (!D.tipos[tipo]) return vacio('Ese tipo no está en el glosario.');
  return `<a class="back" href="#/g/${esc(tipo)}">← ${esc(D.tipos[tipo].nombre)}</a>
    <article class="hoja" id="ed-tipo" data-tipo="${esc(tipo)}"><p class="gris pad">Cargando…</p></article>`;
}
async function editarTipoCargar() {
  const zona = $('#ed-tipo');
  if (!zona) return;
  let f;
  try { f = await api('GET', `api/tipos/${encodeURIComponent(zona.dataset.tipo)}/ficha`); } catch (err) { zona.innerHTML = `<p class="mal pad">${esc(err.message)}</p>`; return; }
  const piezas = D.componentes.filter((c) => c.tipo === f.id).length;
  zona.innerHTML = `${cabecera(`Editar ficha · ${esc(f.nombre)}`, '', piezas > 1 ? `La usan ${piezas} piezas: los cambios se verán en todas.` : '')}
    ${f.origen === 'seed' ? '<p class="nota">Es del catálogo base. Al guardar pasa a ser tuya: las actualizaciones del catálogo ya no la cambiarán.</p>' : ''}
    ${f.revisado === 0 ? '<p class="nota nota-ia">La escribió la IA. Al guardar queda como comprobada por ti.</p>' : ''}
    <form id="form-ficha" class="form ancho" autocomplete="off" data-huella="${esc(f.huella)}" data-tipo="${esc(f.id)}">
      <div class="dos">
        <label>Nombre<input name="nombre" required maxlength="120" value="${esc(f.nombre)}"></label>
        <label>Categoría<select name="categoria">${Object.entries(CATS).map(([k, v]) => `<option value="${esc(k)}" ${k === f.categoria ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      </div>
      <label>Resumen<textarea name="resumen" rows="2" maxlength="400">${esc(f.resumen)}</textarea></label>
      <div class="dos">
        <label>Tensión<input name="voltaje" maxlength="120" value="${esc(f.voltaje)}" placeholder="3,3 V · 5 V tolerante"></label>
        <label>Interfaces<input name="interfaz" value="${esc(list(f.interfaz).join(', '))}" placeholder="I2C, UART"><span class="ayuda">Separadas por comas</span></label>
      </div>
      <label>Otros nombres<input name="alias" value="${esc(list(f.alias).join(', '))}" placeholder="DHT-11, sensor de humedad"><span class="ayuda">Separados por comas: sirven para buscar</span></label>
      <label>Ojo (advertencia)<textarea name="ojo" rows="2" maxlength="400" placeholder="No conectar a 5 V sin divisor">${esc(f.ojo)}</textarea></label>
      ${editorFilas('pines', f.pines, {etiqueta: 'Pines', boton: 'Añadir pin', ayuda: 'Un pin por fila, en el orden de la placa. La función da el color del pin en todas las fichas; en la nota, lo que haya que saber de ese pin («También: UART2 RX», «Solo entrada»). Si escribes varios en una fila («GPIO 16 · 17», «GPIO 32–39»), se separan solos.'})}
      ${editorFilas('datos', f.datos, {etiqueta: 'Datos', boton: 'Añadir dato', ayuda: 'Iguales para todas las piezas de este tipo: «Corriente máx.» → «20 mA».'})}
      <div class="acciones">
        <button class="btn prim" type="submit">Guardar ficha</button>
        <a class="btn" href="#/g/${esc(f.id)}">Cancelar</a>
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
  toast('Ficha guardada');
}

// ---------- proyectos (v8): listado por estado con miniaturas, ficha con pestañas (tablero, bitácora, archivos) ----------
const ESTADOS_PRO = {en_marcha: 'En marcha', pausa: 'En pausa', idea: 'Ideas', terminado: 'Terminados'}; // en el orden del listado
const ESTADO_PRO = {idea: 'Idea', en_marcha: 'En marcha', pausa: 'En pausa', terminado: 'Terminado'};
const COLUMNAS = {hacer: 'Por hacer', curso: 'En curso', hecho: 'Hecho'};
const proyecto = (id) => D.proyectos.find((p) => p.id === id);
const proActual = () => decodeURIComponent(location.hash.split('?')[0].split('/')[2] || '');
const nTareas = (p) => (p.tareas ? p.tareas.hacer + p.tareas.curso + p.tareas.hecho : 0);
const textoProyecto = (p) => [p.nombre, p.resumen, ...(p.material || []).flatMap((m) => list(m.tipo).map((t) => g(t).nombre))].join(' ');
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
  const t = list(m.tipo).find((k) => D.tipos[k]?.origen === 'seed');
  return t ? `<img class="thumb mini dibujo"${conColor(g(t).categoria || 'otro')} src="img/tipos/${esc(t)}.svg" alt="" title="${esc(g(t).nombre)}" loading="lazy" onerror="this.remove()">` : '';
}

// filas de proyectos. Con «minis», la tira de fotos de las piezas (listado de Proyectos); sin ella, el estado va junto al nombre
function listaProyectos(ps, minis = false) {
  return ps.map((p) => {
    const tira = minis ? (p.material || []).filter((m) => !m.opcional).map(miniMaterial).filter(Boolean).slice(0, 8).join('') : '';
    const n = nTareas(p);
    const avance = [n ? `${p.tareas.hecho}/${n} tareas` : '', p.notas ? plural(p.notas, 'nota') : ''].filter(Boolean).join(' · ');
    const estado = !minis && p.estado && p.estado !== 'idea' ? ` <span class="gris">· ${esc(ESTADO_PRO[p.estado].toLowerCase())}</span>` : '';
    return `<div class="fila fila-pro"><a class="fila-main" href="#/p/${esc(p.id)}"><div>
      <div class="nombre">${esc(p.nombre)}${estado}</div><div class="sub">${esc(p.resumen || '')}</div>
      ${tira ? `<div class="minis">${tira}</div>` : ''}</div></a>
      <div class="der"><div>${p.estado === 'terminado' ? 'Terminado' : estadoProyecto(p)}</div><div class="sub">${esc(dificultad(p))}</div>
        ${avance ? `<div class="sub">${esc(avance)}</div>` : ''}</div></div>`;
  }).join('');
}

function vProyectos() {
  const query = q.value.trim();
  const nuevo = '<a class="btn prim" href="#/proyecto-nuevo">Nuevo proyecto</a>';
  if (!D.proyectos.length) return vacio(`Aún no hay proyectos.<br>${nuevo}`);
  const abiertos = D.proyectos.filter((p) => p.estado !== 'terminado');
  const poco = (p) => { const f = faltas(p).length; return f > 0 && f <= 2; };
  const filtros = {
    todos: ['Todos', D.proyectos], en_marcha: ['En marcha', D.proyectos.filter((p) => p.estado === 'en_marcha')],
    ya: ['Puedo hacerlo ya', abiertos.filter((p) => !faltas(p).length)], poco: ['Me falta poco', abiertos.filter(poco)],
    terminado: ['Terminados', D.proyectos.filter((p) => p.estado === 'terminado')],
  };
  if (!filtros[ui.proFiltro]) ui.proFiltro = 'todos';
  let ps = filtros[ui.proFiltro][1];
  if (query) ps = ps.filter((p) => matches(textoProyecto(p), query));
  ps = ps.slice().sort((a, b) => faltas(a).length - faltas(b).length || (a.dificultad || 1) - (b.dificultad || 1) || byName(a, b));
  const barra = `<div class="filtros"><div class="cats">${Object.entries(filtros).filter(([k, [, l]]) => l.length || k === 'todos' || k === ui.proFiltro).map(([k, [t, l]]) =>
    `<button class="f ${ui.proFiltro === k ? 'on' : ''}" data-pf="${k}">${t}<span class="n">${l.length}</span></button>`).join('')}</div>
    <div class="filtros-der">${nuevo}</div></div>`;
  if (!ps.length) return barra + tambien(query, 'proyectos') + vacio('Ninguno en este filtro.');
  return barra + tambien(query, 'proyectos') + Object.entries(ESTADOS_PRO).map(([k, titulo]) => {
    const items = ps.filter((p) => (p.estado || 'idea') === k);
    return items.length ? `<section class="grupo"><h3 class="grupo-t">${titulo}<span class="n">${items.length}</span></h3>${listaProyectos(items, true)}</section>` : '';
  }).join('');
}

// lo del usuario en el proyecto abierto (bitácora, tablero y archivos): se pide al entrar y se guarda para no parpadear
const PRO = {id: null, det: null};
const PRO_TABS = {ficha: 'Ficha', tablero: 'Tablero', bitacora: 'Bitácora', archivos: 'Archivos'};
function tabsProyecto(p, tab) {
  const n = nTareas(p), cuenta = {tablero: n ? `${p.tareas.hecho}/${n}` : '', bitacora: p.notas || '', archivos: p.archivos || ''};
  return Object.entries(PRO_TABS).map(([k, t]) => `<a class="f ${k === tab ? 'on' : ''}" href="#/p/${esc(p.id)}${k === 'ficha' ? '' : `/${k}`}"
    ${k === tab ? 'aria-current="page"' : ''}>${t}${cuenta[k] ? `<span class="n">${cuenta[k]}</span>` : ''}</a>`).join('');
}

function vProyecto(id, sub) {
  const p = proyecto(id);
  if (!p) return vacio('No existe ese proyecto.');
  if (sub === 'editar') return vProyectoForm(p);
  const tab = PRO_TABS[sub] ? sub : 'ficha';
  const listo = PRO.id === p.id && PRO.det;
  return `<a class="back" href="#/proyectos">← Proyectos</a>
    <article class="hoja ficha">
      ${cabecera(esc(p.nombre), '', p.resumen)}
      <div class="pro-barra">
        <label class="pro-estado">Estado
          <select id="pro-estado" class="sel">${Object.entries(ESTADO_PRO).map(([k, v]) => `<option value="${k}" ${k === (p.estado || 'idea') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <a class="btn" href="#/p/${esc(p.id)}/editar">Editar</a>
        ${menuMas(['<button role="menuitem" type="button" class="peligro" data-pro="borrar">Borrar este proyecto</button>'])}
      </div>
      <nav class="pro-tabs" id="pro-tabs" aria-label="Partes del proyecto">${tabsProyecto(p, tab)}</nav>
      <div id="pro-zona" class="pz-cuerpo" data-id="${esc(p.id)}" data-tab="${tab}">${tab === 'ficha' ? fichaProyecto(p)
        : listo ? PRO_PINTAR[tab](p, PRO.det) : '<p class="gris">Cargando…</p>'}</div>
    </article>`;
}

function fichaProyecto(p) {
  const material = `<h3>Material</h3><table class="t t-material"><thead><tr><th class="mini-c"></th><th class="n">Cant.</th><th>Pieza</th><th class="der">Tienes</th></tr></thead><tbody>
    ${(p.material || []).map((m) => {
      const tiene = stock(m.tipo), pide = m.cantidad || 1, ok = tiene >= pide;
      const nombre = list(m.tipo).map((t) => `<a href="#/g/${esc(t)}">${esc(g(t).nombre)}</a>`).join(' o ');
      const nota = [m.opcional ? 'opcional' : '', m.nota].filter(Boolean).map(esc).join(' · ');
      const tuyas = piezasDe(m);
      // qué piezas tuyas valen y dónde están (si solo es una y no tiene sitio, no añade nada al nombre del tipo)
      const donde = tuyas.length === 1 && !tuyas[0].ubicacion ? '' : tuyas.slice(0, 3).map((c) => `<a href="#/c/${c.id}">${esc(c.nombre)}</a>${c.ubicacion ? ` (${esc(c.ubicacion)})` : ''}`).join(', ');
      return `<tr><td class="mini-c">${miniMaterial(m)}</td><td class="n">${pide}</td>
        <td>${nombre}${nota ? `<div class="sub">${nota}</div>` : ''}${donde ? `<div class="sub">Tuyas: ${donde}${tuyas.length > 3 ? ` y ${tuyas.length - 3} más` : ''}</div>` : ''}</td>
        <td class="der num ${ok || m.opcional ? '' : 'mal'}">${tiene >= MUCHOS ? 'muchos' : tiene}</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="gris">Sin material apuntado.</td></tr>'}</tbody></table>
    ${faltas(p).length ? '<p><button class="btn mini" type="button" data-pro="copiar-faltas">Copiar lo que falta</button></p>' : ''}`;
  const con = p.conexiones?.length ? `<h3>Conexiones</h3><table class="t"><thead><tr><th>Desde</th><th>Hasta</th></tr></thead><tbody>
    ${p.conexiones.map(([a, b, n]) => `<tr><td class="pin">${esc(a)}</td><td class="pin">${esc(b)}${n ? `<div class="sub" style="font-family:var(--letra)">${esc(n)}</div>` : ''}</td></tr>`).join('')}</tbody></table>` : '';
  const pasos = p.pasos?.length ? `<h3>Pasos</h3><ol class="pasos">${p.pasos.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '';
  return `${specs([['Dificultad', esc(may(DIF[p.dificultad || 1]))], ['Tiempo', esc(p.tiempo || '—')], ['Piezas', estadoProyecto(p)]])}
    <div class="pro-dos"><div>${material}</div><div>${con}${pasos}${con || pasos ? '' : '<p class="gris">Sin conexiones ni pasos: añádelos en «Editar».</p>'}</div></div>
    <div class="plegables">${plegableHist('proyecto', p.id)}</div>
    <p class="meta">Proyecto ${{seed: 'del catálogo base', ia: 'propuesto por la IA', usuario: 'tuyo'}[p.origen] || ''}</p>`;
}

// tablero: tres columnas; cada tarea se mueve con las flechas (en el móvil las columnas van una debajo de otra)
function tableroProyecto(p, det) {
  const claves = new Set(det.tareas.map((t) => claveTxt(t.texto)));
  const faltanPasos = (p.pasos || []).some((s) => !claves.has(claveTxt(s).slice(0, 300)));
  const cols = Object.entries(COLUMNAS);
  return `<form id="form-pro-tarea" class="form sin-pad pro-anadir" autocomplete="off">
      <input name="texto" maxlength="300" required placeholder="Soldar los pines del sensor" aria-label="Tarea nueva">
      <button class="btn prim" type="submit">Añadir</button></form>
    ${faltanPasos ? '<p class="sub"><button class="btn mini" type="button" data-pro="pasos">Pasar los pasos al tablero</button> Crea una tarea por cada paso del proyecto.</p>' : ''}
    <div class="tablero">${cols.map(([k, nombre], i) => {
      const ts = det.tareas.filter((t) => t.columna === k);
      const mover = (t, j, flecha) => (cols[j] ? `<button class="btn mini" type="button" data-pro="mover" data-id="${t.id}" data-col="${cols[j][0]}" aria-label="Pasar a «${cols[j][1]}»" title="Pasar a «${cols[j][1]}»">${flecha}</button>` : '');
      return `<section class="tab-col"><h3>${nombre}<span class="n">${ts.length}</span></h3>${ts.map((t) => `<div class="tarea${k === 'hecho' ? ' hecha' : ''}">
        <span class="tarea-t">${esc(t.texto)}</span><span class="tarea-b">${mover(t, i - 1, '←')}${mover(t, i + 1, '→')}
        <button class="btn mini peligro" type="button" data-pro="borrar-tarea" data-id="${t.id}" aria-label="Borrar la tarea">✕</button></span></div>`).join('')
        || '<p class="gris tab-vacia">Nada.</p>'}</section>`;
    }).join('')}</div>`;
}

function bitacoraProyecto(p, det) {
  return `<form id="form-pro-nota" class="form sin-pad" autocomplete="off">
      <label>Nota nueva<textarea name="texto" rows="3" maxlength="4000" placeholder="Qué has hecho, qué falla, qué falta comprar…"></textarea></label>
      ${campoFoto('Foto (opcional)')}
      <div class="acciones"><button class="btn prim" type="submit">Apuntar</button></div>
    </form>
    <div class="bitacora">${det.notas.map((n) => `<article class="apunte">
      <header><span class="gris" title="${esc(fechaCompleta(n.fecha))}">${esc(cuando(n.fecha))}</span>
        <button class="btn mini peligro" type="button" data-pro="borrar-nota" data-id="${n.id}">Borrar</button></header>
      ${n.texto ? `<p class="notas">${esc(n.texto)}</p>` : ''}
      ${n.foto ? `<a class="apunte-foto" href="fotos/${encodeURIComponent(n.foto)}" target="_blank" aria-label="Ver la foto grande"><img src="fotos/${encodeURIComponent(n.foto)}" alt="" loading="lazy"></a>` : ''}
    </article>`).join('') || '<p class="gris">Aún no has apuntado nada de este proyecto.</p>'}</div>`;
}

function archivosProyecto(p, det) {
  const url = (a) => `fotos/${encodeURIComponent(a.fichero)}`;
  const pie = (a) => `<span class="nombre">${esc(a.nombre)}</span><span class="sub">${esc(tamano(a.bytes))} · ${esc(cuando(a.fecha))}</span>`;
  const borrar = (a) => `<button class="btn mini peligro" type="button" data-pro="borrar-archivo" data-id="${a.id}">Borrar</button>`;
  const imgs = det.archivos.filter((a) => a.tipo.startsWith('image/')), docs = det.archivos.filter((a) => !a.tipo.startsWith('image/'));
  return `<div class="pro-subir"><label class="btn prim">Subir diagrama o PDF<input type="file" id="pro-archivo" accept="image/*,application/pdf" hidden></label>
      <span class="sub">Esquemas de conexión, capturas, hojas de datos. Las imágenes se reducen a 2400 px; los PDF, hasta 20 MB.</span></div>
    ${imgs.length ? `<div class="diagramas">${imgs.map((a) => `<figure class="diagrama"><a href="${url(a)}" target="_blank" aria-label="Ver «${esc(a.nombre)}» grande"><img src="${url(a)}" alt="" loading="lazy"></a>
      <figcaption><span class="diagrama-t">${pie(a)}</span>${borrar(a)}</figcaption></figure>`).join('')}</div>` : ''}
    ${docs.map((a) => `<div class="fila"><a class="fila-main" href="${url(a)}" target="_blank"><span class="thumb pdf" aria-hidden="true">PDF</span><div>${pie(a)}</div></a>${borrar(a)}</div>`).join('')}
    ${det.archivos.length ? '' : '<p class="gris">Ningún archivo todavía.</p>'}`;
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
async function clicProyecto(t) {
  const id = proActual(), p = proyecto(id), base = `api/proyectos/${encodeURIComponent(id)}`, a = t.dataset.pro;
  if (a === 'mover') { t.disabled = true; pintarProyecto(await api('PATCH', `${base}/tareas/${t.dataset.id}`, {columna: t.dataset.col})); }
  else if (a === 'borrar-tarea') { t.disabled = true; pintarProyecto(await api('DELETE', `${base}/tareas/${t.dataset.id}`)); }
  else if (a === 'pasos') { t.disabled = true; pintarProyecto(await api('POST', `${base}/tareas`, {pasos: true})); }
  else if (a === 'borrar-nota') {
    if (!(await confirmar('¿Borrar esta nota de la bitácora?\nNo se puede deshacer.', {si: 'Borrar', peligro: true}))) return;
    pintarProyecto(await api('DELETE', `${base}/notas/${t.dataset.id}`));
  } else if (a === 'borrar-archivo') {
    if (!(await confirmar('¿Borrar este archivo del proyecto?\nNo se puede deshacer.', {si: 'Borrar', peligro: true}))) return;
    pintarProyecto(await api('DELETE', `${base}/archivos/${t.dataset.id}`));
  } else if (a === 'copiar-faltas') {
    const txt = `Para «${p.nombre}» me falta:\n${faltas(p).map((m) => `- ${m.cantidad || 1} × ${list(m.tipo).map((k) => g(k).nombre).join(' o ')} (tengo ${stockText(m.tipo)})`).join('\n')}`;
    try { await navigator.clipboard.writeText(txt); toast('Lista copiada'); } catch { toast('No se ha podido copiar (hace falta HTTPS o localhost)', true); }
  } else if (a === 'borrar') {
    const suyo = [nTareas(p) ? plural(nTareas(p), 'tarea') : '', p.notas ? plural(p.notas, 'nota') : '', p.archivos ? plural(p.archivos, 'archivo') : ''].filter(Boolean);
    if (!(await confirmar(`¿Borrar el proyecto «${p.nombre}»?\n${suyo.length ? `Se borran también sus ${suyo.join(', ')}. ` : ''}No se puede deshacer.`, {si: 'Borrar proyecto', peligro: true}))) return;
    await api('DELETE', base);
    D.proyectos = D.proyectos.filter((x) => x.id !== id);
    if (PRO.id === id) { PRO.id = null; PRO.det = null; }
    contadores();
    location.hash = '#/proyectos';
    toast(`Borrado «${p.nombre}»`);
  }
}
async function cambiarEstadoPro(sel) {
  const p = await api('PATCH', `api/proyectos/${encodeURIComponent(proActual())}`, {estado: sel.value});
  guardarProLocal(p);
  toast(`Estado: ${ESTADO_PRO[p.estado].toLowerCase()}`);
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
  } else if (tipo !== 'application/pdf') throw new Error('Tiene que ser una imagen o un PDF');
  if (cuerpo.size > 20 * 1024 * 1024) throw new Error('El archivo es demasiado grande (máx. 20 MB)');
  toast('Subiendo…');
  const nombre = file.name.replace(/\.[^.]+$/, '').slice(0, 120);
  pintarProyecto(await api('POST', `api/proyectos/${encodeURIComponent(proActual())}/archivos?nombre=${encodeURIComponent(nombre)}`, cuerpo, {'content-type': tipo}));
  toast('Archivo guardado');
}
async function anadirTareaPro(form) {
  pintarProyecto(await api('POST', `api/proyectos/${encodeURIComponent(proActual())}/tareas`, {texto: new FormData(form).get('texto')}));
  if (matchMedia('(hover: hover)').matches) $('#form-pro-tarea [name=texto]')?.focus(); // en el móvil, sin reabrir el teclado
}
async function anadirNotaPro(form) {
  const fd = new FormData(form), foto = fd.get('foto');
  const body = {texto: fd.get('texto')};
  if (foto && foto.size) body.foto = await base64(await jpeg(await lienzoDe(foto, 1600)));
  if (!String(body.texto).trim() && !body.foto) throw new Error('Escribe algo o pon una foto');
  pintarProyecto(await api('POST', `api/proyectos/${encodeURIComponent(proActual())}/notas`, body));
  toast('Apuntado');
}

// crear o editar la receta de un proyecto: nombre, material (tipos del glosario), conexiones y pasos
function vProyectoForm(p) {
  const x = p || {nombre: '', resumen: '', dificultad: 1, tiempo: '', material: [], conexiones: [], pasos: []};
  const volver = p ? `#/p/${esc(p.id)}` : '#/proyectos';
  return `<a class="back" href="${volver}">← ${p ? esc(p.nombre) : 'Proyectos'}</a>
    <article class="hoja">
      ${cabecera(p ? 'Editar proyecto' : 'Nuevo proyecto', '', p ? '' : 'Apunta la idea con lo que sepas: el material, las conexiones y los pasos se pueden completar más tarde.')}
      ${p?.origen === 'seed' ? '<p class="nota">Es del catálogo base. Al guardar pasa a ser tuyo: las actualizaciones del catálogo ya no lo cambiarán.</p>' : ''}
      <form id="form-proyecto" class="form ancho" autocomplete="off" data-id="${esc(p?.id || '')}">
        <label>Nombre<input name="nombre" required maxlength="120" value="${esc(x.nombre)}" placeholder="Estación meteorológica"></label>
        <label>Resumen<textarea name="resumen" rows="2" maxlength="600" placeholder="Qué hace, en una o dos frases">${esc(x.resumen || '')}</textarea></label>
        <div class="dos">
          <label>Dificultad<select name="dificultad">${Object.entries(DIF).map(([k, v]) => `<option value="${k}" ${Number(k) === (x.dificultad || 1) ? 'selected' : ''}>${esc(may(v))}</option>`).join('')}</select></label>
          <label>Tiempo<input name="tiempo" maxlength="40" value="${esc(x.tiempo || '')}" placeholder="2 h"></label>
        </div>
        ${editorFilas('material', x.material.map((m) => [list(m.tipo)[0] || '', list(m.tipo)[1] || '', m.cantidad || 1, m.nota || '', m.opcional ? '1' : '']),
          {etiqueta: 'Material', boton: 'Añadir pieza', ayuda: 'Elige cada pieza por su tipo del glosario. «O bien» es otro tipo que también vale.'})}
        ${editorFilas('conexiones', x.conexiones, {etiqueta: 'Conexiones', boton: 'Añadir conexión', ayuda: 'De qué pin a qué pin.'})}
        ${editorFilas('pasos', x.pasos.map((s) => [s]), {etiqueta: 'Pasos', boton: 'Añadir paso', ayuda: 'En orden. Luego puedes pasarlos al tablero como tareas.'})}
        <div class="acciones">
          <button class="btn prim" type="submit">Guardar proyecto</button>
          <a class="btn" href="${volver}">Cancelar</a>
        </div>
      </form>
    </article>`;
}
async function guardarProyectoForm(form) {
  const fd = new FormData(form), id = form.dataset.id;
  const body = {nombre: fd.get('nombre'), resumen: fd.get('resumen'), dificultad: Number(fd.get('dificultad')) || 1, tiempo: fd.get('tiempo'),
    material: leerEditor(form, 'material').map(([tipo, alt, cantidad, nota, opcional]) => ({tipo: [tipo, alt].filter(Boolean), cantidad: Number(cantidad) || 1, nota, opcional: !!opcional})),
    conexiones: leerEditor(form, 'conexiones'), pasos: leerEditor(form, 'pasos').map(([s]) => s)};
  const p = id ? await api('PUT', `api/proyectos/${encodeURIComponent(id)}`, body) : await api('POST', 'api/proyectos', body);
  guardarProLocal(p);
  location.hash = `#/p/${encodeURIComponent(p.id)}`;
  toast(id ? 'Proyecto guardado' : 'Proyecto creado');
}

// ---------- IA: «Añadir con IA» (el modelo propone, el usuario confirma) ----------
// fecha de SQLite («2026-11-09 17:20:02», en UTC) → milisegundos
const fechaSql = (s) => Date.parse(String(s || '').replace(' ', 'T') + 'Z');

// espera mientras el modelo piensa: línea de progreso, qué está pasando, segundos y el esqueleto de la ficha
// (no hay progreso real que medir: los textos dicen lo que se sabe y dan una salida si tarda mucho)
function vistaEspera(foto, modelo, titulo = 'Analizando…') {
  return `${cabecera(titulo, '', '')}
    <div class="ia-progreso" role="progressbar" aria-label="El modelo está pensando"><span></span></div>
    <p class="ia-paso pad" role="status"><span id="ia-paso">Enviando al modelo…</span> · <span id="ia-seg" class="num">0 s</span>
      ${modelo ? `<span class="gris"> · ${esc(nombreModelo(modelo))}</span>` : ''}</p>
    <div class="ia-espera pad">
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
    paso.textContent = s < 4 ? 'Enviando al modelo…'
      : s < 30 ? 'El modelo está mirando la pieza…'
      : s < 90 ? 'Sigue pensando: algunos modelos tardan hasta un minuto…'
      : 'Está tardando mucho. Puedes salir: la propuesta te esperará en «Añadir con IA».';
  };
  tic();
  ticContador = setInterval(tic, 1000);
}
const avisoIA = (tipo, conBoton = false) => `<div class="nota nota-ia"><p><span class="nota-t">Sin comprobar</span> Esta ficha la escribió la IA: comprueba la tensión y los pines antes de conectar nada.</p>
  ${conBoton ? `<button class="btn mini" id="revisada" data-tipo="${esc(tipo)}">Ya la he comprobado</button>` : ''}</div>`;
const ESTADO_IA = {pendiente: 'Analizando…', propuesta: 'Esperando a que la mires', error: 'Error', aplicada: 'Guardada', descartada: 'Descartada'};
const comas = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

// las dos formas de añadir con IA, como pestañas (misma cabecera en las dos pantallas)
const modosIA = (actual) => `<nav class="ia-modos" aria-label="Qué quieres añadir">${[['#/ia', 'Una pieza', 'una'], ['#/ia/varias', 'Varias piezas en una foto', 'varias']]
  .map(([h, t, k]) => `<a class="f ${k === actual ? 'on' : ''}" href="${h}"${k === actual ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;
// nombre de una tarea de la IA en las listas. Una pieza que sale de una foto con varias aún no tiene propuesta: se
// enseña el nombre con el que se la vio (va en la pista que se le da al modelo), no la pista entera
const nombreTareaIA = (t) => (t.clase === 'revisar' ? `Correcciones para «${t.objetivo_nombre || '¿?'}»` : t.clase === 'detectar' ? 'Foto con varias piezas'
  : t.propuesta?.nombre || (String(t.texto || '').match(/^Esta pieza sale de una foto con varias\. Allí se vio como «([^»]+)»/) || [])[1] || t.texto || 'Pieza sin nombre');
function vIA(id) {
  if (id === 'ajustes') return `<a class="back" href="#/ia">← Añadir con IA</a><article class="hoja" id="ia-ajustes"><p class="gris pad">Cargando…</p></article>`;
  if (id === 'varias') return vIAVarias();
  if (id) return `<a class="back" href="#/ia">← Añadir con IA</a><article class="hoja" id="ia-zona"><p class="gris pad">Cargando…</p></article>`;
  if (!D.ia?.activa) return `<a class="back" href="#/">← Inventario</a>${vacio('Falta la clave de OpenCode Go. <a class="btn prim" href="#/ia/ajustes">Configurar</a>')}`;
  return `<a class="back" href="#/">← Inventario</a>
    <article class="hoja">
      ${cabecera('Añadir con IA', '', '')}
      ${modosIA('una')}
      <p class="ia-intro">Haz una foto de la pieza y añade lo que sepas. La IA propone el nombre, el tipo y la ficha; tú lo miras y lo corriges antes de guardar.</p>
      <form id="form-ia" class="form" autocomplete="off">
        ${campoFoto('Fotos', 'Hasta 4: por delante, por detrás, la serigrafía de cerca. La primera será la foto de la pieza.', {varias: 4, principal: true})}
        <label>Lo que sepas (opcional)<textarea name="texto" rows="2" maxlength="1000" placeholder="Sensor de humedad del kit de Freenove, 3 pines"></textarea></label>
        <label>Modelo<select name="modelo" id="ia-modelo-alta"><option value="">El de siempre (${esc(nombreModelo(D.ia.modelo))})</option></select>
          <span class="ayuda">Solo para esta pieza, por si una difícil merece otro. El de siempre y la clave se cambian en <a href="#/ia/ajustes">Ajustes → IA</a>.</span></label>
        <p class="nota" id="ia-aviso-modelo" hidden></p>
        <div class="acciones"><button class="btn prim" type="submit">Analizar</button></div>
      </form>
    </article>
    <div id="ia-abiertas"></div>`;
}

// configuración: clave (nunca se vuelve a mostrar) y modelo, elegido de los que el catálogo de Go marca con fotos
// y salida estructurada. Al guardar, el servidor valida el formato y hace una llamada mínima de prueba.
// coste en dólares con pocos decimales y coma
const dolares = (n) => (n == null ? '?' : n < 0.0001 ? '<0,0001 $' : `${n < 0.01 ? n.toFixed(4) : n.toFixed(3)} $`.replace('.', ','));
// lo que cuesta de verdad una pieza con cada modelo: la media de tus consultas, o una estimación si aún no hay
// (≈ 6000 tokens de entrada —instrucciones, lista de tipos y foto— y 900 de salida)
const costePieza = (m) => (m.coste_medio
  ? `≈ ${dolares(m.coste_medio.dolares)} por pieza · media de tus ${m.coste_medio.consultas} consulta${m.coste_medio.consultas === 1 ? '' : 's'}`
  : `≈ ${dolares(((m.precio.entrada ?? 0) * 6000 + (m.precio.salida ?? 0) * 900) / 1e6)} por pieza (estimado)`);
let MODELOS_IA = null;
// lo que NO sabe hacer un modelo, en pocas palabras (vacío si lo hace todo)
const limitesModelo = (m) => [m.vision ? '' : 'no ve fotos', m.estructurada ? '' : 'sin formato fijo'].filter(Boolean);
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
  if (m?.api === 'messages' && nivel === 'poco') return 'sin pensamiento';
  if (!l.length) return m?.api === 'messages' ? `pensamiento ${nivel === 'medio' ? 'corto' : 'largo'}` : 'lo que decida el modelo';
  return nivel === 'mucho' ? l[l.length - 1] : nivel === 'medio' ? (l.includes('medium') ? 'medium' : l[Math.floor((l.length - 1) / 2)]) : l[0];
}
function bloqueRazonar(m) {
  const actual = RAZONAR[D.ajustes.ia_razonar] ? D.ajustes.ia_razonar : 'poco';
  const nota = !m ? '' : !m.razona ? `${esc(m.nombre)} no razona: este ajuste no le cambia nada.`
    : `Con ${esc(m.nombre)}: ${Object.keys(RAZONAR).map((k) => `${RAZONAR[k].nombre.toLowerCase()} = ${esc(esfuerzoDe(m, k))}`).join(' · ')}.`;
  return `<h3>Cuánto razona</h3>
    <p class="ayuda">Antes de responder, el modelo «piensa». Más razonamiento acierta más en piezas difíciles, pero tarda más y cuesta
      más (lo que piensa se cobra como respuesta). Vale para «Añadir con IA» y «Corregir con IA».</p>
    <div class="ia-modelos" role="radiogroup" aria-label="Cuánto razona">${Object.entries(RAZONAR).map(([k, v]) => `
      <label class="ia-modelo"><input type="radio" name="ia-razonar" value="${k}" ${k === actual ? 'checked' : ''}>
        <span><span class="nombre">${v.nombre}${k === 'poco' ? '<span class="gris"> · recomendado</span>' : ''}</span><span class="sub">${v.sub}</span></span></label>`).join('')}</div>
    ${nota ? `<p class="ayuda">${nota}</p>` : ''}`;
}

async function iaAjustes() {
  const zona = $('#ia-ajustes');
  if (!zona) return;
  let cfg, lista = [], fallo = '';
  try { cfg = await api('GET', 'api/ia/config'); } catch (err) { zona.innerHTML = `<p class="mal pad">${esc(err.message)}</p>`; return; }
  try { lista = await modelosIA(true); } catch (err) { fallo = err.message; }
  const origen = {web: 'guardada en la app', entorno: 'de la variable IA_CLAVE del servidor'}[cfg.origen_clave];
  const fuera = cfg.modelo && lista.length && !lista.some((m) => m.id === cfg.modelo);
  zona.innerHTML = `${cabecera('Configuración de la IA', '', 'Proveedor: OpenCode Go. Salen todos sus modelos de chat; los que no ven fotos o no devuelven datos con formato fijo llevan el aviso.')}
    <section class="pad ia-bloque">
      <h3>Modelo de siempre</h3>
      <p class="ayuda">Toca otro para cambiarlo. Se comprueba al momento con tu clave: no hace falta volver a ponerla.</p>
      ${lista.length ? `<div class="ia-modelos" role="radiogroup" aria-label="Modelo de siempre">${lista.map((m) => `
        <label class="ia-modelo"><input type="radio" name="ia-modelo" value="${esc(m.id)}" ${m.id === cfg.modelo ? 'checked' : ''}>
          <span><span class="nombre">${esc(m.nombre)}${m.recomendado ? '<span class="gris"> · recomendado</span>' : ''}</span>
          <span class="sub">${esc(costePieza(m))}</span>
          ${m.vision ? '' : '<span class="sub aviso">No ve fotos: solo sirve con texto, y no puede con «Varias piezas en una foto».</span>'}
          ${m.estructurada ? '' : '<span class="sub aviso">Sin formato fijo: la app saca los datos de su texto. Falla más y deja más cosas por comprobar.</span>'}
          <span class="sub">${esc(m.descripcion)}</span></span></label>`).join('')}</div>`
        : `<p class="mal">${esc(fallo || 'No hay modelos disponibles')}</p>`}
      ${fuera ? `<p class="aviso">El modelo actual («${esc(cfg.modelo)}») ya no está en el catálogo: elige otro.</p>` : ''}
      <p class="ayuda" id="ia-modelo-estado" role="status"></p>
    </section>
    <section class="pad ia-bloque" id="ia-razonar-zona">${bloqueRazonar(lista.find((m) => m.id === cfg.modelo))}</section>
    <section class="pad ia-bloque">
      <h3>Clave de OpenCode Go</h3>
      <p>${cfg.clave ? `${esc(cfg.clave)} · ${esc(origen)}` : '<span class="mal">Sin clave: la IA no funciona hasta que pongas una.</span>'}</p>
      ${cfg.clave ? '<div class="acciones"><button class="btn" type="button" id="ia-cambiar-clave">Cambiar clave</button></div>' : ''}
      <form id="form-ia-config" class="form sin-pad" autocomplete="off" ${cfg.clave ? 'hidden' : ''}>
        <label>${cfg.clave ? 'Clave nueva' : 'Clave'}
          <input name="clave" type="password" autocomplete="off" spellcheck="false" minlength="16" maxlength="300" pattern="[!-~]{16,300}"
            placeholder="Pega aquí la clave de tu suscripción a Go" required>
          <span class="ayuda">La encontrarás en la consola de OpenCode (suscripción Go). La app la guarda en su base de datos y no la vuelve a enseñar;
            ojo: va dentro de las copias de seguridad.</span></label>
        <div class="acciones">
          <button class="btn prim" type="submit">Probar y guardar</button>
          ${cfg.origen_clave === 'web' ? '<button class="btn peligro" type="button" id="ia-quitar">Quitar la clave</button>' : ''}
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
  estado.textContent = 'Comprobando con OpenCode Go…';
  try {
    D.ia = await api('PUT', 'api/ia/config', {modelo: radio.value});
    const z = $('#ia-razonar-zona');
    if (z) z.innerHTML = bloqueRazonar((MODELOS_IA || []).find((m) => m.id === radio.value));
    estado.textContent = `Listo: ${radio.closest('label').querySelector('.nombre').firstChild.textContent} es ahora el modelo de siempre.`;
  } catch (err) {
    estado.className = 'mal';
    estado.textContent = err.message;
    const r = radios.find((x) => x.value === anterior);
    if (r) r.checked = true;
  } finally { radios.forEach((r) => (r.disabled = false)); }
}

async function guardarAjustesIA(form) {
  const clave = String(new FormData(form).get('clave') || '').trim();
  if (!/^[!-~]{16,300}$/.test(clave)) throw new Error('La clave no tiene buen formato (16–300 caracteres, sin espacios)');
  toast('Comprobando con OpenCode Go…');
  D.ia = await api('PUT', 'api/ia/config', {clave});
  toast('Clave comprobada y guardada');
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
      sel.options[0].textContent = `El de siempre (${actual.nombre} · ${costePieza(actual)})`;
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
    sinFotos ? (varias ? `${m.nombre} no ve fotos: no puede separar las piezas. Elige otro modelo.` : `${m.nombre} no ve fotos: no se puede subir foto. Describe la pieza con texto (lo que pone en la serigrafía, cuántos pines tiene…).`) : '',
    m.estructurada ? '' : `${m.nombre} no devuelve datos con formato fijo: puede fallar o dejar más cosas por comprobar.`].filter(Boolean);
  aviso.hidden = !partes.length;
  aviso.textContent = partes.join(' ');
}

// ---------- foto con varias piezas: el modelo las separa, tú eliges cuáles, y cada una se identifica con su recorte ----------
function vIAVarias() {
  if (!D.ia?.activa) return `<a class="back" href="#/">← Inventario</a>${vacio('Falta la clave de OpenCode Go. <a class="btn prim" href="#/ia/ajustes">Configurar</a>')}`;
  return `<a class="back" href="#/">← Inventario</a>
    <article class="hoja">
      ${cabecera('Añadir con IA', '', '')}
      ${modosIA('varias')}
      <p class="ia-intro">Pon las piezas separadas sobre un fondo liso y hazles una foto desde arriba. La IA las separa, tú eliges cuáles dar de alta y después identifica cada una con su recorte. Nada se guarda hasta que lo confirmes.</p>
      <form id="form-ia-varias" class="form" autocomplete="off">
        ${campoFoto('Foto con las piezas', 'Mejor pocas y que se lean (hasta 40). Con muchas piezas pequeñas, haz varias fotos.')}
        <label>Lo que sepas de ellas (opcional)<textarea name="texto" rows="2" maxlength="1000" placeholder="Son del kit de sensores de Freenove"></textarea></label>
        <label>Modelo<select name="modelo" id="ia-modelo-alta" data-solo-fotos="1"><option value="">El de siempre (${esc(nombreModelo(D.ia.modelo))})</option></select>
          <span class="ayuda">Solo salen los que ven fotos. Gasta una consulta para separarlas y otra por cada pieza que elijas.</span></label>
        <p class="nota" id="ia-aviso-modelo" hidden></p>
        <div class="acciones"><button class="btn prim" type="submit">Separar las piezas</button></div>
      </form>
    </article>`;
}
async function enviarVarias(form) {
  const fd = new FormData(form), file = fd.get('foto');
  if (!file || !file.size) throw new Error('Elige la foto con las piezas');
  toast('Enviando la foto…');
  const foto = await base64(await jpeg(await lienzoDe(file, 2000))); // entera, sin encuadrar: los recortes salen de ella
  const t = await api('POST', 'api/ia/detectar', {texto: fd.get('texto'), foto, modelo: fd.get('modelo') || undefined});
  location.hash = `#/ia/${t.id}`;
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
function vistaDeteccion(t) {
  DETECCION = t;
  const p = t.propuesta, url = `fotos/${encodeURIComponent(t.foto)}`;
  return `${cabecera(`${plural(p.piezas.length, 'pieza')} en la foto`, '', 'Desmarca las que no quieras y corrige el nombre si hace falta (es solo una pista). Después la IA identifica cada una con su recorte y te las enseña juntas para guardarlas.')}
    ${specs([['Modelo', esc(nombreModelo(t.modelo))], ['Coste', esc(costeTexto(p.coste))]])}
    ${p.dudas?.length ? `<div class="nota nota-ia"><p><span class="nota-t">Ojo</span> ${p.dudas.map(esc).join(' ')}</p></div>` : ''}
    <div class="pad det">
      <div class="det-foto"><img id="det-img" src="${url}" alt="La foto con las piezas numeradas">
        ${p.piezas.map((x, i) => (x.caja ? `<span class="det-caja" data-i="${i}" style="left:${x.caja.x / 10}%;top:${x.caja.y / 10}%;width:${x.caja.ancho / 10}%;height:${x.caja.alto / 10}%"><b>${i + 1}</b></span>` : '')).join('')}</div>
      <div class="det-lista">${p.piezas.map((x, i) => `<div class="det-pieza" data-i="${i}">
        <label class="det-marca"><input type="checkbox" class="det-ok" checked aria-label="Dar de alta la pieza ${i + 1}"><b>${i + 1}</b></label>
        <span class="det-mini" data-i="${i}"></span>
        <div class="det-datos"><input class="det-nombre" maxlength="200" value="${esc(x.nombre)}" aria-label="Nombre de la pieza ${i + 1}">
          ${x.descripcion ? `<span class="sub">${esc(x.descripcion)}</span>` : ''}${x.caja ? '' : '<span class="sub aviso">Sin recuadro: se usará la foto entera.</span>'}</div>
        <label class="det-cant">Cant.<input type="number" class="det-cantidad" min="1" inputmode="numeric" value="${esc(x.cantidad ?? 1)}"></label>
      </div>`).join('')}</div>
      <div class="acciones">
        <button class="btn prim" type="button" id="det-crear" data-id="${t.id}">Identificar las marcadas</button>
        <button class="btn" type="button" data-det-marcar="todo">Marcar todas</button>
        <button class="btn" type="button" data-det-marcar="nada">Ninguna</button>
        <button class="btn peligro" type="button" id="ia-descartar" data-id="${t.id}" data-volver="#/ia/varias">Descartar</button>
      </div>
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
  b.textContent = n ? `Identificar ${piezasTxt(n)} (${plural(n, 'consulta')})` : 'Marca alguna pieza';
  b.disabled = !n;
}
async function crearDeteccion(boton) {
  const img = $('#det-img'), t = DETECCION;
  if (!img?.naturalWidth) throw new Error('La foto aún no ha cargado');
  boton.disabled = true;
  boton.textContent = 'Recortando…';
  const piezas = [];
  for (const f of document.querySelectorAll('.det-pieza')) {
    if (!f.querySelector('.det-ok').checked) continue;
    const x = t.propuesta.piezas[f.dataset.i];
    piezas.push({nombre: f.querySelector('.det-nombre').value.trim() || x.nombre, descripcion: x.descripcion, cantidad: Number(f.querySelector('.det-cantidad').value) || 1,
      foto: await base64(await jpeg(recortar(img, x.caja, 1200)))});
  }
  toast(`Enviando ${piezasTxt(piezas.length)}…`);
  const r = await api('POST', `api/ia/tareas/${t.id}/crear-piezas`, {piezas});
  location.hash = `#/ia/lote/${r.lote}`;
}

// ---- lote de piezas nuevas (de una foto con varias): se guardan las marcadas tal como las propone la IA ----
function htmlLoteAltas(ts) {
  const listas = ts.filter((t) => t.estado !== 'pendiente').length;
  const tarea = (t) => {
    const p = t.propuesta || {};
    const tipo = p.tipo_existente ? esc(g(p.tipo_existente).nombre) : p.tipo_nuevo ? `${esc(p.tipo_nuevo.nombre)} <span class="aviso">· tipo nuevo, sin comprobar</span>` : 'Sin tipo';
    const estado = {pendiente: 'identificando…', propuesta: `confianza ${p.confianza || '?'}`, aplicada: 'guardada', descartada: 'descartada', error: 'error'}[t.estado] || t.estado;
    const mini = t.foto ? `<img class="thumb" src="fotos/${encodeURIComponent(t.foto)}" alt="">` : '';
    const cuerpo = t.estado === 'error' ? `<p class="mal">${esc(t.error || 'Error')}</p>`
      : t.estado === 'propuesta' ? `<p class="sub">${tipo} · ${p.cantidad ?? 1} ud.${p.dudas?.length ? ` · <span class="aviso">${plural(p.dudas.length, 'duda')}: ábrela para contestar</span>` : ''}</p>` : '';
    const nombre = esc(p.nombre || 'Pieza sin identificar');
    return `<section class="pad lote-tarea lote-alta lote-${t.estado}">
      ${t.estado === 'propuesta' ? `<input type="checkbox" class="lote-cambio" data-tarea="${t.id}" value="alta" aria-label="Guardar ${nombre}" ${LOTE.desmarcados.has(`${t.id}:alta`) ? '' : 'checked'}>` : '<span></span>'}
      ${mini}
      <div><div class="lote-t">${t.estado === 'aplicada' && t.componente_id ? `<a class="nombre" href="#/c/${t.componente_id}">${nombre}</a>` : `<span class="nombre">${nombre}</span>`}
        <span class="gris">· ${esc(estado)}</span>${t.estado === 'propuesta' ? `<a class="lote-abrir" href="#/ia/${t.id}">Abrir</a>` : ''}</div>${cuerpo}</div></section>`;
  };
  const quedan = ts.some((t) => t.estado === 'propuesta' || t.estado === 'error');
  return `${cabecera(`${piezasTxt(ts.length)} de una foto`, '', listas < ts.length
      ? `Identificando… ${listas} de ${ts.length} listas. Puedes ir mirando las que ya han llegado.`
      : 'Guarda las marcadas tal como están, o abre una para corregirla, contestar sus dudas o ponerle sitio. Las fichas nuevas quedan «sin comprobar».')}
    ${listas < ts.length ? '<div class="ia-progreso" role="progressbar" aria-label="La IA está identificando las piezas"><span></span></div>' : ''}
    ${ts.map(tarea).join('')}
    ${quedan ? `<div class="acciones pad lote-acciones">
      <button class="btn prim" type="button" id="lote-guardar">Guardar las marcadas</button>
      <button class="btn" type="button" data-lote-marcar="todo">Marcar todas</button>
      <button class="btn" type="button" data-lote-marcar="nada">Ninguna</button>
      <button class="btn peligro" type="button" id="lote-descartar">Descartar lo que quede</button></div>` : '<p class="pad gris">Ya no queda nada por revisar de esta foto.</p>'}`;
}
async function guardarLoteAltas(boton) {
  const ids = [...document.querySelectorAll('.lote-cambio:checked')].map((x) => Number(x.dataset.tarea));
  if (!ids.length) throw new Error('Marca alguna pieza');
  boton.disabled = true;
  boton.textContent = 'Guardando…';
  const r = await api('POST', `api/ia/lotes/${encodeURIComponent(LOTE.id)}/guardar`, {ids});
  await cargar(); contadores();
  await iaLote(LOTE.id);
  toast(`${piezasTxt(r.guardadas.length)} guardada${r.guardadas.length === 1 ? '' : 's'}${r.fallos.length ? `; ${r.fallos.length} no (${r.fallos[0].error})` : ''}`, r.fallos.length > 0);
}

// lista de tareas abiertas (debajo del formulario): nada se pierde si cierras la pestaña mientras el modelo piensa
async function iaAbiertas() {
  const zona = $('#ia-abiertas');
  if (!zona) return;
  try {
    const p = await api('GET', 'api/ia/pendientes'), n = p.lotes.length + p.tareas.length, MAX = 6;
    const filas = [...p.lotes.map(filaLotePendiente), ...p.tareas.map(filaPendiente)];
    zona.innerHTML = n ? `<section class="grupo"><h3 class="grupo-t">Sin terminar<span class="n">${n}</span></h3>${filas.slice(0, MAX).join('')}
      <p class="sub ia-abiertas-mas"><a href="#/pendientes">${n > MAX ? `Ver las ${n} en «Cambios pendientes»` : 'Verlo en «Cambios pendientes»'} →</a></p></section>` : '';
    if (p.lotes.some((l) => l.estados.pendiente) || p.tareas.some((t) => t.estado === 'pendiente')) setTimeout(() => { if (location.hash === '#/ia') iaAbiertas(); }, 4000);
  } catch {}
}

async function iaTarea(id) {
  const zona = $('#ia-zona');
  if (!zona) return;
  let t;
  try { t = await api('GET', `api/ia/tareas/${id}`); } catch (err) { zona.innerHTML = `<p class="mal pad">${esc(err.message)}</p>`; return; }
  const foto = t.foto ? `<img class="foto ia-foto" src="fotos/${encodeURIComponent(t.foto)}" alt="">` : '';
  const atras = document.querySelector('a.back');
  if (atras && t.clase === 'revisar') { atras.href = volverRevision(t); atras.textContent = `← ${textoVolver(t)}`; } // a su lote, a pendientes o a la ficha
  else if (atras && t.lote) { atras.href = `#/ia/lote/${encodeURIComponent(t.lote)}`; atras.textContent = '← Las piezas de la foto'; }
  else if (atras && desdePendientes(t)) { atras.href = '#/pendientes'; atras.textContent = '← Cambios pendientes'; }
  if (t.estado === 'pendiente') {
    // la pantalla de espera se pinta UNA vez (si no, la animación y el contador se reiniciarían en cada consulta)
    const clave = `${t.id}-${t.rondas}`;
    if (zona.dataset.espera !== clave) {
      zona.dataset.espera = clave;
      const lleva = Math.max(0, (fechaSql(t.ahora) - fechaSql(t.actualizada)) / 1000) || 0; // segundos que lleva, según el servidor
      zona.dataset.inicio = String(Date.now() - lleva * 1000);
      zona.innerHTML = vistaEspera(foto, t.modelo_pedido || D.ia?.modelo, t.clase === 'revisar' ? 'Repasando la ficha…' : t.clase === 'detectar' ? 'Separando las piezas…' : 'Analizando…');
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
  if (t.estado === 'error') {
    pintar(`${cabecera('No ha salido', '', t.error || 'Error desconocido')}
      <div class="pad">${foto}<div class="acciones"><a class="btn prim" href="${t.clase === 'revisar' ? fichaRevision(t) : t.clase === 'detectar' ? '#/ia/varias' : '#/ia'}">Probar otra vez</a>
      <button class="btn peligro" id="ia-descartar" data-id="${t.id}">Descartar</button></div></div>`);
    return;
  }
  if (t.estado !== 'propuesta') {
    const enlace = t.clase === 'revisar' ? `<a class="btn" href="${volverRevision(t)}">${textoVolver(t)}</a>`
      : t.clase === 'detectar' && t.propuesta?.lote ? `<a class="btn" href="#/ia/lote/${esc(t.propuesta.lote)}">Ver las piezas de la foto</a>`
      : t.componente_id ? `<a class="btn" href="#/c/${t.componente_id}">Ver la pieza</a>` : '';
    pintar(`${cabecera(ESTADO_IA[t.estado])}<div class="pad">${enlace}</div>`);
    return;
  }
  if (t.clase === 'revisar') { pintar(vistaCambios(t)); return; }
  if (t.clase === 'detectar') { pintar(vistaDeteccion(t)); pintarDeteccion(); return; }
  const p = t.propuesta, n = p.tipo_nuevo || {}, sel = p.tipo_existente || (p.tipo_nuevo ? '__nuevo' : '');
  pintar(`${cabecera('Revisa la propuesta', '', 'Corrige lo que haga falta, mira cómo quedará y guarda. Nada se ha guardado todavía.')}
    ${specs([['Confianza', esc(p.confianza)], ['Modelo', esc(nombreModelo(t.modelo))], ['Coste', esc(costeTexto(p.coste))], ['Vuelta', t.rondas ? String(t.rondas + 1) : '']])}
    ${dudasIA(t, p)}
    <div class="filtros ia-pestanas"><div class="cats">
      <button class="f on" type="button" data-ia-vista="editar">Editar</button>
      <button class="f" type="button" data-ia-vista="previa">Vista previa</button></div></div>
    <div id="ia-previa" hidden></div>
    <form id="form-ia-ok" class="form" autocomplete="off" data-id="${t.id}" data-foto="${t.foto ? `fotos/${encodeURIComponent(t.foto)}` : ''}">
      ${foto}${tiraFotos(t)}
      <label>Nombre<input name="nombre" required maxlength="200" value="${esc(p.nombre)}"></label>
      <div class="campo"><span class="campo-t">Tipo</span>${selectorTipo(sel, p.tipo_nuevo ? `Nuevo: ${p.tipo_nuevo.nombre} (propuesto por la IA)` : 'Nuevo tipo…')}</div>
      <div id="nuevo-tipo" class="nuevo-tipo" ${sel === '__nuevo' ? '' : 'hidden'}>
        <p class="nota nota-ia">Ficha nueva escrita por la IA: quedará marcada como «sin comprobar».</p>
        <label>Nombre del tipo<input name="tn_nombre" maxlength="120" value="${esc(n.nombre || '')}"></label>
        <label>Categoría<select name="tn_categoria">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k === (n.categoria || 'otro') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Resumen<textarea name="tn_resumen" rows="2" maxlength="400">${esc(n.resumen || '')}</textarea></label>
        <label>Tensión<input name="tn_voltaje" maxlength="120" value="${esc(n.voltaje || '')}"></label>
        <label>Interfaces (separadas por comas)<input name="tn_interfaz" value="${esc(list(n.interfaz).join(', '))}"></label>
        <label>Otros nombres (separados por comas)<input name="tn_alias" value="${esc(list(n.alias).join(', '))}"></label>
        ${editorFilas('pines', n.pines, {campo: 'tn_pines', etiqueta: 'Pines', boton: 'Añadir pin', ayuda: 'Un pin por fila, en el orden de la placa. La función da el color del pin; en la nota, lo que haya que saber de ese pin. Si escribes varios en una fila, se separan solos.'})}
        ${editorFilas('datos', n.datos, {campo: 'tn_datos', etiqueta: 'Datos del tipo', boton: 'Añadir dato', ayuda: 'Iguales para todas las piezas de este tipo.'})}
        <label>Ojo (advertencia)<textarea name="tn_ojo" rows="2" maxlength="400">${esc(n.ojo || '')}</textarea></label>
      </div>
      ${editorFilas('datos', p.datos_pieza, {campo: 'datos_pieza', etiqueta: 'Datos de esta pieza', boton: 'Añadir dato'})}
      <div class="dos">
        <label>Cantidad<input name="cantidad" type="number" min="0" inputmode="numeric" value="${esc(p.cantidad ?? 1)}"></label>
        <label class="check"><input type="checkbox" name="varios"> Hay muchos (sin contar)</label>
      </div>
      <label>Sitio<input name="ubicacion" list="ubics" maxlength="120" placeholder="Cajita 3"></label>
      <datalist id="ubics">${ubicaciones().map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
      <label>Notas<textarea name="notas" rows="2" maxlength="2000"></textarea></label>
      <div class="acciones">
        <button class="btn prim" type="submit">Guardar pieza</button>
        <button class="btn peligro" type="button" id="ia-descartar" data-id="${t.id}"${t.lote ? ` data-volver="#/ia/lote/${esc(t.lote)}"` : ''}>Descartar</button>
      </div>
    </form>`);
}

async function enviarIA(form) {
  const fd = new FormData(form);
  const [file, ...otras] = fotosDelCampo(form.querySelector('.archivo-input'));
  let foto = null;
  if (file) { // la primera es la que se queda la pieza: se encuadra como siempre
    const blob = await encuadrar(file);
    if (!blob) throw new Error('Foto cancelada: no se ha enviado nada');
    foto = await base64(blob);
  }
  toast(otras.length ? `Enviando ${otras.length + 1} fotos…` : 'Enviando…');
  const fotos = await Promise.all(otras.map(reducida));
  const t = await api('POST', 'api/ia/alta', {texto: fd.get('texto'), foto, fotos, modelo: fd.get('modelo') || undefined});
  location.hash = `#/ia/${t.id}`;
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
function tiraFotos(t, todas = false) {
  const fs = (t.fotos || []).filter((f) => todas || f !== t.foto);
  if (!fs.length || (todas && fs.length < 2)) return '';
  return `<div class="ia-tira${todas ? ' pad' : ''}">${todas ? '' : '<span class="ayuda">También ha mirado:</span>'}${fs.map((f) =>
    `<a href="fotos/${encodeURIComponent(f)}" target="_blank" rel="noopener"><img src="fotos/${encodeURIComponent(f)}" alt="" loading="lazy"></a>`).join('')}</div>`;
}
const costeTexto = (c) => (c && c.dolares != null ? `≈ ${c.dolares < 0.0001 ? '<0,0001' : c.dolares.toFixed(4).replace('.', ',')} $` : '');

// dudas del modelo, cada una con su hueco para contestar y, si el modelo ve fotos, su foto («¿qué pone en la
// serigrafía?» → la foto de la serigrafía). Debajo, lo que quieras añadir y más fotos sueltas. «Responder y repensar»
// le manda todo junto con lo que hayas corregido en el formulario, y el modelo rehace la propuesta (como mucho 5 vueltas)
function dudasIA(t, p) {
  const quedan = (t.rondas || 0) < 5, correccion = t.clase === 'revisar';
  const m = modeloIA(t.modelo_pedido || t.modelo), usadas = t.fotos?.length || 0, libres = Math.min(4, 8 - usadas);
  const puedeFotos = quedan && (!m || m.vision) && libres > 0;
  // lo que no es una pregunta (avisos de la app: «se han corregido solos algunos campos») no lleva hueco para contestar
  const avisos = (p.dudas || []).filter((d) => !d.includes('?'));
  p = {...p, dudas: (p.dudas || []).filter((d) => d.includes('?'))};
  return `<section class="ia-dudas pad" id="ia-dudas" data-libres="${puedeFotos ? libres : 0}">
    <h3>${p.dudas?.length ? `Dudas del modelo<span class="n">${p.dudas.length}</span>` : '¿Algo que aclarar?'}</h3>
    ${avisos.map((d) => `<p class="ia-aviso">${esc(d)}</p>`).join('')}
    ${p.dudas?.length ? `<ol class="ia-preguntas">${p.dudas.map((d, i) => `<li><p>${esc(d)}</p>
      <div class="ia-resp-fila"><input class="ia-resp" data-duda="${esc(d)}" maxlength="500" placeholder="Tu respuesta" autocomplete="off" aria-label="Respuesta a la duda ${i + 1}">
        ${puedeFotos ? campoFoto('', '', {compacto: true}) : ''}</div></li>`).join('')}</ol>` : ''}
    <label class="ia-extra">${p.dudas?.length ? 'Algo más (opcional)' : correccion ? 'Qué más tiene que corregir o saber' : 'Qué más tiene que saber'}
      <textarea id="ia-extra" rows="2" maxlength="1000" placeholder="${correccion ? 'Tiene 16 MB de flash · Añade el consumo' : 'Tiene 3 pines · Es la versión en placa'}"></textarea></label>
    ${puedeFotos ? campoFoto(p.dudas?.length ? 'Más fotos (opcional)' : 'Fotos (opcional)', `La serigrafía de cerca, la otra cara… Hasta ${libres} en esta vuelta${p.dudas?.length ? ', contando las de las respuestas' : ''}${usadas ? ` (la consulta lleva ${usadas} de 8)` : ''}.`, {varias: libres}) : ''}
    <div class="acciones">${quedan
      ? `<button class="btn prim" type="button" id="ia-responder" data-id="${t.id}">Responder y repensar</button>
         <span class="ayuda">${correccion ? 'La IA vuelve a mirar la ficha con tus respuestas y rehace los cambios. Gasta otra consulta.' : 'Rehace la propuesta con tus respuestas y con lo que hayas corregido abajo. Gasta otra consulta.'}</span>`
      : `<span class="ayuda">Ya van 5 vueltas: ${correccion ? 'aplica lo que te sirva y corrige a mano el resto' : 'corrige a mano lo que falte y guarda'}.</span>`}</div>
  </section>`;
}

// vista previa: la ficha tal como se verá en el inventario, con los mismos componentes que la ficha real
function vistaPreviaIA(b, fotoUrl) {
  const nuevo = b.tipo === '__nuevo';
  const f = nuevo ? {...b.tipo_nuevo, revisado: 0} : b.tipo ? g(b.tipo) : null;
  const datosTipo = f && list(f.datos).length ? `<h3 class="sep">Datos del tipo</h3><table class="t"><tbody>${f.datos.map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>` : '';
  const ocultos = nuevo ? [f.ojo ? 'la advertencia («Ojo»)' : '', list(f.interfaz).length ? 'las interfaces (sirven para buscar)' : ''].filter(Boolean) : [];
  return `<p class="ayuda pad">Así quedará${nuevo ? ` la pieza, y el tipo nuevo «${esc(f.nombre)}» en el glosario (sin la palabra «Nuevo»)` : ' la pieza'}. Aún no se ha guardado nada.</p>
    <article class="hoja ia-previa-hoja">
      ${cabecera(esc(b.nombre || '(sin nombre)'), f ? CATS[f.categoria] || '' : '', f ? f.resumen : '')}
      ${nuevo ? avisoIA('') : ''}
      ${specs([
        ['Cantidad', b.varios ? 'muchos' : esc(b.cantidad === '' || b.cantidad == null ? '?' : b.cantidad)],
        ['Sitio', esc(b.ubicacion || '—')],
        ['Tensión', esc(f ? voltajeDe(f) : '')],
        ['Tipo', f ? esc(f.nombre) : 'Sin tipo'],
        ...list(b.datos_pieza).map(([k, v]) => [esc(k), esc(v)]),
      ])}
      <div class="hoja-cuerpo">
        <div>${f ? tablaPines(f) || '<p class="gris">Este tipo no tiene pines.</p>' : '<p class="gris">Sin tipo: no se verán pines.</p>'}${datosTipo}</div>
        <aside class="lateral">
          ${fotoUrl ? `<img class="foto" src="${fotoUrl}" alt="">` : ''}
          ${b.notas ? `<div><h3>Notas</h3><p class="notas">${esc(b.notas)}</p></div>` : ''}
          ${f && list(f.alias).length ? `<p class="meta">Otros nombres: ${esc(list(f.alias).join(', '))}</p>` : ''}
          ${ocultos.length ? `<p class="meta">Se guardan pero no se muestran en la ficha: ${ocultos.join(' y ')}.</p>` : ''}
        </aside>
      </div>
    </article>
    <div class="acciones pad"><button class="btn" type="button" data-ia-vista="editar">Volver a editar</button>
      <button class="btn prim" type="button" id="ia-guardar-previa">Guardar pieza</button></div>`;
}

function verVistaIA(vista) {
  const form = $('#form-ia-ok'), previa = $('#ia-previa');
  if (!form || !previa) return;
  const ver = vista === 'previa';
  if (ver) previa.innerHTML = vistaPreviaIA(leerFormIA(form), form.dataset.foto);
  previa.hidden = !ver;
  form.hidden = ver;
  $('#ia-dudas').hidden = ver;
  document.querySelectorAll('.ia-pestanas [data-ia-vista]').forEach((b) => b.classList.toggle('on', b.dataset.iaVista === vista));
}

async function responderIA(boton) {
  const zona = $('#ia-dudas');
  // cada duda con su respuesta y su foto (una foto sola ya es una respuesta)
  const dudas = [...zona.querySelectorAll('.ia-preguntas li')].map((li) => ({duda: li.querySelector('.ia-resp').dataset.duda,
    respuesta: li.querySelector('.ia-resp').value.trim(), archivos: fotosDelCampo(li.querySelector('.archivo-input'))})).filter((r) => r.respuesta || r.archivos.length);
  const extra = ($('#ia-extra')?.value || '').trim();
  const sueltas = fotosDelCampo([...zona.querySelectorAll('.archivo-input')].find((i) => !i.closest('.ia-preguntas')));
  const nFotos = sueltas.length + dudas.reduce((n, r) => n + r.archivos.length, 0), libres = Number(zona.dataset.libres) || 0;
  if (!dudas.length && !extra && !nFotos) throw new Error('Contesta alguna duda, escribe algo más o añade una foto antes de repensar');
  if (nFotos > libres) throw new Error(`En esta vuelta caben ${libres} fotos y has puesto ${nFotos}: quita ${nFotos - libres}`);
  boton.disabled = true;
  toast(nFotos ? `Repensando con tus respuestas y ${nFotos === 1 ? 'la foto' : `${nFotos} fotos`}…` : 'Repensando con tus respuestas…');
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
  toast('Guardada');
  location.hash = LOTE.id && ui.origenTarea?.desde === `#/ia/lote/${LOTE.id}` ? ui.origenTarea.desde : `#/c/${r.componente.id}`;
}

// ---------- Ajustes (fase B): IA, categorías, tipos, sitios, datos y tema ----------
const plural = (n, uno, varios = `${uno}s`) => `${n} ${n === 1 ? uno : varios}`;

// ---------- cambios pendientes: correcciones y altas a medias (para no perder un lote al salir de su pantalla) ----------
// fecha del servidor (UTC «AAAA-MM-DD HH:MM:SS») → «hace 5 min», «hoy 14:32», «ayer 09:10», «3 nov 14:32»
function cuando(s) {
  const t = fechaSql(s);
  if (!t) return '';
  const d = new Date(t), seg = (Date.now() - t) / 1000;
  if (seg < 60) return 'ahora';
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  const hora = d.toLocaleTimeString('es-ES', {hour: '2-digit', minute: '2-digit'});
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (d >= hoy) return `hoy ${hora}`;
  if (d >= hoy - 864e5) return `ayer ${hora}`;
  return `${d.toLocaleDateString('es-ES', {day: 'numeric', month: 'short', ...(d.getFullYear() !== hoy.getFullYear() ? {year: 'numeric'} : {})})} ${hora}`;
}
// el nombre bonito de los modelos («Claude Haiku 5.5») necesita el catálogo: si aún no está, se pide y se vuelve a pintar
const conModelos = (fn) => { if (!MODELOS_IA && D.ia?.activa) modelosIA().then(fn).catch(() => {}); };
const fechaCompleta = (s) => (fechaSql(s) ? new Date(fechaSql(s)).toLocaleString('es-ES', {dateStyle: 'full', timeStyle: 'medium'}) : '');

function vPendientes() {
  return `<a class="back" href="#/">← Inventario</a><article class="hoja" id="pend-zona"><p class="gris pad">Cargando…</p></article>`;
}
const estadosLote = (e) => [e.propuesta ? `${e.propuesta} lista${e.propuesta === 1 ? '' : 's'}` : '', e.pendiente ? `${e.pendiente} preparándose` : '',
  e.error ? `<span class="mal">${e.error} con error</span>` : ''].filter(Boolean).join(' · ');
function estadoTarea(t) {
  if (t.estado === 'error') return '<span class="mal">Error</span>';
  if (t.estado === 'pendiente') return 'Preparándose…';
  if (t.clase === 'detectar') return `${plural(t.propuesta?.piezas?.length || 0, 'pieza')} por elegir`;
  if (t.clase !== 'revisar') return 'Lista para revisar';
  const n = t.propuesta?.cambios?.length || 0;
  return n ? plural(n, 'cambio') : 'Nada que cambiar';
}
function filaPendiente(t) {
  const nombre = nombreTareaIA(t);
  const modelo = nombreModelo(t.modelo || t.modelo_pedido || D.ia?.modelo);
  return `<div class="fila"><a class="fila-main" href="#/ia/${t.id}">${t.foto ? `<img class="thumb" src="fotos/${encodeURIComponent(t.foto)}" alt="">` : ''}
      <div><div class="nombre">${esc(nombre)}</div><div class="sub">${esc(cuando(t.creada))}${modelo ? ` · ${esc(modelo)}` : ''}${t.texto && t.clase === 'revisar' ? ` · «${esc(t.texto)}»` : ''}</div></div></a>
    <div class="der"><span>${estadoTarea(t)}</span>${t.estado !== 'pendiente' ? `<button class="btn mini" type="button" data-pend-descartar="tarea:${t.id}">Descartar</button>` : ''}</div></div>`;
}
function filaLotePendiente(l) {
  const mas = l.piezas.length > 4 ? ` y ${l.piezas.length - 4} más` : '';
  const abiertas = (l.estados.propuesta || 0) + (l.estados.error || 0);
  return `<div class="fila"><a class="fila-main" href="#/ia/lote/${esc(l.lote)}">
      <div><div class="nombre">${l.clase === 'alta' ? `${piezasTxt(l.total)} de una foto` : `Correcciones de ${piezasTxt(l.total)} a la vez`}</div>
        <div class="sub">${esc(l.piezas.slice(0, 4).join(', '))}${mas}${l.texto ? ` · «${esc(l.texto)}»` : ''}</div>
        <div class="sub">${esc(cuando(l.creada))}${l.cambios ? ` · ${plural(l.cambios, 'cambio')} por mirar` : ''}</div></div></a>
    <div class="der"><span>${estadosLote(l.estados)}</span>${abiertas ? `<button class="btn mini" type="button" data-pend-descartar="lote:${esc(l.lote)}">Descartar</button>` : ''}</div></div>`;
}
async function cargarPendientes() {
  const zona = $('#pend-zona');
  if (!zona) return;
  let p;
  try { p = await api('GET', 'api/ia/pendientes'); } catch (err) { zona.innerHTML = `<p class="mal pad">${esc(err.message)}</p>`; return; }
  const revisar = p.tareas.filter((t) => t.clase === 'revisar'), altas = p.tareas.filter((t) => t.clase !== 'revisar');
  const grupo = (titulo, filas) => (filas.length ? `<section class="grupo pad"><h3 class="grupo-t">${titulo}<span class="n">${filas.length}</span></h3>${filas.join('')}</section>` : '');
  zona.innerHTML = `${cabecera('Cambios pendientes', '', 'Correcciones y piezas nuevas que esperan a que las revises, las que aún se están preparando y las que fallaron. Nada se aplica hasta que lo marcas.')}
    ${p.total ? '' : '<p class="pad gris">No hay nada pendiente. Si dejas a medias unas correcciones o una pieza nueva, aparecerán aquí.</p>'}
    ${grupo('Varias piezas a la vez', p.lotes.map(filaLotePendiente))}
    ${grupo('Correcciones', revisar.map(filaPendiente))}
    ${grupo('Piezas nuevas', altas.map(filaPendiente))}
    <p class="pad sub">Lo que ya aplicaste o descartaste está en <a href="#/ajustes/historial?g=ia">Ajustes → Historial</a>.</p>`;
  if (p.tareas.length) conModelos(() => { if (location.hash === '#/pendientes') cargarPendientes(); });
  const pensando = p.lotes.some((l) => l.estados.pendiente) || p.tareas.some((t) => t.estado === 'pendiente');
  if (pensando) setTimeout(() => { if (location.hash === '#/pendientes') cargarPendientes(); }, 4000);
}
async function descartarPendiente(valor) {
  const [clase, id] = valor.split(':');
  let ids = [Number(id)];
  if (clase === 'lote') {
    ids = (await api('GET', `api/ia/lotes/${encodeURIComponent(id)}`)).filter((t) => t.estado === 'propuesta' || t.estado === 'error').map((t) => t.id);
    if (!ids.length || !(await confirmar(`¿Descartar las ${ids.length} correcciones que quedan en este lote?\nNo se cambia nada de tus piezas ni de sus fichas.`, {si: 'Descartar', peligro: true}))) return;
  } else if (!(await confirmar('¿Descartar este cambio pendiente?\nNo se cambia nada.', {si: 'Descartar', peligro: true}))) return;
  for (const t of ids) await api('POST', `api/ia/tareas/${t}/descartar`).catch(() => {});
  CUENTA_PEND = null;
  await cargarPendientes();
  await iaAbiertas(); // la lista «Sin terminar» de «Añadir con IA», si es la que está en pantalla
  toast(ids.length === 1 ? 'Descartada' : `${ids.length} descartadas`);
}

// aviso en el Inventario cuando la IA tiene algo sin terminar
let CUENTA_PEND = null;
function pintarAvisoPend() {
  const z = $('#pend-aviso'), c = CUENTA_PEND;
  if (!z || !c) return;
  z.innerHTML = c.tareas ? `<a class="pend-aviso" href="#/pendientes"><span class="nota-t">Cambios pendientes</span>
    <span>${c.grupos === 1 ? 'Tienes 1 sin revisar' : `Tienes ${c.grupos} sin revisar`}${c.pensando ? ` (${c.pensando} aún preparándose)` : ''}</span><span class="gris">Ver →</span></a>` : '';
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
const quienHist = (r) => (r.quien === 'ia' ? `IA${r.modelo ? ` · ${esc(nombreModelo(r.modelo))}` : ''}` : r.quien === 'sistema' ? 'Sistema' : 'Tú');
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
    d.cantidad ? `Tenía: ${esc(d.cantidad)}${d.sitio ? ` · en ${esc(d.sitio)}` : ''}${d.tipo ? ` · ${esc(d.tipo)}` : ''}` : '',
    d.antes ? `El estado anterior se guardó como ${esc(d.antes)}` : '',
    d.lote ? `<a href="#/ia/lote/${esc(d.lote)}">Ver el lote</a>` : '',
    d.orden ? `Orden nuevo: ${esc(d.orden.join(', '))}` : '',
    d.texto ? `«${esc(d.texto)}»` : '',
  ].filter(Boolean);
  const objeto = conObjeto && r.nombre ? `<span class="hist-obj">${enlaceHist(r)} <span class="gris">· ${OBJETO_HIST[r.objeto] || r.objeto}</span></span>` : '';
  const cab = `<span class="hist-cuando" title="${esc(fechaCompleta(r.fecha))}">${esc(cuando(r.fecha))}</span>
    <span class="hist-quien hist-${r.quien}">${quienHist(r)}</span>
    <span class="hist-que">${objeto}<span class="hist-res">${esc(r.resumen)}</span></span>`;
  if (!cambios.length && !extra.length) return `<div class="hist">${cab}</div>`;
  return `<details class="hist"><summary>${cab}</summary><div class="hist-det">
    ${cambios.map((c) => `<div class="hist-c"><span class="hist-campo">${esc(c.campo)}</span>
      <span class="ia-antes">${esc(c.antes) || '<span class="gris">(vacío)</span>'}</span><span class="ia-ahora">${esc(c.despues) || '<span class="gris">(vacío)</span>'}</span></div>`).join('')}
    ${extra.length ? `<p class="sub">${extra.join(' · ')}</p>` : ''}</div></details>`;
}
function ajHistorial() {
  return `${cabecera('Historial', '', 'Todo lo que ha cambiado, de lo más nuevo a lo más antiguo: lo que haces tú, lo que la IA corrige (con el modelo que usó) y lo que hace el sistema. Toca una línea para ver el antes y el después.')}
    <div class="filtros pad hist-filtros">
      <div class="cats">${Object.entries(GRUPOS_HIST).map(([k, v]) => `<button class="f ${HIST.grupo === k ? 'on' : ''}" type="button" data-hist-grupo="${k}">${v}</button>`).join('')}</div>
      <input id="hist-q" class="buscar-mini" type="search" placeholder="Buscar nombre o modelo" value="${esc(HIST.q)}" autocomplete="off" aria-label="Buscar en el historial">
    </div>
    <div class="hist-lista pad" id="hist-lista">${HIST.filas.length ? HIST.filas.map((r) => filaHist(r)).join('') : `<p class="gris">${HIST.cargando ? 'Cargando…' : 'Nada por aquí todavía.'}</p>`}</div>
    ${HIST.mas ? '<div class="pad acciones"><button class="btn" type="button" id="hist-mas">Cargar más</button></div>' : ''}`;
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
const plegableHist = (objeto, id, tipo = '') => `<details class="plegable" data-historial="${objeto}:${esc(id)}" data-tipo="${esc(tipo || '')}"><summary>Historial</summary>
  <div class="plegable-cuerpo"><p class="gris">Cargando…</p></div></details>`;
async function cargarHistDe(det) {
  const [objeto, ...resto] = det.dataset.historial.split(':'), id = resto.join(':');
  const cuerpo = det.querySelector('.plegable-cuerpo');
  try {
    const tipo = det.dataset.tipo || '';
    const r = await api('GET', `api/auditoria?${new URLSearchParams({objeto, id, limite: '100', ...(tipo ? {tipo} : {})})}`);
    cuerpo.innerHTML = r.filas.length ? `${tipo ? '<p class="sub">Los cambios de la pieza y los de la ficha de su tipo (marcados «ficha»).</p>' : ''}
      <div class="hist-lista">${r.filas.map((x) => filaHist(x, x.objeto !== objeto)).join('')}</div>
      ${r.mas ? `<p class="sub">Solo los 100 últimos. <a href="#/ajustes/historial">Todo el historial</a></p>` : ''}` : '<p class="gris">Sin cambios apuntados todavía.</p>';
    if (r.filas.some((x) => x.modelo)) conModelos(() => cargarHistDe(det));
  } catch (err) { cuerpo.innerHTML = `<p class="mal">${esc(err.message)}</p>`; }
}

// ---------- registro del servidor (Ajustes → Registro) ----------
const REG = {nivel: 'todo', q: '', datos: null};
const NIVELES_REG = {todo: 'Todo', avisos: 'Avisos y errores', errores: 'Solo errores'};
function ajRegistro() {
  const d = REG.datos;
  const linea = (l) => `<div class="reg-l reg-${l.nivel}"><span class="reg-h" title="${esc(new Date(l.fecha).toLocaleString('es-ES'))}">${esc(new Date(l.fecha).toLocaleTimeString('es-ES'))}</span><span class="reg-t">${esc(l.texto)}</span></div>`;
  return `${cabecera('Registro del servidor', '', 'Los últimos mensajes del servidor: arranque, copias, lo que hace la IA, cada cambio que llega y los errores. Se guardan en memoria y se borran al reiniciar.')}
    <div class="filtros pad hist-filtros">
      <div class="cats">${Object.entries(NIVELES_REG).map(([k, v]) => `<button class="f ${REG.nivel === k ? 'on' : ''}" type="button" data-reg-nivel="${k}">${v}</button>`).join('')}</div>
      <input id="reg-q" class="buscar-mini" type="search" placeholder="Buscar en el registro" value="${esc(REG.q)}" autocomplete="off" aria-label="Buscar en el registro">
      <button class="btn mini" type="button" id="reg-copiar">Copiar</button>
    </div>
    ${d ? `<p class="pad sub">Arrancó ${esc(new Date(d.arranque).toLocaleString('es-ES', {dateStyle: 'medium', timeStyle: 'short'}))} · ${d.guardadas} mensajes guardados (como mucho ${d.maximo}) · se actualiza solo</p>
      <div class="registro pad" id="reg-lista">${d.lineas.length ? d.lineas.map(linea).join('') : '<p class="gris">Nada que coincida.</p>'}</div>` : '<p class="pad gris">Cargando…</p>'}`;
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

const SECCIONES = {ia: 'IA', categorias: 'Categorías', tipos: 'Tipos', sitios: 'Sitios', formato: 'Uniformar formato', datos: 'Datos', historial: 'Historial', registro: 'Registro'};

function vAjustes(sec) {
  if (sec && SECCIONES[sec]) {
    const id = sec === 'ia' ? 'ia-ajustes' : 'aj-zona';
    return `<a class="back" href="#/ajustes">← Ajustes</a><article class="hoja" id="${id}" data-sec="${sec}"><p class="gris pad">Cargando…</p></article>`;
  }
  const tipos = Object.values(D.tipos), archivados = tipos.filter((t) => t.archivado).length;
  const fila = (href, nombre, sub) => `<div class="fila"><a class="fila-main" href="${href}"><div><div class="nombre">${nombre}</div>
    <div class="sub">${sub}</div></div></a><span class="gris">→</span></div>`;
  const grupo = (titulo, filas) => `<section class="aj-grupo"><h3 class="grupo-t">${titulo}</h3>${filas.join('')}</section>`;
  const pend = CUENTA_PEND?.grupos ? `<span class="aviso">${CUENTA_PEND.grupos} sin revisar</span> · ` : '';
  return `<article class="hoja">${cabecera('Ajustes', '', 'Lo que cambies aquí se ve al momento en el inventario y el glosario.')}
    <div class="pad aj-menu">
      ${grupo('IA', [
        fila('#/ajustes/ia', 'Modelo y clave', D.ia?.activa ? `Conectada · ${esc(nombreModelo(D.ia.modelo))} · razona ${esc((RAZONAR[D.ajustes.ia_razonar] || RAZONAR.poco).nombre.toLowerCase())} · clave ${esc(D.ia.clave)}` : '<span class="mal">Sin clave</span>'),
        fila('#/pendientes', 'Cambios pendientes', `${pend}correcciones y piezas nuevas que dejaste a medias`)])}
      ${grupo('Catálogo', [
        fila('#/ajustes/categorias', 'Categorías', `${plural(D.categorias.length, 'categoría')} · renombrar, ordenar, añadir, borrar`),
        fila('#/ajustes/tipos', 'Tipos', `${plural(tipos.length - archivados, 'tipo')}${archivados ? ` · ${archivados} archivado${archivados === 1 ? '' : 's'}` : ''} · archivar, fusionar, borrar`),
        fila('#/ajustes/sitios', 'Sitios', `${plural(ubicaciones().length, 'sitio')} · renombrar, juntar, borrar`),
        fila('#/ajustes/formato', 'Uniformar formato', 'Que todo esté escrito igual: «3,3 V», «I2C», «Corriente máx.»')])}
      ${grupo('Aspecto', [
        `<div class="fila"><div class="fila-main"><div><div class="nombre">Tema</div><div class="sub">Claro de día, grafito de noche o según el sistema</div></div></div>
          <div class="cats">${Object.entries({auto: 'Automático', claro: 'Claro', noche: 'Noche'}).map(([k, v]) =>
            `<button class="f ${(D.ajustes.tema || 'auto') === k ? 'on' : ''}" data-poner-tema="${k}">${v}</button>`).join('')}</div></div>`])}
      ${grupo('Datos y actividad', [
        fila('#/ajustes/datos', 'Copias de seguridad', 'Hacer una copia, descargarla, restaurar y exportar'),
        fila('#/ajustes/historial', 'Historial', 'Quién cambió qué y cuándo: tú, la IA (con su modelo) o el sistema'),
        fila('#/ajustes/registro', 'Registro', 'Mensajes del servidor: arranque, copias, IA y errores')])}
    </div></article>`;
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
  return `${cabecera('Categorías', '', 'Cámbiales el nombre escribiendo encima, ordénalas con las flechas o bórralas. «Otros» no se borra: es donde va lo que no tiene sitio.')}
    <div class="pad aj-lista">${cats.map((c, i) => `
      <div class="aj-fila" data-cat-fila="${esc(c.id)}">
        <input class="aj-nombre" data-cat-nombre="${esc(c.id)}" value="${esc(c.nombre)}" maxlength="60" aria-label="Nombre de la categoría">
        <span class="sub">${plural(c.tipos, 'tipo')}</span>
        <span class="aj-botones">
          <button class="btn mini" data-cat-mover="${esc(c.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${esc(c.nombre)}">↑</button>
          <button class="btn mini" data-cat-mover="${esc(c.id)}" data-dir="1" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="Bajar ${esc(c.nombre)}">↓</button>
          <button class="btn mini peligro" data-cat-borrar="${esc(c.id)}" data-tipos="${c.tipos}" ${c.id === 'otro' ? 'disabled title="Es la categoría de reserva"' : ''}>Borrar</button>
        </span>
        <div class="aj-panel" hidden></div>
      </div>`).join('')}</div>
    <form id="aj-cat-nueva" class="form" autocomplete="off">
      <label>Nueva categoría<input name="nombre" maxlength="60" required placeholder="Relés y potencia"></label>
      <div class="acciones"><button class="btn prim" type="submit">Añadir</button></div>
    </form>`;
}

const ORIGEN_TXT = {seed: 'catálogo base', ia: 'IA', usuario: 'tuyo'};
function ajTipos(tipos) {
  const f = ui.ajTipos || 'todos', query = norm(ui.ajBuscar || '');
  const filtros = {
    todos: ['Todos', (t) => !t.archivado], sin: ['Sin comprobar', (t) => !t.archivado && t.revisado === 0],
    ia: ['De la IA', (t) => !t.archivado && t.origen === 'ia'], vacios: ['Sin piezas', (t) => !t.archivado && !t.piezas],
    archivados: ['Archivados', (t) => t.archivado === 1],
  };
  const lista = tipos.filter(filtros[f][1]).filter((t) => !query || norm(`${t.nombre} ${t.id}`).includes(query));
  const destinos = (sin) => Object.keys(CATS).map((cat) => {
    const ts = tipos.filter((t) => !t.archivado && t.categoria === cat && t.id !== sin);
    return ts.length ? `<optgroup label="${esc(CATS[cat])}">${ts.map((t) => `<option value="${esc(t.id)}">${esc(t.nombre)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  return `${cabecera('Tipos', '', 'Archivar lo oculta sin borrar nada. Fusionar pasa las piezas y los proyectos a otro tipo. Borrar solo se puede si nada lo usa.')}
    <div class="filtros pad"><div class="cats">${Object.entries(filtros).map(([k, [nombre, fn]]) =>
      `<button class="f ${f === k ? 'on' : ''}" data-aj-tipos="${k}">${nombre}<span class="n">${tipos.filter(fn).length}</span></button>`).join('')}</div>
      <input id="aj-buscar" class="aj-buscar" type="search" placeholder="Buscar tipo" value="${esc(ui.ajBuscar || '')}" autocomplete="off"></div>
    <div class="pad aj-lista">${lista.length ? lista.map((t) => {
      const usos = [t.piezas ? plural(t.piezas, 'pieza') : '', t.proyectos ? plural(t.proyectos, 'proyecto') : ''].filter(Boolean).join(' · ');
      return `<div class="aj-fila aj-tipo" data-tipo="${esc(t.id)}">
        <div><a class="nombre" href="#/g/${esc(t.id)}">${esc(t.nombre)}</a>${t.revisado === 0 ? ' <span class="aviso">· sin comprobar</span>' : ''}
          <div class="sub">${esc(CATS[t.categoria] || t.categoria)} · ${usos || 'sin uso'} · ${esc(ORIGEN_TXT[t.origen] || t.origen)}</div></div>
        <span class="aj-botones">
          <button class="btn mini" data-tipo-archivar="${esc(t.id)}" data-v="${t.archivado ? 0 : 1}">${t.archivado ? 'Recuperar' : 'Archivar'}</button>
          ${t.archivado ? '' : `<button class="btn mini" data-tipo-fusionar="${esc(t.id)}">Fusionar…</button>`}
          <button class="btn mini peligro" data-tipo-borrar="${esc(t.id)}" ${usos ? `disabled title="No se puede borrar: lo usan ${esc(usos)}. Archívalo o fusiónalo con otro."` : ''}>Borrar</button>
        </span>
        <div class="aj-panel" hidden>${t.archivado ? '' : `<label>Sus piezas y proyectos pasan a
          <select data-fusion-destino="${esc(t.id)}"><option value="">Elige el tipo que se queda…</option>${destinos(t.id)}</select></label>
          <div class="acciones"><button class="btn prim mini" data-tipo-fusionar-ok="${esc(t.id)}">Fusionar</button>
          <button class="btn mini" data-aj-cerrar>Cancelar</button></div>`}</div>
      </div>`;
    }).join('') : vacio('Nada en este filtro.')}</div>`;
}

// Uniformar formato: lo que cambiaría en las fichas y en los datos de las piezas para que todo esté escrito igual
function ajFormato(r) {
  const grupos = new Map();
  for (const c of r.cambios) { const k = `${c.objeto}:${c.objeto_id}`; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(c); }
  const enlace = (c) => (c.objeto === 'tipo' ? `#/g/${encodeURIComponent(c.objeto_id)}` : `#/c/${esc(c.objeto_id)}`);
  return `${cabecera('Uniformar formato', '', 'La app escribe siempre igual las tensiones y las unidades («3,3 V», «20 mA»), las interfaces («I2C») y los nombres de los datos («Corriente máx.»). Aquí sale lo que ya está guardado de otra manera: marca lo que quieras dejar igual que el resto. Solo cambia cómo está escrito, no lo que dice, y no gasta consultas de la IA.')}
    ${r.cambios.length ? [...grupos.values()].map((cs) => `<section class="pad formato-grupo">
      <p class="lote-t"><a class="nombre" href="${enlace(cs[0])}">${esc(cs[0].nombre)}</a><span class="gris">· ${cs[0].objeto === 'tipo' ? 'ficha' : 'pieza'}</span></p>
      ${cs.map((c) => `<label class="ia-cambio-fila"><input type="checkbox" class="formato-cambio" value="${esc(c.id)}" checked><span>${filaCambio(c)}</span></label>`).join('')}</section>`).join('')
      + `<div class="acciones pad lote-acciones">
        <button class="btn prim" type="button" id="formato-aplicar">Aplicar lo marcado</button>
        <button class="btn" type="button" data-formato-marcar="todo">Marcar todo</button>
        <button class="btn" type="button" data-formato-marcar="nada">Ninguno</button></div>`
      : '<p class="pad">Todo está ya escrito con el mismo formato.</p>'}
    ${r.interfaces.length ? `<section class="pad"><h3 class="grupo-t">Interfaces en uso<span class="n">${r.interfaces.length}</span></h3>
      <p class="sub">La app no puede saber si dos nombres distintos son la misma cosa («Analógica» y «1 pin analógico»). Si ves dos que lo son, edita la ficha y deja uno: la IA usará el que quede.</p>
      <p class="formato-lista">${r.interfaces.map((x) => `<span>${esc(x.nombre)} <span class="gris">×${x.n}</span></span>`).join('')}</p></section>` : ''}`;
}
function contarFormato() {
  const b = $('#formato-aplicar');
  if (!b) return;
  const n = document.querySelectorAll('.formato-cambio:checked').length;
  b.textContent = n ? `Aplicar ${plural(n, 'cambio')}` : 'Marca algún cambio';
  b.disabled = !n;
}
async function aplicarFormato(boton) {
  const ids = [...document.querySelectorAll('.formato-cambio:checked')].map((x) => x.value);
  boton.disabled = true;
  boton.textContent = 'Aplicando…';
  const r = await api('POST', 'api/ajustes/formato', {ids});
  await cargar(); contadores();
  $('#aj-zona').innerHTML = ajFormato(r);
  contarFormato();
  toast(`${plural(r.aplicados, 'cambio')} de formato aplicado${r.aplicados === 1 ? '' : 's'}`);
}

function ajSitios(sitios) {
  return `${cabecera('Sitios', '', 'Donde guardas las piezas. Si renombras uno con el nombre de otro, se juntan. Al borrar uno, sus piezas se quedan «sin sitio».')}
    <div class="pad aj-lista">${sitios.length ? sitios.map((s) => `
      <div class="aj-fila">
        <input class="aj-nombre" data-sitio-nombre="${s.id}" value="${esc(s.nombre)}" maxlength="120" aria-label="Nombre del sitio">
        <span class="sub">${plural(s.piezas, 'pieza')}</span>
        <span class="aj-botones"><button class="btn mini peligro" data-sitio-borrar="${s.id}" data-piezas="${s.piezas}" data-nombre="${esc(s.nombre)}">Borrar</button></span>
      </div>`).join('') : vacio('Aún no hay sitios: se crean al poner «Sitio» en una pieza.')}</div>`;
}

const fechaLarga = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'}) : '');
const tamano = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
// copias de cada día, manuales y las que se hacen solas antes de migrar o de restaurar
const claseCopia = (n) => (n.startsWith('lab-antes-restaurar') ? 'antes de restaurar' : n.startsWith('lab-antes-') ? 'antes de una migración'
  : /^lab-\d{4}-\d{2}-\d{2}\.db$/.test(n) ? 'diaria' : 'manual');

function ajDatos(r) {
  const u = r.copias.ultima;
  return `${cabecera('Datos', '', 'Copias de seguridad: descárgalas para guardarlas fuera del servidor y restáuralas si algo sale mal.')}
    ${specs([['Piezas', r.piezas], ['Fotos', r.fotos], ['Tipos', `${r.tipos}${r.archivados ? ` (+${r.archivados} archivado${r.archivados === 1 ? '' : 's'})` : ''}`], ['Categorías', r.categorias],
      ['Sitios', r.sitios], ['Proyectos', r.proyectos], ['Versión de los datos', `v${r.version}`]])}
    <section class="pad ia-bloque">
      <h3>Exportar</h3>
      <p class="ayuda">Un solo archivo .tar.gz con la base de datos y las ${r.fotos} fotos. Sirve para restaurarlo aquí o en otro servidor.
        Incluye la clave de la IA: guárdalo en un sitio seguro.</p>
      <div class="acciones"><a class="btn prim" href="api/copia/exportar" download>Descargar copia completa</a>
        <a class="btn" href="api/exportar" download>Datos en JSON (solo lectura)</a></div>
    </section>
    <section class="pad ia-bloque" id="aj-importar-zona">
      <h3>Restaurar desde un archivo</h3>
      <p class="ayuda">El .tar.gz que exporta la app, o un .db suelto (una copia diaria). Primero se comprueba y te enseña qué contiene; no cambia nada hasta que confirmes.</p>
      <div class="acciones"><label class="btn">Elegir archivo…<input type="file" id="aj-importar" accept=".gz,.tgz,.tar.gz,.db,application/gzip,application/x-gzip" hidden></label></div>
      <p class="ayuda" id="aj-importar-estado" role="status"></p>
      <div id="aj-restaurar"></div>
    </section>
    <section class="pad ia-bloque">
      <h3>Copias en el servidor</h3>
      <p class="ayuda">Se hace una al día sola y se guardan ${r.copias.maximo} diarias (${r.copias.guardadas} copias ahora, contando las especiales).
        ${u ? `Última: ${esc(fechaLarga(u.fecha))}.` : '<span class="mal">Aún no hay ninguna.</span>'} Carpeta: <span class="mono">${esc(r.copias.carpeta)}</span></p>
      <div class="acciones"><button class="btn" type="button" id="aj-copia">Hacer copia ahora</button></div>
      ${r.copias.lista.length ? `<table class="t copias"><thead><tr><th>Fecha</th><th>Clase</th><th class="der">Tamaño</th><th></th></tr></thead><tbody>
        ${r.copias.lista.map((c) => `<tr><td class="num">${esc(fechaLarga(c.fecha))}</td><td class="gris">${esc(claseCopia(c.nombre))}</td>
          <td class="der num">${tamano(c.bytes)}</td><td class="der"><span class="aj-botones">
            <a class="btn mini" href="api/copias/${encodeURIComponent(c.nombre)}" download>Descargar</a>
            <button class="btn mini" type="button" data-copia-preparar="${esc(c.nombre)}">Restaurar…</button></span></td></tr>`).join('')}</tbody></table>
        <p class="ayuda">Las copias del servidor solo llevan la base de datos: las fotos están en su carpeta de copias y no se borran nunca.</p>` : ''}
    </section>`;
}

// lo que se va a restaurar frente a lo que hay ahora; nada cambia hasta pulsar «Restaurar»
function panelRestaurar(r) {
  const fila = (k, a, b) => `<tr><td class="gris">${k}</td><td class="der num">${esc(a)}</td><td class="der num">${esc(b)}</td></tr>`;
  const de = {archivo: 'el archivo subido', base: 'la base de datos subida', copia: `la copia del servidor ${r.copia || ''}`}[r.origen] || 'la copia';
  return `<div class="restaurar aparece">
    <h3>Restaurar ${esc(de)}</h3>
    <table class="t"><thead><tr><th></th><th class="der">Ahora</th><th class="der">Copia</th></tr></thead><tbody>
      ${fila('Piezas', r.actual.piezas, r.piezas)}${fila('Tipos', r.actual.tipos + r.actual.archivados, r.tipos)}${fila('Proyectos', r.actual.proyectos, r.proyectos)}
      ${fila('Fotos', r.actual.fotos, r.origen === 'archivo' ? `${r.fotos} en el archivo` : 'las de ahora')}
      ${fila('Versión de los datos', `v${r.actual.version}`, `v${r.version}${r.version < r.actual.version ? ' (se actualiza al restaurar)' : ''}`)}
      ${r.exportado ? fila('Fecha', '—', fechaLarga(r.exportado)) : ''}</tbody></table>
    <p class="nota nota-peligro">Se sustituye todo lo de ahora: inventario, glosario, proyectos, ajustes y la clave de la IA. Antes se guarda una copia
      del estado actual en el servidor («antes de restaurar»), así que se puede volver atrás. Las fotos no se borran.</p>
    <div class="acciones"><button class="btn prim peligro-prim" type="button" data-restaurar="${esc(r.token)}">Restaurar</button>
      <button class="btn" type="button" data-restaurar-cancelar>Cancelar</button></div></div>`;
}

// subida con progreso (XMLHttpRequest: fetch no da el progreso de subida)
function subirCopia(file) {
  const estado = $('#aj-importar-estado'), zona = $('#aj-restaurar');
  zona.innerHTML = '';
  estado.className = 'ayuda';
  estado.textContent = `Subiendo ${file.name} (${tamano(file.size)})…`;
  const x = new XMLHttpRequest();
  x.open('POST', 'api/copia/preparar');
  x.setRequestHeader('content-type', 'application/octet-stream');
  x.upload.onprogress = (e) => { if (e.lengthComputable) estado.textContent = `Subiendo ${file.name}: ${Math.round((e.loaded / e.total) * 100)} %`; };
  x.upload.onload = () => { estado.textContent = 'Comprobando el archivo…'; };
  x.onerror = () => { estado.className = 'mal'; estado.textContent = 'Sin conexión con el servidor: no se ha subido'; };
  x.onload = () => {
    let r = {};
    try { r = JSON.parse(x.responseText); } catch {}
    if (x.status !== 200) { estado.className = 'mal'; estado.textContent = r.error || `Error ${x.status}`; return; }
    estado.textContent = 'Archivo comprobado: está bien. Mira lo que contiene antes de restaurar.';
    zona.innerHTML = panelRestaurar(r);
    zona.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  };
  x.send(file);
}

async function restaurarCopia(boton) {
  if (!(await confirmar('¿Restaurar esta copia?\nSe sustituye todo lo de ahora. Antes se guarda una copia del estado actual en el servidor.', {si: 'Restaurar', peligro: true}))) return;
  boton.disabled = true;
  boton.textContent = 'Restaurando…';
  try {
    const r = await api('POST', 'api/copia/restaurar', {token: boton.dataset.restaurar});
    MODELOS_IA = null;
    await cargar();
    aplicarTema();
    contadores();
    location.hash = '#/ajustes/datos';
    await ajCargar();
    toast(`Restaurada: ${plural(r.piezas, 'pieza')}${r.fotos ? ` y ${r.fotos} foto${r.fotos === 1 ? ' nueva' : 's nuevas'}` : ''}`);
  } catch (err) { boton.disabled = false; boton.textContent = 'Restaurar'; toast(err.message, true); }
}

async function clicAjustes(t) {
  const d = t.dataset, fila = t.closest('.aj-fila'), panel = fila?.querySelector('.aj-panel');
  if (d.ponerTema) { await api('PUT', 'api/ajustes/tema', {valor: d.ponerTema}); D.ajustes.tema = d.ponerTema; aplicarTema(); route(); return true; }
  if ('ajCerrar' in d) { t.closest('.aj-panel').hidden = true; return true; }
  if (d.ajTipos) { ui.ajTipos = d.ajTipos; await ajCargar(); return true; }
  if (t.id === 'aj-copia') { t.disabled = true; const r = await api('POST', 'api/copias'); await ajCargar(); toast(`Copia hecha: ${r.nombre}`); return true; }
  if (d.copiaPreparar) {
    t.disabled = true;
    try {
      const r = await api('POST', `api/copias/${encodeURIComponent(d.copiaPreparar)}/preparar`);
      const zona = $('#aj-restaurar');
      zona.innerHTML = panelRestaurar(r);
      $('#aj-importar-estado').textContent = '';
      zona.closest('section').scrollIntoView({block: 'start', behavior: 'smooth'});
    } finally { t.disabled = false; }
    return true;
  }
  if (d.restaurar) { await restaurarCopia(t); return true; }
  if ('restaurarCancelar' in d) {
    await api('DELETE', 'api/copia/preparada').catch(() => {});
    $('#aj-restaurar').innerHTML = '';
    $('#aj-importar-estado').textContent = 'Cancelado: no se ha cambiado nada.';
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
      if (!(await confirmar(`¿Borrar la categoría «${nombre}»?`, {si: 'Borrar', peligro: true}))) return true;
      await api('DELETE', `api/categorias/${d.catBorrar}`);
      await ajRefrescar(`Categoría «${nombre}» borrada`);
      return true;
    }
    panel.innerHTML = `<label>${n === 1 ? 'Su tipo pasa' : `Sus ${n} tipos pasan`} a
        <select data-cat-destino>${D.categorias.filter((c) => c.id !== d.catBorrar).map((c) => `<option value="${esc(c.id)}" ${c.id === 'otro' ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>
      <div class="acciones"><button class="btn prim mini peligro" data-cat-borrar-ok="${esc(d.catBorrar)}">Mover y borrar «${esc(nombre)}»</button>
        <button class="btn mini" data-aj-cerrar>Cancelar</button></div>`;
    panel.hidden = false;
    return true;
  }
  if (d.catBorrarOk) {
    const destino = panel.querySelector('[data-cat-destino]').value;
    const r = await api('DELETE', `api/categorias/${d.catBorrarOk}?destino=${encodeURIComponent(destino)}`);
    await ajRefrescar(`Borrada; ${plural(r.movidos, 'tipo')} a «${CATS[destino] || destino}»`);
    return true;
  }
  if (d.tipoArchivar) {
    const archivar = d.v === '1';
    await api('PATCH', `api/tipos/${d.tipoArchivar}`, {archivado: archivar});
    if ($('#aj-zona')) await ajRefrescar(archivar ? 'Archivado: ya no sale en el glosario' : 'Recuperado');
    else { await cargar(); contadores(); route(); toast(archivar ? 'Archivado' : 'Recuperado'); }
    return true;
  }
  if (d.tipoFusionar) { panel.hidden = !panel.hidden; return true; }
  if (d.tipoFusionarOk) {
    const destino = panel.querySelector('[data-fusion-destino]').value;
    if (!destino) { toast('Elige el tipo que se queda', true); return true; }
    const a = D.tipos[d.tipoFusionarOk]?.nombre, b = D.tipos[destino]?.nombre;
    if (!(await confirmar(`¿Fusionar «${a}» en «${b}»?\nSus piezas y proyectos pasan a «${b}» y «${a}» desaparece. No se puede deshacer.`, {si: 'Fusionar', peligro: true}))) return true;
    const r = await api('POST', `api/tipos/${d.tipoFusionarOk}/fusionar`, {destino});
    await ajRefrescar(`Fusionado: ${plural(r.piezas, 'pieza')} ${r.piezas === 1 ? 'pasa' : 'pasan'} a «${b}»`);
    return true;
  }
  if (d.tipoBorrar) {
    const nombre = D.tipos[d.tipoBorrar]?.nombre;
    if (!(await confirmar(`¿Borrar el tipo «${nombre}»?\nNo se puede deshacer.`, {si: 'Borrar', peligro: true}))) return true;
    await api('DELETE', `api/tipos/${d.tipoBorrar}`);
    await ajRefrescar(`Tipo «${nombre}» borrado`);
    return true;
  }
  if (d.sitioBorrar) {
    const n = Number(d.piezas);
    if (!(await confirmar(n ? `¿Borrar el sitio «${d.nombre}»?\nSus ${plural(n, 'pieza')} se quedan sin sitio.` : `¿Borrar el sitio «${d.nombre}»?`, {si: 'Borrar', peligro: true}))) return true;
    await api('DELETE', `api/ubicaciones/${d.sitioBorrar}`);
    await ajRefrescar('Sitio borrado');
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
      await ajRefrescar('Guardado');
    } else {
      const otro = [...document.querySelectorAll('[data-sitio-nombre]')].find((x) => x !== input && x.defaultValue.toLowerCase() === nuevo.toLowerCase());
      if (otro && !(await confirmar(`¿Juntar con «${otro.defaultValue}»?\nYa hay un sitio con ese nombre: las piezas de este pasan a ese.`, {si: 'Juntar'}))) { input.value = input.defaultValue; return; }
      const r = await api('PATCH', `api/ubicaciones/${input.dataset.sitioNombre}`, {nombre: nuevo});
      await ajRefrescar(r.fusionado ? `Juntados: ${plural(r.piezas, 'pieza')} en «${r.nombre}»` : 'Guardado');
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
  return nombre || may(String(campo).replace(/^(ficha|tipo|pieza)./i, '').replace(/[._]/g, ' '));
}
const fichaRevision = (t) => (t.objetivo?.componente_id ? `#/c/${t.objetivo.componente_id}` : t.objetivo?.tipo_id ? `#/g/${encodeURIComponent(t.objetivo.tipo_id)}` : '#/ia');
const desdePendientes = (t) => ui.origenTarea?.hash === `#/ia/${t.id}` && ui.origenTarea.desde === '#/pendientes';
const volverRevision = (t) => (t.lote ? `#/ia/lote/${encodeURIComponent(t.lote)}` : desdePendientes(t) ? '#/pendientes' : fichaRevision(t));
const textoVolver = (t) => (t.lote ? 'Volver al lote' : desdePendientes(t) ? 'Volver a cambios pendientes' : 'Volver a la ficha');

// desplegable en la ficha (pieza o tipo): qué revisar y una foto, ambos opcionales
function panelRevisar(objetivo, id, ayuda) {
  if (!D.ia?.activa) return '';
  return `<details class="ia-revisar"><summary class="btn">Corregir con IA</summary>
    <form id="form-revisar" class="form sin-pad" autocomplete="off" data-objetivo="${objetivo}" data-id="${esc(id)}">
      <p class="ayuda">${esc(ayuda)} Te enseña solo lo que cambiaría y tú eliges qué aplicar.</p>
      <label>Qué corregir (opcional)<textarea name="texto" rows="2" maxlength="1000" placeholder="Los pines están al revés · Añade el consumo"></textarea></label>
      ${campoFoto('Fotos (opcional)', 'Hasta 4. Sin ninguna, la IA mira la foto que ya tiene la pieza.', {varias: 4})}
      <div class="acciones"><button class="btn prim" type="submit">Pedir correcciones</button></div>
    </form></details>`;
}

async function enviarRevision(form) {
  const fd = new FormData(form);
  const [foto = null, ...fotos] = await Promise.all(fotosDelCampo(form.querySelector('.archivo-input')).map(reducida));
  const t = await api('POST', 'api/ia/revisar', {objetivo: form.dataset.objetivo, id: form.dataset.id, texto: fd.get('texto'), foto, fotos});
  location.hash = `#/ia/${t.id}`;
}

// los cambios propuestos: cada uno con su casilla (marcados al empezar), antes tachado y ahora en claro
// vista previa de una corrección: la ficha tal como quedaría con SOLO los cambios marcados, aplicados aquí (sin guardar
// nada) con la misma regla que el servidor (server/revision.mjs → aplicarCambios): pines y datos emparejados por su nombre
const claveTxt = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
function aplicarEnLocal(t, ids) {
  const p = t.propuesta, o = p.objetivo || {};
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
function previaRevision(t, ids) {
  const {tipo, pieza, pc, marcados} = aplicarEnLocal(t, ids);
  const datosTxt = (pares) => `<p class="sec-datos">${pares.map(([k, v]) => `<span><span class="gris">${esc(k)}</span> ${esc(v)}</span>`).join('')}</p>`;
  return `<div class="pad rev-resumen">${marcados.length
      ? `<p class="ayuda">Así quedaría con ${marcados.length === 1 ? 'el cambio marcado' : `los ${marcados.length} cambios marcados`}. Aún no se ha guardado nada.</p>
        <p class="rev-lista"><span class="gris">Cambia:</span> ${marcados.map((c) => esc(c.etiqueta)).join(' · ')}</p>`
      : '<p class="ayuda">No hay ningún cambio marcado: la ficha se quedaría como está.</p>'}</div>
    <article class="hoja ficha ia-previa-hoja">
      ${cabFicha({
        img: pc?.foto ? `<span class="pz-img"><img src="${fotoUrl(pc)}" alt=""></span>` : '',
        titulo: esc(pieza ? pieza.nombre : tipo?.nombre || ''),
        linea: pieza ? [esc(pc.ubicacion || 'Sin sitio'), esc(tipo ? tipo.nombre : 'Sin tipo')].join(' · ') : esc(CATS[tipo?.categoria] || ''),
        extra: !pieza && tipo?.resumen ? `<p class="pz-resumen">${esc(tipo.resumen)}</p>` : ''})}
      <div class="pz-cuerpo">
        ${tipo ? notaOjo(tipo) : ''}
        ${tipo && tipo.revisado === 0 ? avisoIA('') : ''}
        ${pieza && pieza.datos_pieza.length ? specs(pieza.datos_pieza.map(([k, v]) => [esc(k), esc(v)])) : ''}
        ${tipo ? `${lineaTecnica(tipo)}${tablaPines(tipo) || '<p class="gris">Sin pines.</p>'}` : ''}
        ${pieza && tipo ? `<h3>${esc(tipo.nombre)} · ${esc(CATS[tipo.categoria] || '')}</h3>${tipo.resumen ? `<p class="resumen">${esc(tipo.resumen)}</p>` : ''}` : ''}
        ${tipo && list(tipo.alias).length ? datosTxt([['Otros nombres', list(tipo.alias).join(', ')]]) : ''}
        ${tipo && list(tipo.datos).length ? `<h3>Datos del tipo</h3>${tablaDatos(tipo.datos)}` : ''}
        ${pieza?.notas ? `<h3>Notas</h3><p class="notas">${esc(pieza.notas)}</p>` : ''}
      </div>
    </article>`;
}
function verVistaRevision(vista, t) {
  const previa = $('#rev-previa'), cambios = $('#rev-cambios');
  if (!previa || !cambios || !t) return;
  const ver = vista === 'previa';
  if (ver) previa.innerHTML = previaRevision(t, [...document.querySelectorAll('.ia-cambio:checked')].map((x) => x.value));
  previa.hidden = !ver;
  cambios.hidden = ver;
  document.querySelectorAll('[data-rev-vista]').forEach((b) => b.classList.toggle('on', b.dataset.revVista === vista));
}
let REVISION = null; // la corrección que está en pantalla (para la vista previa)

function vistaCambios(t) {
  REVISION = t;
  const p = t.propuesta, volver = volverRevision(t), tipoId = p.objetivo?.tipo_id;
  const piezasTipo = tipoId ? D.componentes.filter((c) => c.tipo === tipoId).length : 0;
  const fila = (c) => `<label class="ia-cambio-fila"><input type="checkbox" class="ia-cambio" value="${esc(c.id)}" checked>
    <span><span class="nombre">${esc(c.etiqueta)}${c.tipoCambio === 'nuevo' ? ' <span class="gris">· nuevo</span>' : c.tipoCambio === 'quitado' ? ' <span class="gris">· se quita</span>' : ''}</span>
      ${c.antes ? `<span class="ia-antes">${esc(c.antes)}</span>` : ''}
      ${c.despues ? `<span class="ia-ahora">${esc(c.despues)}</span>` : ''}</span></label>`;
  const grupo = (ambito, titulo, ayuda) => {
    const cs = p.cambios.filter((c) => c.ambito === ambito);
    return cs.length ? `<section class="pad ia-grupo"><h3>${titulo}</h3>${ayuda ? `<p class="ayuda">${ayuda}</p>` : ''}${cs.map(fila).join('')}</section>` : '';
  };
  const nombreTipo = tipoId ? D.tipos[tipoId]?.nombre || tipoId : '';
  return `${cabecera(`Correcciones para «${esc(t.objetivo_nombre || '')}»`, '', p.cambios.length
      ? 'Marca los cambios que quieras aplicar. Lo que no marques se queda como está.'
      : 'La IA no ve nada que cambiar.')}
    ${t.foto ? `<p class="ayuda pad">${(t.fotos?.length || 1) > 1 ? `Ha mirado ${t.fotos.length} fotos${t.foto_de_pieza ? ' (la de la pieza y las que añadiste)' : ''}.` : t.foto_de_pieza ? 'Ha mirado la foto que ya tenía la pieza.' : 'Ha mirado la foto que adjuntaste.'}</p>${tiraFotos(t, true)}` : ''}
    ${specs([['Cambios', String(p.cambios.length)], ['Confianza', esc(p.confianza)], ['Modelo', esc(nombreModelo(t.modelo))], ['Coste', esc(costeTexto(p.coste))]])}
    ${dudasIA(t, p)}
    ${p.cambios.length ? `<div class="filtros ia-pestanas"><div class="cats">
      <button class="f on" type="button" data-rev-vista="cambios">Cambios</button>
      <button class="f" type="button" data-rev-vista="previa">Vista previa</button></div></div>` : ''}
    <div id="rev-previa" hidden></div>
    <div id="rev-cambios">
    ${grupo('tipo', `Ficha del tipo «${esc(nombreTipo)}»`, piezasTipo > 1 ? `La usan ${piezasTipo} piezas: los cambios se verán en todas. La ficha quedará «sin comprobar» hasta que la mires.` : 'La ficha quedará «sin comprobar» hasta que la mires.')}
    ${grupo('pieza', 'Esta pieza', '')}
    ${p.motivos?.length ? `<details class="pad ia-motivos"><summary>Por qué (${p.motivos.length})</summary><ul>${p.motivos.map((m) => `<li><strong>${esc(nombreCampo(m.campo))}</strong>: ${esc(m.motivo)}</li>`).join('')}</ul></details>` : ''}
    </div>
    <div class="acciones pad">
      ${p.cambios.length ? `<button class="btn prim" type="button" id="ia-aplicar-cambios" data-id="${t.id}" data-volver="${volver}">Aplicar ${p.cambios.length} cambio${p.cambios.length === 1 ? '' : 's'}</button>
        <button class="btn" type="button" data-ia-marcar="todo">Marcar todo</button>
        <button class="btn" type="button" data-ia-marcar="nada">Ninguno</button>` : `<a class="btn prim" href="${volver}">${textoVolver(t)}</a>`}
      <button class="btn peligro" type="button" id="ia-descartar" data-id="${t.id}" data-volver="${volver}">Descartar</button>
    </div>`;
}

function contarCambios() {
  const b = $('#ia-aplicar-cambios');
  if (!b) return;
  const n = document.querySelectorAll('.ia-cambio:checked').length;
  b.textContent = n ? `Aplicar ${n} cambio${n === 1 ? '' : 's'}` : 'Marca algún cambio';
  b.disabled = !n;
}

async function aplicarRevisionIA(boton) {
  const ids = [...document.querySelectorAll('.ia-cambio:checked')].map((x) => x.value);
  if (!ids.length) throw new Error('Marca algún cambio');
  boton.disabled = true;
  boton.textContent = 'Aplicando…';
  const r = await api('POST', `api/ia/tareas/${boton.dataset.id}/aplicar-cambios`, {ids});
  await cargar();
  contadores();
  location.hash = boton.dataset.volver;
  toast(`${r.aplicados} cambio${r.aplicados === 1 ? '' : 's'} aplicado${r.aplicados === 1 ? '' : 's'}`);
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
  document.title = `AMS lab · ${tab}`;
  if (v === 'g' && sub === 'editar') editarTipoCargar();
  if (v === 'p') cargarProyecto();
  if (v === 'ia') { if (arg === 'ajustes') iaAjustes(); else if (arg === 'lote') iaLote(sub); else if (arg === 'varias') llenarModelosAlta(); else if (arg) iaTarea(arg); else { iaAbiertas(); llenarModelosAlta(); } }
  if (v === '') avisoPendientes();
  if (v === 'pendientes') cargarPendientes();
  if (v === 'ajustes' && arg === 'historial') { const g = new URLSearchParams(qs).get('g'); if (g != null && g in GRUPOS_HIST) HIST.grupo = g; }
  if (v !== '' && v !== 'lote' && ui.seleccionando) salirSeleccion(); // la selección vive en el Inventario y en «Editar juntas»
  if (v === 'ajustes') {
    const t = new URLSearchParams(qs).get('t');
    if (arg === 'tipos' && t) { ui.ajBuscar = D.tipos[t]?.nombre || t; ui.ajTipos = D.tipos[t]?.archivado ? 'archivados' : 'todos'; }
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
  $('#n-glo').textContent = Object.values(D.tipos).filter((t) => !t.archivado).length || '';
}

// ---------- eventos ----------
app.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-cat],[data-cuenta],[data-pf],[data-adj],#quitar-foto,#quitar-pendiente,#marcar-pendiente,#ia-abrir,#borrar,#revisada,#ia-descartar,#ia-quitar,[data-ia-vista],#ia-responder,#ia-guardar-previa,#ia-cambiar-clave,[data-glo],[data-poner-tema],[data-cat-mover],[data-cat-borrar],[data-cat-borrar-ok],[data-aj-cerrar],[data-aj-tipos],[data-tipo-archivar],[data-tipo-fusionar],[data-tipo-fusionar-ok],[data-tipo-borrar],[data-sitio-borrar],#aj-copia,[data-ia-marcar],#ia-aplicar-cambios,[data-rev-vista],[data-vista-inv],#sel-modo,[data-sel],[data-sel-acc],[data-lote-todas],[data-lote-marcar],#lote-aplicar,#lote-descartar,.combo-op,[data-ed-anadir],[data-ed-quitar],[data-copia-preparar],[data-restaurar],[data-restaurar-cancelar],[data-pend-descartar],[data-hist-grupo],#hist-mas,[data-reg-nivel],#reg-copiar,[data-pro],#det-crear,[data-det-marcar],#lote-guardar,#filtros-abrir,#formato-aplicar,[data-formato-marcar],[data-pines-vista]');
  if (!t || !app.contains(t)) return; // solo botones de la propia vista (no el <html>, que lleva data-* del tema)
  if (t.dataset.cuenta) { // móvil: el recuadro de la cantidad se convierte en − n + (y se queda así mientras ajustas)
    ui.cuentaAbierta = Number(t.dataset.cuenta);
    document.querySelectorAll('.fila-pieza.editando').forEach((x) => x.classList.remove('editando'));
    t.closest('.fila-pieza').classList.add('editando');
    t.closest('.fila-pieza').querySelector('[data-adj]')?.focus();
    return;
  }
  // sin redibujar la vista: el selector de tipo y las tablas editables viven dentro de formularios a medio rellenar
  if (t.classList.contains('combo-op')) { elegirTipo(t.closest('.combo'), t.dataset.valor); return; }
  if (t.id === 'ia-abrir') { // el panel de la IA se abre debajo de la fila de acciones
    const d = $('.ia-revisar');
    d.open = !d.open;
    t.setAttribute('aria-expanded', String(d.open));
    if (d.open) d.querySelector('textarea')?.focus({preventScroll: true});
    return;
  }
  if (t.dataset.pinesVista) {
    ui.pinesVista = t.dataset.pinesVista;
    const caja = t.closest('.pines');
    caja.dataset.pinesModo = ui.pinesVista;
    caja.querySelectorAll('[data-pines-vista]').forEach((b) => { const on = b.dataset.pinesVista === ui.pinesVista; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    return;
  }
  if (clicEditor(t)) return;
  try {
    if (t.dataset.pro) { await clicProyecto(t); return; }
    if (t.id === 'sel-modo') { if (ui.seleccionando) salirSeleccion(); else ui.seleccionando = true; route(); return; }
    if (t.dataset.sel) { if (t.dataset.sel === 'visibles') ui.visibles.forEach((id) => ui.sel.add(id)); else ui.sel.clear(); route(); return; }
    if (t.dataset.selAcc) { if (!t.disabled) await accionSel(t.dataset.selAcc); return; }
    if (t.dataset.loteTodas) { ponerATodas(t.dataset.loteTodas); return; }
    if (t.dataset.loteMarcar) {
      document.querySelectorAll('.lote-cambio').forEach((x) => { x.checked = t.dataset.loteMarcar === 'todo'; LOTE.desmarcados[x.checked ? 'delete' : 'add'](`${x.dataset.tarea}:${x.value}`); });
      contarLote(); return;
    }
    if (t.id === 'lote-aplicar') { try { await aplicarLote(t); } catch (err) { toast(err.message, true); contarLote(); } return; }
    if (t.id === 'lote-descartar') { await descartarLote(); return; }
    if (t.id === 'formato-aplicar') { try { await aplicarFormato(t); } catch (err) { toast(err.message, true); contarFormato(); } return; }
    if (t.dataset.formatoMarcar) { document.querySelectorAll('.formato-cambio').forEach((x) => (x.checked = t.dataset.formatoMarcar === 'todo')); contarFormato(); return; }
    if (t.id === 'lote-guardar') { try { await guardarLoteAltas(t); } catch (err) { toast(err.message, true); contarLote(); } return; }
    if (t.id === 'det-crear') { try { await crearDeteccion(t); } catch (err) { toast(err.message, true); contarDeteccion(); } return; }
    if (t.dataset.detMarcar) { document.querySelectorAll('.det-ok').forEach((x) => (x.checked = t.dataset.detMarcar === 'todo')); contarDeteccion(); return; }
    if (t.dataset.pendDescartar) { await descartarPendiente(t.dataset.pendDescartar); return; }
    if (t.dataset.histGrupo != null) { HIST.grupo = t.dataset.histGrupo; await histCargar(true); return; }
    if (t.id === 'hist-mas') { t.disabled = true; t.textContent = 'Cargando…'; await histCargar(false); return; }
    if (t.dataset.regNivel) { REG.nivel = t.dataset.regNivel; REG.datos = null; await regCargar(); return; }
    if (t.id === 'reg-copiar') {
      const txt = (REG.datos?.lineas || []).slice().reverse().map((l) => `${l.fecha} ${l.nivel.toUpperCase()} ${l.texto}`).join('\n');
      try { await navigator.clipboard.writeText(txt); toast('Registro copiado'); } catch { toast('No se ha podido copiar (hace falta HTTPS o localhost)', true); }
      return;
    }
    if (t.dataset.vistaInv) { // Lista / Cuadrícula del inventario (atributo propio: no confundir con otras «vistas»)
      await api('PUT', 'api/ajustes/vista_inventario', {valor: t.dataset.vistaInv});
      D.ajustes.vista_inventario = t.dataset.vistaInv;
      route();
      return;
    }
    if (t.id === 'ia-cambiar-clave') { $('#form-ia-config').hidden = false; t.closest('.acciones').hidden = true; $('#form-ia-config [name=clave]').focus(); return; }
    if (t.dataset.glo) { ui.sinComprobar = t.dataset.glo === 'sin'; route(); return; }
    if (await clicAjustes(t)) return;
    if (t.dataset.iaMarcar) { document.querySelectorAll('.ia-cambio').forEach((x) => (x.checked = t.dataset.iaMarcar === 'todo')); contarCambios(); return; }
    if (t.id === 'ia-aplicar-cambios') { try { await aplicarRevisionIA(t); } catch (err) { t.disabled = false; toast(err.message, true); } return; }
    if (t.dataset.iaVista) { verVistaIA(t.dataset.iaVista); return; }
    if (t.dataset.revVista) { verVistaRevision(t.dataset.revVista, REVISION); return; }
    if (t.id === 'ia-guardar-previa') { verVistaIA('editar'); $('#form-ia-ok').requestSubmit(); return; }
    if (t.id === 'ia-responder') { try { await responderIA(t); } catch (err) { t.disabled = false; toast(err.message, true); } return; } // sin redibujar: no se pierde lo editado
    if (t.id === 'ia-quitar') {
      if (!(await confirmar('¿Quitar la clave de OpenCode Go?\nLa IA dejará de funcionar hasta que pongas otra.', {si: 'Quitar la clave', peligro: true}))) return;
      D.ia = await api('PUT', 'api/ia/config', {quitarClave: true});
      toast('Clave quitada');
      location.hash = '#/ia';
      return;
    }
    if (t.id === 'ia-descartar') {
      if (!(await confirmar('¿Descartar esta propuesta?\nNo se guarda nada.', {si: 'Descartar', peligro: true}))) return;
      await api('POST', `api/ia/tareas/${t.dataset.id}/descartar`);
      toast('Descartada');
      location.hash = t.dataset.volver || '#/ia';
      return;
    }
    if (t.id === 'revisada') {
      await api('PATCH', `api/tipos/${t.dataset.tipo}`, {revisado: true});
      D.tipos[t.dataset.tipo].revisado = 1;
      toast('Ficha comprobada: ya no sale el aviso');
    } else if (t.dataset.adj) {
      e.preventDefault();
      t.disabled = true;
      guardarLocal(await api('POST', `api/componentes/${t.dataset.id}/ajuste`, {delta: Number(t.dataset.adj)}));
    } else if (t.dataset.cat !== undefined) ui.cat = t.dataset.cat;
    else if (t.dataset.pf) ui.proFiltro = t.dataset.pf;
    else if (t.id === 'filtros-abrir') ui.filtros = !ui.filtros;
    else if (t.id === 'quitar-pendiente' || t.id === 'marcar-pendiente') {
      const marcar = t.id === 'marcar-pendiente';
      guardarLocal(await api('PATCH', `api/componentes/${location.hash.split('/')[2]}`, {revisar: marcar}));
      toast(marcar ? 'Marcada como pendiente' : 'Marca quitada');
    } else if (t.id === 'quitar-foto') {
      if (!(await confirmar('¿Quitar la foto de esta pieza?', {si: 'Quitar', peligro: true}))) return;
      guardarLocal(await api('DELETE', `api/componentes/${location.hash.split('/')[2]}/foto`));
    } else if (t.id === 'borrar') {
      const id = location.hash.split('/')[2], nombre = comp(id)?.nombre || 'la pieza';
      const r = await api('DELETE', `api/componentes/${id}`);
      D.componentes = D.componentes.filter((c) => c.id !== Number(id));
      contadores();
      location.hash = '#/';
      toast(`Borrada «${nombre}»`, false, {texto: 'Deshacer', fn: async () => {
        try {
          const x = await api('POST', 'api/componentes/restaurar', {token: r.deshacer});
          await cargar(); contadores();
          location.hash = `#/c/${x.id}`;
          toast('Recuperada');
        } catch (err) { toast(err.message, true); }
      }});
      return;
    }
    route();
  } catch (err) { toast(err.message, true); route(); }
});
app.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'ubic') { ui.ubic = t.value; route(); }
  if (t.id === 'rev') { ui.revisar = t.checked; route(); }
  if (t.id === 'sin-sitio') { ui.ubic = t.checked ? '∅' : ''; route(); }
  if (t.id === 'sin-foto') { ui.sinFoto = t.checked; route(); }
  if (t.id === 'pro-estado') { try { await cambiarEstadoPro(t); } catch (err) { toast(err.message, true); route(); } }
  if (t.id === 'pro-archivo' && t.files[0]) { const f = t.files[0]; t.value = ''; try { await subirArchivoPro(f); } catch (err) { toast(err.message, true); } }
  if (t.name === 'ia-modelo') cambiarModeloIA(t);
  if (t.id === 'ia-modelo-alta') avisoModeloAlta();
  if (t.classList.contains('det-ok')) contarDeteccion();
  if (t.classList.contains('formato-cambio')) contarFormato();
  if (t.name === 'ia-razonar') {
    const antes = D.ajustes.ia_razonar;
    try { await api('PUT', 'api/ajustes/ia_razonar', {valor: t.value}); D.ajustes.ia_razonar = t.value; toast(`La IA razonará: ${RAZONAR[t.value].nombre.toLowerCase()}`); }
    catch (err) { D.ajustes.ia_razonar = antes; toast(err.message, true); iaAjustes(); }
  }
  if (t.dataset.catNombre || t.dataset.sitioNombre) cambioAjustes(t);
  if (t.classList.contains('ia-cambio')) contarCambios();
  if (t.classList.contains('sel-pieza')) {
    const id = Number(t.value);
    if (t.checked) ui.sel.add(id); else ui.sel.delete(id);
    t.closest('.fila-sel, .tarjeta-sel')?.classList.toggle('marcada', t.checked);
    if (!ui.selIA) refrescarBarraSel();
  }
  if (t.classList.contains('lote-cambio')) { LOTE.desmarcados[t.checked ? 'delete' : 'add'](`${t.dataset.tarea}:${t.value}`); contarLote(); }
  if (t.id === 'aj-importar' && t.files[0]) { subirCopia(t.files[0]); t.value = ''; }
  if (t.matches('.ed-fn select')) t.closest('.ed-fn').style.cssText = colorFn(t.value); // el punto de color sigue a la función
  if (t.matches('.ed-pines .ed-fila [data-col="0"]')) separarEnEditor(t);
  if (t.name === 'varios') { const n = t.form.querySelector('[name=cantidad]'); n.disabled = t.checked; if (!t.checked && !n.value) n.value = 1; }
  if ((t.id === 'foto' || t.id === 'foto2') && t.files[0]) {
    try { await subirFoto(Number(location.hash.split('/')[2]), t.files[0]); route(); } catch (err) { toast(err.message, true); }
  }
});
app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const b = e.target.querySelector('[type=submit]');
  b.disabled = true;
  b.dataset.texto ||= b.textContent;
  if (e.target.id === 'form-ia' || e.target.id === 'form-ia-varias') b.textContent = 'Enviando…';
  if (e.target.id === 'form-ia-config') b.textContent = 'Comprobando…';
  try {
    if (e.target.id === 'form-ia') await enviarIA(e.target);
    else if (e.target.id === 'form-ia-varias') await enviarVarias(e.target);
    else if (e.target.id === 'form-ia-config') await guardarAjustesIA(e.target);
    else if (e.target.id === 'form-revisar') await enviarRevision(e.target);
    else if (e.target.id === 'aj-cat-nueva') {
      const nombre = new FormData(e.target).get('nombre');
      await api('POST', 'api/categorias', {nombre});
      await ajRefrescar(`Categoría «${nombre}» añadida`);
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
  if (!D.ia?.activa) { toast('Primero pon la clave de OpenCode Go'); location.hash = '#/ia/ajustes'; return; }
  await modelosIA().catch(() => {});
  const m = modeloIA();
  if (m && !m.vision) { toast(`${m.nombre} no ve fotos: elige otro modelo o describe la pieza con texto`, true); location.hash = '#/ia'; return; }
  const blob = await fotoEncuadrada(file);
  if (!blob) return;
  toast('Enviando foto…');
  const foto = await base64(blob);
  const t = await api('POST', 'api/ia/alta', {foto});
  location.hash = `#/ia/${t.id}`;
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
async function cargar() {
  let r;
  try { r = await fetch('api/datos'); } catch { throw new Error('sin conexión y sin copia guardada en este dispositivo'); }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
  Object.assign(D, datos);
  CATS = Object.fromEntries(D.categorias.map((c) => [c.id, c.nombre]));
  COLOR_CAT = Object.fromEntries(D.categorias.map((c) => [c.id, c.color]));
  FUNC = Object.fromEntries(D.funciones.map((f) => [f.id, f]));
  DIF = Object.fromEntries(D.dificultades.map((d) => [d.nivel, d.nombre]));
  const guardado = r.headers.get('x-guardado');
  const aviso = $('#sin-red');
  aviso.hidden = !guardado;
  if (guardado) {
    const f = new Date(guardado).toLocaleString('es-ES', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
    $('#sin-red-txt').textContent = `Sin conexión · datos del ${f} · los cambios no se guardan`;
  }
}
async function recargar() {
  try { await cargar(); contadores(); route(); } catch {}
  if (!$('#sin-red').hidden) toast('Sigue sin conexión', true);
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
    app.innerHTML = vacio(`No puedo hablar con el servidor: ${esc(err.message)}`);
    return;
  }
  aplicarTema();
  contadores();
  route();
})();
