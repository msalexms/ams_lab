// CircuitBin · lotes.js — correcciones de varias piezas a la vez y rótulos de los cambios.
import {$, D, FUNC, api, cabIA, cargar, comp, confirmar, esc, migas, piezasTxt, plural, repetirEn, t, toast} from './base.js';
import {contadores} from './app.js';
import {htmlLoteAltas} from './ia.js';

// ---- correcciones de varias piezas: todas en una pantalla; se aplica lo marcado de todas a la vez ----
export const LOTE = {id: null, desmarcados: new Set()};
// rótulos y valores que escribe el servidor en español (cambios de la IA, de formato y del historial): a la lengua de la web.
// Solo lo que pone la app («Pin GPIO4», «Dato de la pieza: Color», el nombre de la función de un pin); nunca tus datos
export const rotulo = (s) => {
  const x = String(s ?? '');
  const m = x.match(/^(Pin) (.+)$/) || x.match(/^(Dato del tipo|Dato de la pieza|Dato): (.+)$/);
  return m ? `${t(m[1])}${m[1] === 'Pin' ? ' ' : ': '}${m[2]}` : t(x);
};
const VALORES_APP = new Set(['Sin sitio', 'Sin tipo', 'muchas', 'sin contar']);
export const valorCambio = (v) => {
  const x = String(v ?? '');
  if (VALORES_APP.has(x)) return t(x);
  const fn = Object.fromEntries(D.funciones.map((f) => [f.nombre, FUNC[f.id]?.nombre || f.nombre])); // «Otros» → «Other»
  return x.split(' · ').map((p) => fn[p] ?? p).join(' · ');
};
export function filaCambio(c, extra = '') {
  return `<span class="nombre">${esc(rotulo(c.etiqueta))}${c.tipoCambio === 'nuevo' ? ` <span class="gris">${t('· nuevo')}</span>` : c.tipoCambio === 'quitado' ? ` <span class="gris">${t('· se quita')}</span>` : ''}</span>
    ${c.antes ? `<span class="ia-antes">${esc(valorCambio(c.antes))}</span>` : ''}
    ${c.despues ? `<span class="ia-ahora">${esc(valorCambio(c.despues))}</span>` : ''}${extra}`;
}
export function vLoteIA(id) {
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
    const cuerpo = tr.estado === 'error' ? `<p class="mal">${esc(t(tr.error || 'Error'))}</p>`
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
export function contarLote() {
  const g2 = $('#lote-guardar');
  if (g2) { const n = document.querySelectorAll('.lote-cambio:checked').length; g2.textContent = n ? t('Guardar {piezas}', {piezas: piezasTxt(n)}) : t('Marca alguna pieza'); g2.disabled = !n; return; }
  const b = $('#lote-aplicar');
  if (!b) return;
  const marcados = document.querySelectorAll('.lote-cambio:checked'), piezas = new Set([...marcados].map((x) => x.dataset.tarea)).size;
  b.textContent = marcados.length ? t('Aplicar {cambios} en {piezas}', {cambios: plural(marcados.length, 'cambio'), piezas: piezasTxt(piezas)}) : t('Marca algún cambio');
  b.disabled = !marcados.length;
}
export async function iaLote(id) {
  const zona = $('#lote-zona');
  if (!zona || zona.dataset.lote !== id) return;
  if (LOTE.id !== id) { LOTE.id = id; LOTE.desmarcados = new Set(); }
  let ts;
  try { ts = await api('GET', `api/ia/lotes/${encodeURIComponent(id)}`); } catch (err) { zona.innerHTML = `<p class="mal pad">${esc(err.message)}</p>`; return; }
  if (!ts.length) { zona.innerHTML = `<p class="gris pad">${t('Ese lote no existe.')}</p>`; return; }
  zona.innerHTML = htmlLote(ts);
  contarLote();
  if (ts.some((tr) => tr.estado === 'pendiente')) repetirEn(3000, () => iaLote(id));
}
export async function aplicarLote(boton) {
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
export async function descartarLote() {
  const ts = await api('GET', `api/ia/lotes/${encodeURIComponent(LOTE.id)}`);
  const quedan = ts.filter((tr) => tr.estado === 'propuesta' || tr.estado === 'error');
  const altas = ts[0]?.clase === 'alta';
  if (!quedan.length || !(await confirmar(altas ? t('¿Descartar las {piezas} que quedan sin guardar?\nNo se añaden al inventario.', {piezas: piezasTxt(quedan.length)})
    : t('¿Descartar las {n} correcciones que quedan?\nNo se cambia nada de tus piezas ni de sus fichas.', {n: quedan.length}), {si: 'Descartar', peligro: true}))) return;
  for (const tr of quedan) await api('POST', `api/ia/tareas/${tr.id}/descartar`).catch(() => {});
  await iaLote(LOTE.id);
  toast(t('Descartadas'));
}
