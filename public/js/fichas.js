// CircuitBin · fichas.js — búsqueda en todo, fichas de pieza y de tipo, selector de tipo, tablas editables, formulario de pieza, glosario y editor de fichas.
import {$, CATS, D, FUNC, api, app, byName, cabIA, campoFoto, cargar, catOf, comp, compText, conColor, esc, fotoUrl, g, guardarLocal, list, marcaCat, matches, migas, plural, proyectosDe, q, stock, stockText, t, toast, ubicaciones, ui, vacio, voltajeDe} from './base.js';
import {ICO, colorPin, dibujoDe, etqCat, etqPend, filaComp, opcionesTiposLista, tablaPines, tambien} from './piezas.js';
import {avisoIA, comas} from './ia.js';
import {contadores} from './app.js';
import {listaProyectos, textoProyecto} from './proyectos.js';
import {panelRevisar} from './revision.js';
import {plegableHist} from './actividad.js';
import {stepper, subirFoto} from './fotos.js';

// ---------- búsqueda en todo (piezas, tipos y proyectos) ----------
export function buscarTodo(query) {
  const piezas = D.componentes.filter((c) => matches(compText(c), query)).sort(byName);
  const tipos = Object.entries(D.tipos).map(([k, t]) => ({k, ...t})).filter((t) => !t.archivado && matches([t.k, t.nombre, t.resumen,
    CATS[t.categoria], ...list(t.alias), ...list(t.interfaz), ...list(t.pines).flat(), ...list(t.datos).flat()].join(' '), query)).sort(byName);
  const proyectos = D.proyectos.filter((p) => matches(textoProyecto(p), query));
  return {piezas, tipos, proyectos};
}
const filaTipo = (tp) => `<div class="fila"><a class="fila-main" href="#/g/${esc(tp.k)}"><span class="fila-img dibujo"${conColor(tp.categoria || 'otro')}><img src="${dibujoDe(tp.k)}" alt="" loading="lazy"></span><div><div class="nombre">${esc(tp.nombre)}${tp.revisado === 0 ? ` <span class="etq-pend">${t('sin comprobar')}</span>` : ''}</div>
  <div class="sub">${esc(tp.resumen || '')}</div></div></a>
  <div class="der"><div class="${stock(tp.k) ? '' : 'gris'}">${stock(tp.k) ? t('Tienes {n}', {n: stockText(tp.k)}) : t('No tienes')}</div><div class="sub">${esc(voltajeDe(tp))}</div></div></div>`;

export function vBuscar() {
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
export const menuMas = (items) => `<details class="mas"><summary class="btn" aria-label="${esc(t('Más acciones'))}">⋯</summary>
  <div class="mas-menu" role="menu">${items.filter(Boolean).join('')}</div></details>`;

// ---------- fichas de pieza y de tipo: dos columnas (mockup del 23/11/2026) ----------
// izquierda: la imagen grande y lo de esta pieza (o tus piezas del tipo); derecha: nombre, acciones, avisos, pines y ficha del tipo.
// En el móvil todo va en una columna: imagen, nombre, acciones, avisos, esta pieza, pines y ficha del tipo.
// cajetín de 2, 3 o 4 columnas: una celda que se queda sola en su fila se estira para no dejar huecos
export function cajetin(celdas, cols = 2) {
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
// caja «Esta pieza» (ficha, vista previa del alta y de una corrección): cantidad, sitio, tipo, categoría, sus datos y notas.
// cantidad y tipo llegan ya en HTML; «cab» y «antes» son lo que va junto al título y debajo de él (solo en la ficha real)
export const cajaEsta = ({cantidad, sitio, tipo, cat, datos, notas, cab = '', antes = ''}) => `<section class="caja fi-esta"><div class="fi-esta-cab"><h2 class="rotulo">${t('Esta pieza')}</h2>${cab}</div>
  ${antes}${cajetin([[t('Cantidad'), cantidad], [t('Sitio'), esc(sitio || t('Sin sitio'))], [t('Tipo'), tipo, true], [t('Categoría'), etqCat(cat)],
    ...(list(datos).length ? datos.map(([k, v]) => [esc(k), esc(v)]) : [[t('Datos propios'), '—']])])}
  ${notas ? `<div class="fi-notas"><h3 class="rotulo">${t('Notas')}</h3><p class="notas">${esc(notas)}</p></div>` : ''}</section>`;
export const cantidadTxt = (varios, n) => (varios ? `<span class="muchos">${t('muchos')}</span>` : `<span class="num">${esc(n === '' || n == null ? '?' : n)}</span>`);
export const imagenGrande = ({foto = '', tipo = '', cat, pie}) => `<figure class="fi-img${foto ? ' con-foto' : ''}"${conColor(cat)}>
  ${foto ? `<a class="fi-img-marco" href="${foto}" target="_blank" aria-label="${esc(t('Ver la foto grande'))}"><img src="${foto}" alt=""></a>`
    : `<span class="fi-img-marco"><img src="${dibujoDe(tipo)}" alt=""></span>`}
  <figcaption>${pie}</figcaption></figure>`;
export const notaOjo = (f) => (f.ojo ? `<div class="ams-aviso aviso-ojo"><b>${ICO.aviso}${t('Ojo')}</b><p>${esc(f.ojo)}</p></div>` : '');
// disposición fija de la ficha (opción B): la «Ficha del tipo» va siempre en la columna izquierda (bajo la foto y
// «Esta pieza»); los pines ocupan siempre todo el ancho de la derecha y «Proyectos que la usan» va en su propia caja
// debajo. En el móvil: foto, cabecera, acciones, avisos, esta pieza, pines, ficha del tipo y proyectos.
export function fichaDelTipo(f, tipo, ps, pie = '') {
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

export function vComponente(id) {
  const c = comp(id);
  if (!c) return vacio(t('No existe esa pieza.'));
  const f = g(c.tipo), conTipo = !!(c.tipo && D.tipos[c.tipo]), cat = catOf(c), ia = D.ia?.activa;
  const delTipo = conTipo ? D.componentes.filter((x) => x.tipo === c.tipo).length : 0;
  const ps = conTipo ? proyectosDe(c.tipo) : [];
  const ft = conTipo ? fichaDelTipo(f, c.tipo, ps, `${delTipo > 1 ? t('La comparten tus {n} piezas de este tipo', {n: delTipo}) : t('Común a todas las piezas de este tipo')} ·
    <a href="#/g/${esc(c.tipo)}/editar">${t('Editar la ficha del tipo')}</a>`) : {der: '', izq: ''};
  const esta = cajaEsta({cantidad: stepper(c, true), sitio: c.ubicacion, cat, datos: c.datos, notas: c.notas,
    tipo: conTipo ? `<a href="#/g/${esc(c.tipo)}">${esc(f.nombre)}</a>${f.archivado ? t(' (archivado)') : ''}` : t('Sin tipo'),
    cab: c.revisar ? `<button class="btn mini" id="quitar-pendiente" type="button">${t('Hecho: quitar «pendiente»')}</button>`
      : `<button class="btn mini" id="marcar-pendiente" type="button">${t('Marcar pendiente')}</button>`,
    antes: c.revisar ? `<p class="fi-pend">${t('La marcaste para mirar algo de ella más tarde.')}</p>` : ''});
  return `${migas([`<a href="#/" data-cat="">${t('Inventario')}</a>`, `<a href="#/" data-cat="${esc(cat)}">${esc(CATS[cat] || t('Otros'))}</a>`, `<span>${esc(c.nombre)}</span>`])}
    <article class="fi">
      <div class="fi-izq">
        ${imagenGrande({foto: c.foto ? fotoUrl(c) : '', tipo: conTipo ? c.tipo : '', cat,
          pie: `<span>${c.foto ? t('Foto de la pieza') : conTipo ? t('Dibujo del tipo · aún sin foto') : t('Aún sin foto')}</span>
            <label class="btn mini">${ICO.camara}${c.foto ? t('Cambiar foto') : t('Añadir foto')}<input type="file" accept="image/*" id="foto" hidden></label>`})}
        ${esta}
        ${ft.izq}
      </div>
      <div class="fi-der">
        <header class="fi-cab">${etqCat(cat, 'etq-cat')}<h1>${esc(c.nombre)} ${etqPend(c)}</h1>
          ${conTipo && f.resumen ? `<p class="fi-resumen">${esc(f.resumen)}</p>` : ''}</header>
        <div class="fi-acciones">
          <a class="btn${ia ? '' : ' prim'}" href="#/editar/${c.id}">${ICO.lapiz}${t('Editar')}</a>
          ${ia ? `<button class="btn prim" type="button" id="ia-abrir" aria-expanded="false">${ICO.chispa}${t('Corregir con IA')}</button>` : ''}
          ${menuMas([
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

export function vTipo(tipo) {
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
export function selectorTipo(sel, nuevo = t('Nuevo tipo…')) {
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
export function abrirCombo(combo) {
  opcionesCombo(combo);
  combo.querySelector('.combo-lista').hidden = false;
  combo.querySelector('.combo-q').setAttribute('aria-expanded', 'true');
}
export function cerrarCombo(combo) {
  const lista = combo.querySelector('.combo-lista');
  lista.hidden = true;
  combo.querySelector('.combo-q').setAttribute('aria-expanded', 'false');
  combo.querySelector('.combo-q').value = nombreSel(combo.querySelector('#tipo').value, combo.dataset.nuevo); // sin elegir: vuelve lo que había
}
export function elegirTipo(combo, valor) {
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
// asa para arrastrar la fila (seis puntos, dibujados: nada de emojis)
const ASA = '<svg viewBox="0 0 10 16" aria-hidden="true"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></svg>';
function filaEditor(nombre, valores = []) {
  return `<div class="ed-fila"><button type="button" class="ed-asa" aria-label="${esc(t('Mover la fila: arrástrala, o usa las flechas arriba y abajo'))}">${ASA}</button>${COLS[nombre].map((c, i) => c.funcion
    ? `<label class="ed-celda ed-fn" style="${colorPin(valores[i] || 'otro')}"><span class="ed-et">${t(c.t)}</span><i class="dot"></i>
        <select data-col="${i}">${Object.entries(FUNC).map(([k, f]) => `<option value="${esc(k)}" ${k === (valores[i] || 'otro') ? 'selected' : ''}>${esc(f.nombre)}</option>`).join('')}</select></label>`
    : c.tipos ? `<label class="ed-celda"><span class="ed-et">${t(c.t)}</span><select data-col="${i}" aria-label="${esc(t(c.t))}">${opcionesTiposLista(valores[i] || '').replace(t('Sin tipo'), t(c.tipos))}</select></label>`
    : c.num ? `<label class="ed-celda"><span class="ed-et">${t(c.t)}</span><input data-col="${i}" type="number" min="1" max="9999" inputmode="numeric" aria-label="${esc(t(c.t))}" value="${esc(valores[i] || 1)}"></label>`
    : c.check ? `<label class="ed-celda ed-check"><input data-col="${i}" type="checkbox" ${valores[i] ? 'checked' : ''}><span>${t(c.t)}</span></label>`
    : c.area ? `<label class="ed-celda"><span class="ed-et">${t(c.t)}</span><textarea data-col="${i}" rows="2" maxlength="${c.max}" placeholder="${esc(t(c.ph))}">${esc(valores[i] || '')}</textarea></label>`
    : `<label class="ed-celda"><span class="ed-et">${t(c.t)}</span><input data-col="${i}" class="${c.clase || ''}" maxlength="${c.max}" value="${esc(valores[i] || '')}" placeholder="${esc(t(c.ph))}"></label>`).join('')}
    <button type="button" class="btn mini peligro ed-quitar" data-ed-quitar aria-label="${esc(t('Quitar fila'))}">✕</button></div>`;
}
export function editorFilas(nombre, filas, {etiqueta, boton, ayuda = '', campo = nombre} = {}) {
  return `<fieldset class="ed ed-${nombre}" data-ed="${campo}" data-cols="${nombre}">
    <legend>${etiqueta}</legend>${ayuda ? `<p class="ayuda">${ayuda}</p>` : ''}
    <div class="ed-cab" aria-hidden="true"><span></span>${COLS[nombre].map((c) => `<span>${t(c.t)}</span>`).join('')}<span></span></div>
    <div class="ed-filas">${list(filas).map((f) => filaEditor(nombre, f)).join('')}</div>
    <button type="button" class="btn mini" data-ed-anadir>${boton}</button></fieldset>`;
}
export const leerEditor = (raiz, campo) => [...(raiz.querySelector(`[data-ed="${campo}"]`)?.querySelectorAll('.ed-fila') || [])]
  .map((f) => [...f.querySelectorAll('[data-col]')].map((x) => (x.type === 'checkbox' ? (x.checked ? '1' : '') : x.value.trim()))).filter((v) => v[0]);
// un pin por fila: si en el nombre hay varios («GPIO 16 · 17», «GPIO 32–39», «SDA, SCL»), el servidor devuelve la tabla
// con una fila por pin (misma regla que al guardar y que para la IA) y se repinta
const VARIOS_PINES = /[·,;]|\sy\s|\d\s*[–-]\s*\D*\d+$|^[a-zA-Z]\s*[–-]\s*[a-zA-Z]$/;
export async function separarEnEditor(input) {
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
export function clicEditor(t) {
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

export function vForm(id, tipoInicial = '') {
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

export async function guardarForm(form, id) {
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

export function vGlosario() {
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
export function vEditarTipo(tipo) {
  if (!D.tipos[tipo]) return vacio(t('Ese tipo no está en el glosario.'));
  return `${migas([`<a href="#/glosario">${t('Glosario')}</a>`, `<a href="#/g/${esc(tipo)}">${esc(D.tipos[tipo].nombre)}</a>`, `<span>${t('Editar ficha')}</span>`])}
    <div class="plano" id="ed-tipo" data-tipo="${esc(tipo)}"><p class="gris">${t('Cargando…')}</p></div>`;
}
export async function editarTipoCargar() {
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
export async function guardarFicha(form) {
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
