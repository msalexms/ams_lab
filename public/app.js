// [AMS] lab — inventario, glosario y proyectos. Habla con la API del servidor (server/index.mjs).
'use strict';

// configuración: llega de la base de datos (categorias, funciones_pin, dificultades, ajustes)
let CATS = {};  // id → nombre, en el orden de la base de datos
let FUNC = {};  // id → {nombre, color_claro, color_oscuro, tachado}
let DIF = {};   // nivel → nombre
const MUCHOS = 99;
const TEMAS = {auto: 'Tema: automático', claro: 'Tema: claro', noche: 'Tema: noche'};

const D = {componentes: [], tipos: {}, proyectos: [], categorias: [], funciones: [], dificultades: [], ubicaciones: [], ajustes: {}};
const ui = {cat: '', ubic: '', revisar: false, proFiltro: 'ya', sinComprobar: false, ajTipos: 'todos', ajBuscar: ''};
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
const dibujo = (tipo) => (tipo ? `<img class="ref" src="img/tipos/${esc(tipo)}.svg" alt="" loading="lazy" onerror="this.remove()">` : '');
const vacio = (html) => `<div class="vacio">${html}</div>`;

// aviso abajo; con «accion» ({texto, fn}) lleva un botón (p. ej. «Deshacer») y dura más
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

// tabla de pines: color y nombre de cada función salen de la base de datos (claro y noche)
function tablaPines(f) {
  const pines = list(f.pines).map(([pin, uso, fn]) => ({pin, uso, fn}));
  if (!pines.length) return '';
  const usadas = Object.keys(FUNC).filter((k) => pines.some((p) => p.fn === k));
  const color = (id) => { const x = FUNC[id] || {color_claro: '#888888', color_oscuro: '#888888'}; return `--cc:${esc(x.color_claro)};--co:${esc(x.color_oscuro)}`; };
  return `<h3>Pines</h3><table class="t"><thead><tr><th class="n">#</th><th>Pin</th><th>Uso</th></tr></thead><tbody>
    ${pines.map((p, i) => `<tr style="${color(p.fn)}"${FUNC[p.fn]?.tachado ? ' class="tachado"' : ''}><td class="n">${i + 1}</td>
      <td class="pin"><i class="dot"></i>${esc(p.pin)}</td><td>${esc(p.uso)}</td></tr>`).join('')}</tbody></table>
    <p class="leyenda">${usadas.map((k) => `<span style="${color(k)}"><i class="dot"></i>${esc(FUNC[k].nombre)}</span>`).join('')}</p>`;
}

function listaProyectos(ps) {
  return ps.map((p) => `<div class="fila"><a class="fila-main" href="#/p/${esc(p.id)}"><div>
      <div class="nombre">${esc(p.nombre)}</div><div class="sub">${esc(p.resumen || '')}</div></div></a>
      <div class="der"><div>${estadoProyecto(p)}</div><div class="sub">${esc(dificultad(p))}</div></div></div>`).join('');
}
const usadoEn = (tipo) => {
  const ps = tipo ? proyectosDe(tipo) : [];
  return ps.length ? `<h2>Se usa en</h2>${listaProyectos(ps)}` : '';
};

// ---------- vistas ----------
function filaComp(c) {
  return `<div class="fila">
    <a class="fila-main" href="#/c/${c.id}">${c.foto ? `<img class="thumb" src="${fotoUrl(c)}" alt="" loading="lazy">` : ''}
      <div><div class="nombre">${esc(c.nombre)}${revisar(c)}</div>
      <div class="sub">${[c.tipo ? g(c.tipo).nombre : '', c.ubicacion].filter(Boolean).map(esc).join(' · ')}</div></div></a>
    ${stepper(c)}</div>`;
}

// cuadrícula: la foto manda; sin foto, solo el nombre (sin recuadros de relleno)
function tarjetaComp(c) {
  return `<div class="tarjeta${c.foto ? '' : ' sin-foto'}">
    <a class="tarjeta-main" href="#/c/${c.id}">${c.foto ? `<img class="tarjeta-foto" src="${fotoUrl(c)}" alt="" loading="lazy">` : ''}
      <span class="tarjeta-txt"><span class="nombre">${esc(c.nombre)}${revisar(c)}</span>
      <span class="sub">${[c.tipo ? g(c.tipo).nombre : '', c.ubicacion].filter(Boolean).map(esc).join(' · ')}</span></span></a>
    <div class="tarjeta-pie">${stepper(c)}</div></div>`;
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

function vInventario() {
  const query = q.value.trim();
  let cs = D.componentes.slice();
  const porCat = {};
  cs.forEach((c) => (porCat[catOf(c)] = (porCat[catOf(c)] || 0) + 1));
  if (query) cs = cs.filter((c) => matches(compText(c), query));
  if (ui.cat) cs = cs.filter((c) => catOf(c) === ui.cat);
  if (ui.ubic) cs = cs.filter((c) => (ui.ubic === '∅' ? !c.ubicacion : c.ubicacion === ui.ubic));
  if (ui.revisar) cs = cs.filter((c) => c.revisar);
  const nRevisar = D.componentes.filter((c) => c.revisar).length;

  const cats = Object.keys(CATS).filter((k) => porCat[k]).map((k) =>
    `<button class="f ${ui.cat === k ? 'on' : ''}" data-cat="${k}">${CATS[k]}<span class="n">${porCat[k]}</span></button>`).join('');
  const filtros = `<div class="filtros">
    <div class="cats"><button class="f ${!ui.cat ? 'on' : ''}" data-cat="">Todo<span class="n">${D.componentes.length}</span></button>${cats}</div>
    <div class="filtros-der">
      <select id="ubic" class="sel" aria-label="Filtrar por sitio"><option value="">Cualquier sitio</option>
        ${ubicaciones().map((u) => `<option ${ui.ubic === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}
        <option value="∅" ${ui.ubic === '∅' ? 'selected' : ''}>Sin sitio</option></select>
      ${nRevisar ? `<button class="f ${ui.revisar ? 'on' : ''}" id="rev">Pendientes<span class="n">${nRevisar}</span></button>` : ''}
      <span class="conmuta" role="group" aria-label="Vista">${[['lista', 'Lista'], ['cuadricula', 'Cuadrícula']].map(([k, v]) =>
        `<button class="f ${vistaInv() === k ? 'on' : ''}" data-vista="${k}" aria-pressed="${vistaInv() === k}">${v}</button>`).join('')}</span>
      <a class="btn solo-escritorio" href="#/ia">Añadir con IA</a>
      <a class="btn prim solo-escritorio" href="#/nuevo">Añadir pieza</a>
    </div></div>`;

  if (!D.componentes.length) return filtros + vacio('Aún no hay piezas. Pulsa + para añadir la primera.');
  if (!cs.length) return filtros + tambien(query, 'piezas') + vacio('Nada coincide con el filtro.');
  const rejilla = vistaInv() === 'cuadricula';
  return filtros + tambien(query, 'piezas') + Object.keys(CATS).map((k) => {
    const items = cs.filter((c) => catOf(c) === k).sort(byName);
    return items.length ? `<section class="grupo"><h3 class="grupo-t">${CATS[k]}<span class="n">${items.length}</span></h3>${rejilla
      ? `<div class="rejilla">${items.map(tarjetaComp).join('')}</div>` : items.map(filaComp).join('')}</section>` : '';
  }).join('');
}

// ---------- búsqueda en todo (piezas, tipos y proyectos) ----------
function buscarTodo(query) {
  const piezas = D.componentes.filter((c) => matches(compText(c), query)).sort(byName);
  const tipos = Object.entries(D.tipos).map(([k, t]) => ({k, ...t})).filter((t) => !t.archivado && matches([t.k, t.nombre, t.resumen,
    CATS[t.categoria], ...list(t.alias), ...list(t.interfaz), ...list(t.pines).flat(), ...list(t.datos).flat()].join(' '), query)).sort(byName);
  const proyectos = D.proyectos.filter((p) => matches([p.nombre, p.resumen, ...(p.material || []).flatMap((m) => list(m.tipo).map((t) => g(t).nombre))].join(' '), query));
  return {piezas, tipos, proyectos};
}
const filaTipo = (t) => `<div class="fila"><a class="fila-main" href="#/g/${esc(t.k)}"><div><div class="nombre">${esc(t.nombre)}${t.revisado === 0 ? ' <span class="aviso">· sin comprobar</span>' : ''}</div>
  <div class="sub">${esc(t.resumen || '')}</div></div></a>
  <div class="der"><div class="num ${stock(t.k) ? '' : 'gris'}">${stockText(t.k)}</div><div class="sub">${esc(voltajeDe(t))}</div></div></div>`;

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

function vComponente(id) {
  const c = comp(id);
  if (!c) return vacio('No existe esa pieza.');
  const f = g(c.tipo);
  const delTipo = c.tipo ? D.componentes.filter((x) => x.tipo === c.tipo).length : 0;
  // arriba, lo de ESTA pieza (cantidad, sitio, sus datos); debajo, la ficha de su TIPO, que comparten todas las piezas iguales
  const fichaTipo = c.tipo ? `<section class="ficha-tipo">
      <div class="sec-cab"><h3>Ficha del tipo</h3><a class="btn mini" href="#/g/${esc(c.tipo)}/editar">Editar ficha</a></div>
      <p class="sec-nombre"><a href="#/g/${esc(c.tipo)}">${esc(f.nombre)}</a>${f.archivado ? ' <span class="gris">(archivado)</span>' : ''}
        <span class="gris">· ${delTipo > 1 ? `la comparten tus ${delTipo} piezas de este tipo` : 'común a todas las piezas de este tipo'}</span></p>
      ${f.resumen ? `<p class="resumen">${esc(f.resumen)}</p>` : ''}
      ${f.revisado === 0 ? avisoIA(c.tipo, true) : ''}
      ${notaOjo(f)}
      ${voltajeDe(f) || list(f.interfaz).length ? `<p class="sec-datos">${[voltajeDe(f) ? `<span><span class="gris">Tensión</span> ${esc(voltajeDe(f))}</span>` : '',
        list(f.interfaz).length ? `<span><span class="gris">Interfaces</span> ${esc(list(f.interfaz).join(', '))}</span>` : ''].join('')}</p>` : ''}
      ${tablaPines(f) || '<p class="gris">Este tipo no tiene pines.</p>'}
      ${list(f.datos).length ? `<h3 class="sep">Datos del tipo</h3><table class="t datos"><tbody>${f.datos.map(([k, v]) =>
        `<tr><td class="gris">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>` : ''}
    </section>` : `<section class="ficha-tipo"><div class="sec-cab"><h3>Ficha del tipo</h3></div>
      <p class="gris">Esta pieza no tiene tipo. Ponle uno en «Editar pieza» y verás aquí sus pines, su tensión y sus datos.</p></section>`;
  return `<a class="back" href="#/">← Inventario</a>
    <article class="hoja">
      ${cabecera(esc(c.nombre) + revisar(c), c.tipo ? `Pieza · ${CATS[f.categoria] || ''}` : 'Pieza', '')}
      ${c.revisar ? `<div class="nota"><p><span class="nota-t">Pendiente</span> La marcaste para mirar algo de ella más tarde.</p>
        <button class="btn mini" id="quitar-pendiente" type="button">Hecho: quitar la marca</button></div>` : ''}
      <p class="sec-etq">Esta pieza</p>
      ${specs([
        ['Cantidad', stepper(c, true)],
        ['Sitio', esc(c.ubicacion || '—')],
        ['Tipo', c.tipo ? `<a href="#/g/${esc(c.tipo)}">${esc(f.nombre)}</a>` : 'Sin tipo'],
        ...list(c.datos).map(([k, v]) => [esc(k), esc(v)]),
      ])}
      <div class="hoja-cuerpo">
        <div>${fichaTipo}</div>
        <aside class="lateral">
          ${c.foto ? `<a href="${fotoUrl(c)}" target="_blank"><img class="foto" src="${fotoUrl(c)}" alt="${esc(c.nombre)}"></a>` : ''}
          <div class="acciones apiladas">
            <a class="btn prim" href="#/editar/${c.id}">Editar pieza</a>
            <label class="btn">${c.foto ? 'Cambiar foto' : 'Añadir foto'}<input type="file" accept="image/*" id="foto" hidden></label>
            ${c.foto ? '<button class="btn" id="quitar-foto" type="button">Quitar foto</button>' : ''}
          </div>
          ${panelRevisar('pieza', c.id, c.tipo ? 'La IA repasa esta pieza y la ficha de su tipo.' : 'La IA repasa esta pieza.')}
          ${c.notas ? `<div><h3>Notas</h3><p class="notas">${esc(c.notas)}</p></div>` : ''}
          <p class="meta">Actualizado ${esc(c.actualizado)}</p>
          <button class="enlace-peligro" id="borrar" type="button">Borrar esta pieza</button>
        </aside>
      </div>
    </article>
    ${usadoEn(c.tipo)}`;
}

const notaOjo = (f) => (f.ojo ? `<p class="nota nota-ojo"><span class="nota-t">Ojo</span> ${esc(f.ojo)}</p>` : '');

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
  pines: [{k: 'pin', t: 'Pin', clase: 'mono', max: 60, ph: 'GPIO4'}, {k: 'uso', t: 'Uso', max: 60, ph: 'Datos del sensor'}, {k: 'fn', t: 'Función', funcion: true}],
  datos: [{k: 'clave', t: 'Dato', max: 60, ph: 'Corriente máx.'}, {k: 'valor', t: 'Valor', max: 200, ph: '20 mA'}],
};
const colorFn = (id) => { const x = FUNC[id] || {color_claro: '#888888', color_oscuro: '#888888'}; return `--cc:${esc(x.color_claro)};--co:${esc(x.color_oscuro)}`; };
function filaEditor(nombre, valores = []) {
  return `<div class="ed-fila">${COLS[nombre].map((c, i) => c.funcion
    ? `<label class="ed-celda ed-fn" style="${colorFn(valores[i] || 'otro')}"><span class="ed-et">${c.t}</span><i class="dot"></i>
        <select data-col="${i}">${Object.entries(FUNC).map(([k, f]) => `<option value="${esc(k)}" ${k === (valores[i] || 'otro') ? 'selected' : ''}>${esc(f.nombre)}</option>`).join('')}</select></label>`
    : `<label class="ed-celda"><span class="ed-et">${c.t}</span><input data-col="${i}" class="${c.clase || ''}" maxlength="${c.max}" value="${esc(valores[i] || '')}" placeholder="${esc(c.ph)}"></label>`).join('')}
    <span class="ed-botones"><button type="button" class="btn mini" data-ed-mover="-1" aria-label="Subir">↑</button><button type="button" class="btn mini" data-ed-mover="1" aria-label="Bajar">↓</button>
      <button type="button" class="btn mini peligro" data-ed-quitar aria-label="Quitar fila">✕</button></span></div>`;
}
function editorFilas(nombre, filas, {etiqueta, boton, ayuda = '', campo = nombre} = {}) {
  return `<fieldset class="ed ed-${nombre}" data-ed="${campo}" data-cols="${nombre}">
    <legend>${etiqueta}</legend>${ayuda ? `<p class="ayuda">${ayuda}</p>` : ''}
    <div class="ed-cab" aria-hidden="true">${COLS[nombre].map((c) => `<span>${c.t}</span>`).join('')}<span></span></div>
    <div class="ed-filas">${list(filas).map((f) => filaEditor(nombre, f)).join('')}</div>
    <button type="button" class="btn mini" data-ed-anadir>${boton}</button></fieldset>`;
}
const leerEditor = (raiz, campo) => [...(raiz.querySelector(`[data-ed="${campo}"]`)?.querySelectorAll('.ed-fila') || [])]
  .map((f) => [...f.querySelectorAll('[data-col]')].map((x) => x.value.trim())).filter((v) => v[0]);
function clicEditor(t) {
  const ed = t.closest('.ed');
  if (!ed) return false;
  const fila = t.closest('.ed-fila');
  if ('edAnadir' in t.dataset) {
    ed.querySelector('.ed-filas').insertAdjacentHTML('beforeend', filaEditor(ed.dataset.cols));
    ed.querySelector('.ed-fila:last-child input')?.focus();
  } else if ('edQuitar' in t.dataset) fila.remove();
  else if (t.dataset.edMover) {
    const otra = t.dataset.edMover === '-1' ? fila.previousElementSibling : fila.nextElementSibling;
    if (otra) { if (t.dataset.edMover === '-1') otra.before(fila); else otra.after(fila); t.focus(); }
  } else return false;
  return true;
}

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
        ${id ? '' : '<label>Foto (opcional)<input type="file" name="foto" accept="image/*"></label>'}
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
    return ts.length ? `<section class="grupo"><h3 class="grupo-t">${CATS[cat]}<span class="n">${ts.length}</span></h3>${ts.map(filaTipo).join('')}</section>` : '';
  }).join('');
}

function vTipo(tipo) {
  const f = D.tipos[tipo];
  if (!f) return vacio('Ese tipo no está en el glosario.');
  const cs = D.componentes.filter((c) => c.tipo === tipo).sort(byName);
  const datos = list(f.datos).length ? `<h3 class="sep">Datos</h3><table class="t datos"><tbody>${f.datos.map(([k, v]) =>
    `<tr><td class="gris">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>` : '';
  return `<a class="back" href="#/glosario">← Glosario</a>
    <article class="hoja">
      ${cabecera(esc(f.nombre), `Ficha del tipo · ${CATS[f.categoria] || ''}`, f.resumen)}
      ${f.revisado === 0 ? avisoIA(tipo, true) : ''}
      ${f.archivado ? `<p class="nota">Archivado: no sale en el glosario ni al elegir tipo. <button class="btn mini" data-tipo-archivar="${esc(tipo)}" data-v="0">Recuperar</button></p>` : ''}
      ${notaOjo(f)}
      ${specs([['Tienes', stockText(tipo)], ['Tensión', esc(voltajeDe(f))], ['Interfaces', esc(list(f.interfaz).join(', '))], ['Otros nombres', esc(list(f.alias).join(', '))]])}
      <div class="hoja-cuerpo">
        <div>${tablaPines(f) || '<p class="gris">Sin pines.</p>'}${datos}</div>
        <aside class="lateral">${f.origen === 'seed' ? dibujo(tipo) : ''}
          <div class="acciones apiladas">
            <a class="btn prim" href="#/g/${esc(tipo)}/editar">Editar ficha</a>
            <a class="btn" href="#/nuevo?tipo=${esc(tipo)}">Añadir una pieza de este tipo</a>
          </div>
          ${panelRevisar('tipo', tipo, 'La IA repasa la ficha; los cambios valen para todas las piezas de este tipo.')}
          <div><h3>Tus piezas de este tipo</h3>${cs.length ? cs.map(filaComp).join('') : '<p class="gris">Ninguno.</p>'}</div>
          <p class="meta">Ficha ${{seed: 'del catálogo base', ia: 'de la IA', usuario: 'escrita por ti'}[f.origen] || ''} ·
            <a href="#/ajustes/tipos?t=${esc(tipo)}">archivar, fusionar o borrar</a></p>
        </aside>
      </div>
    </article>
    ${usadoEn(tipo)}`;
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
      ${editorFilas('pines', f.pines, {etiqueta: 'Pines', boton: 'Añadir pin', ayuda: 'En el orden de la placa. La función da el color del pin en todas las fichas.'})}
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

function vProyectos() {
  const query = q.value.trim();
  if (!D.proyectos.length) return vacio('Aún no hay proyectos.');
  let ps = D.proyectos.slice();
  if (query) ps = ps.filter((p) => matches([p.nombre, p.resumen, ...(p.material || []).flatMap((m) => list(m.tipo).map((t) => g(t).nombre))].join(' '), query));
  const n = {ya: 0, poco: 0, todos: D.proyectos.length};
  D.proyectos.forEach((p) => { const f = faltas(p).length; if (!f) n.ya++; if (f && f <= 2) n.poco++; });
  if (ui.proFiltro === 'ya') ps = ps.filter((p) => !faltas(p).length);
  if (ui.proFiltro === 'poco') ps = ps.filter((p) => { const f = faltas(p).length; return f && f <= 2; });
  ps.sort((a, b) => faltas(a).length - faltas(b).length || (a.dificultad || 1) - (b.dificultad || 1));
  const btn = (k, t) => `<button class="f ${ui.proFiltro === k ? 'on' : ''}" data-pf="${k}">${t}<span class="n">${n[k]}</span></button>`;
  return `<div class="filtros"><div class="cats">${btn('ya', 'Puedo hacerlo ya')}${btn('poco', 'Me falta poco')}${btn('todos', 'Todos')}</div></div>
    ${tambien(query, 'proyectos')}
    ${ps.length ? `<section class="grupo"><h3 class="grupo-t">Proyectos<span class="n">${ps.length}</span></h3>${listaProyectos(ps)}</section>` : vacio('Ninguno en este filtro.')}`;
}

function vProyecto(id) {
  const p = D.proyectos.find((x) => x.id === id);
  if (!p) return vacio('No existe ese proyecto.');
  const material = `<h3>Material</h3><table class="t"><thead><tr><th class="n">Cant.</th><th>Pieza</th><th class="der">Tienes</th></tr></thead><tbody>
    ${(p.material || []).map((m) => {
      const tiene = stock(m.tipo), pide = m.cantidad || 1, ok = tiene >= pide;
      const nombre = list(m.tipo).map((t) => `<a href="#/g/${esc(t)}">${esc(g(t).nombre)}</a>`).join(' o ');
      const nota = [m.opcional ? 'opcional' : '', m.nota].filter(Boolean).map(esc).join(' · ');
      return `<tr><td class="n">${pide}</td><td>${nombre}${nota ? `<div class="sub">${nota}</div>` : ''}</td>
        <td class="der num ${ok || m.opcional ? '' : 'mal'}">${tiene >= MUCHOS ? 'muchos' : tiene}</td></tr>`;
    }).join('')}</tbody></table>`;
  const con = p.conexiones?.length ? `<h3>Conexiones</h3><table class="t"><thead><tr><th>Desde</th><th>Hasta</th></tr></thead><tbody>
    ${p.conexiones.map(([a, b, n]) => `<tr><td class="pin">${esc(a)}</td><td class="pin">${esc(b)}${n ? `<div class="sub" style="font-family:var(--sans)">${esc(n)}</div>` : ''}</td></tr>`).join('')}</tbody></table>` : '';
  const pasos = p.pasos?.length ? `<h3 class="sep">Pasos</h3><ol class="pasos">${p.pasos.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '';
  return `<a class="back" href="#/proyectos">← Proyectos</a>
    <article class="hoja">
      ${cabecera(esc(p.nombre), '', p.resumen)}
      ${specs([['Dificultad', esc(may(DIF[p.dificultad || 1]))], ['Tiempo', esc(p.tiempo || '—')], ['Material', estadoProyecto(p)]])}
      <div class="hoja-cuerpo"><div>${material}</div><div>${con}${pasos}</div></div>
    </article>`;
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

function vIA(id) {
  if (id === 'ajustes') return `<a class="back" href="#/ia">← Añadir con IA</a><article class="hoja" id="ia-ajustes"><p class="gris pad">Cargando…</p></article>`;
  if (id) return `<a class="back" href="#/ia">← Añadir con IA</a><article class="hoja" id="ia-zona"><p class="gris pad">Cargando…</p></article>`;
  if (!D.ia?.activa) return `<a class="back" href="#/">← Inventario</a>${vacio('Falta la clave de OpenCode Go. <a class="btn prim" href="#/ia/ajustes">Configurar</a>')}`;
  return `<a class="back" href="#/">← Inventario</a>
    <article class="hoja">
      ${cabecera('Añadir con IA', '', 'Haz una foto de la pieza (mejor si se lee la serigrafía) y añade lo que sepas. La IA propone el nombre, el tipo y la ficha; tú lo miras y corriges antes de guardar.')}
      <p class="ia-atajo">Modelo de siempre: <span id="ia-modelo-siempre">${esc(nombreModelo(D.ia.modelo))}</span> · <a href="#/ia/ajustes">Cambiar modelo o clave</a></p>
      <form id="form-ia" class="form" autocomplete="off">
        <label>Foto<input type="file" name="foto" accept="image/*"></label>
        <label>Lo que sepas (opcional)<textarea name="texto" rows="3" maxlength="1000" placeholder="Sensor de humedad del kit de Freenove, 3 pines"></textarea></label>
        <label>Modelo para esta pieza<select name="modelo" id="ia-modelo-alta"><option value="">El de siempre (${esc(nombreModelo(D.ia.modelo))})</option></select>
          <span class="ayuda">Por si una pieza difícil merece otro modelo. No cambia el de siempre.</span></label>
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
// nombre legible de un modelo («Claude Haiku 5.5») si ya tenemos el catálogo; si no, su identificador
const nombreModelo = (id) => MODELOS_IA?.find((m) => m.id === id)?.nombre || id || '';
async function modelosIA(forzar = false) {
  if (!MODELOS_IA || forzar) MODELOS_IA = await api('GET', 'api/ia/modelos');
  return MODELOS_IA;
}

async function iaAjustes() {
  const zona = $('#ia-ajustes');
  if (!zona) return;
  let cfg, lista = [], fallo = '';
  try { cfg = await api('GET', 'api/ia/config'); } catch (err) { zona.innerHTML = `<p class="mal pad">${esc(err.message)}</p>`; return; }
  try { lista = await modelosIA(true); } catch (err) { fallo = err.message; }
  const origen = {web: 'guardada en la app', entorno: 'de la variable IA_CLAVE del servidor'}[cfg.origen_clave];
  const fuera = cfg.modelo && lista.length && !lista.some((m) => m.id === cfg.modelo);
  zona.innerHTML = `${cabecera('Configuración de la IA', '', 'Proveedor: OpenCode Go. Solo salen los modelos que entienden fotos y devuelven datos con formato fijo.')}
    <section class="pad ia-bloque">
      <h3>Modelo de siempre</h3>
      <p class="ayuda">Toca otro para cambiarlo. Se comprueba al momento con tu clave: no hace falta volver a ponerla.</p>
      ${lista.length ? `<div class="ia-modelos" role="radiogroup" aria-label="Modelo de siempre">${lista.map((m) => `
        <label class="ia-modelo"><input type="radio" name="ia-modelo" value="${esc(m.id)}" ${m.id === cfg.modelo ? 'checked' : ''}>
          <span><span class="nombre">${esc(m.nombre)}${m.recomendado ? '<span class="gris"> · recomendado</span>' : ''}</span>
          <span class="sub">${esc(costePieza(m))}</span>
          <span class="sub">${esc(m.descripcion)}</span></span></label>`).join('')}</div>`
        : `<p class="mal">${esc(fallo || 'No hay modelos disponibles')}</p>`}
      ${fuera ? `<p class="aviso">El modelo actual («${esc(cfg.modelo)}») ya no está en el catálogo con fotos: elige otro.</p>` : ''}
      <p class="ayuda" id="ia-modelo-estado" role="status"></p>
    </section>
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
    sel.insertAdjacentHTML('beforeend', lista.filter((m) => m.id !== D.ia?.modelo)
      .map((m) => `<option value="${esc(m.id)}">${esc(m.nombre)} · ${esc(costePieza(m))}</option>`).join(''));
  } catch {}
}

// lista de tareas abiertas (debajo del formulario): nada se pierde si cierras la pestaña mientras el modelo piensa
async function iaAbiertas() {
  const zona = $('#ia-abiertas');
  if (!zona) return;
  try {
    const ts = await api('GET', 'api/ia/tareas');
    zona.innerHTML = ts.length ? `<section class="grupo"><h3 class="grupo-t">Sin terminar<span class="n">${ts.length}</span></h3>${ts.map((t) => `
      <div class="fila"><a class="fila-main" href="#/ia/${t.id}">${t.foto ? `<img class="thumb" src="fotos/${encodeURIComponent(t.foto)}" alt="">` : ''}
        <div><div class="nombre">${esc(t.clase === 'revisar' ? `Correcciones para «${t.objetivo_nombre || '?'}»` : t.propuesta?.nombre || t.texto || 'Pieza sin nombre')}</div><div class="sub">${esc(t.creada)}</div></div></a>
        <div class="der">${t.estado === 'error' ? '<span class="mal">Error</span>' : esc(ESTADO_IA[t.estado])}</div></div>`).join('')}</section>` : '';
  } catch {}
}

async function iaTarea(id) {
  const zona = $('#ia-zona');
  if (!zona) return;
  let t;
  try { t = await api('GET', `api/ia/tareas/${id}`); } catch (err) { zona.innerHTML = `<p class="mal pad">${esc(err.message)}</p>`; return; }
  const foto = t.foto ? `<img class="foto ia-foto" src="fotos/${encodeURIComponent(t.foto)}" alt="">` : '';
  if (t.clase === 'revisar') { // en una revisión, «volver» lleva a la ficha revisada
    const atras = document.querySelector('a.back');
    if (atras) { atras.href = volverRevision(t); atras.textContent = '← Volver a la ficha'; }
  }
  if (t.estado === 'pendiente') {
    // la pantalla de espera se pinta UNA vez (si no, la animación y el contador se reiniciarían en cada consulta)
    const clave = `${t.id}-${t.rondas}`;
    if (zona.dataset.espera !== clave) {
      zona.dataset.espera = clave;
      const lleva = Math.max(0, (fechaSql(t.ahora) - fechaSql(t.actualizada)) / 1000) || 0; // segundos que lleva, según el servidor
      zona.dataset.inicio = String(Date.now() - lleva * 1000);
      zona.innerHTML = vistaEspera(foto, t.modelo_pedido || D.ia?.modelo, t.clase === 'revisar' ? 'Repasando la ficha…' : 'Analizando…');
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
      <div class="pad">${foto}<div class="acciones"><a class="btn prim" href="${t.clase === 'revisar' ? volverRevision(t) : '#/ia'}">Probar otra vez</a>
      <button class="btn peligro" id="ia-descartar" data-id="${t.id}">Descartar</button></div></div>`);
    return;
  }
  if (t.estado !== 'propuesta') {
    const enlace = t.clase === 'revisar' ? `<a class="btn" href="${volverRevision(t)}">Volver a la ficha</a>`
      : t.componente_id ? `<a class="btn" href="#/c/${t.componente_id}">Ver la pieza</a>` : '';
    pintar(`${cabecera(ESTADO_IA[t.estado])}<div class="pad">${enlace}</div>`);
    return;
  }
  if (t.clase === 'revisar') { pintar(vistaCambios(t)); return; }
  const p = t.propuesta, n = p.tipo_nuevo || {}, sel = p.tipo_existente || (p.tipo_nuevo ? '__nuevo' : '');
  pintar(`${cabecera('Revisa la propuesta', '', 'Corrige lo que haga falta, mira cómo quedará y guarda. Nada se ha guardado todavía.')}
    ${specs([['Confianza', esc(p.confianza)], ['Modelo', esc(nombreModelo(t.modelo))], ['Coste', esc(costeTexto(p.coste))], ['Vuelta', t.rondas ? String(t.rondas + 1) : '']])}
    ${dudasIA(t, p)}
    <div class="filtros ia-pestanas"><div class="cats">
      <button class="f on" type="button" data-ia-vista="editar">Editar</button>
      <button class="f" type="button" data-ia-vista="previa">Vista previa</button></div></div>
    <div id="ia-previa" hidden></div>
    <form id="form-ia-ok" class="form" autocomplete="off" data-id="${t.id}" data-foto="${t.foto ? `fotos/${encodeURIComponent(t.foto)}` : ''}">
      ${foto}
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
        ${editorFilas('pines', n.pines, {campo: 'tn_pines', etiqueta: 'Pines', boton: 'Añadir pin', ayuda: 'En el orden de la placa. La función da el color del pin.'})}
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
        <button class="btn peligro" type="button" id="ia-descartar" data-id="${t.id}">Descartar</button>
      </div>
    </form>`);
}

async function enviarIA(form) {
  const fd = new FormData(form);
  const file = fd.get('foto');
  let foto = null;
  if (file && file.size) {
    const blob = await encuadrar(file);
    if (!blob) throw new Error('Foto cancelada: no se ha enviado nada');
    foto = await base64(blob);
  }
  toast('Enviando…');
  const t = await api('POST', 'api/ia/alta', {texto: fd.get('texto'), foto, modelo: fd.get('modelo') || undefined});
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

const costeTexto = (c) => (c && c.dolares != null ? `≈ ${c.dolares < 0.0001 ? '<0,0001' : c.dolares.toFixed(4).replace('.', ',')} $` : '');

// dudas del modelo con un hueco para contestar cada una; «Responder y repensar» le manda las respuestas y lo que hayas
// corregido en el formulario, y el modelo rehace la propuesta (como mucho 5 vueltas)
function dudasIA(t, p) {
  const quedan = (t.rondas || 0) < 5;
  return `<section class="ia-dudas pad" id="ia-dudas">
    <h3>${p.dudas?.length ? 'Dudas del modelo' : '¿Algo que aclarar?'}</h3>
    ${p.dudas?.length ? `<ol class="ia-preguntas">${p.dudas.map((d) => `<li><p>${esc(d)}</p>
      <input class="ia-resp" data-duda="${esc(d)}" maxlength="500" placeholder="Tu respuesta (opcional)" autocomplete="off"></li>`).join('')}</ol>` : ''}
    <textarea id="ia-extra" rows="2" maxlength="1000" placeholder="Algo más que deba saber (opcional): «tiene 3 pines», «es la versión en placa»…"></textarea>
    <div class="acciones">${quedan
      ? `<button class="btn" type="button" id="ia-responder" data-id="${t.id}">Responder y repensar</button>
         <span class="ayuda">Rehace la propuesta con tus respuestas y con lo que hayas corregido abajo. Gasta otra consulta.</span>`
      : '<span class="ayuda">Ya van 5 vueltas: corrige a mano lo que falte y guarda.</span>'}</div>
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
  const respuestas = [...document.querySelectorAll('.ia-resp')].map((i) => ({duda: i.dataset.duda, respuesta: i.value.trim()})).filter((r) => r.respuesta);
  const extra = ($('#ia-extra')?.value || '').trim();
  if (!respuestas.length && !extra) throw new Error('Contesta alguna duda o escribe algo más antes de repensar');
  boton.disabled = true;
  toast('Repensando con tus respuestas…');
  await api('POST', `api/ia/tareas/${boton.dataset.id}/responder`, {respuestas, extra, propuesta: leerFormIA($('#form-ia-ok'))});
  iaTarea(boton.dataset.id); // vuelve a «Analizando…» y se actualiza sola
}

async function aplicarIA(form) {
  const body = leerFormIA(form);
  const r = await api('POST', `api/ia/tareas/${form.dataset.id}/aplicar`, body);
  await cargar(); // trae la pieza, la ficha nueva (si la hay) y los contadores
  contadores();
  toast('Guardada');
  location.hash = `#/c/${r.componente.id}`;
}

// ---------- Ajustes (fase B): IA, categorías, tipos, sitios, datos y tema ----------
const plural = (n, uno, varios = `${uno}s`) => `${n} ${n === 1 ? uno : varios}`;
const SECCIONES = {ia: 'IA', categorias: 'Categorías', tipos: 'Tipos', sitios: 'Sitios', datos: 'Datos'};

function vAjustes(sec) {
  if (sec && SECCIONES[sec]) {
    const id = sec === 'ia' ? 'ia-ajustes' : 'aj-zona';
    return `<a class="back" href="#/ajustes">← Ajustes</a><article class="hoja" id="${id}" data-sec="${sec}"><p class="gris pad">Cargando…</p></article>`;
  }
  const tipos = Object.values(D.tipos), archivados = tipos.filter((t) => t.archivado).length;
  const fila = (href, nombre, sub) => `<div class="fila"><a class="fila-main" href="${href}"><div><div class="nombre">${nombre}</div>
    <div class="sub">${sub}</div></div></a><span class="gris">→</span></div>`;
  return `<article class="hoja">${cabecera('Ajustes', '', 'Todo lo que se configura de la app. Lo que cambies aquí se ve al momento en el inventario y el glosario.')}
    <div class="pad aj-menu">
      ${fila('#/ajustes/ia', 'IA', D.ia?.activa ? `Conectada · ${esc(nombreModelo(D.ia.modelo))} · clave ${esc(D.ia.clave)}` : '<span class="mal">Sin clave</span>')}
      ${fila('#/ajustes/categorias', 'Categorías', `${plural(D.categorias.length, 'categoría')} · renombrar, ordenar, añadir, borrar`)}
      ${fila('#/ajustes/tipos', 'Tipos', `${plural(tipos.length - archivados, 'tipo')}${archivados ? ` · ${archivados} archivado${archivados === 1 ? '' : 's'}` : ''} · archivar, fusionar, borrar`)}
      ${fila('#/ajustes/sitios', 'Sitios', `${plural(ubicaciones().length, 'sitio')} · renombrar, juntar, borrar`)}
      ${fila('#/ajustes/datos', 'Datos', 'Copias de seguridad y exportar')}
      <div class="fila"><div class="fila-main"><div><div class="nombre">Tema</div><div class="sub">Claro de día, grafito de noche o según el sistema</div></div></div>
        <div class="cats">${Object.entries({auto: 'Automático', claro: 'Claro', noche: 'Noche'}).map(([k, v]) =>
          `<button class="f ${(D.ajustes.tema || 'auto') === k ? 'on' : ''}" data-poner-tema="${k}">${v}</button>`).join('')}</div></div>
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
    if (sec === 'datos') zona.innerHTML = ajDatos(await api('GET', 'api/ajustes/resumen'));
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
      <div class="aj-fila" data-cat="${esc(c.id)}">
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
  if (!confirm('¿Restaurar esta copia? Se sustituye todo lo de ahora (antes se guarda una copia del estado actual en el servidor).')) return;
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
    const ids = [...document.querySelectorAll('[data-cat]')].map((e) => e.dataset.cat), i = ids.indexOf(d.catMover), j = i + Number(d.dir);
    if (j < 0 || j >= ids.length) return true;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api('PUT', 'api/categorias/orden', {ids});
    await ajRefrescar();
    return true;
  }
  if (d.catBorrar) {
    const n = Number(d.tipos), nombre = fila.querySelector('.aj-nombre').value;
    if (!n) {
      if (!confirm(`¿Borrar la categoría «${nombre}»?`)) return true;
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
    if (!confirm(`¿Fusionar «${a}» en «${b}»?\n\nSus piezas y proyectos pasan a «${b}» y «${a}» desaparece. No se puede deshacer.`)) return true;
    const r = await api('POST', `api/tipos/${d.tipoFusionarOk}/fusionar`, {destino});
    await ajRefrescar(`Fusionado: ${plural(r.piezas, 'pieza')} ${r.piezas === 1 ? 'pasa' : 'pasan'} a «${b}»`);
    return true;
  }
  if (d.tipoBorrar) {
    const nombre = D.tipos[d.tipoBorrar]?.nombre;
    if (!confirm(`¿Borrar el tipo «${nombre}»? No se puede deshacer.`)) return true;
    await api('DELETE', `api/tipos/${d.tipoBorrar}`);
    await ajRefrescar(`Tipo «${nombre}» borrado`);
    return true;
  }
  if (d.sitioBorrar) {
    const n = Number(d.piezas);
    if (!confirm(n ? `¿Borrar «${d.nombre}»? Sus ${plural(n, 'pieza')} se quedan sin sitio.` : `¿Borrar «${d.nombre}»?`)) return true;
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
      if (otro && !confirm(`Ya hay un sitio «${otro.defaultValue}». ¿Juntar los dos? Sus piezas pasan a ese.`)) { input.value = input.defaultValue; return; }
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
const CAMPOS_PIEZA = {nombre: 'Nombre de la pieza', notas: 'Notas de la pieza', datos: 'Datos de la pieza', datos_pieza: 'Datos de la pieza'};
function nombreCampo(campo) {
  const m = norm(campo).match(/^(ficha|tipo|pieza)[.:s]+([a-z_]+)/) || [null, 'ficha', norm(campo).match(/^[a-z_]+/)?.[0]];
  const nombre = (m[1] === 'pieza' ? CAMPOS_PIEZA : CAMPOS_FICHA)[m[2]];
  return nombre || may(String(campo).replace(/^(ficha|tipo|pieza)./i, '').replace(/[._]/g, ' '));
}
const volverRevision = (t) => (t.objetivo?.componente_id ? `#/c/${t.objetivo.componente_id}` : t.objetivo?.tipo_id ? `#/g/${encodeURIComponent(t.objetivo.tipo_id)}` : '#/ia');

// desplegable en la ficha (pieza o tipo): qué revisar y una foto, ambos opcionales
function panelRevisar(objetivo, id, ayuda) {
  if (!D.ia?.activa) return '';
  return `<details class="ia-revisar"><summary class="btn">Corregir con IA</summary>
    <form id="form-revisar" class="form sin-pad" autocomplete="off" data-objetivo="${objetivo}" data-id="${esc(id)}">
      <p class="ayuda">${esc(ayuda)} Te enseña solo lo que cambiaría y tú eliges qué aplicar.</p>
      <label>Qué corregir (opcional)<textarea name="texto" rows="2" maxlength="1000" placeholder="Los pines están al revés · Añade el consumo"></textarea></label>
      <label>Foto (opcional)<input type="file" name="foto" accept="image/*">
        <span class="ayuda">Si no pones ninguna, la IA mira la foto que ya tiene la pieza.</span></label>
      <div class="acciones"><button class="btn prim" type="submit">Pedir correcciones</button></div>
    </form></details>`;
}

async function enviarRevision(form) {
  const fd = new FormData(form), file = fd.get('foto');
  let foto = null;
  if (file && file.size) {
    const blob = await encuadrar(file);
    if (!blob) throw new Error('Foto cancelada: no se ha enviado nada');
    foto = await base64(blob);
  }
  const t = await api('POST', 'api/ia/revisar', {objetivo: form.dataset.objetivo, id: form.dataset.id, texto: fd.get('texto'), foto});
  location.hash = `#/ia/${t.id}`;
}

// los cambios propuestos: cada uno con su casilla (marcados al empezar), antes tachado y ahora en claro
function vistaCambios(t) {
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
    ${t.foto ? `<p class="ayuda pad">${t.foto_de_pieza ? 'Ha mirado la foto que ya tenía la pieza.' : 'Ha mirado la foto que adjuntaste.'}</p>` : ''}
    ${specs([['Cambios', String(p.cambios.length)], ['Confianza', esc(p.confianza)], ['Modelo', esc(nombreModelo(t.modelo))], ['Coste', esc(costeTexto(p.coste))]])}
    ${p.dudas?.length ? `<div class="pad ia-dudas"><h3>Dudas del modelo</h3><ul>${p.dudas.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      <p class="ayuda">Si sabes la respuesta, pide otra corrección desde la ficha y escríbela en «Qué corregir».</p></div>` : ''}
    ${grupo('tipo', `Ficha del tipo «${esc(nombreTipo)}»`, piezasTipo > 1 ? `La usan ${piezasTipo} piezas: los cambios se verán en todas. La ficha quedará «sin comprobar» hasta que la mires.` : 'La ficha quedará «sin comprobar» hasta que la mires.')}
    ${grupo('pieza', 'Esta pieza', '')}
    ${p.motivos?.length ? `<details class="pad ia-motivos"><summary>Por qué (${p.motivos.length})</summary><ul>${p.motivos.map((m) => `<li><strong>${esc(nombreCampo(m.campo))}</strong>: ${esc(m.motivo)}</li>`).join('')}</ul></details>` : ''}
    <div class="acciones pad">
      ${p.cambios.length ? `<button class="btn prim" type="button" id="ia-aplicar-cambios" data-id="${t.id}" data-volver="${volver}">Aplicar ${p.cambios.length} cambio${p.cambios.length === 1 ? '' : 's'}</button>
        <button class="btn" type="button" data-ia-marcar="todo">Marcar todo</button>
        <button class="btn" type="button" data-ia-marcar="nada">Ninguno</button>` : `<a class="btn prim" href="${volver}">Volver a la ficha</a>`}
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
    proyectos: ['proyectos', vProyectos], p: ['proyectos', () => vProyecto(arg)],
    glosario: ['glosario', vGlosario], g: ['glosario', () => (sub === 'editar' ? vEditarTipo(arg) : vTipo(arg))],
    ia: ['inventario', () => vIA(arg)],
    ajustes: ['ajustes', () => vAjustes(arg)],
    buscar: ['buscar', vBuscar],
  };
  const [tab, fn] = map[v] || map[''];
  document.querySelectorAll('#nav a, #barra a').forEach((a) => a.classList.toggle('on', a.dataset.v === tab));
  cerrarMenuFab();
  app.innerHTML = fn();
  document.title = `[AMS] lab · ${tab}`;
  if (v === 'g' && sub === 'editar') editarTipoCargar();
  if (v === 'ia') { if (arg === 'ajustes') iaAjustes(); else if (arg) iaTarea(arg); else { iaAbiertas(); llenarModelosAlta(); } }
  if (v === 'ajustes') {
    const t = new URLSearchParams(qs).get('t');
    if (arg === 'tipos' && t) { ui.ajBuscar = D.tipos[t]?.nombre || t; ui.ajTipos = D.tipos[t]?.archivado ? 'archivados' : 'todos'; }
    if (arg === 'ia') iaAjustes(); else if (arg) ajCargar();
    else if (!MODELOS_IA && D.ia?.activa) modelosIA().then(() => { if (location.hash === '#/ajustes') route(); }).catch(() => {});
  }
  if (v === 'nuevo' && matchMedia('(hover: hover)').matches) $('#form [name=nombre]').focus(); // en el móvil, sin abrir el teclado
}

function contadores() {
  $('#n-inv').textContent = D.componentes.length || '';
  $('#n-pro').textContent = D.proyectos.filter((p) => !faltas(p).length).length || '';
  $('#n-glo').textContent = Object.values(D.tipos).filter((t) => !t.archivado).length || '';
}

// ---------- eventos ----------
app.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-cat],[data-pf],[data-adj],#rev,#quitar-foto,#quitar-pendiente,#borrar,#revisada,#ia-descartar,#ia-quitar,[data-ia-vista],#ia-responder,#ia-guardar-previa,#ia-cambiar-clave,[data-glo],[data-poner-tema],[data-cat-mover],[data-cat-borrar],[data-cat-borrar-ok],[data-aj-cerrar],[data-aj-tipos],[data-tipo-archivar],[data-tipo-fusionar],[data-tipo-fusionar-ok],[data-tipo-borrar],[data-sitio-borrar],#aj-copia,[data-ia-marcar],#ia-aplicar-cambios,[data-vista],.combo-op,[data-ed-anadir],[data-ed-quitar],[data-ed-mover],[data-copia-preparar],[data-restaurar],[data-restaurar-cancelar]');
  if (!t || !app.contains(t)) return; // solo botones de la propia vista (no el <html>, que lleva data-* del tema)
  // sin redibujar la vista: el selector de tipo y las tablas editables viven dentro de formularios a medio rellenar
  if (t.classList.contains('combo-op')) { elegirTipo(t.closest('.combo'), t.dataset.valor); return; }
  if (clicEditor(t)) return;
  try {
    if (t.dataset.vista) {
      await api('PUT', 'api/ajustes/vista_inventario', {valor: t.dataset.vista});
      D.ajustes.vista_inventario = t.dataset.vista;
      route();
      return;
    }
    if (t.id === 'ia-cambiar-clave') { $('#form-ia-config').hidden = false; t.closest('.acciones').hidden = true; $('#form-ia-config [name=clave]').focus(); return; }
    if (t.dataset.glo) { ui.sinComprobar = t.dataset.glo === 'sin'; route(); return; }
    if (await clicAjustes(t)) return;
    if (t.dataset.iaMarcar) { document.querySelectorAll('.ia-cambio').forEach((x) => (x.checked = t.dataset.iaMarcar === 'todo')); contarCambios(); return; }
    if (t.id === 'ia-aplicar-cambios') { try { await aplicarRevisionIA(t); } catch (err) { t.disabled = false; toast(err.message, true); } return; }
    if (t.dataset.iaVista) { verVistaIA(t.dataset.iaVista); return; }
    if (t.id === 'ia-guardar-previa') { verVistaIA('editar'); $('#form-ia-ok').requestSubmit(); return; }
    if (t.id === 'ia-responder') { try { await responderIA(t); } catch (err) { t.disabled = false; toast(err.message, true); } return; } // sin redibujar: no se pierde lo editado
    if (t.id === 'ia-quitar') {
      if (!confirm('¿Quitar la clave de OpenCode Go? La IA dejará de funcionar hasta que pongas otra.')) return;
      D.ia = await api('PUT', 'api/ia/config', {quitarClave: true});
      toast('Clave quitada');
      location.hash = '#/ia';
      return;
    }
    if (t.id === 'ia-descartar') {
      if (!confirm('¿Descartar esta propuesta? No se guarda nada.')) return;
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
    else if (t.id === 'rev') ui.revisar = !ui.revisar;
    else if (t.id === 'quitar-pendiente') {
      guardarLocal(await api('PATCH', `api/componentes/${location.hash.split('/')[2]}`, {revisar: false}));
      toast('Marca quitada');
    } else if (t.id === 'quitar-foto') {
      if (!confirm('¿Quitar la foto?')) return;
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
  if (t.name === 'ia-modelo') cambiarModeloIA(t);
  if (t.dataset.catNombre || t.dataset.sitioNombre) cambioAjustes(t);
  if (t.classList.contains('ia-cambio')) contarCambios();
  if (t.id === 'aj-importar' && t.files[0]) { subirCopia(t.files[0]); t.value = ''; }
  if (t.matches('.ed-fn select')) t.closest('.ed-fn').style.cssText = colorFn(t.value); // el punto de color sigue a la función
  if (t.name === 'varios') { const n = t.form.querySelector('[name=cantidad]'); n.disabled = t.checked; if (!t.checked && !n.value) n.value = 1; }
  if (t.id === 'foto' && t.files[0]) {
    try { await subirFoto(Number(location.hash.split('/')[2]), t.files[0]); route(); } catch (err) { toast(err.message, true); }
  }
});
app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const b = e.target.querySelector('[type=submit]');
  b.disabled = true;
  b.dataset.texto ||= b.textContent;
  if (e.target.id === 'form-ia') b.textContent = 'Enviando…';
  if (e.target.id === 'form-ia-config') b.textContent = 'Comprobando…';
  try {
    if (e.target.id === 'form-ia') await enviarIA(e.target);
    else if (e.target.id === 'form-ia-config') await guardarAjustesIA(e.target);
    else if (e.target.id === 'form-revisar') await enviarRevision(e.target);
    else if (e.target.id === 'aj-cat-nueva') {
      const nombre = new FormData(e.target).get('nombre');
      await api('POST', 'api/categorias', {nombre});
      await ajRefrescar(`Categoría «${nombre}» añadida`);
    }
    else if (e.target.id === 'form-ia-ok') await aplicarIA(e.target);
    else if (e.target.id === 'form-ficha') await guardarFicha(e.target);
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarMenuFab(); });
async function fotoDirectaIA(file) {
  cerrarMenuFab();
  if (!D.ia?.activa) { toast('Primero pon la clave de OpenCode Go'); location.hash = '#/ia/ajustes'; return; }
  const blob = await fotoEncuadrada(file);
  if (!blob) return;
  toast('Enviando foto…');
  const foto = await base64(blob);
  const t = await api('POST', 'api/ia/alta', {foto});
  location.hash = `#/ia/${t.id}`;
}
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
document.addEventListener('keydown', (e) => {
  const escribiendo = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === '/' && !escribiendo) { e.preventDefault(); q.focus(); q.select(); }
  if (e.key === 'Escape' && document.activeElement === q) { q.value = ''; route(); q.blur(); }
});
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

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
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); // solo con HTTPS o localhost

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
