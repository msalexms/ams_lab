// CircuitBin · proyectos.js — proyectos: listado, ficha con pestañas (tablero, bitácora, archivos) y formulario.
import {$, D, DIF, MUCHOS, api, base64, byName, cabIA, campoFoto, conColor, confirmar, cuando, dificultad, esc, estadoProyecto, faltas, fechaCompleta, fotoUrl, g, jpeg, lienzoDe, list, matches, may, migas, plural, q, stock, stockText, t, tamano, toast, ui, vacio} from './base.js';
import {ICO, cuenta, tambien} from './piezas.js';
import {cajetin, editorFilas, leerEditor, menuMas} from './fichas.js';
import {claveTxt} from './revision.js';
import {contadores} from './app.js';
import {plegableHist} from './actividad.js';

// ---------- proyectos (v8): listado por estado con miniaturas, ficha con pestañas (tablero, bitácora, archivos) ----------
const ESTADOS_PRO = {en_marcha: 'En marcha', pausa: 'En pausa', idea: 'Ideas', terminado: 'Terminados'}; // en el orden del listado
const ESTADO_PRO = {idea: 'Idea', en_marcha: 'En marcha', pausa: 'En pausa', terminado: 'Terminado'};
const COLUMNAS = {hacer: 'Por hacer', curso: 'En curso', hecho: 'Hecho'};
export const proyecto = (id) => D.proyectos.find((p) => p.id === id);
const proActual = () => decodeURIComponent(location.hash.split('?')[0].split('/')[2] || '');
const nTareas = (p) => (p.tareas ? p.tareas.hacer + p.tareas.curso + p.tareas.hecho : 0);
export const textoProyecto = (p) => [p.nombre, p.resumen, ...(p.material || []).flatMap((m) => list(m.tipo).map((tp) => g(tp).nombre))].join(' ');
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
export function listaProyectos(ps, minis = false) {
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

export function vProyectos() {
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

export function vProyecto(id, sub) {
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
export async function cargarProyecto() {
  const zona = $('#pro-zona');
  if (!zona || zona.dataset.tab === 'ficha') return;
  try { pintarProyecto(await api('GET', `api/proyectos/${encodeURIComponent(zona.dataset.id)}`)); }
  catch (err) { if (PRO.id !== zona.dataset.id) zona.innerHTML = `<p class="mal">${esc(err.message)}</p>`; }
}

// botones de la ficha de un proyecto (data-pro)
export async function clicProyecto(el) {
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
    if (!(await confirmar(t('¿Borrar el proyecto «{nombre}»?\n{extra}No se puede deshacer.', {nombre: p.nombre, extra: suyo.length ? t('Se borran también sus {items}. ', {items: suyo.join(', ')}) : ''}), {si: t('Borrar proyecto'), peligro: true}))) return;
    await api('DELETE', base);
    D.proyectos = D.proyectos.filter((x) => x.id !== id);
    if (PRO.id === id) { PRO.id = null; PRO.det = null; }
    contadores();
    location.hash = '#/proyectos';
    toast(t('Borrado «{nombre}»', {nombre: p.nombre}));
  }
}
export async function cambiarEstadoPro(sel) {
  const p = await api('PATCH', `api/proyectos/${encodeURIComponent(proActual())}`, {estado: sel.value});
  guardarProLocal(p);
  toast(t('Estado: {e}', {e: t(ESTADO_PRO[p.estado]).toLowerCase()}));
}
// imagen → JPEG de 2400 px como mucho, sobre blanco (los PNG con transparencia saldrían en negro); PDF → tal cual
export async function subirArchivoPro(file) {
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
export async function anadirTareaPro(form) {
  pintarProyecto(await api('POST', `api/proyectos/${encodeURIComponent(proActual())}/tareas`, {texto: new FormData(form).get('texto')}));
  if (matchMedia('(hover: hover)').matches) $('#form-pro-tarea [name=texto]')?.focus(); // en el móvil, sin reabrir el teclado
}
export async function anadirNotaPro(form) {
  const fd = new FormData(form), foto = fd.get('foto');
  const body = {texto: fd.get('texto')};
  if (foto && foto.size) body.foto = await base64(await jpeg(await lienzoDe(foto, 1600)));
  if (!String(body.texto).trim() && !body.foto) throw new Error(t('Escribe algo o pon una foto'));
  pintarProyecto(await api('POST', `api/proyectos/${encodeURIComponent(proActual())}/notas`, body));
  toast(t('Apuntado'));
}

// crear o editar la receta de un proyecto: nombre, material (tipos del glosario), conexiones y pasos
export function vProyectoForm(p) {
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
export async function guardarProyectoForm(form) {
  const fd = new FormData(form), id = form.dataset.id;
  const body = {nombre: fd.get('nombre'), resumen: fd.get('resumen'), dificultad: Number(fd.get('dificultad')) || 1, tiempo: fd.get('tiempo'),
    material: leerEditor(form, 'material').map(([tipo, alt, cantidad, nota, opcional]) => ({tipo: [tipo, alt].filter(Boolean), cantidad: Number(cantidad) || 1, nota, opcional: !!opcional})),
    conexiones: leerEditor(form, 'conexiones'), pasos: leerEditor(form, 'pasos').map(([s]) => s)};
  const p = id ? await api('PUT', `api/proyectos/${encodeURIComponent(id)}`, body) : await api('POST', 'api/proyectos', body);
  guardarProLocal(p);
  location.hash = `#/p/${encodeURIComponent(p.id)}`;
  toast(id ? t('Proyecto guardado') : t('Proyecto creado'));
}
