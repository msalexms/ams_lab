// CircuitBin · revision.js — «Corregir con IA»: cambios propuestos, vista previa y aplicar.
import {$, D, api, cabIA, campoFoto, cargar, comp, esc, fotoUrl, fotosDelCampo, list, may, norm, plural, proyectosDe, reducida, t, toast, ui} from './base.js';
import {avisoIA, costeTexto, dudasIA, etqConfianza, nombreModelo, tiraFotos} from './ia.js';
import {cajaEsta, cantidadTxt, fichaDelTipo, imagenGrande, notaOjo} from './fichas.js';
import {contadores} from './app.js';
import {etqCat} from './piezas.js';
import {filaCambio, rotulo} from './lotes.js';

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
export const fichaRevision = (tr) => (tr.objetivo?.componente_id ? `#/c/${tr.objetivo.componente_id}` : tr.objetivo?.tipo_id ? `#/g/${encodeURIComponent(tr.objetivo.tipo_id)}` : '#/ia');
export const desdePendientes = (tr) => ui.origenTarea?.hash === `#/ia/${tr.id}` && ui.origenTarea.desde === '#/pendientes';
export const volverRevision = (tr) => (tr.lote ? `#/ia/lote/${encodeURIComponent(tr.lote)}` : desdePendientes(tr) ? '#/pendientes' : fichaRevision(tr));
export const textoVolver = (tr) => t(tr.lote ? 'Volver al lote' : desdePendientes(tr) ? 'Volver a cambios pendientes' : 'Volver a la ficha');

// desplegable en la ficha (pieza o tipo): qué revisar y una foto, ambos opcionales
export function panelRevisar(objetivo, id, ayuda) {
  if (!D.ia?.activa) return '';
  return `<details class="ia-revisar"><summary class="btn">${t('Corregir con IA')}</summary>
    <form id="form-revisar" class="form sin-pad" autocomplete="off" data-objetivo="${objetivo}" data-id="${esc(id)}">
      <p class="ayuda">${esc(ayuda)} ${t('Te enseña solo lo que cambiaría y tú eliges qué aplicar.')}</p>
      <label>${t('Qué corregir (opcional)')}<textarea name="texto" rows="2" maxlength="1000" placeholder="${esc(t('Los pines están al revés · Añade el consumo'))}"></textarea></label>
      ${campoFoto(t('Fotos (opcional)'), t('Hasta 4. Sin ninguna, la IA mira la foto que ya tiene la pieza.'), {varias: 4})}
      <div class="acciones"><button class="btn prim" type="submit">${t('Pedir correcciones')}</button></div>
    </form></details>`;
}

export async function enviarRevision(form) {
  const fd = new FormData(form);
  const [foto = null, ...fotos] = await Promise.all(fotosDelCampo(form.querySelector('.archivo-input')).map(reducida));
  const tr = await api('POST', 'api/ia/revisar', {objetivo: form.dataset.objetivo, id: form.dataset.id, texto: fd.get('texto'), foto, fotos});
  location.hash = `#/ia/${tr.id}`;
}

// vista previa de una corrección: la ficha tal como quedaría con SOLO los cambios marcados, aplicados aquí (sin guardar
// nada) con la misma regla que el servidor (server/revision.mjs → aplicarCambios): pines y datos emparejados por su nombre
export const claveTxt = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
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
    ? cajaEsta({cantidad: cantidadTxt(pc.varios, pc.cantidad), sitio: pc.ubicacion, cat, datos: pieza.datos_pieza, notas: pieza.notas,
      tipo: tipo ? esc(tipo.nombre) : t('Sin tipo')})
    : '';
  const barra = `<div class="caja previa-barra"><span class="ams-etiqueta ams-etiqueta--amarilla">${t('Vista previa')}</span>
    <div class="previa-txt"><p>${marcados.length === 1
      ? t('Así quedaría con el cambio marcado. Aún no se ha guardado nada.')
      : marcados.length
        ? t('Así quedaría con los {n} cambios marcados. Aún no se ha guardado nada.', {n: marcados.length})
        : t('No hay ningún cambio marcado: la ficha se quedaría como está.')}</p>
      ${marcados.length ? `<p class="sub">${t('Cambia: {lista}', {lista: marcados.map((c) => esc(rotulo(c.etiqueta))).join(' · ')})}</p>` : ''}</div>
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
export function verVistaRevision(vista, tr) {
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
export let REVISION = null; // la corrección que está en pantalla (para la vista previa)

export function vistaCambios(tr) {
  REVISION = tr;
  const p = tr.propuesta, volver = volverRevision(tr), tipoId = p.objetivo?.tipo_id;
  const piezasTipo = tipoId ? D.componentes.filter((c) => c.tipo === tipoId).length : 0;
  const fila = (c) => `<label class="ia-cambio-fila"><input type="checkbox" class="ia-cambio" value="${esc(c.id)}" checked><span>${filaCambio(c)}</span></label>`;
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

export function contarCambios() {
  const b = $('#ia-aplicar-cambios');
  if (!b) return;
  const n = document.querySelectorAll('.ia-cambio:checked').length;
  b.textContent = n ? t('Aplicar {cambios}', {cambios: plural(n, 'cambio')}) : t('Marca algún cambio');
  b.disabled = !n;
}

export async function aplicarRevisionIA(boton) {
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
