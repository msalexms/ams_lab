// CircuitBin · base.js — utilidades comunes: datos cargados (D, ui), traducción, API, avisos, confirmación, campo de fotos, fechas, tema e idioma.
import {contadores} from './app.js';

export const t = (s, v) => window.I18N.t(s, v);

// configuración: llega de la base de datos (categorias, funciones_pin, dificultades, ajustes)
export let CATS = {};  // id → nombre, en el orden de la base de datos
let COLOR_CAT = {}; // id → color de la categoría (tabla categorias, v9): marcas y fondos teñidos
// el color de una categoría como variable CSS (--ams-c) y su cuadradito
export const conColor = (cat) => (COLOR_CAT[cat] ? ` style="--ams-c:${COLOR_CAT[cat]}"` : '');
export const marcaCat = '<span class="ams-cuadro" aria-hidden="true"></span>';
export let FUNC = {};  // id → {nombre, color_claro, color_oscuro, tachado}
export let DIF = {};   // nivel → nombre
export const MUCHOS = 99;
const TEMAS = {auto: 'Tema: automático', claro: 'Tema: claro', noche: 'Tema: noche'};

export const D = {componentes: [], tipos: {}, proyectos: [], categorias: [], funciones: [], dificultades: [], ubicaciones: [], ajustes: {}};
export const ui = {sel: new Set(), seleccionando: false, selIA: false, visibles: [], cat: '', ubic: '', revisar: false, proFiltro: 'todos', sinComprobar: false, ajTipos: 'todos', ajBuscar: ''};
export const $ = (s) => document.querySelector(s);
export const app = $('#app');
export const q = $('#q');

// ---------- utilidades ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
export const g = (tipo) => D.tipos[tipo] || {nombre: t('Sin tipo'), categoria: 'otro'};
export const catOf = (c) => g(c.tipo).categoria || 'otro';
export const byName = (a, b) => a.nombre.localeCompare(b.nombre, I18N.lang());
export const comp = (id) => D.componentes.find((c) => c.id === Number(id));
export const ubicaciones = () => [...new Set([...D.ubicaciones, ...D.componentes.map((c) => c.ubicacion)].filter(Boolean))].sort((a, b) => a.localeCompare(b, I18N.lang()));
export const may = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const dificultad = (p) => [may(DIF[p.dificultad || 1]), p.tiempo].filter(Boolean).join(' · ');

export function matches(text, query) {
  const t = norm(text);
  return norm(query).split(/\s+/).filter(Boolean).every((w) => t.includes(w));
}
export function compText(c) {
  const f = g(c.tipo);
  return [c.nombre, c.notas, c.ubicacion, f.nombre, f.resumen, ...list(f.alias), list(f.interfaz).join(' ')].join(' ');
}

export const unidades = (c) => (c.varios ? MUCHOS : Number(c.cantidad) || 0);
export const qtyText = (c) => (c.varios ? t('muchos') : c.cantidad ?? '?');
export function stock(tipo) {
  return Math.max(0, ...list(tipo).map((t) => D.componentes.filter((c) => c.tipo === t).reduce((a, c) => a + unidades(c), 0)));
}
export const stockText = (tipo) => (stock(tipo) >= MUCHOS ? t('muchos') : stock(tipo));
export const faltas = (p) => (p.material || []).filter((m) => !m.opcional && stock(m.tipo) < (m.cantidad || 1));
export const estadoProyecto = (p) => {
  const n = faltas(p).length;
  return n ? `<span class="mal">${esc(t(n > 1 ? 'Faltan {n}' : 'Falta {n}', {n}))}</span>` : t('Tienes todo');
};
export const proyectosDe = (tipo) => D.proyectos.filter((p) => (p.material || []).some((m) => list(m.tipo).includes(tipo)));
export const voltajeDe = (f) => String(f.voltaje || '').split(' · ')[0];

export const fotoUrl = (c) => `fotos/${encodeURIComponent(c.foto)}`;
// vuelve a preguntar dentro de «ms» si sigue en la misma pantalla (la IA pensando, el registro…)
export const repetirEn = (ms, fn, hash = location.hash) => setTimeout(() => { if (location.hash === hash) fn(); }, ms);
export const vacio = (html) => `<div class="vacio">${html}</div>`;
export const plural = (n, uno) => I18N.plural(n, uno);
export const piezasTxt = (n) => I18N.plural(n, 'pieza');
// cabecera de una pantalla (fuera de caja, como la de una ficha) y migas de pan
export const cabIA = (titulo, texto = '', extra = '') => `<header class="ia-cab"><h1>${titulo}</h1>${texto ? `<p>${esc(texto)}</p>` : ''}${extra}</header>`;
export const migas = (partes) => `<nav class="migas" aria-label="${esc(t('Estás en'))}">${partes.join('<span class="migas-sep" aria-hidden="true">/</span>')}</nav>`;
// fecha de SQLite («2026-11-09 17:20:02», en UTC) → milisegundos
export const fechaSql = (s) => Date.parse(String(s || '').replace(' ', 'T') + 'Z');
// fecha del servidor (UTC «AAAA-MM-DD HH:MM:SS») → «hace 5 min», «hoy 14:32», «ayer 09:10», «3 nov 14:32»
export function cuando(s) {
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
export const fechaCompleta = (s) => (fechaSql(s) ? new Date(fechaSql(s)).toLocaleString(I18N.loc(), {dateStyle: 'full', timeStyle: 'medium'}) : '');
// coste en dólares con pocos decimales
export const dolares = (n) => {
  if (n == null) return '?';
  const sep = I18N.lang() === 'en' ? '.' : ',';
  return n < 0.0001 ? `<0${sep}0001 $` : `${(n < 0.01 ? n.toFixed(4) : n.toFixed(3)).replace('.', sep)} $`;
};

// ---------- diálogo de confirmación propio (en vez del confirm() del navegador) ----------
// confirmar('¿Borrar X?\n\nNo se puede deshacer.', {si: 'Borrar', peligro: true}) → promesa con true o false.
// La primera línea es la pregunta; lo demás, la explicación. Esc o «Cancelar» = no.
export function confirmar(texto, {si = 'Aceptar', no = 'Cancelar', peligro = false} = {}) {
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
export const campoFoto = (etiqueta, ayuda = '', {varias = 0, principal = false, compacto = false} = {}) => {
  const max = varias || 1;
  return `<div class="campo${compacto ? ' campo-compacto' : ''}">${etiqueta ? `<span class="campo-t">${etiqueta}</span>` : ''}
  <div class="archivo${compacto ? ' compacto' : ''}"${principal ? ' data-principal="1"' : ''}>
    <div class="archivo-lista"></div>
    <label class="archivo-mas"><input type="file" name="foto" accept="image/*" class="archivo-input"${max > 1 ? ' multiple' : ''} data-max="${max}">
      <span class="archivo-cruz" aria-hidden="true">+</span><span class="archivo-mas-t">${compacto ? t('Foto') : max > 1 ? t('Añadir fotos') : t('Añadir foto')}</span></label>
  </div>${ayuda ? `<span class="ayuda">${ayuda}</span>` : ''}</div>`;
};
export const tamano = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', I18N.lang() === 'en' ? '.' : ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
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
export function pintarArchivo(input) {
  const caja = input.closest('.archivo'), max = Number(input.dataset.max) || 1;
  if (!input.files.length) ARCHIVOS.set(input, []); // vaciado desde fuera (input.value = '')
  const fs = ARCHIVOS.get(input) || [];
  (caja.urls || []).forEach((u) => URL.revokeObjectURL(u));
  caja.urls = fs.map((f) => URL.createObjectURL(f));
  caja.classList.toggle('con', fs.length > 0);
  caja.classList.toggle('lleno', fs.length >= max);
  const principal = caja.dataset.principal && fs.length > 1;
  caja.querySelector('.archivo-lista').innerHTML = fs.map((f, i) => `<span class="archivo-foto" title="${esc(f.name)} · ${tamano(f.size)}"><img src="${caja.urls[i]}" alt="">
    ${principal && i === 0 ? `<span class="archivo-pral">${t('de la pieza')}</span>` : ''}
    <button class="archivo-x" type="button" data-i="${i}" aria-label="${esc(t('Quitar la foto {n}', {n: i + 1}))}">✕</button></span>`).join('');
  const t2 = caja.querySelector('.archivo-mas-t');
  if (t2 && !caja.classList.contains('compacto')) t2.textContent = fs.length ? t('Otra') : max > 1 ? t('Añadir fotos') : t('Añadir foto');
}
// fotos de un campo, reducidas a 1600 px en JPEG (las que solo ve el modelo: no hace falta encuadrarlas)
export const reducida = async (file) => base64(await jpeg(await lienzoDe(file, 1600)));
export const fotosDelCampo = (input) => [...(input?.files || [])].filter((f) => f.size);
document.addEventListener('change', (e) => { if (e.target.classList?.contains('archivo-input')) alElegirArchivos(e.target); });
document.addEventListener('click', (e) => {
  const x = e.target.closest?.('.archivo-x');
  if (!x) return;
  const input = x.closest('.archivo').querySelector('.archivo-input');
  ponerArchivos(input, (ARCHIVOS.get(input) || []).filter((_, i) => i !== Number(x.dataset.i)));
});

// aviso abajo; con «accion» ({texto, fn}, el texto ya traducido) lleva un botón (p. ej. «Deshacer») y dura más
export function toast(msg, mal = false, accion = null) {
  const caja = $('#toast'); // no llamarla «t»: taparía a la función de traducir
  caja.textContent = msg;
  if (accion) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-accion';
    b.textContent = accion.texto;
    b.addEventListener('click', () => { caja.className = ''; accion.fn(); }, {once: true});
    caja.append(' ', b);
  }
  caja.className = `show ${mal ? 'mal' : ''} ${accion ? 'con-accion' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (caja.className = ''), accion ? 8000 : 2600);
}

export async function api(method, url, body, headers = {}) {
  const opts = {method, headers};
  if (body instanceof Blob) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers = {'content-type': 'application/json', ...headers}; }
  let r;
  try { r = await fetch(url, opts); } catch { throw new Error(t('Sin conexión con el servidor: no se ha guardado')); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ? t(data.error) : `Error ${r.status}`); // los fijos del servidor, traducidos
  return data;
}
export function guardarLocal(c) {
  const i = D.componentes.findIndex((x) => x.id === c.id);
  if (i >= 0) D.componentes[i] = c; else D.componentes.push(c);
  contadores();
}

// ---------- tema (guardado en la tabla ajustes) ----------
export function aplicarTema() {
  const tx = TEMAS[D.ajustes.tema] ? D.ajustes.tema : 'auto';
  document.documentElement.dataset.tema = tx;
  $('#tema').textContent = t(TEMAS[tx]);
}
export async function cambiarTema() {
  const orden = Object.keys(TEMAS);
  const sig = orden[(orden.indexOf(D.ajustes.tema) + 1) % orden.length];
  try { await api('PUT', 'api/ajustes/tema', {valor: sig}); D.ajustes.tema = sig; aplicarTema(); }
  catch (err) { toast(err.message, true); }
}

// la foto en un lienzo (lado largo como mucho «max» px), respetando la orientación de la cámara
export async function lienzoDe(file, max) {
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
export const jpeg = (cv) => new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.85));
export const base64 = (blob) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob); });

// ---------- datos de /api/datos e idioma ----------
// idioma de la web: nombres de categorías, funciones de pin y dificultades
export function aplicarIdioma() {
  I18N.set(D.ajustes?.idioma || 'en');
  CATS = Object.fromEntries(D.categorias.map((c) => [c.id, I18N.cat(c.id, c.nombre)]));
  FUNC = Object.fromEntries(D.funciones.map((f) => [f.id, {...f, nombre: I18N.fn(f.id, f.nombre)}]));
  DIF = Object.fromEntries(D.dificultades.map((d) => [d.nivel, I18N.dif(d.nivel, d.nombre)]));
  I18N.shell();
}
// sin red, el service worker (sw.js) entrega la última copia de /api/datos con la cabecera x-guardado
export async function cargar() {
  let r;
  try { r = await fetch('api/datos'); } catch { throw new Error(t('sin conexión y sin copia guardada en este dispositivo')); }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error ? t(datos.error) : `Error ${r.status}`);
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
