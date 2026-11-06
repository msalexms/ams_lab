// [AMS] lab — inventario, glosario y proyectos. Habla con la API del servidor (server/index.mjs).
'use strict';

// configuración: llega de la base de datos (categorias, funciones_pin, dificultades, ajustes)
let CATS = {};  // id → nombre, en el orden de la base de datos
let FUNC = {};  // id → {nombre, color_claro, color_oscuro, tachado}
let DIF = {};   // nivel → nombre
const MUCHOS = 99;
const TEMAS = {auto: 'Tema: automático', claro: 'Tema: claro', noche: 'Tema: noche'};

const D = {componentes: [], tipos: {}, proyectos: [], categorias: [], funciones: [], dificultades: [], ubicaciones: [], ajustes: {}};
const ui = {cat: '', ubic: '', revisar: false, proFiltro: 'ya'};
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

function toast(msg, mal = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show ${mal ? 'mal' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = ''), 2600);
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

// reduce la foto en el móvil antes de subirla (lado largo 1600 px, JPEG) y respeta la orientación
async function reducir(file, max = 1600) {
  let src;
  try { src = await createImageBitmap(file, {imageOrientation: 'from-image'}); }
  catch {
    src = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('No puedo leer esa imagen')); i.src = URL.createObjectURL(file); });
  }
  const w = src.width, h = src.height, s = Math.min(1, max / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * s); cv.height = Math.round(h * s);
  cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
  return new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.85));
}
async function subirFoto(id, file) {
  toast('Subiendo foto…');
  const blob = await reducir(file);
  const c = await api('PUT', `api/componentes/${id}/foto`, blob, {'content-type': 'image/jpeg'});
  guardarLocal(c);
  toast('Foto guardada');
  return c;
}

const revisar = (c) => (c.revisar ? ' <span class="aviso">· revisar</span>' : '');
const stepper = (c, grande = false) => c.varios
  ? '<span class="muchos">muchos</span>'
  : `<div class="stepper ${grande ? 'grande' : ''}"><button data-adj="-1" data-id="${c.id}" aria-label="Quitar uno">−</button>
     <span class="num ${unidades(c) ? '' : 'cero'}">${esc(qtyText(c))}</span>
     <button data-adj="1" data-id="${c.id}" aria-label="Añadir uno">+</button></div>`;
const specs = (pares) => `<dl class="specs">${pares.filter(([, v]) => v !== '' && v != null)
  .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const cabecera = (titulo, cat, resumen) => `<header class="hoja-cab"><h1>${titulo}</h1>${cat ? `<span class="cat">${esc(cat)}</span>` : ''}</header>
  ${resumen ? `<p class="resumen">${esc(resumen)}</p>` : '<div style="height:14px"></div>'}`;

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
      ${nRevisar ? `<button class="f ${ui.revisar ? 'on' : ''}" id="rev">Por revisar<span class="n">${nRevisar}</span></button>` : ''}
      <a class="btn prim solo-escritorio" href="#/nuevo">Añadir pieza</a>
    </div></div>`;

  if (!D.componentes.length) return filtros + vacio('Aún no hay piezas. Pulsa + para añadir la primera.');
  if (!cs.length) return filtros + vacio('Nada coincide con el filtro.');
  return filtros + Object.keys(CATS).map((k) => {
    const items = cs.filter((c) => catOf(c) === k).sort(byName);
    return items.length ? `<section class="grupo"><h3 class="grupo-t">${CATS[k]}<span class="n">${items.length}</span></h3>${items.map(filaComp).join('')}</section>` : '';
  }).join('');
}

function vComponente(id) {
  const c = comp(id);
  if (!c) return vacio('No existe esa pieza.');
  const f = g(c.tipo);
  return `<a class="back" href="#/">← Inventario</a>
    <article class="hoja">
      ${cabecera(esc(c.nombre) + revisar(c), c.tipo ? CATS[f.categoria] : '', c.tipo ? f.resumen : '')}
      ${specs([
        ['Cantidad', stepper(c, true)],
        ['Sitio', esc(c.ubicacion || '—')],
        ['Tensión', esc(c.tipo ? voltajeDe(f) : '')],
        ['Tipo', c.tipo ? `<a href="#/g/${esc(c.tipo)}">${esc(f.nombre)}</a>` : 'Sin tipo'],
      ])}
      <div class="hoja-cuerpo">
        <div>${c.tipo ? tablaPines(f) || '<p class="gris">Este tipo no tiene pines.</p>' : '<p class="gris">Asígnale un tipo para ver sus pines.</p>'}</div>
        <aside class="lateral">
          ${c.foto ? `<a href="${fotoUrl(c)}" target="_blank"><img class="foto" src="${fotoUrl(c)}" alt="${esc(c.nombre)}"></a>` : ''}
          <div class="acciones">
            <label class="btn">${c.foto ? 'Cambiar foto' : 'Añadir foto'}<input type="file" accept="image/*" id="foto" hidden></label>
            ${c.foto ? '<button class="btn" id="quitar-foto">Quitar foto</button>' : ''}
            <a class="btn" href="#/editar/${c.id}">Editar</a>
          </div>
          ${c.notas ? `<div><h3>Notas</h3><p class="notas">${esc(c.notas)}</p></div>` : ''}
          <p class="meta">Actualizado ${esc(c.actualizado)}</p>
        </aside>
      </div>
    </article>
    ${usadoEn(c.tipo)}`;
}

function opcionesTipo(sel) {
  return `<option value="">Sin tipo</option>` + Object.keys(CATS).map((cat) => {
    const ts = Object.entries(D.tipos).filter(([, t]) => t.categoria === cat).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, 'es'));
    return ts.length ? `<optgroup label="${CATS[cat]}">${ts.map(([k, t]) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</optgroup>` : '';
  }).join('') + `<option value="__nuevo">Nuevo tipo…</option>`;
}

function vForm(id) {
  const c = id ? comp(id) : {nombre: '', tipo: '', cantidad: 1, varios: 0, ubicacion: '', notas: '', revisar: 0};
  if (!c) return vacio('No existe esa pieza.');
  return `<a class="back" href="${id ? `#/c/${id}` : '#/'}">← ${id ? 'Volver' : 'Inventario'}</a>
    <article class="hoja">
      ${cabecera(id ? 'Editar pieza' : 'Nueva pieza')}
      <form id="form" class="form" autocomplete="off">
        <label>Nombre<input name="nombre" required maxlength="200" value="${esc(c.nombre)}" placeholder="ESP32-WROOM-32 DevKit"></label>
        <label>Tipo<select name="tipo" id="tipo">${opcionesTipo(c.tipo)}</select></label>
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
        ${id ? '' : '<label>Foto (opcional)<input type="file" name="foto" accept="image/*"></label>'}
        <label class="check"><input type="checkbox" name="revisar" ${c.revisar ? 'checked' : ''}> Marcar para revisar</label>
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
    ubicacion: fd.get('ubicacion'), notas: fd.get('notas'), revisar: !!fd.get('revisar')};
  const c = id ? await api('PATCH', `api/componentes/${id}`, body) : await api('POST', 'api/componentes', body);
  guardarLocal(c);
  const foto = fd.get('foto');
  if (foto && foto.size) await subirFoto(c.id, foto);
  else toast('Guardado');
  location.hash = `#/c/${c.id}`;
}

function vGlosario() {
  const query = q.value.trim();
  let tipos = Object.entries(D.tipos).map(([k, f]) => ({k, ...f}));
  if (query) tipos = tipos.filter((t) => matches([t.k, t.nombre, t.resumen, ...list(t.alias), list(t.interfaz).join(' ')].join(' '), query));
  if (!tipos.length) return vacio('Nada coincide.');
  return Object.keys(CATS).map((cat) => {
    const ts = tipos.filter((t) => (t.categoria || 'otro') === cat).sort(byName);
    return ts.length ? `<section class="grupo"><h3 class="grupo-t">${CATS[cat]}<span class="n">${ts.length}</span></h3>${ts.map((t) => `
      <div class="fila"><a class="fila-main" href="#/g/${esc(t.k)}"><div><div class="nombre">${esc(t.nombre)}</div>
        <div class="sub">${esc(t.resumen || '')}</div></div></a>
        <div class="der"><div class="num ${stock(t.k) ? '' : 'gris'}">${stockText(t.k)}</div><div class="sub">${esc(voltajeDe(t))}</div></div></div>`).join('')}</section>` : '';
  }).join('');
}

function vTipo(tipo) {
  const f = D.tipos[tipo];
  if (!f) return vacio('Ese tipo no está en el glosario.');
  const cs = D.componentes.filter((c) => c.tipo === tipo).sort(byName);
  return `<a class="back" href="#/glosario">← Glosario</a>
    <article class="hoja">
      ${cabecera(esc(f.nombre), CATS[f.categoria], f.resumen)}
      ${specs([['Tienes', stockText(tipo)], ['Tensión', esc(voltajeDe(f))], ['También', esc(list(f.alias).join(', '))]])}
      <div class="hoja-cuerpo">
        <div>${tablaPines(f) || '<p class="gris">Sin pines.</p>'}</div>
        <aside class="lateral">${dibujo(tipo)}
          <div><h3>Los que tienes</h3>${cs.length ? cs.map(filaComp).join('') : '<p class="gris">Ninguno.</p>'}</div>
          <a class="btn" href="#/nuevo?tipo=${esc(tipo)}">Añadir uno de este tipo</a>
        </aside>
      </div>
    </article>
    ${usadoEn(tipo)}`;
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
  const pasos = p.pasos?.length ? `<h3 style="margin-top:18px">Pasos</h3><ol class="pasos">${p.pasos.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '';
  return `<a class="back" href="#/proyectos">← Proyectos</a>
    <article class="hoja">
      ${cabecera(esc(p.nombre), '', p.resumen)}
      ${specs([['Dificultad', esc(may(DIF[p.dificultad || 1]))], ['Tiempo', esc(p.tiempo || '—')], ['Material', estadoProyecto(p)]])}
      <div class="hoja-cuerpo"><div>${material}</div><div>${con}${pasos}</div></div>
    </article>`;
}

// ---------- router ----------
function route() {
  const [ruta, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [v = '', arg = ''] = ruta.split('/').map(decodeURIComponent);
  const map = {
    '': ['inventario', vInventario], c: ['inventario', () => vComponente(arg)],
    nuevo: ['inventario', () => vForm()], editar: ['inventario', () => vForm(arg)],
    proyectos: ['proyectos', vProyectos], p: ['proyectos', () => vProyecto(arg)],
    glosario: ['glosario', vGlosario], g: ['glosario', () => vTipo(arg)],
  };
  const [tab, fn] = map[v] || map[''];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === tab));
  $('#fab').hidden = v === 'nuevo' || v === 'editar';
  app.innerHTML = fn();
  document.title = `[AMS] lab · ${tab}`;
  if (v === 'nuevo') {
    const t = new URLSearchParams(qs).get('tipo');
    if (t && D.tipos[t]) $('#tipo').value = t;
    $('#form [name=nombre]').focus();
  }
}

function contadores() {
  $('#n-inv').textContent = D.componentes.length || '';
  $('#n-pro').textContent = D.proyectos.filter((p) => !faltas(p).length).length || '';
  $('#n-glo').textContent = Object.keys(D.tipos).length || '';
}

// ---------- eventos ----------
app.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-cat],[data-pf],[data-adj],#rev,#quitar-foto,#borrar');
  if (!t) return;
  try {
    if (t.dataset.adj) {
      e.preventDefault();
      t.disabled = true;
      guardarLocal(await api('POST', `api/componentes/${t.dataset.id}/ajuste`, {delta: Number(t.dataset.adj)}));
    } else if (t.dataset.cat !== undefined) ui.cat = t.dataset.cat;
    else if (t.dataset.pf) ui.proFiltro = t.dataset.pf;
    else if (t.id === 'rev') ui.revisar = !ui.revisar;
    else if (t.id === 'quitar-foto') {
      if (!confirm('¿Quitar la foto?')) return;
      guardarLocal(await api('DELETE', `api/componentes/${location.hash.split('/')[2]}/foto`));
    } else if (t.id === 'borrar') {
      const id = location.hash.split('/')[2];
      if (!confirm(`¿Borrar «${comp(id)?.nombre}» del inventario?`)) return;
      await api('DELETE', `api/componentes/${id}`);
      D.componentes = D.componentes.filter((c) => c.id !== Number(id));
      contadores();
      toast('Borrada');
      location.hash = '#/';
      return;
    }
    route();
  } catch (err) { toast(err.message, true); route(); }
});
app.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'ubic') { ui.ubic = t.value; route(); }
  if (t.id === 'tipo') $('#nuevo-tipo').hidden = t.value !== '__nuevo';
  if (t.name === 'varios') { const n = $('#form [name=cantidad]'); n.disabled = t.checked; if (!t.checked && !n.value) n.value = 1; }
  if (t.id === 'foto' && t.files[0]) {
    try { await subirFoto(Number(location.hash.split('/')[2]), t.files[0]); route(); } catch (err) { toast(err.message, true); }
  }
});
app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const b = e.target.querySelector('[type=submit]');
  b.disabled = true;
  try { await guardarForm(e.target, location.hash.startsWith('#/editar/') ? location.hash.split('/')[2] : null); }
  catch (err) { toast(err.message, true); b.disabled = false; }
});
$('#tema').addEventListener('click', cambiarTema);

// buscar: desde una ficha salta a la lista de su pestaña
q.addEventListener('input', () => {
  const v = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  const lista = {c: '#/', g: '#/glosario', p: '#/proyectos', nuevo: '#/', editar: '#/'}[v];
  if (lista) location.hash = lista; else route();
});
document.addEventListener('keydown', (e) => {
  const escribiendo = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === '/' && !escribiendo) { e.preventDefault(); q.focus(); q.select(); }
  if (e.key === 'Escape' && document.activeElement === q) { q.value = ''; route(); q.blur(); }
});
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

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
