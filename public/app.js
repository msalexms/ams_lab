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
      <a class="btn" href="#/ia">Añadir con IA</a>
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
      ${c.tipo && f.revisado === 0 ? avisoIA(c.tipo) : ''}
      ${specs([
        ['Cantidad', stepper(c, true)],
        ['Sitio', esc(c.ubicacion || '—')],
        ['Tensión', esc(c.tipo ? voltajeDe(f) : '')],
        ['Tipo', c.tipo ? `<a href="#/g/${esc(c.tipo)}">${esc(f.nombre)}</a>${f.archivado ? ' <span class="gris">(archivado)</span>' : ''}` : 'Sin tipo'],
        ...list(c.datos).map(([k, v]) => [esc(k), esc(v)]),
      ])}
      <div class="hoja-cuerpo">
        <div>${c.tipo ? tablaPines(f) || '<p class="gris">Este tipo no tiene pines.</p>' : '<p class="gris">Asígnale un tipo para ver sus pines.</p>'}</div>
        <aside class="lateral">
          ${c.foto ? `<a href="${fotoUrl(c)}" target="_blank"><img class="foto" src="${fotoUrl(c)}" alt="${esc(c.nombre)}"></a>` : ''}
          <div class="acciones">
            <label class="btn">${c.foto ? 'Cambiar foto' : 'Añadir foto'}<input type="file" accept="image/*" id="foto" hidden></label>
            ${c.foto ? '<button class="btn" id="quitar-foto">Quitar foto</button>' : ''}
            <a class="btn" href="#/editar/${c.id}">Editar</a>
            <button class="btn peligro" id="borrar" type="button">Borrar</button>
          </div>
          ${panelRevisar('pieza', c.id, c.tipo ? 'Revisa esta pieza y la ficha de su tipo.' : 'Revisa esta pieza.')}
          <div>
          </div>
          ${c.notas ? `<div><h3>Notas</h3><p class="notas">${esc(c.notas)}</p></div>` : ''}
          <p class="meta">Actualizado ${esc(c.actualizado)}</p>
        </aside>
      </div>
    </article>
    ${usadoEn(c.tipo)}`;
}

function opcionesTipo(sel, nuevo = 'Nuevo tipo…') {
  return `<option value="">Sin tipo</option>` + Object.keys(CATS).map((cat) => {
    const ts = Object.entries(D.tipos).filter(([k, t]) => t.categoria === cat && (!t.archivado || k === sel)).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, 'es'));
    return ts.length ? `<optgroup label="${CATS[cat]}">${ts.map(([k, t]) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</optgroup>` : '';
  }).join('') + `<option value="__nuevo" ${sel === '__nuevo' ? 'selected' : ''}>${esc(nuevo)}</option>`;
}

function vForm(id) {
  const c = id ? comp(id) : {nombre: '', tipo: '', cantidad: 1, varios: 0, ubicacion: '', notas: '', revisar: 0};
  if (!c) return vacio('No existe esa pieza.');
  return `<a class="back" href="${id ? `#/c/${id}` : '#/'}">← ${id ? 'Volver' : 'Inventario'}</a>
    <article class="hoja">
      ${cabecera(id ? 'Editar pieza' : 'Nueva pieza')}
      ${!id ? '<p class="ia-atajo"><a href="#/ia">O que la IA la rellene a partir de una foto →</a></p>' : ''}
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
  let tipos = Object.entries(D.tipos).map(([k, f]) => ({k, ...f})).filter((t) => !t.archivado);
  if (query) tipos = tipos.filter((t) => matches([t.k, t.nombre, t.resumen, ...list(t.alias), list(t.interfaz).join(' ')].join(' '), query));
  // filtro «Sin comprobar»: las fichas que escribió la IA y nadie ha revisado (solo aparece si hay alguna)
  const sinComprobar = Object.values(D.tipos).filter((t) => t.revisado === 0).length;
  if (!sinComprobar) ui.sinComprobar = false;
  if (ui.sinComprobar) tipos = tipos.filter((t) => t.revisado === 0);
  const filtros = sinComprobar ? `<div class="filtros"><div class="cats">
    <button class="f ${ui.sinComprobar ? '' : 'on'}" data-glo="todo">Todo<span class="n">${Object.keys(D.tipos).length}</span></button>
    <button class="f ${ui.sinComprobar ? 'on' : ''}" data-glo="sin">Sin comprobar<span class="n">${sinComprobar}</span></button></div></div>` : '';
  if (!tipos.length) return filtros + vacio('Nada coincide.');
  return filtros + Object.keys(CATS).map((cat) => {
    const ts = tipos.filter((t) => (t.categoria || 'otro') === cat).sort(byName);
    return ts.length ? `<section class="grupo"><h3 class="grupo-t">${CATS[cat]}<span class="n">${ts.length}</span></h3>${ts.map((t) => `
      <div class="fila"><a class="fila-main" href="#/g/${esc(t.k)}"><div><div class="nombre">${esc(t.nombre)}${t.revisado === 0 ? ' <span class="aviso">· sin comprobar</span>' : ''}</div>
        <div class="sub">${esc(t.resumen || '')}</div></div></a>
        <div class="der"><div class="num ${stock(t.k) ? '' : 'gris'}">${stockText(t.k)}</div><div class="sub">${esc(voltajeDe(t))}</div></div></div>`).join('')}</section>` : '';
  }).join('');
}

function vTipo(tipo) {
  const f = D.tipos[tipo];
  if (!f) return vacio('Ese tipo no está en el glosario.');
  const cs = D.componentes.filter((c) => c.tipo === tipo).sort(byName);
  const datos = list(f.datos).length ? `<h3 style="margin-top:18px">Datos</h3><table class="t"><tbody>${f.datos.map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>` : '';
  return `<a class="back" href="#/glosario">← Glosario</a>
    <article class="hoja">
      ${cabecera(esc(f.nombre), CATS[f.categoria], f.resumen)}
      ${f.revisado === 0 ? avisoIA(tipo, true) : ''}
      ${f.archivado ? `<p class="ia-aviso">Archivado: no sale en el glosario ni al elegir tipo. <button class="btn" data-tipo-archivar="${esc(tipo)}" data-v="0">Recuperar</button></p>` : ''}
      ${specs([['Tienes', stockText(tipo)], ['Tensión', esc(voltajeDe(f))], ['También', esc(list(f.alias).join(', '))]])}
      <div class="hoja-cuerpo">
        <div>${tablaPines(f) || '<p class="gris">Sin pines.</p>'}${datos}</div>
        <aside class="lateral">${f.origen === 'ia' ? '' : dibujo(tipo)}
          <div><h3>Los que tienes</h3>${cs.length ? cs.map(filaComp).join('') : '<p class="gris">Ninguno.</p>'}</div>
          <a class="btn" href="#/nuevo?tipo=${esc(tipo)}">Añadir uno de este tipo</a>
          ${panelRevisar('tipo', tipo, 'Revisa la ficha del tipo: vale para todas sus piezas.')}
          <a class="ia-atajo sin-margen" href="#/ajustes/tipos?t=${esc(tipo)}">Archivar, fusionar o borrar este tipo →</a>
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
const avisoIA = (tipo, conBoton = false) => `<p class="ia-aviso">Ficha generada por IA, sin comprobar: revisa la tensión y los pines antes de conectar nada.
  ${conBoton ? `<button class="btn" id="revisada" data-tipo="${esc(tipo)}">Marcar como revisada</button>` : ''}</p>`;
const ESTADO_IA = {pendiente: 'Analizando…', propuesta: 'Propuesta por revisar', error: 'Error', aplicada: 'Guardada', descartada: 'Descartada'};
const lineasPares = (pares) => list(pares).map(([k, v]) => `${k}: ${v}`).join('\n');
const paresLineas = (s) => String(s || '').split('\n').map((l) => l.split(/:\s*/)).filter(([k, ...v]) => k.trim() && v.join(':').trim())
  .map(([k, ...v]) => [k.trim(), v.join(':').trim()]);
const comas = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

function vIA(id) {
  if (id === 'ajustes') return `<a class="back" href="#/ia">← Añadir con IA</a><article class="hoja" id="ia-ajustes"><p class="gris pad">Cargando…</p></article>`;
  if (id) return `<a class="back" href="#/ia">← Añadir con IA</a><article class="hoja" id="ia-zona"><p class="gris pad">Cargando…</p></article>`;
  if (!D.ia?.activa) return `<a class="back" href="#/">← Inventario</a>${vacio('Falta la clave de OpenCode Go. <a class="btn prim" href="#/ia/ajustes">Configurar</a>')}`;
  return `<a class="back" href="#/">← Inventario</a>
    <article class="hoja">
      ${cabecera('Añadir con IA', '', 'Haz una foto de la pieza (mejor si se lee la serigrafía) y añade lo que sepas. La IA propone el nombre, el tipo y la ficha; tú lo revisas antes de guardar.')}
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
          <span class="ayuda">Se saca en la consola de OpenCode (suscripción Go). La app la guarda en su base de datos y no la vuelve a mostrar;
            ojo: viaja en las copias de seguridad de la base de datos.</span></label>
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
        <div><div class="nombre">${esc(t.clase === 'revisar' ? `Revisión de «${t.objetivo_nombre || '?'}»` : t.propuesta?.nombre || t.texto || 'Pieza sin nombre')}</div><div class="sub">${esc(t.creada)}</div></div></a>
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
      zona.innerHTML = vistaEspera(foto, t.modelo_pedido || D.ia?.modelo, t.clase === 'revisar' ? 'Revisando…' : 'Analizando…');
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
  const funciones = Object.entries(FUNC).map(([k, f]) => `${k} = ${f.nombre}`).join(' · ');
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
      <label>Tipo<select name="tipo" id="tipo">${opcionesTipo(sel, p.tipo_nuevo ? `Nuevo: ${p.tipo_nuevo.nombre} (propuesto por la IA)` : 'Nuevo tipo…')}</select></label>
      <div id="nuevo-tipo" class="nuevo-tipo" ${sel === '__nuevo' ? '' : 'hidden'}>
        <p class="ia-aviso sin-pad">Ficha nueva escrita por la IA: quedará marcada como «sin comprobar».</p>
        <label>Nombre del tipo<input name="tn_nombre" maxlength="120" value="${esc(n.nombre || '')}"></label>
        <label>Categoría<select name="tn_categoria">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k === (n.categoria || 'otro') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Resumen<textarea name="tn_resumen" rows="2" maxlength="400">${esc(n.resumen || '')}</textarea></label>
        <label>Tensión<input name="tn_voltaje" maxlength="120" value="${esc(n.voltaje || '')}"></label>
        <label>Interfaces (separadas por comas)<input name="tn_interfaz" value="${esc(list(n.interfaz).join(', '))}"></label>
        <label>También se llama (separado por comas)<input name="tn_alias" value="${esc(list(n.alias).join(', '))}"></label>
        <label>Pines: una línea por pin, «pin | uso | función»<textarea name="tn_pines" rows="${Math.max(3, list(n.pines).length + 1)}" class="mono">${esc(list(n.pines).map((x) => x.join(' | ')).join('\n'))}</textarea>
          <span class="ayuda">Funciones: ${esc(funciones)}</span></label>
        <label>Datos del tipo: una línea por dato, «dato: valor»<textarea name="tn_datos" rows="3">${esc(lineasPares(n.datos))}</textarea></label>
        <label>Ojo (advertencia)<textarea name="tn_ojo" rows="2" maxlength="400">${esc(n.ojo || '')}</textarea></label>
      </div>
      <label>Datos de esta pieza: «dato: valor»<textarea name="datos_pieza" rows="2">${esc(lineasPares(p.datos_pieza))}</textarea></label>
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
    const blob = await reducir(file);
    foto = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
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
    ubicacion: fd.get('ubicacion'), notas: fd.get('notas'), datos_pieza: paresLineas(fd.get('datos_pieza')),
  };
  if (body.tipo === '__nuevo') body.tipo_nuevo = {
    nombre: fd.get('tn_nombre'), categoria: fd.get('tn_categoria'), resumen: fd.get('tn_resumen'), voltaje: fd.get('tn_voltaje'),
    interfaz: comas(fd.get('tn_interfaz')), alias: comas(fd.get('tn_alias')), ojo: fd.get('tn_ojo'), datos: paresLineas(fd.get('tn_datos')),
    pines: String(fd.get('tn_pines') || '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x[0]),
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
  const datosTipo = f && list(f.datos).length ? `<h3 style="margin-top:18px">Datos del tipo</h3><table class="t"><tbody>${f.datos.map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>` : '';
  const ocultos = nuevo ? [f.ojo ? 'la advertencia («Ojo»)' : '', list(f.interfaz).length ? 'las interfaces (sirven para buscar)' : ''].filter(Boolean) : [];
  return `<p class="ayuda pad">Así quedará${nuevo ? ` la pieza, y el tipo nuevo «${esc(f.nombre)}» en el glosario (sin la palabra «Nuevo»)` : ' la pieza'}. No se ha guardado nada.</p>
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
          ${f && list(f.alias).length ? `<p class="meta">También: ${esc(list(f.alias).join(', '))}</p>` : ''}
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
          `<button class="f ${(D.ajustes.tema || 'auto') === k ? 'on' : ''}" data-tema="${k}">${v}</button>`).join('')}</div></div>
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
  return `${cabecera('Categorías', '', 'Renombra escribiendo encima, ordénalas con las flechas o bórralas. «Otros» no se borra: es donde va lo que no tiene sitio.')}
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
          <button class="btn mini peligro" data-tipo-borrar="${esc(t.id)}" ${usos ? `disabled title="No se puede borrar: lo usan ${esc(usos)}. Archívalo o fúndelo."` : ''}>Borrar</button>
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

function ajDatos(r) {
  const u = r.copias.ultima;
  const fecha = (iso) => new Date(iso).toLocaleString('es-ES', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
  return `${cabecera('Datos', '', 'Copias de seguridad de la base de datos (con las fotos nuevas) y exportación.')}
    ${specs([['Piezas', r.piezas], ['Tipos', `${r.tipos}${r.archivados ? ` (+${r.archivados} archivado${r.archivados === 1 ? '' : 's'})` : ''}`], ['Categorías', r.categorias],
      ['Sitios', r.sitios], ['Proyectos', r.proyectos], ['Modelo de datos', `v${r.version}`]])}
    <section class="pad ia-bloque">
      <h3>Copias de seguridad</h3>
      <p>${u ? `Última: ${esc(fecha(u.fecha))} · ${Math.round(u.bytes / 1024)} KB` : '<span class="mal">Aún no hay ninguna</span>'}</p>
      <p class="ayuda">Se hace una al día sola y se guardan ${r.copias.maximo} (${r.copias.guardadas} ahora). Carpeta: ${esc(r.copias.carpeta)}</p>
      <div class="acciones"><button class="btn prim" type="button" id="aj-copia">Hacer copia ahora</button>
        <a class="btn" href="api/exportar" download>Exportar (JSON)</a></div>
    </section>`;
}

async function clicAjustes(t) {
  const d = t.dataset, fila = t.closest('.aj-fila'), panel = fila?.querySelector('.aj-panel');
  if (d.tema) { await api('PUT', 'api/ajustes/tema', {valor: d.tema}); D.ajustes.tema = d.tema; aplicarTema(); route(); return true; }
  if ('ajCerrar' in d) { t.closest('.aj-panel').hidden = true; return true; }
  if (d.ajTipos) { ui.ajTipos = d.ajTipos; await ajCargar(); return true; }
  if (t.id === 'aj-copia') { t.disabled = true; const r = await api('POST', 'api/copias'); await ajCargar(); toast(`Copia hecha: ${r.nombre}`); return true; }
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

// ---------- «Revisar con IA» (fase C): el modelo corrige la ficha y aquí se eligen los cambios ----------
const volverRevision = (t) => (t.objetivo?.componente_id ? `#/c/${t.objetivo.componente_id}` : t.objetivo?.tipo_id ? `#/g/${encodeURIComponent(t.objetivo.tipo_id)}` : '#/ia');

// desplegable en la ficha (pieza o tipo): qué revisar y una foto, ambos opcionales
function panelRevisar(objetivo, id, ayuda) {
  if (!D.ia?.activa) return '';
  return `<details class="ia-revisar"><summary class="btn">Revisar con IA</summary>
    <form id="form-revisar" class="form sin-pad" autocomplete="off" data-objetivo="${objetivo}" data-id="${esc(id)}">
      <p class="ayuda">${esc(ayuda)} Te enseñará solo los cambios y tú eliges cuáles aplicar.</p>
      <label>Qué revisar (opcional)<textarea name="texto" rows="2" maxlength="1000" placeholder="Los pines están al revés · Añade el consumo"></textarea></label>
      <label>Foto (opcional)<input type="file" name="foto" accept="image/*"></label>
      <div class="acciones"><button class="btn prim" type="submit">Revisar</button></div>
    </form></details>`;
}

async function enviarRevision(form) {
  const fd = new FormData(form), file = fd.get('foto');
  let foto = null;
  if (file && file.size) {
    const blob = await reducir(file);
    foto = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
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
  return `${cabecera(`Revisión de «${esc(t.objetivo_nombre || '')}»`, '', p.cambios.length
      ? 'Marca los cambios que quieras aplicar. Lo que no marques se queda como está.'
      : 'El modelo no ve nada que cambiar.')}
    ${specs([['Cambios', String(p.cambios.length)], ['Confianza', esc(p.confianza)], ['Modelo', esc(nombreModelo(t.modelo))], ['Coste', esc(costeTexto(p.coste))]])}
    ${p.dudas?.length ? `<div class="pad ia-dudas"><h3>Dudas del modelo</h3><ul>${p.dudas.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      <p class="ayuda">Si sabes la respuesta, pide otra revisión desde la ficha y escríbela en «Qué revisar».</p></div>` : ''}
    ${grupo('tipo', `Ficha del tipo «${esc(nombreTipo)}»`, piezasTipo > 1 ? `La usan ${piezasTipo} piezas: los cambios se verán en todas. La ficha quedará como «sin comprobar».` : 'La ficha quedará como «sin comprobar».')}
    ${grupo('pieza', 'Esta pieza', '')}
    ${p.motivos?.length ? `<details class="pad ia-motivos"><summary>Por qué (${p.motivos.length})</summary><ul>${p.motivos.map((m) => `<li><strong>${esc(m.campo)}</strong>: ${esc(m.motivo)}</li>`).join('')}</ul></details>` : ''}
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
  const [v = '', arg = ''] = ruta.split('/').map(decodeURIComponent);
  const map = {
    '': ['inventario', vInventario], c: ['inventario', () => vComponente(arg)],
    nuevo: ['inventario', () => vForm()], editar: ['inventario', () => vForm(arg)],
    proyectos: ['proyectos', vProyectos], p: ['proyectos', () => vProyecto(arg)],
    glosario: ['glosario', vGlosario], g: ['glosario', () => vTipo(arg)],
    ia: ['inventario', () => vIA(arg)],
    ajustes: ['ajustes', () => vAjustes(arg)],
  };
  const [tab, fn] = map[v] || map[''];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === tab));
  $('#fab').hidden = v === 'nuevo' || v === 'editar' || v === 'ia' || v === 'ajustes';
  cerrarMenuFab();
  app.innerHTML = fn();
  document.title = `[AMS] lab · ${tab}`;
  if (v === 'ia') { if (arg === 'ajustes') iaAjustes(); else if (arg) iaTarea(arg); else { iaAbiertas(); llenarModelosAlta(); } }
  if (v === 'ajustes') {
    const t = new URLSearchParams(qs).get('t');
    if (arg === 'tipos' && t) { ui.ajBuscar = D.tipos[t]?.nombre || t; ui.ajTipos = D.tipos[t]?.archivado ? 'archivados' : 'todos'; }
    if (arg === 'ia') iaAjustes(); else if (arg) ajCargar();
    else if (!MODELOS_IA && D.ia?.activa) modelosIA().then(() => { if (location.hash === '#/ajustes') route(); }).catch(() => {});
  }
  if (v === 'nuevo') {
    const t = new URLSearchParams(qs).get('tipo');
    if (t && D.tipos[t]) $('#tipo').value = t;
    $('#form [name=nombre]').focus();
  }
}

function contadores() {
  $('#n-inv').textContent = D.componentes.length || '';
  $('#n-pro').textContent = D.proyectos.filter((p) => !faltas(p).length).length || '';
  $('#n-glo').textContent = Object.values(D.tipos).filter((t) => !t.archivado).length || '';
}

// ---------- eventos ----------
app.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-cat],[data-pf],[data-adj],#rev,#quitar-foto,#borrar,#revisada,#ia-descartar,#ia-quitar,[data-ia-vista],#ia-responder,#ia-guardar-previa,#ia-cambiar-clave,[data-glo],[data-tema],[data-cat-mover],[data-cat-borrar],[data-cat-borrar-ok],[data-aj-cerrar],[data-aj-tipos],[data-tipo-archivar],[data-tipo-fusionar],[data-tipo-fusionar-ok],[data-tipo-borrar],[data-sitio-borrar],#aj-copia,[data-ia-marcar],#ia-aplicar-cambios');
  if (!t) return;
  try {
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
      toast('Ficha marcada como revisada');
    } else if (t.dataset.adj) {
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
  if (t.id === 'tipo') $('#nuevo-tipo').hidden = t.value !== '__nuevo';
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
  toast('Enviando foto…');
  const blob = await reducir(file);
  const foto = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
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

q.addEventListener('input', () => {
  const v = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  const lista = {c: '#/', g: '#/glosario', p: '#/proyectos', nuevo: '#/', editar: '#/', ia: '#/'}[v];
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
