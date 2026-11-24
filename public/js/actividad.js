// CircuitBin · actividad.js — cambios pendientes de la IA, historial de cambios y registro del servidor.
import {$, D, api, cabIA, comp, confirmar, cuando, esc, fechaCompleta, migas, piezasTxt, plural, repetirEn, t, toast, vacio} from './base.js';
import {MODELOS_IA, iaAbiertas, modelosIA, nombreModelo, nombreTareaIA} from './ia.js';
import {proyecto} from './proyectos.js';
import {rotulo, valorCambio} from './lotes.js';

// ---------- cambios pendientes: correcciones y altas a medias (para no perder un lote al salir de su pantalla) ----------
// el nombre bonito de los modelos («Claude Haiku 5.5») necesita el catálogo: si aún no está, se pide y se vuelve a pintar
const conModelos = (fn) => { if (!MODELOS_IA && D.ia?.activa) modelosIA().then(fn).catch(() => {}); };

export function vPendientes() {
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
export function filaPendiente(tr) {
  const nombre = nombreTareaIA(tr);
  const modelo = nombreModelo(tr.modelo || tr.modelo_pedido || D.ia?.modelo);
  return `<div class="fila"><a class="fila-main" href="#/ia/${tr.id}">${tr.foto ? `<span class="fila-img"><img src="fotos/${encodeURIComponent(tr.foto)}" alt="" loading="lazy"></span>` : ''}
      <div><div class="nombre">${esc(nombre)}</div><div class="sub">${esc(cuando(tr.creada))}${modelo ? ` · ${esc(modelo)}` : ''}${tr.texto && tr.clase === 'revisar' ? ` · «${esc(tr.texto)}»` : ''}</div></div></a>
    <div class="der">${estadoTarea(tr)}${tr.estado !== 'pendiente' ? `<button class="btn mini" type="button" data-pend-descartar="tarea:${tr.id}">${t('Descartar')}</button>` : ''}</div></div>`;
}
export function filaLotePendiente(l) {
  const mas = l.piezas.length > 4 ? t(' y {n} más', {n: l.piezas.length - 4}) : '';
  const abiertas = (l.estados.propuesta || 0) + (l.estados.error || 0);
  return `<div class="fila"><a class="fila-main" href="#/ia/lote/${esc(l.lote)}">
      <div><div class="nombre">${l.clase === 'alta' ? t('{piezas} de una foto', {piezas: piezasTxt(l.total)}) : t('Correcciones de {piezas} a la vez', {piezas: piezasTxt(l.total)})}</div>
        <div class="sub">${esc(l.piezas.slice(0, 4).join(', '))}${mas}${l.texto ? ` · «${esc(l.texto)}»` : ''}</div>
        <div class="sub">${esc(cuando(l.creada))}${l.cambios ? ` · ${t('{cambios} por mirar', {cambios: plural(l.cambios, 'cambio')})}` : ''}</div></div></a>
    <div class="der"><span class="ams-etiqueta">${estadosLote(l.estados)}</span>${abiertas ? `<button class="btn mini" type="button" data-pend-descartar="lote:${esc(l.lote)}">${t('Descartar')}</button>` : ''}</div></div>`;
}
export async function cargarPendientes() {
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
  if (pensando) repetirEn(4000, cargarPendientes, '#/pendientes');
}
export async function descartarPendiente(valor) {
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
export let CUENTA_PEND = null;
function pintarAvisoPend() {
  const z = $('#pend-aviso'), c = CUENTA_PEND;
  if (!z || !c) return;
  z.innerHTML = c.tareas ? `<a class="pend-aviso" href="#/pendientes"><span class="nota-t">${t('Cambios pendientes')}</span>
    <span>${c.grupos === 1 ? t('Tienes 1 sin revisar') : t('Tienes {n} sin revisar', {n: c.grupos})}${c.pensando ? ` (${t('{n} aún preparándose', {n: c.pensando})})` : ''}</span><span class="gris">${t('Ver →')}</span></a>` : '';
}
export async function avisoPendientes() {
  pintarAvisoPend(); // lo último que se supo, sin esperar
  try { CUENTA_PEND = await api('GET', 'api/ia/pendientes/cuenta'); } catch { return; }
  pintarAvisoPend();
}

// ---------- historial de cambios (Ajustes → Historial, y el de cada pieza o ficha) ----------
export const HIST = {grupo: '', q: '', filas: [], mas: false, cargando: false};
export const GRUPOS_HIST = {'': 'Todo', piezas: 'Piezas', fichas: 'Fichas', ia: 'IA', catalogo: 'Catálogo', proyectos: 'Proyectos', sistema: 'Copias y ajustes'};
const OBJETO_HIST = {pieza: 'pieza', tipo: 'ficha', categoria: 'categoría', sitio: 'sitio', ia: 'IA', copia: 'copia', ajustes: 'ajuste', proyecto: 'proyecto'};
const quienHist = (r) => (r.quien === 'ia' ? `${t('IA')}${r.modelo ? ` · ${esc(nombreModelo(r.modelo))}` : ''}` : r.quien === 'sistema' ? t('Sistema') : t('Tú'));
function enlaceHist(r) {
  if (!r.nombre) return '';
  if (r.objeto === 'pieza' && comp(r.objeto_id)) return `<a href="#/c/${esc(r.objeto_id)}">${esc(r.nombre)}</a>`;
  if (r.objeto === 'tipo' && D.tipos[r.objeto_id]) return `<a href="#/g/${encodeURIComponent(r.objeto_id)}">${esc(r.nombre)}</a>`;
  if (r.objeto === 'proyecto' && proyecto(r.objeto_id)) return `<a href="#/p/${encodeURIComponent(r.objeto_id)}">${esc(r.nombre)}</a>`;
  return esc(r.nombre);
}
// el servidor guarda el resumen en español: frases fijas o con datos (las traduce t()), «Campo: antes → después» y
// «Editada: campos que cambian» (resumenCambios() de server/auditoria.mjs), que se traducen con los rótulos de los cambios
const PREFIJOS_HIST = new Set(['Editada', 'Corregida con IA', 'Ficha corregida con IA', 'Proyecto editado', 'Tarea cambiada', 'Formato uniformado', 'Ficha editada']);
// los valores de Ajustes van como su identificador («cuadricula»): con el nombre que enseña la web
const VALOR_AJUSTE = {auto: 'Automático', claro: 'Claro', noche: 'Noche', lista: 'Lista', cuadricula: 'Cuadrícula', poco: 'Poco', medio: 'Medio', mucho: 'Mucho', en: 'English', es: 'Español'};
const VARIAS = ' (varias a la vez)';
function resumenHist(r) {
  const x = String(r.resumen ?? ''), tr = t(x);
  if (tr !== x || I18N.lang() !== 'en') return tr;
  const varias = x.endsWith(VARIAS), base = varias ? x.slice(0, -VARIAS.length) : x, fin = varias ? ` ${t(VARIAS.trim())}` : '';
  const cambios = r.detalle?.cambios || [], c = cambios[0], vacio = (v) => valorCambio(v) || '—';
  if (cambios.length === 1 && base.startsWith(`${c.campo}: `)) return `${rotulo(c.campo)}: ${vacio(c.antes)} → ${vacio(c.despues)}${fin}`;
  const m = base.match(/^(.+?): (.+)$/s);
  if (m && PREFIJOS_HIST.has(m[1])) {
    const campos = m[2] === 'sin cambios' ? t(m[2]) : m[2].split(', ').map((k) => rotulo(k[0].toUpperCase() + k.slice(1)).toLowerCase()).join(', ');
    return `${t(m[1])}: ${campos}${fin}`;
  }
  const v = base.match(/^([^:]+): (.*) → (.*)$/s); // ajustes y estado de un proyecto: «Tema: claro → noche»
  const valor = (s) => t(r.objeto === 'ajustes' ? VALOR_AJUSTE[s] || s : valorCambio(s));
  return v ? `${rotulo(v[1])}: ${valor(v[2])} → ${valor(v[3])}${fin}` : x;
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
    <span class="hist-que">${objeto}<span class="hist-res">${esc(resumenHist(r))}</span></span>`;
  if (!cambios.length && !extra.length) return `<div class="hist">${cab}</div>`;
  return `<details class="hist"><summary>${cab}</summary><div class="hist-det">
    ${cambios.map((c) => `<div class="hist-c"><span class="hist-campo">${esc(rotulo(c.campo))}</span>
      <span class="ia-antes">${esc(valorCambio(c.antes)) || `<span class="gris">(${t('vacío')})</span>`}</span><span class="ia-ahora">${esc(valorCambio(c.despues)) || `<span class="gris">(${t('vacío')})</span>`}</span></div>`).join('')}
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
export async function histCargar(desdeCero) {
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
// historial de una pieza o de una ficha: se carga al abrir el desplegable
export const plegableHist = (objeto, id, tipo = '') => `<details class="plegable" data-historial="${objeto}:${esc(id)}" data-tipo="${esc(tipo || '')}"><summary>${t('Historial')}</summary>
  <div class="plegable-cuerpo"><p class="gris">${t('Cargando…')}</p></div></details>`;
export async function cargarHistDe(det) {
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
export const REG = {nivel: 'todo', q: '', datos: null};
const NIVELES_REG = {todo: 'Todo', avisos: 'Avisos y errores', errores: 'Solo errores'};
export function ajRegistro() {
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
export async function regCargar() {
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
  regCargar.t = repetirEn(5000, regCargar, h);
}
