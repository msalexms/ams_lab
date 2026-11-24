// CircuitBin — inventario, glosario y proyectos. Habla con la API del servidor (server/index.mjs).
// app.js es la entrada (index.html la carga como módulo): router, eventos, botón «+» del móvil, modo sin conexión y
// arranque. Las vistas están en los demás módulos de public/js/; se cargan todos aquí, «base» el primero.
import './base.js';
import './fotos.js';
import './piezas.js';
import './lotes.js';
import './fichas.js';
import './proyectos.js';
import './ia.js';
import './actividad.js';
import './ajustes.js';
import './revision.js';
import {$, D, api, aplicarTema, app, base64, cambiarTema, cargar, comp, confirmar, esc, g, guardarLocal, norm, q, t, toast, ui, vacio} from './base.js';
import {CUENTA_PEND, GRUPOS_HIST, HIST, REG, avisoPendientes, cargarHistDe, cargarPendientes, descartarPendiente, histCargar, regCargar, vPendientes} from './actividad.js';
import {LOTE, aplicarLote, contarLote, descartarLote, iaLote, vLoteIA} from './lotes.js';
import {MODELOS_IA, RAZONAR, aplicarIA, avisoModeloAlta, cambiarModeloIA, contarDeteccion, crearDeteccion, enviarIA, enviarVarias, guardarAjustesIA, guardarLoteAltas, iaAbiertas, iaAjustes, iaTarea, llenarModelosAlta, modeloIA, modelosIA, responderIA, vIA, verVistaIA} from './ia.js';
import {REVISION, aplicarRevisionIA, contarCambios, enviarRevision, verVistaRevision} from './revision.js';
import {abrirCombo, cerrarCombo, CLICS_EDITOR, clicEditor, editarTipoCargar, elegirTipo, guardarFicha, guardarForm, separarEnEditor, vBuscar, vComponente, vEditarTipo, vForm, vGlosario, vTipo} from './fichas.js';
import {accionSel, colorPin, filaComp, guardarLote, ponerATodas, refrescarBarraSel, salirSeleccion, vInventario, vLote} from './piezas.js';
import {CLICS_AJUSTES, ajCargar, ajRefrescar, aplicarFormato, cambioAjustes, clicAjustes, contarFormato, subirCopia, vAjustes} from './ajustes.js';
import {anadirNotaPro, anadirTareaPro, cambiarEstadoPro, cargarProyecto, clicProyecto, guardarProyectoForm, subirArchivoPro, vProyecto, vProyectoForm, vProyectos} from './proyectos.js';
import {fotoEncuadrada, subirFoto} from './fotos.js';

// ---------- router ----------
export function route() {
  const [ruta, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [v = '', arg = '', sub = ''] = ruta.split('/').map(decodeURIComponent);
  const map = {
    '': ['inventario', vInventario], c: ['inventario', () => vComponente(arg)],
    nuevo: ['inventario', () => vForm(null, new URLSearchParams(qs).get('tipo') || '')], editar: ['inventario', () => vForm(arg)],
    proyectos: ['proyectos', vProyectos], p: ['proyectos', () => vProyecto(arg, sub)], 'proyecto-nuevo': ['proyectos', () => vProyectoForm(null)],
    glosario: ['glosario', vGlosario], g: ['glosario', () => (sub === 'editar' ? vEditarTipo(arg) : vTipo(arg))],
    ia: ['inventario', () => (arg === 'lote' ? vLoteIA(sub) : vIA(arg))],
    lote: ['inventario', vLote],
    pendientes: ['inventario', vPendientes],
    ajustes: ['ajustes', () => vAjustes(arg)],
    buscar: ['buscar', vBuscar],
  };
  const [tab, fn] = map[v] || map[''];
  document.querySelectorAll('#nav a, #barra a').forEach((a) => a.classList.toggle('on', a.dataset.v === tab));
  cerrarMenuFab();
  app.innerHTML = fn();
  document.title = `CircuitBin · ${t(tab)}`;
  if (v === 'g' && sub === 'editar') editarTipoCargar();
  if (v === 'p') cargarProyecto();
  if (v === 'ia') { if (arg === 'ajustes') iaAjustes(); else if (arg === 'lote') iaLote(sub); else if (arg === 'varias') llenarModelosAlta(); else if (arg) iaTarea(arg); else { iaAbiertas(); llenarModelosAlta(); } }
  if (v === '') avisoPendientes();
  if (v === 'pendientes') cargarPendientes();
  if (v === 'ajustes' && arg === 'historial') { const g = new URLSearchParams(qs).get('g'); if (g != null && g in GRUPOS_HIST) HIST.grupo = g; }
  if (v !== '' && v !== 'lote' && ui.seleccionando) salirSeleccion(); // la selección vive en el Inventario y en «Editar juntas»
  if (v === 'ajustes') {
    const tp = new URLSearchParams(qs).get('t');
    if (arg === 'tipos' && tp) { ui.ajBuscar = D.tipos[tp]?.nombre || tp; ui.ajTipos = D.tipos[tp]?.archivado ? 'archivados' : 'todos'; }
    if (arg === 'ia') iaAjustes(); else if (arg) ajCargar();
    else {
      if (!MODELOS_IA && D.ia?.activa) modelosIA().then(() => { if (location.hash === '#/ajustes') route(); }).catch(() => {});
      if (!CUENTA_PEND) avisoPendientes().then(() => { if (location.hash === '#/ajustes' && CUENTA_PEND?.grupos) route(); }).catch(() => {});
    }
  }
  if (v === 'proyecto-nuevo' && matchMedia('(hover: hover)').matches) $('#form-proyecto [name=nombre]').focus();
  if (v === 'nuevo' && matchMedia('(hover: hover)').matches) $('#form [name=nombre]').focus(); // en el móvil, sin abrir el teclado
}

export function contadores() {
  $('#n-inv').textContent = D.componentes.length || '';
  $('#n-pro').textContent = D.proyectos.length || '';
  $('#n-glo').textContent = Object.values(D.tipos).filter((tp) => !tp.archivado).length || '';
}

// ---------- eventos ----------
// Clics de la vista: [selector, qué hace, opciones]. Gana el elemento más cercano al clic que case con algún selector
// y, de la lista, la primera fila que case con él. {redibujar}: después se vuelve a pintar la vista. Si algo falla se
// avisa y se redibuja, salvo con {local}: trabajan dentro de formularios a medio rellenar, que se perderían.
const LOCAL = {local: true}, REDIBUJAR = {redibujar: true};
// para las que avisan ellas mismas del fallo sin redibujar (y dejan el botón como estaba)
const avisando = (fn, despues) => async (el) => { try { await fn(el); } catch (err) { toast(err.message, true); despues(el); } };
const reactivar = (el) => { el.disabled = false; };
// «Marcar todo / nada» de una lista de casillas
const marcarTodas = (casillas, clave, contar) => (el) => {
  document.querySelectorAll(casillas).forEach((x) => (x.checked = el.dataset[clave] === 'todo'));
  contar();
};
const piezaDeLaRuta = () => location.hash.split('/')[2];

const CLICS = [
  ['[data-cuenta]', (el) => { // móvil: el recuadro de la cantidad se convierte en − n + (y se queda así mientras ajustas)
    ui.cuentaAbierta = Number(el.dataset.cuenta);
    document.querySelectorAll('.fila-pieza.editando').forEach((x) => x.classList.remove('editando'));
    el.closest('.fila-pieza').classList.add('editando');
    el.closest('.fila-pieza').querySelector('[data-adj]')?.focus();
  }, LOCAL],
  // sin redibujar la vista: el selector de tipo y las tablas editables viven dentro de formularios a medio rellenar
  ['.combo-op', (el) => elegirTipo(el.closest('.combo'), el.dataset.valor), LOCAL],
  ['[data-op]', (el) => { // una respuesta propuesta por la IA: la pone en su campo (otra vez: la quita)
    const li = el.closest('li');
    li.querySelector('.ia-resp').value = el.getAttribute('aria-pressed') === 'true' ? '' : el.dataset.op;
    marcarOpciones(li);
  }, LOCAL],
  ['#ia-abrir', (el) => { // el panel de la IA se abre debajo de la fila de acciones
    const d = $('.ia-revisar');
    d.open = !d.open;
    el.setAttribute('aria-expanded', String(d.open));
    if (d.open) d.querySelector('textarea')?.focus({preventScroll: true});
  }, LOCAL],
  ['[data-pines-vista]', (el) => {
    ui.pinesVista = el.dataset.pinesVista;
    const caja = el.closest('.pines');
    caja.dataset.pinesModo = ui.pinesVista;
    caja.querySelectorAll('[data-pines-vista]').forEach((b) => { const on = b.dataset.pinesVista === ui.pinesVista; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }, LOCAL],
  [CLICS_EDITOR, clicEditor, LOCAL],
  ['[data-pro]', clicProyecto],
  // selección de varias piezas y cambios en lote
  ['#sel-modo', () => { if (ui.seleccionando) salirSeleccion(); else ui.seleccionando = true; }, REDIBUJAR],
  ['[data-sel]', (el) => { if (el.dataset.sel === 'visibles') ui.visibles.forEach((id) => ui.sel.add(id)); else ui.sel.clear(); }, REDIBUJAR],
  ['[data-sel-acc]', (el) => !el.disabled && accionSel(el.dataset.selAcc)],
  ['[data-lote-todas]', (el) => ponerATodas(el.dataset.loteTodas)],
  ['[data-lote-marcar]', (el) => {
    document.querySelectorAll('.lote-cambio').forEach((x) => { x.checked = el.dataset.loteMarcar === 'todo'; LOTE.desmarcados[x.checked ? 'delete' : 'add'](`${x.dataset.tarea}:${x.value}`); });
    contarLote();
  }],
  ['#lote-aplicar', avisando(aplicarLote, contarLote)],
  ['#lote-descartar', descartarLote],
  ['#formato-aplicar', avisando(aplicarFormato, contarFormato)],
  ['[data-formato-marcar]', marcarTodas('.formato-cambio', 'formatoMarcar', contarFormato)],
  ['#lote-guardar', avisando(guardarLoteAltas, contarLote)],
  ['#det-crear', avisando(crearDeteccion, contarDeteccion)],
  ['[data-det-marcar]', marcarTodas('.det-ok', 'detMarcar', contarDeteccion)],
  // actividad: cambios pendientes, historial y registro
  ['[data-pend-descartar]', (el) => descartarPendiente(el.dataset.pendDescartar)],
  ['[data-hist-grupo]', (el) => { HIST.grupo = el.dataset.histGrupo; return histCargar(true); }],
  ['#hist-mas', (el) => { el.disabled = true; el.textContent = t('Cargando…'); return histCargar(false); }],
  ['[data-reg-nivel]', (el) => { REG.nivel = el.dataset.regNivel; REG.datos = null; return regCargar(); }],
  ['#reg-copiar', async () => {
    const txt = (REG.datos?.lineas || []).slice().reverse().map((l) => `${l.fecha} ${l.nivel.toUpperCase()} ${l.texto}`).join('\n');
    try { await navigator.clipboard.writeText(txt); toast(t('Registro copiado')); } catch { toast(t('No se ha podido copiar (hace falta HTTPS o localhost)'), true); }
  }],
  ['[data-vista-inv]', async (el) => { // Lista / Cuadrícula del inventario (atributo propio: no confundir con otras «vistas»)
    await api('PUT', 'api/ajustes/vista_inventario', {valor: el.dataset.vistaInv});
    D.ajustes.vista_inventario = el.dataset.vistaInv;
  }, REDIBUJAR],
  ['#ia-cambiar-clave', (el) => { $('#form-ia-config').hidden = false; el.closest('.acciones').hidden = true; $('#form-ia-config [name=clave]').focus(); }],
  ['[data-glo]', (el) => { ui.sinComprobar = el.dataset.glo === 'sin'; }, REDIBUJAR],
  [CLICS_AJUSTES, clicAjustes],
  // IA: correcciones y propuestas
  ['[data-ia-marcar]', marcarTodas('.ia-cambio', 'iaMarcar', contarCambios)],
  ['#ia-aplicar-cambios', avisando(aplicarRevisionIA, reactivar)],
  ['[data-ia-vista]', (el) => verVistaIA(el.dataset.iaVista)],
  ['[data-rev-vista]', (el) => verVistaRevision(el.dataset.revVista, REVISION)],
  ['#ia-guardar-previa', () => { verVistaIA('editar'); $('#form-ia-ok').requestSubmit(); }],
  ['#ia-responder', avisando(responderIA, reactivar)], // sin redibujar: no se pierde lo editado
  ['#ia-quitar', async () => {
    if (!(await confirmar(t('¿Quitar la clave de OpenCode Go?\nLa IA dejará de funcionar hasta que pongas otra.'), {si: t('Quitar la clave'), peligro: true}))) return;
    D.ia = await api('PUT', 'api/ia/config', {quitarClave: true});
    toast(t('Clave quitada'));
    location.hash = '#/ia';
  }],
  ['#ia-descartar', async (el) => {
    if (!(await confirmar(t('¿Descartar esta propuesta?\nNo se guarda nada.'), {si: t('Descartar'), peligro: true}))) return;
    await api('POST', `api/ia/tareas/${el.dataset.id}/descartar`);
    toast(t('Descartada'));
    location.hash = el.dataset.volver || '#/ia';
  }],
  ['#revisada', async (el) => {
    await api('PATCH', `api/tipos/${el.dataset.tipo}`, {revisado: true});
    D.tipos[el.dataset.tipo].revisado = 1;
    toast(t('Ficha comprobada: ya no sale el aviso'));
  }, REDIBUJAR],
  // piezas: cantidad, filtros, marca de pendiente, foto y borrar
  ['[data-adj]', async (el, e) => {
    e.preventDefault();
    el.disabled = true;
    const c = await api('POST', `api/componentes/${el.dataset.id}/ajuste`, {delta: Number(el.dataset.adj)});
    guardarLocal(c);
    const fila = el.closest('.fila-pieza');
    if (!fila) return route();
    // en una lista: solo esa fila, y el foco sigue en el mismo botón (pulsar varias veces seguidas)
    fila.outerHTML = filaComp(c);
    app.querySelector(`[data-adj="${el.dataset.adj}"][data-id="${c.id}"]`)?.focus();
  }],
  ['[data-cat]', (el) => { ui.cat = el.dataset.cat; }, REDIBUJAR],
  ['[data-pf]', (el) => { ui.proFiltro = el.dataset.pf; }, REDIBUJAR],
  ['#filtros-abrir', () => { ui.filtros = !ui.filtros; }, REDIBUJAR],
  ['#quitar-pendiente, #marcar-pendiente', async (el) => {
    const marcar = el.id === 'marcar-pendiente';
    guardarLocal(await api('PATCH', `api/componentes/${piezaDeLaRuta()}`, {revisar: marcar}));
    toast(marcar ? t('Marcada como pendiente') : t('Marca quitada'));
  }, REDIBUJAR],
  ['#quitar-foto', async () => {
    if (!(await confirmar(t('¿Quitar la foto de esta pieza?'), {si: t('Quitar'), peligro: true}))) return;
    guardarLocal(await api('DELETE', `api/componentes/${piezaDeLaRuta()}/foto`));
    route();
  }],
  ['#borrar', async () => {
    const id = piezaDeLaRuta(), nombre = comp(id)?.nombre || t('la pieza');
    const r = await api('DELETE', `api/componentes/${id}`);
    D.componentes = D.componentes.filter((c) => c.id !== Number(id));
    contadores();
    location.hash = '#/';
    toast(t('Borrada «{nombre}»', {nombre}), false, {texto: t('Deshacer'), fn: async () => {
      try {
        const x = await api('POST', 'api/componentes/restaurar', {token: r.deshacer});
        await cargar(); contadores();
        location.hash = `#/c/${x.id}`;
        toast(t('Recuperada'));
      } catch (err) { toast(err.message, true); }
    }});
  }],
];
const SEL_CLICS = CLICS.map(([sel]) => sel).join(', ');

app.addEventListener('click', async (e) => {
  const el = e.target.closest(SEL_CLICS);
  if (!el || !app.contains(el)) return; // solo botones de la propia vista (no el <html>, que lleva data-* del tema)
  const [, accion, {local = false, redibujar = false} = {}] = CLICS.find(([sel]) => el.matches(sel));
  try {
    await accion(el, e);
    if (redibujar) route();
  } catch (err) {
    toast(err.message, true);
    if (!local) route();
  }
});
app.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.id === 'ubic') { ui.ubic = el.value; route(); }
  if (el.id === 'rev') { ui.revisar = el.checked; route(); }
  if (el.id === 'sin-foto') { ui.sinFoto = el.checked; route(); }
  if (el.id === 'pro-estado') { try { await cambiarEstadoPro(el); } catch (err) { toast(err.message, true); route(); } }
  if (el.id === 'pro-archivo' && el.files[0]) { const f = el.files[0]; el.value = ''; try { await subirArchivoPro(f); } catch (err) { toast(err.message, true); } }
  if (el.name === 'ia-modelo') cambiarModeloIA(el);
  if (el.id === 'ia-modelo-alta') avisoModeloAlta();
  if (el.classList.contains('det-ok')) contarDeteccion();
  if (el.classList.contains('formato-cambio')) contarFormato();
  if (el.name === 'ia-razonar') {
    const antes = D.ajustes.ia_razonar;
    try { await api('PUT', 'api/ajustes/ia_razonar', {valor: el.value}); D.ajustes.ia_razonar = el.value; toast(t('La IA razonará: {nivel}', {nivel: t(RAZONAR[el.value].nombre).toLowerCase()})); }
    catch (err) { D.ajustes.ia_razonar = antes; toast(err.message, true); iaAjustes(); }
  }
  if (el.dataset.catNombre || el.dataset.sitioNombre) cambioAjustes(el);
  if (el.classList.contains('ia-cambio')) contarCambios();
  if (el.classList.contains('sel-pieza')) {
    const id = Number(el.value);
    if (el.checked) ui.sel.add(id); else ui.sel.delete(id);
    el.closest('.fila-sel, .tarjeta-sel')?.classList.toggle('marcada', el.checked);
    if (!ui.selIA) refrescarBarraSel();
  }
  if (el.classList.contains('lote-cambio')) { LOTE.desmarcados[el.checked ? 'delete' : 'add'](`${el.dataset.tarea}:${el.value}`); contarLote(); }
  if (el.id === 'aj-importar' && el.files[0]) { subirCopia(el.files[0]); el.value = ''; }
  if (el.matches('.ed-fn select')) el.closest('.ed-fn').style.cssText = colorPin(el.value); // el punto de color sigue a la función
  if (el.matches('.ed-pines .ed-fila [data-col="0"]')) separarEnEditor(el);
  if (el.name === 'varios') { const n = el.form.querySelector('[name=cantidad]'); n.disabled = el.checked; if (!el.checked && !n.value) n.value = 1; }
  if (el.id === 'foto' && el.files[0]) {
    try { await subirFoto(Number(location.hash.split('/')[2]), el.files[0]); route(); } catch (err) { toast(err.message, true); }
  }
});
app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const b = e.target.querySelector('[type=submit]');
  b.disabled = true;
  b.dataset.texto ||= b.textContent;
  if (e.target.id === 'form-ia' || e.target.id === 'form-ia-varias') b.textContent = t('Enviando…');
  if (e.target.id === 'form-ia-config') b.textContent = t('Comprobando…');
  try {
    if (e.target.id === 'form-ia') await enviarIA(e.target);
    else if (e.target.id === 'form-ia-varias') await enviarVarias(e.target);
    else if (e.target.id === 'form-ia-config') await guardarAjustesIA(e.target);
    else if (e.target.id === 'form-revisar') await enviarRevision(e.target);
    else if (e.target.id === 'aj-cat-nueva') {
      const nombre = new FormData(e.target).get('nombre');
      await api('POST', 'api/categorias', {nombre});
      await ajRefrescar(t('Categoría «{nombre}» añadida', {nombre}));
    }
    else if (e.target.id === 'form-ia-ok') await aplicarIA(e.target);
    else if (e.target.id === 'form-ficha') await guardarFicha(e.target);
    else if (e.target.id === 'form-proyecto') await guardarProyectoForm(e.target);
    else if (e.target.id === 'form-pro-tarea') await anadirTareaPro(e.target);
    else if (e.target.id === 'form-pro-nota') await anadirNotaPro(e.target);
    else if (e.target.id === 'form-lote') { await guardarLote(e.target); b.disabled = false; }
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
// menú «⋯» de las fichas: se cierra al tocar fuera o al elegir algo
document.addEventListener('click', (e) => document.querySelectorAll('details.mas[open]').forEach((d) => {
  if (!d.contains(e.target) || e.target.closest('.mas-menu > a, .mas-menu > button')) d.open = false;
}));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  cerrarMenuFab();
  document.querySelectorAll('details.mas[open]').forEach((d) => { d.open = false; if (d.contains(document.activeElement)) d.querySelector('summary')?.focus(); }); // menús «⋯»
});
async function fotoDirectaIA(file) {
  cerrarMenuFab();
  if (!D.ia?.activa) { toast(t('Primero pon la clave de OpenCode Go')); location.hash = '#/ia/ajustes'; return; }
  await modelosIA().catch(() => {});
  const m = modeloIA();
  if (m && !m.vision) { toast(t('{nombre} no ve fotos: elige otro modelo o describe la pieza con texto', {nombre: m.nombre}), true); location.hash = '#/ia'; return; }
  const blob = await fotoEncuadrada(file);
  if (!blob) return;
  toast(t('Enviando foto…'));
  const foto = await base64(blob);
  const tr = await api('POST', 'api/ia/alta', {foto});
  location.hash = `#/ia/${tr.id}`;
}
// «Foto con IA» de la caja azul (escritorio): lo mismo que el del móvil (también con Intro o Espacio)
app.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('label.btn[tabindex]')) { e.preventDefault(); e.target.querySelector('input')?.click(); }
});
app.addEventListener('change', async (e) => {
  if (!e.target.classList.contains('foto-directa')) return;
  const f = e.target.files[0];
  e.target.value = '';
  e.target.closest('details')?.removeAttribute('open');
  if (f) try { await fotoDirectaIA(f); } catch (err) { toast(err.message, true); }
});
for (const id of ['fab-camara', 'fab-galeria']) $(`#${id}`).addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) try { await fotoDirectaIA(f); } catch (err) { toast(err.message, true); }
});

// Ajustes → Tipos: filtra la lista al escribir
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
// respuesta a una duda escrita a mano: se marca la opción propuesta que coincide (o ninguna)
function marcarOpciones(li) {
  const v = norm(li.querySelector('.ia-resp').value.trim());
  li.querySelectorAll('.ia-op').forEach((o) => o.setAttribute('aria-pressed', String(!!v && norm(o.dataset.op) === v)));
}
app.addEventListener('input', (e) => { if (e.target.classList.contains('ia-resp')) marcarOpciones(e.target.closest('li')); });
let HIST_ESPERA = null;
// buscar en el historial y en el registro (con una pequeña espera para no preguntar en cada tecla)
app.addEventListener('input', (e) => {
  if (e.target.id !== 'hist-q' && e.target.id !== 'reg-q') return;
  clearTimeout(HIST_ESPERA);
  const v = e.target.value.trim(), es = e.target.id;
  HIST_ESPERA = setTimeout(() => { if (es === 'hist-q') { HIST.q = v; histCargar(true); } else { REG.q = v; REG.datos = null; regCargar(); } }, 300);
});
// el historial de una pieza o ficha se pide al abrir su desplegable (toggle no burbujea: en captura)
app.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.open && d.dataset?.historial && !d.dataset.cargado) { d.dataset.cargado = '1'; cargarHistDe(d); }
}, true);
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
// móvil: el buscador va escondido tras la lupa; se abre al tocarla y se cierra al salir de él vacío
$('#buscar-abrir').addEventListener('click', () => { document.body.classList.add('buscando'); q.focus(); });
q.addEventListener('blur', () => { if (!q.value.trim()) document.body.classList.remove('buscando'); });
document.addEventListener('keydown', (e) => {
  const escribiendo = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === '/' && !escribiendo) { e.preventDefault(); q.focus(); q.select(); }
  if (e.key === 'Escape' && document.activeElement === q) { q.value = ''; route(); q.blur(); }
});
window.addEventListener('hashchange', (e) => {
  if (/^#\/ia\/\d+$/.test(location.hash)) ui.origenTarea = {hash: location.hash, desde: e.oldURL ? new URL(e.oldURL).hash : ''};
  ui.cuentaAbierta = null;
  route(); window.scrollTo(0, 0);
});

// móvil: con el teclado abierto se esconde la barra de abajo (iOS la deja flotando en mitad de la pantalla, encima del texto)
const escribe = (el) => !!el && (el.matches('textarea, select, [contenteditable]')
  || (el.tagName === 'INPUT' && !/^(checkbox|radio|file|button|submit|range|hidden)$/.test(el.type)));
document.addEventListener('focusin', (e) => { if (escribe(e.target)) document.body.classList.add('teclado'); });
document.addEventListener('focusout', () => setTimeout(() => { if (!escribe(document.activeElement)) document.body.classList.remove('teclado'); }, 60));

// ---------- datos y modo sin conexión ----------
async function recargar() {
  try { await cargar(); contadores(); route(); } catch {}
  if (!$('#sin-red').hidden) toast(t('Sigue sin conexión'), true);
}
$('#sin-red-btn').addEventListener('click', recargar);
window.addEventListener('online', () => { if (!$('#sin-red').hidden) recargar(); });
// con la huella de esta versión (la pone el servidor en index.html): un sw.js nuevo por versión, sin copias viejas de proxies
const VERSION_WEB = document.querySelector('meta[name=version-web]')?.content || '';
if ('serviceWorker' in navigator) navigator.serviceWorker.register(`sw.js${VERSION_WEB ? `?v=${VERSION_WEB}` : ''}`).catch(() => {}); // solo con HTTPS o localhost

(async function init() {
  try {
    await cargar();
  } catch (err) {
    app.innerHTML = vacio(t('No puedo hablar con el servidor: {msg}', {msg: esc(err.message)}));
    return;
  }
  aplicarTema();
  contadores();
  route();
})();
