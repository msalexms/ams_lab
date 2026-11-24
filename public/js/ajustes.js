// CircuitBin · ajustes.js — Ajustes: menú, categorías, tipos, sitios, uniformar formato, datos y copias.
import {$, CATS, D, api, aplicarIdioma, aplicarTema, cabIA, cargar, conColor, confirmar, esc, marcaCat, migas, norm, plural, t, tamano, toast, ubicaciones, ui, vacio} from './base.js';
import {CUENTA_PEND, ajRegistro, histCargar, regCargar} from './actividad.js';
import {RAZONAR, nombreModelo, olvidarModelosIA} from './ia.js';
import {cajetin} from './fichas.js';
import {contadores, route} from './app.js';
import {etqCat} from './piezas.js';
import {filaCambio} from './lotes.js';

const SECCIONES = {ia: 'IA', categorias: 'Categorías', tipos: 'Tipos', sitios: 'Sitios', formato: 'Uniformar formato', datos: 'Datos y copias', historial: 'Historial', registro: 'Registro'};

// ---------- Ajustes: IA, catálogo, aspecto, datos e historial ----------
export function vAjustes(sec) {
  if (sec && SECCIONES[sec]) {
    const id = sec === 'ia' ? 'ia-ajustes' : 'aj-zona';
    return `${migas([`<a href="#/ajustes">${t('Ajustes')}</a>`, `<span>${esc(t(SECCIONES[sec]))}</span>`])}<div class="plano" id="${id}" data-sec="${sec}"><p class="gris">${t('Cargando…')}</p></div>`;
  }
  const tipos = Object.values(D.tipos), archivados = tipos.filter((tp) => tp.archivado).length;
  const fila = (href, nombre, sub) => `<div class="fila"><a class="fila-main" href="${href}"><div><div class="nombre">${nombre}</div>
    <div class="sub">${sub}</div></div></a><span class="gris">→</span></div>`;
  const grupo = (titulo, filas) => `<section class="grupo"><h3 class="grupo-t">${titulo}</h3>${filas.join('')}</section>`;
  const pend = CUENTA_PEND?.grupos ? `<span class="etq-pend">${t('{n} sin revisar', {n: CUENTA_PEND.grupos})}</span> ` : '';
  const razNom = t((RAZONAR[D.ajustes.ia_razonar] || RAZONAR.poco).nombre).toLowerCase();
  const archTxt = archivados ? ` · ${plural(archivados, 'archivado')}` : '';
  return `<div class="plano aj-menu">
      ${cabIA(t('Ajustes'), t('Lo que cambies aquí se ve al momento en el inventario y el glosario.'))}
      ${grupo(t('IA'), [
        fila('#/ajustes/ia', t('Modelo y clave'), D.ia?.activa ? `${t('Conectada')} · ${esc(nombreModelo(D.ia.modelo))} · ${t('razona {nivel}', {nivel: esc(razNom)})} · ${t('clave')} ${esc(D.ia.clave)}` : `<span class="mal">${t('Sin clave')}</span>`),
        fila('#/pendientes', t('Cambios pendientes'), `${pend}${t('correcciones y piezas nuevas que dejaste a medias')}`)])}
      ${grupo(t('Catálogo'), [
        fila('#/ajustes/categorias', t('Categorías'), `${plural(D.categorias.length, 'categoría')} · ${t('renombrar, ordenar, añadir, borrar')}`),
        fila('#/ajustes/tipos', t('Tipos'), `${plural(tipos.length - archivados, 'tipo')}${archTxt} · ${t('archivar, fusionar, borrar')}`),
        fila('#/ajustes/sitios', t('Sitios'), `${plural(ubicaciones().length, 'sitio')} · ${t('renombrar, juntar, borrar')}`),
        fila('#/ajustes/formato', t('Uniformar formato'), t('Que todo esté escrito igual: «3,3 V», «I2C», «Corriente máx.»'))])}
      ${grupo(t('Aspecto'), [
        `<div class="fila"><div class="fila-main"><div><div class="nombre">${t('Tema')}</div><div class="sub">${t('Claro de día, grafito de noche o según el sistema')}</div></div></div>
          <div class="seg" role="group" aria-label="${esc(t('Tema'))}">${Object.entries({auto: 'Automático', claro: 'Claro', noche: 'Noche'}).map(([k, v]) =>
            `<button type="button" class="${(D.ajustes.tema || 'auto') === k ? 'on' : ''}" data-poner-tema="${k}" aria-pressed="${(D.ajustes.tema || 'auto') === k}">${t(v)}</button>`).join('')}</div></div>`,
        `<div class="fila"><div class="fila-main"><div><div class="nombre">${t('Idioma')}</div><div class="sub">${t('Interfaz y respuestas de la IA')}</div></div></div>
          <div class="seg" role="group" aria-label="${esc(t('Idioma'))}">${Object.entries({en: 'English', es: 'Español'}).map(([k, v]) =>
            `<button type="button" class="${(D.ajustes.idioma || 'en') === k ? 'on' : ''}" data-poner-idioma="${k}" aria-pressed="${(D.ajustes.idioma || 'en') === k}">${v}</button>`).join('')}</div></div>`])}
      ${grupo(t('Datos y actividad'), [
        fila('#/ajustes/datos', t('Copias de seguridad'), t('Hacer una copia, descargarla, restaurar y exportar')),
        fila('#/ajustes/historial', t('Historial'), t('Quién cambió qué y cuándo: tú, la IA (con su modelo) o el sistema')),
        fila('#/ajustes/registro', t('Registro'), t('Mensajes del servidor: arranque, copias, IA y errores'))])}
    </div>`;
}

// carga y pinta el apartado abierto (los datos vienen siempre del servidor: lo que se ve es lo que hay)
export async function ajCargar() {
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
export async function ajRefrescar(msg) {
  await cargar();
  contadores();
  await ajCargar();
  if (msg) toast(msg);
}

function ajCategorias(cats) {
  return `${cabIA(t('Categorías'), t('Cámbiales el nombre escribiendo encima, ordénalas con las flechas o bórralas. «Otros» no se borra: es donde va lo que no tiene sitio.'))}
    <section class="caja bloque-caja"><div class="aj-lista">${cats.map((c, i) => `
      <div class="aj-fila aj-cat" data-cat-fila="${esc(c.id)}"${conColor(c.id)}>
        <span class="aj-cat-nom">${marcaCat}<input class="aj-nombre" data-cat-nombre="${esc(c.id)}" value="${esc(c.nombre)}" maxlength="60" aria-label="${esc(t('Nombre de la categoría'))}"></span>
        <span class="sub">${plural(c.tipos, 'tipo')}</span>
        <span class="aj-botones">
          <button class="btn mini" data-cat-mover="${esc(c.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('Subir {nombre}', {nombre: c.nombre}))}">↑</button>
          <button class="btn mini" data-cat-mover="${esc(c.id)}" data-dir="1" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="${esc(t('Bajar {nombre}', {nombre: c.nombre}))}">↓</button>
          <button class="btn mini peligro" data-cat-borrar="${esc(c.id)}" data-tipos="${c.tipos}" ${c.id === 'otro' ? `disabled title="${esc(t('Es la categoría de reserva'))}"` : ''}>${t('Borrar')}</button>
        </span>
        <div class="aj-panel" hidden></div>
      </div>`).join('')}</div></section>
    <form id="aj-cat-nueva" class="form caja" autocomplete="off">
      <label>${t('Nueva categoría')}<input name="nombre" maxlength="60" required placeholder="${esc(t('Relés y potencia'))}"></label>
      <div class="acciones"><button class="btn prim" type="submit">${t('Añadir')}</button></div>
    </form>`;
}

const ORIGEN_TXT = {seed: 'catálogo base', ia: 'IA', usuario: 'tuyo'};
function ajTipos(tipos) {
  const f = ui.ajTipos || 'todos', query = norm(ui.ajBuscar || '');
  const filtros = {
    todos: ['Todos', (tp) => !tp.archivado], sin: ['Sin comprobar', (tp) => !tp.archivado && tp.revisado === 0],
    ia: ['De la IA', (tp) => !tp.archivado && tp.origen === 'ia'], vacios: ['Sin piezas', (tp) => !tp.archivado && !tp.piezas],
    archivados: ['Archivados', (tp) => tp.archivado === 1],
  };
  const lista = tipos.filter(filtros[f][1]).filter((tp) => !query || norm(`${tp.nombre} ${tp.id}`).includes(query));
  const destinos = (sin) => Object.keys(CATS).map((cat) => {
    const ts = tipos.filter((tp) => !tp.archivado && tp.categoria === cat && tp.id !== sin);
    return ts.length ? `<optgroup label="${esc(CATS[cat])}">${ts.map((tp) => `<option value="${esc(tp.id)}">${esc(tp.nombre)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  return `${cabIA(t('Tipos'), t('Archivar lo oculta sin borrar nada. Fusionar pasa las piezas y los proyectos a otro tipo. Borrar solo se puede si nada lo usa.'))}
    <div class="filtros"><div class="cats">${Object.entries(filtros).map(([k, [nombre, fn]]) =>
      `<button class="f ${f === k ? 'on' : ''}" data-aj-tipos="${k}">${t(nombre)}<span class="n">${tipos.filter(fn).length}</span></button>`).join('')}</div>
      <input id="aj-buscar" class="aj-buscar" type="search" placeholder="${esc(t('Buscar tipo'))}" value="${esc(ui.ajBuscar || '')}" autocomplete="off"></div>
    ${lista.length ? `<section class="caja bloque-caja"><div class="aj-lista">${lista.map((tp) => {
      const usos = [tp.piezas ? plural(tp.piezas, 'pieza') : '', tp.proyectos ? plural(tp.proyectos, 'proyecto') : ''].filter(Boolean).join(' · ');
      return `<div class="aj-fila aj-tipo" data-tipo="${esc(tp.id)}">
        <div><a class="nombre" href="#/g/${esc(tp.id)}">${esc(tp.nombre)}</a>${tp.revisado === 0 ? ` <span class="etq-pend">${t('sin comprobar')}</span>` : ''}
          <div class="sub">${etqCat(tp.categoria || 'otro')} · ${usos || t('sin uso')} · ${esc(t(ORIGEN_TXT[tp.origen] || tp.origen))}</div></div>
        <span class="aj-botones">
          <button class="btn mini" data-tipo-archivar="${esc(tp.id)}" data-v="${tp.archivado ? 0 : 1}">${tp.archivado ? t('Recuperar') : t('Archivar')}</button>
          ${tp.archivado ? '' : `<button class="btn mini" data-tipo-fusionar="${esc(tp.id)}">${t('Fusionar…')}</button>`}
          <button class="btn mini peligro" data-tipo-borrar="${esc(tp.id)}" ${usos ? `disabled title="${esc(t('No se puede borrar: lo usan {usos}. Archívalo o fusiónalo con otro.', {usos}))}"` : ''}>${t('Borrar')}</button>
        </span>
        <div class="aj-panel" hidden>${tp.archivado ? '' : `<label>${t('Sus piezas y proyectos pasan a')}
          <select data-fusion-destino="${esc(tp.id)}"><option value="">${t('Elige el tipo que se queda…')}</option>${destinos(tp.id)}</select></label>
          <div class="acciones"><button class="btn prim mini" data-tipo-fusionar-ok="${esc(tp.id)}">${t('Fusionar')}</button>
          <button class="btn mini" data-aj-cerrar>${t('Cancelar')}</button></div>`}</div>
      </div>`;
    }).join('')}</div></section>` : vacio(t('Nada en este filtro.'))}`;
}

// Uniformar formato: lo que cambiaría en las fichas y en los datos de las piezas para que todo esté escrito igual
function ajFormato(r) {
  const grupos = new Map();
  for (const c of r.cambios) { const k = `${c.objeto}:${c.objeto_id}`; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(c); }
  const enlace = (c) => (c.objeto === 'tipo' ? `#/g/${encodeURIComponent(c.objeto_id)}` : `#/c/${esc(c.objeto_id)}`);
  return `${cabIA(t('Uniformar formato'), t('La app escribe siempre igual las tensiones y las unidades («3,3 V», «20 mA»), las interfaces («I2C») y los nombres de los datos («Corriente máx.»). Aquí sale lo que ya está guardado de otra manera: marca lo que quieras dejar igual que el resto. Solo cambia cómo está escrito, no lo que dice, y no gasta consultas de la IA.'))}
    ${r.cambios.length ? [...grupos.values()].map((cs) => `<section class="caja bloque-caja formato-grupo">
      <p class="lote-t"><a class="nombre" href="${enlace(cs[0])}">${esc(cs[0].nombre)}</a><span class="ams-etiqueta">${cs[0].objeto === 'tipo' ? t('ficha') : t('pieza')}</span></p>
      ${cs.map((c) => `<label class="ia-cambio-fila"><input type="checkbox" class="formato-cambio" value="${esc(c.id)}" checked><span>${filaCambio(c)}</span></label>`).join('')}</section>`).join('')
      + `<div class="acciones lote-acciones">
        <button class="btn prim" type="button" id="formato-aplicar">${t('Aplicar lo marcado')}</button>
        <button class="btn" type="button" data-formato-marcar="todo">${t('Marcar todo')}</button>
        <button class="btn" type="button" data-formato-marcar="nada">${t('Ninguno')}</button></div>`
      : `<div class="caja bloque-caja"><p>${t('Todo está ya escrito con el mismo formato.')}</p></div>`}
    ${r.interfaces.length ? `<section class="caja bloque-caja"><h3 class="grupo-t">${t('Interfaces en uso')}<span class="n">${r.interfaces.length}</span></h3>
      <p class="sub">${t('La app no puede saber si dos nombres distintos son la misma cosa («Analógica» y «1 pin analógico»). Si ves dos que lo son, edita la ficha y deja uno: la IA usará el que quede.')}</p>
      <p class="formato-lista">${r.interfaces.map((x) => `<span class="ams-etiqueta">${esc(x.nombre)} <span class="gris">×${x.n}</span></span>`).join('')}</p></section>` : ''}`;
}
export function contarFormato() {
  const b = $('#formato-aplicar');
  if (!b) return;
  const n = document.querySelectorAll('.formato-cambio:checked').length;
  b.textContent = n ? t('Aplicar {cambios}', {cambios: plural(n, 'cambio')}) : t('Marca algún cambio');
  b.disabled = !n;
}
export async function aplicarFormato(boton) {
  const ids = [...document.querySelectorAll('.formato-cambio:checked')].map((x) => x.value);
  boton.disabled = true;
  boton.textContent = t('Aplicando…');
  const r = await api('POST', 'api/ajustes/formato', {ids});
  await cargar(); contadores();
  $('#aj-zona').innerHTML = ajFormato(r);
  contarFormato();
  toast(t('{cambios} de formato aplicados', {cambios: plural(r.aplicados, 'cambio')}));
}

function ajSitios(sitios) {
  return `${cabIA(t('Sitios'), t('Donde guardas las piezas. Si renombras uno con el nombre de otro, se juntan. Al borrar uno, sus piezas se quedan «sin sitio».'))}
    ${sitios.length ? `<section class="caja bloque-caja"><div class="aj-lista">${sitios.map((s) => `
      <div class="aj-fila">
        <input class="aj-nombre" data-sitio-nombre="${s.id}" value="${esc(s.nombre)}" maxlength="120" aria-label="${esc(t('Nombre del sitio'))}">
        <span class="sub">${plural(s.piezas, 'pieza')}</span>
        <span class="aj-botones"><button class="btn mini peligro" data-sitio-borrar="${s.id}" data-piezas="${s.piezas}" data-nombre="${esc(s.nombre)}">${t('Borrar')}</button></span>
      </div>`).join('')}</div></section>` : vacio(t('Aún no hay sitios: se crean al poner «Sitio» en una pieza.'))}`;
}

const fechaLarga = (iso) => (iso ? new Date(iso).toLocaleString(I18N.loc(), {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'}) : '');
// copias de cada día, manuales y las que se hacen solas antes de migrar o de restaurar
const claseCopia = (n) => t(n.startsWith('lab-antes-restaurar') ? 'antes de restaurar' : n.startsWith('lab-antes-') ? 'antes de una migración'
  : /^lab-\d{4}-\d{2}-\d{2}\.db$/.test(n) ? 'diaria' : 'manual');

function ajDatos(r) {
  const u = r.copias.ultima;
  const archTxt = r.archivados ? ` (+${plural(r.archivados, 'archivado')})` : '';
  return `${cabIA(t('Datos y copias'), t('Copias de seguridad: descárgalas para guardarlas fuera del servidor y restáuralas si algo sale mal.'))}
    <div class="caja pro-resumen">${cajetin([[t('Piezas'), r.piezas], [t('Fotos'), r.fotos], [t('Tipos'), `${r.tipos}${archTxt}`], [t('Categorías'), r.categorias],
      [t('Sitios'), r.sitios], [t('Proyectos'), r.proyectos], [t('Versión de los datos'), `v${r.version}`]], 4)}</div>
    <section class="caja bloque-caja ia-bloque">
      <h3>${t('Exportar')}</h3>
      <p class="ayuda">${t('Un solo archivo .tar.gz con la base de datos y las {n} fotos. Sirve para restaurarlo aquí o en otro servidor. Incluye la clave de la IA: guárdalo en un sitio seguro.', {n: r.fotos})}</p>
      <div class="acciones"><a class="btn prim" href="api/copia/exportar" download>${t('Descargar copia completa')}</a>
        <a class="btn" href="api/exportar" download>${t('Datos en JSON (solo lectura)')}</a></div>
    </section>
    <section class="caja bloque-caja ia-bloque" id="aj-importar-zona">
      <h3>${t('Restaurar desde un archivo')}</h3>
      <p class="ayuda">${t('El .tar.gz que exporta la app, o un .db suelto (una copia diaria). Primero se comprueba y te enseña qué contiene; no cambia nada hasta que confirmes.')}</p>
      <div class="acciones"><label class="btn">${t('Elegir archivo…')}<input type="file" id="aj-importar" accept=".gz,.tgz,.tar.gz,.db,application/gzip,application/x-gzip" hidden></label></div>
      <p class="ayuda" id="aj-importar-estado" role="status"></p>
      <div id="aj-restaurar"></div>
    </section>
    <section class="caja bloque-caja ia-bloque">
      <h3>${t('Copias en el servidor')}</h3>
      <p class="ayuda">${t('Se hace una al día sola y se guardan {max} diarias ({guardadas} copias ahora, contando las especiales).', {max: r.copias.maximo, guardadas: r.copias.guardadas})}
        ${u ? t('Última: {fecha}.', {fecha: esc(fechaLarga(u.fecha))}) : `<span class="mal">${t('Aún no hay ninguna.')}</span>`} ${t('Carpeta:')} <span class="mono">${esc(r.copias.carpeta)}</span></p>
      <div class="acciones"><button class="btn" type="button" id="aj-copia">${t('Hacer copia ahora')}</button></div>
      ${r.copias.lista.length ? `<table class="t copias"><thead><tr><th>${t('Fecha')}</th><th>${t('Clase')}</th><th class="der">${t('Tamaño')}</th><th></th></tr></thead><tbody>
        ${r.copias.lista.map((c) => `<tr><td class="num">${esc(fechaLarga(c.fecha))}</td><td class="gris">${esc(claseCopia(c.nombre))}</td>
          <td class="der num">${tamano(c.bytes)}</td><td class="der"><span class="aj-botones">
            <a class="btn mini" href="api/copias/${encodeURIComponent(c.nombre)}" download>${t('Descargar')}</a>
            <button class="btn mini" type="button" data-copia-preparar="${esc(c.nombre)}">${t('Restaurar…')}</button></span></td></tr>`).join('')}</tbody></table>
        <p class="ayuda">${t('Las copias del servidor solo llevan la base de datos: las fotos están en su carpeta de copias y no se borran nunca.')}</p>` : ''}
    </section>`;
}

// lo que se va a restaurar frente a lo que hay ahora; nada cambia hasta pulsar «Restaurar»
function panelRestaurar(r) {
  const fila = (k, a, b) => `<tr><td class="gris">${k}</td><td class="der num">${esc(a)}</td><td class="der num">${esc(b)}</td></tr>`;
  const de = {archivo: t('el archivo subido'), base: t('la base de datos subida'), copia: t('la copia del servidor {nombre}', {nombre: r.copia || ''})}[r.origen] || t('la copia');
  return `<div class="restaurar aparece">
    <h3>${t('Restaurar {origen}', {origen: esc(de)})}</h3>
    <table class="t"><thead><tr><th></th><th class="der">${t('Ahora')}</th><th class="der">${t('Copia')}</th></tr></thead><tbody>
      ${fila(t('Piezas'), r.actual.piezas, r.piezas)}${fila(t('Tipos'), r.actual.tipos + r.actual.archivados, r.tipos)}${fila(t('Proyectos'), r.actual.proyectos, r.proyectos)}
      ${fila(t('Fotos'), r.actual.fotos, r.origen === 'archivo' ? t('{n} en el archivo', {n: r.fotos}) : t('las de ahora'))}
      ${fila(t('Versión de los datos'), `v${r.actual.version}`, `v${r.version}${r.version < r.actual.version ? t(' (se actualiza al restaurar)') : ''}`)}
      ${r.exportado ? fila(t('Fecha'), '—', fechaLarga(r.exportado)) : ''}</tbody></table>
    <p class="nota nota-peligro">${t('Se sustituye todo lo de ahora: inventario, glosario, proyectos, ajustes y la clave de la IA. Antes se guarda una copia del estado actual en el servidor («antes de restaurar»), así que se puede volver atrás. Las fotos no se borran.')}</p>
    <div class="acciones"><button class="btn prim peligro-prim" type="button" data-restaurar="${esc(r.token)}">${t('Restaurar')}</button>
      <button class="btn" type="button" data-restaurar-cancelar>${t('Cancelar')}</button></div></div>`;
}

// subida con progreso (XMLHttpRequest: fetch no da el progreso de subida)
export function subirCopia(file) {
  const estado = $('#aj-importar-estado'), zona = $('#aj-restaurar');
  zona.innerHTML = '';
  estado.className = 'ayuda';
  estado.textContent = t('Subiendo {nombre} ({tam})…', {nombre: file.name, tam: tamano(file.size)});
  const x = new XMLHttpRequest();
  x.open('POST', 'api/copia/preparar');
  x.setRequestHeader('content-type', 'application/octet-stream');
  x.upload.onprogress = (e) => { if (e.lengthComputable) estado.textContent = t('Subiendo {nombre}: {pct} %', {nombre: file.name, pct: Math.round((e.loaded / e.total) * 100)}); };
  x.upload.onload = () => { estado.textContent = t('Comprobando el archivo…'); };
  x.onerror = () => { estado.className = 'mal'; estado.textContent = t('Sin conexión con el servidor: no se ha subido'); };
  x.onload = () => {
    let r = {};
    try { r = JSON.parse(x.responseText); } catch {}
    if (x.status !== 200) { estado.className = 'mal'; estado.textContent = r.error ? t(r.error) : `Error ${x.status}`; return; }
    estado.textContent = t('Archivo comprobado: está bien. Mira lo que contiene antes de restaurar.');
    zona.innerHTML = panelRestaurar(r);
    zona.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  };
  x.send(file);
}

async function restaurarCopia(boton) {
  if (!(await confirmar(t('¿Restaurar esta copia?\nSe sustituye todo lo de ahora. Antes se guarda una copia del estado actual en el servidor.'), {si: t('Restaurar'), peligro: true}))) return;
  boton.disabled = true;
  boton.textContent = t('Restaurando…');
  try {
    const r = await api('POST', 'api/copia/restaurar', {token: boton.dataset.restaurar});
    olvidarModelosIA();
    await cargar();
    aplicarTema();
    contadores();
    location.hash = '#/ajustes/datos';
    await ajCargar();
    toast(`${t('Restaurada:')} ${plural(r.piezas, 'pieza')}${r.fotos ? ` ${t('y {fotos} nuevas', {fotos: plural(r.fotos, 'foto')})}` : ''}`);
  } catch (err) { boton.disabled = false; boton.textContent = t('Restaurar'); toast(err.message, true); }
}

// los botones de Ajustes que atiende clicAjustes (los recoge el gestor de clics de app.js)
export const CLICS_AJUSTES = ['poner-tema', 'poner-idioma', 'aj-cerrar', 'aj-tipos', 'copia-preparar', 'restaurar', 'restaurar-cancelar', 'cat-mover', 'cat-borrar',
  'cat-borrar-ok', 'tipo-archivar', 'tipo-fusionar', 'tipo-fusionar-ok', 'tipo-borrar', 'sitio-borrar'].map((d) => `[data-${d}]`).concat('#aj-copia').join(', ');
export async function clicAjustes(el) {
  const d = el.dataset, fila = el.closest('.aj-fila'), panel = fila?.querySelector('.aj-panel');
  if (d.ponerTema) { await api('PUT', 'api/ajustes/tema', {valor: d.ponerTema}); D.ajustes.tema = d.ponerTema; aplicarTema(); route(); return true; }
  if (d.ponerIdioma) { await api('PUT', 'api/ajustes/idioma', {valor: d.ponerIdioma}); D.ajustes.idioma = d.ponerIdioma; aplicarIdioma(); aplicarTema(); contadores(); route(); return true; }
  if ('ajCerrar' in d) { el.closest('.aj-panel').hidden = true; return true; }
  if (d.ajTipos) { ui.ajTipos = d.ajTipos; await ajCargar(); return true; }
  if (el.id === 'aj-copia') { el.disabled = true; const r = await api('POST', 'api/copias'); await ajCargar(); toast(t('Copia hecha: {nombre}', {nombre: r.nombre})); return true; }
  if (d.copiaPreparar) {
    el.disabled = true;
    try {
      const r = await api('POST', `api/copias/${encodeURIComponent(d.copiaPreparar)}/preparar`);
      const zona = $('#aj-restaurar');
      zona.innerHTML = panelRestaurar(r);
      $('#aj-importar-estado').textContent = '';
      zona.closest('section').scrollIntoView({block: 'start', behavior: 'smooth'});
    } finally { el.disabled = false; }
    return true;
  }
  if (d.restaurar) { await restaurarCopia(el); return true; }
  if ('restaurarCancelar' in d) {
    await api('DELETE', 'api/copia/preparada').catch(() => {});
    $('#aj-restaurar').innerHTML = '';
    $('#aj-importar-estado').textContent = t('Cancelado: no se ha cambiado nada.');
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
      if (!(await confirmar(t('¿Borrar la categoría «{nombre}»?', {nombre}), {si: t('Borrar'), peligro: true}))) return true;
      await api('DELETE', `api/categorias/${d.catBorrar}`);
      await ajRefrescar(t('Categoría «{nombre}» borrada', {nombre}));
      return true;
    }
    panel.innerHTML = `<label>${n === 1 ? t('Su tipo pasa a') : t('Sus {n} tipos pasan a', {n})}
        <select data-cat-destino>${D.categorias.filter((c) => c.id !== d.catBorrar).map((c) => `<option value="${esc(c.id)}" ${c.id === 'otro' ? 'selected' : ''}>${esc(I18N.cat(c.id, c.nombre))}</option>`).join('')}</select></label>
      <div class="acciones"><button class="btn prim mini peligro" data-cat-borrar-ok="${esc(d.catBorrar)}">${t('Mover y borrar «{nombre}»', {nombre: esc(nombre)})}</button>
        <button class="btn mini" data-aj-cerrar>${t('Cancelar')}</button></div>`;
    panel.hidden = false;
    return true;
  }
  if (d.catBorrarOk) {
    const destino = panel.querySelector('[data-cat-destino]').value;
    const r = await api('DELETE', `api/categorias/${d.catBorrarOk}?destino=${encodeURIComponent(destino)}`);
    await ajRefrescar(t('Borrada; {tipos} a «{destino}»', {tipos: plural(r.movidos, 'tipo'), destino: CATS[destino] || destino}));
    return true;
  }
  if (d.tipoArchivar) {
    const archivar = d.v === '1';
    await api('PATCH', `api/tipos/${d.tipoArchivar}`, {archivado: archivar});
    if ($('#aj-zona')) await ajRefrescar(archivar ? t('Archivado: ya no sale en el glosario') : t('Recuperado'));
    else { await cargar(); contadores(); route(); toast(archivar ? t('Archivado') : t('Recuperado')); }
    return true;
  }
  if (d.tipoFusionar) { panel.hidden = !panel.hidden; return true; }
  if (d.tipoFusionarOk) {
    const destino = panel.querySelector('[data-fusion-destino]').value;
    if (!destino) { toast(t('Elige el tipo que se queda'), true); return true; }
    const a = D.tipos[d.tipoFusionarOk]?.nombre, b = D.tipos[destino]?.nombre;
    if (!(await confirmar(t('¿Fusionar «{a}» en «{b}»?\nSus piezas y proyectos pasan a «{b}» y «{a}» desaparece. No se puede deshacer.', {a, b}), {si: t('Fusionar'), peligro: true}))) return true;
    const r = await api('POST', `api/tipos/${d.tipoFusionarOk}/fusionar`, {destino});
    await ajRefrescar(t('Fusionado: {piezas} pasan a «{b}»', {piezas: plural(r.piezas, 'pieza'), b}));
    return true;
  }
  if (d.tipoBorrar) {
    const nombre = D.tipos[d.tipoBorrar]?.nombre;
    if (!(await confirmar(t('¿Borrar el tipo «{nombre}»?\nNo se puede deshacer.', {nombre}), {si: t('Borrar'), peligro: true}))) return true;
    await api('DELETE', `api/tipos/${d.tipoBorrar}`);
    await ajRefrescar(t('Tipo «{nombre}» borrado', {nombre}));
    return true;
  }
  if (d.sitioBorrar) {
    const n = Number(d.piezas);
    if (!(await confirmar(n ? t('¿Borrar el sitio «{nombre}»?\nSus {piezas} se quedan sin sitio.', {nombre: d.nombre, piezas: plural(n, 'pieza')}) : t('¿Borrar el sitio «{nombre}»?', {nombre: d.nombre}), {si: t('Borrar'), peligro: true}))) return true;
    await api('DELETE', `api/ubicaciones/${d.sitioBorrar}`);
    await ajRefrescar(t('Sitio borrado'));
    return true;
  }
  return false;
}

// renombrar categoría o sitio al salir del campo; si el sitio ya existe, se juntan (preguntando antes)
export async function cambioAjustes(input) {
  const nuevo = input.value.trim();
  if (!nuevo || nuevo === input.defaultValue) { input.value = input.defaultValue; return; }
  try {
    if (input.dataset.catNombre) {
      await api('PATCH', `api/categorias/${input.dataset.catNombre}`, {nombre: nuevo});
      await ajRefrescar(t('Guardado'));
    } else {
      const otro = [...document.querySelectorAll('[data-sitio-nombre]')].find((x) => x !== input && x.defaultValue.toLowerCase() === nuevo.toLowerCase());
      if (otro && !(await confirmar(t('¿Juntar con «{nombre}»?\nYa hay un sitio con ese nombre: las piezas de este pasan a ese.', {nombre: otro.defaultValue}), {si: t('Juntar')}))) { input.value = input.defaultValue; return; }
      const r = await api('PATCH', `api/ubicaciones/${input.dataset.sitioNombre}`, {nombre: nuevo});
      await ajRefrescar(r.fusionado ? t('Juntados: {piezas} en «{nombre}»', {piezas: plural(r.piezas, 'pieza'), nombre: r.nombre}) : t('Guardado'));
    }
  } catch (err) { input.value = input.defaultValue; toast(err.message, true); }
}
