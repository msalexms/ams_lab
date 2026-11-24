// CircuitBin · piezas.js — tabla de pines, inventario (lista y cuadrícula), selección de varias piezas y «Editar juntas».
import {$, CATS, D, FUNC, api, byName, cabIA, cargar, catOf, comp, compText, conColor, confirmar, dolares, esc, fotoUrl, g, list, marcaCat, matches, migas, norm, piezasTxt, plural, q, qtyText, t, toast, ubicaciones, ui, unidades, vacio, voltajeDe} from './base.js';
import {MODELOS_IA, modelosIA} from './ia.js';
import {buscarTodo, menuMas} from './fichas.js';
import {contadores, route} from './app.js';
import {stepper} from './fotos.js';

// tabla de pines. Cada fila es UN pin: [pin, uso, función, nota]. Color y nombre de cada función salen de la base de
// datos (claro y noche). Con pocos pines, una tabla sin más. Con muchos (una placa), agrupados por función: cada grupo
// plegado con sus pines en una línea («GPIO 21 · 22 · 32–39») y, al abrirlo, el detalle de cada uno con su nota.
// «En orden» los enseña todos seguidos, como están en la placa. La vista elegida se recuerda mientras dure la visita.
const PINES_AGRUPAR = 8;
export const colorPin = (id) => { const x = FUNC[id] || {color_claro: '#888888', color_oscuro: '#888888'}; return `--cc:${esc(x.color_claro)};--co:${esc(x.color_oscuro)}`; };
// «GPIO 21», «GPIO 22», «GPIO 32»…«GPIO 39» → «GPIO 21 · 22 · 32–39» (solo para leerlos de un vistazo)
function resumenPines(nombres) {
  const out = [];
  let prefijo = null, nums = [];
  const cerrar = () => {
    if (!nums.length) return;
    nums.sort((a, b) => a - b); // de menor a mayor: se lee mejor que en el orden de la placa
    const tramos = [];
    for (let i = 0; i < nums.length; i++) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      tramos.push(j - i >= 2 ? `${nums[i]}–${nums[j]}` : nums.slice(i, j + 1).join(' · '));
      i = j;
    }
    out.push(`${prefijo}${tramos.join(' · ')}`);
    nums = [];
  };
  for (const n of nombres) {
    const m = String(n).match(/^(.*?\D)(\d+)$/);
    if (m && m[1] === prefijo) { nums.push(Number(m[2])); continue; }
    cerrar();
    if (m) { prefijo = m[1]; nums = [Number(m[2])]; } else { prefijo = null; out.push(n); }
  }
  cerrar();
  return out.join(' · ');
}
const filaPin = (p, n) => `<tr style="${colorPin(p.fn)}"${FUNC[p.fn]?.tachado ? ' class="tachado"' : ''}>${n != null ? `<td class="n">${n}</td>` : ''}
  <td class="pin"><span class="pin-chip"><i class="dot"></i>${esc(p.pin)}</span></td><td>${esc(p.uso)}${p.nota ? `<div class="sub pin-nota">${esc(p.nota)}</div>` : ''}</td></tr>`;
export function tablaPines(f) {
  const pines = list(f.pines).map(([pin, uso, fn, nota]) => ({pin, uso, fn, nota}));
  if (!pines.length) return '';
  const usadas = Object.keys(FUNC).filter((k) => pines.some((p) => p.fn === k));
  const leyenda = `<div class="leyenda">${usadas.map((k) => `<span class="ley-it" style="${colorPin(k)}"><i class="dot"></i>${esc(FUNC[k].nombre)}</span>`).join('')}</div>`;
  const enOrden = `<table class="t t-pines"><thead><tr><th class="n">#</th><th>${t('Pin')}</th><th>${t('Uso')}</th></tr></thead><tbody>${pines.map((p, i) => filaPin(p, i + 1)).join('')}</tbody></table>`;
  const cuenta = `<span class="pines-cnt">${plural(pines.length, 'pin')}</span>`;
  if (pines.length <= PINES_AGRUPAR) return `<div class="pines"><div class="pines-top">${cuenta}</div>${enOrden}${leyenda}</div>`;
  const vista = ui.pinesVista === 'orden' ? 'orden' : 'funcion';
  const grupos = usadas.map((k) => {
    const ps = pines.filter((p) => p.fn === k), notas = ps.filter((p) => p.nota).length;
    return `<details class="pin-grupo" style="${colorPin(k)}"><summary>
      <span class="pin-grupo-etq"><i class="dot"></i><span>${esc(FUNC[k].nombre)}</span><span class="n">${ps.length}</span></span>
      <span class="pin-grupo-mid"><span class="pin-grupo-pines${FUNC[k].tachado ? ' tachado' : ''}">${esc(resumenPines(ps.map((p) => p.pin)))}</span>${notas ? `<span class="etq-pend pin-grupo-notas">${plural(notas, 'nota')}</span>` : ''}</span>
    </summary><div class="pin-grupo-cuerpo"><table class="t t-pines"><tbody>${ps.map((p) => filaPin(p)).join('')}</tbody></table></div></details>`;
  }).join('');
  return `<div class="pines" data-pines-modo="${vista}"><div class="pines-top">${cuenta}
      <div class="seg conmuta" role="group" aria-label="${esc(t('Cómo ver los pines'))}">${[['funcion', t('Por función')], ['orden', t('En orden')]].map(([k, lbl]) =>
        `<button class="${vista === k ? 'on' : ''}" type="button" data-pines-vista="${k}" aria-pressed="${vista === k}">${lbl}</button>`).join('')}</div></div>
    <div class="pines-funcion">${grupos}</div><div class="pines-orden">${enOrden}${leyenda}</div></div>`;
}

// ---------- vistas ----------
// el tipo en la fila de una pieza: solo lo que el nombre de la pieza no dice ya («HC-SR04» + «ultrasonidos»; nada si
// el tipo se llama igual que la pieza)
const PALABRAS_VACIAS = new Set(['de', 'del', 'con', 'la', 'el', 'los', 'las', 'para', 'por', 'en', 'of', 'with', 'for', 'in', 'the', 'and', 'to']);
function tipoEnFila(c) {
  if (!c.tipo || !D.tipos[c.tipo]) return '';
  const t = g(c.tipo).nombre, pieza = norm(c.nombre).replace(/[^a-z0-9]+/g, ' ');
  const nuevas = norm(t).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !PALABRAS_VACIAS.has(w) && !pieza.includes(w));
  if (!nuevas.length) return '';
  return norm(t).startsWith(norm(c.nombre)) ? t.slice(c.nombre.length).replace(/^[\s(·:,-]+|[)\s]+$/g, '') || t : t;
}
// ---------- disposición AMSTech (mockup aprobado el 23/11/2026) ----------
// iconos de línea (heredan el color del texto)
const ico = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const ICO = {
  camara: ico('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  galeria: ico('<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 18l5-5 3 3 2-2 4 4"/>'),
  varias: ico('<rect x="4" y="6" width="7" height="7" rx="1"/><rect x="13" y="11" width="7" height="7" rx="1"/><path d="M4 17h6M14 7h6"/>'),
  lapiz: ico('<path d="M5 19l1-4L16 5l3 3L9 18z"/><path d="M14 7l3 3"/>'),
  mas: ico('<path d="M12 5v14M5 12h14"/>'),
  rejilla: ico('<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>'),
  lista: ico('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
  chispa: ico('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/>'),
  aviso: ico('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>'),
  filtros: ico('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
};
// la categoría de una pieza: cuadradito de su color + nombre
export const etqCat = (cat, cls = 'pz-cat') => `<span class="${cls}"${conColor(cat)}>${marcaCat}<span class="pz-cat-t">${esc(CATS[cat] || t('Otros'))}</span></span>`;
// el dibujo de un tipo; sin dibujo propio (o sin tipo), el genérico
export const dibujoDe = (tipo) => `img/tipos/${D.tipos[tipo]?.dibujo ? encodeURIComponent(tipo) : '_pieza'}.svg`;
// imagen de una pieza: su foto o el dibujo de su tipo sobre el color de su categoría (sin dibujo, solo el color)
const imgPieza = (c, cls) => (c.foto ? `<span class="${cls}"><img src="${fotoUrl(c)}" alt="" loading="lazy"></span>`
  : `<span class="${cls} dibujo"${conColor(catOf(c))}><img src="${dibujoDe(c.tipo)}" alt="" loading="lazy"></span>`);
export const cuenta = (c) => `<span class="cuenta num${unidades(c) || c.varios ? '' : ' cero'}">${esc(qtyText(c))}</span>`;
export const etqPend = (c) => (c.revisar ? `<span class="etq-pend">${t('pendiente')}</span>` : '');

// lista: miniatura, nombre y categoría; en escritorio, sitio, tensión e interfaces en columnas y el − n +;
// en el móvil, la cantidad en un recuadro que al tocarlo se convierte en − n +
// la columna «Sitio» solo sale si alguna pieza tiene sitio (si no, sería una columna de «—»)
const haySitios = () => D.componentes.some((c) => c.ubicacion);
export function filaComp(c) {
  const f = c.tipo && D.tipos[c.tipo] ? g(c.tipo) : null, tipo = tipoEnFila(c), sitios = haySitios();
  return `<div class="fila fila-pieza${ui.cuentaAbierta === c.id ? ' editando' : ''}">
    <a class="fila-main" href="#/c/${c.id}">${imgPieza(c, 'fila-img')}
      <div><div class="nombre">${esc(c.nombre)} ${etqPend(c)}</div>
      <div class="sub">${etqCat(catOf(c))}${tipo ? `<span class="solo-escritorio"> · ${esc(tipo)}</span>` : ''}${c.ubicacion ? `<span class="solo-movil"> · ${esc(c.ubicacion)}</span>` : ''}</div></div></a>
    <div class="fila-cols solo-escritorio${sitios ? '' : ' sin-sitio'}">${sitios ? `<span>${esc(c.ubicacion) || '<span class="gris">—</span>'}</span>` : ''}<span>${f ? esc(voltajeDe(f)) : ''}</span>
      <span>${f ? esc(list(f.interfaz).slice(0, 2).join(', ')) : ''}</span></div>
    ${c.varios ? '' : `<button class="cuenta-btn num" type="button" data-cuenta="${c.id}" aria-label="${esc(t('Cambiar la cantidad ({q})', {q: qtyText(c)}))}">${esc(qtyText(c))}</button>`}
    ${stepper(c)}</div>`;
}
const cabInventario = () => `<div class="fila fila-cab solo-escritorio" aria-hidden="true"><div class="fila-main">${t('Pieza')}</div>
  <div class="fila-cols${haySitios() ? '' : ' sin-sitio'}">${haySitios() ? `<span>${t('Sitio')}</span>` : ''}<span>${t('Tensión')}</span><span>${t('Interfaz')}</span></div><div class="fila-cant">${t('Cantidad')}</div></div>`;

// cuadrícula: foto o dibujo arriba, la cantidad en la esquina y debajo nombre, categoría y sitio
const tarjetaTxt = (c) => `<span class="tarjeta-txt"><span class="nombre">${esc(c.nombre)}</span>
  <span class="tarjeta-meta">${etqCat(catOf(c))}<span class="sitio">${esc(c.ubicacion || t('sin sitio'))}</span></span></span>`;
function tarjetaComp(c) {
  return `<a class="tarjeta" href="#/c/${c.id}">${imgPieza(c, 'tarjeta-img')}${etqPend(c)}${cuenta(c)}${tarjetaTxt(c)}</a>`;
}
const vistaInv = () => (D.ajustes.vista_inventario === 'cuadricula' ? 'cuadricula' : 'lista');

// en una lista filtrada: «también hay N tipos y M proyectos con eso» → búsqueda en todo
export function tambien(query, aqui) {
  if (!query) return '';
  const r = buscarTodo(query), partes = [];
  if (aqui !== 'piezas' && r.piezas.length) partes.push(plural(r.piezas.length, 'pieza'));
  if (aqui !== 'tipos' && r.tipos.length) partes.push(plural(r.tipos.length, 'tipo'));
  if (aqui !== 'proyectos' && r.proyectos.length) partes.push(plural(r.proyectos.length, 'proyecto'));
  return partes.length ? `<p class="tambien">${t('También con «{q}»: ', {q: esc(query)})}<a href="#/buscar">${partes.join(', ')} →</a></p>` : '';
}

// la caja azul: lo principal de la pantalla es añadir piezas con la IA (solo escritorio; en el móvil, el «+»)
function cajaIA() {
  if (!D.ia?.activa) return `<section class="caja-ia solo-escritorio"><span class="caja-ia-ico">${ICO.camara}</span>
    <div><b class="caja-ia-t">${t('Añadir con IA')}</b><p>${t('Pon tu clave de OpenCode Go y la IA identificará tus piezas por foto: nombre, tipo y pines.')}</p></div>
    <div class="caja-ia-bot"><a class="btn blanco" href="#/ia/ajustes">${t('Configurar la IA')}</a></div></section>`;
  return `<section class="caja-ia solo-escritorio"><span class="caja-ia-ico">${ICO.camara}</span>
    <div><b class="caja-ia-t">${t('Añadir con IA')}</b><p>${t('Haz una foto a una pieza (o a varias a la vez): la IA propone nombre, tipo y pines, y tú lo revisas antes de guardar.')}
      <a href="#/ia">${t('Con foto y texto →')}</a></p></div>
    <div class="caja-ia-bot"><label class="btn amarillo" tabindex="0">${t('Foto con IA')}<input type="file" accept="image/*" class="foto-directa" hidden></label>
      <a class="btn blanco" href="#/ia/varias">${t('Varias piezas')}</a></div></section>`;
}

export function vInventario() {
  const query = q.value.trim(), todas = D.componentes;
  let cs = todas.slice();
  const porCat = {};
  cs.forEach((c) => (porCat[catOf(c)] = (porCat[catOf(c)] || 0) + 1));
  if (query) cs = cs.filter((c) => matches(compText(c), query));
  if (ui.cat) cs = cs.filter((c) => catOf(c) === ui.cat);
  if (ui.ubic) cs = cs.filter((c) => (ui.ubic === '∅' ? !c.ubicacion : c.ubicacion === ui.ubic));
  if (ui.revisar) cs = cs.filter((c) => c.revisar);
  if (ui.sinFoto) cs = cs.filter((c) => !c.foto);
  const n = (fn) => todas.filter(fn).length, sitios = ubicaciones(), orden = Object.keys(CATS);
  const activos = [ui.ubic, ui.revisar, ui.sinFoto].filter(Boolean).length;
  const opCat = (k, nombre, cuantas, cls) => `<button class="${cls}${ui.cat === k ? ' on' : ''}" type="button" data-cat="${k}"${k ? conColor(k) : ''} aria-pressed="${ui.cat === k}">${k ? marcaCat : '<span class="ams-cuadro todas" aria-hidden="true"></span>'}${esc(nombre)}<span class="n">${cuantas}</span></button>`;
  const catsVisibles = orden.filter((k) => porCat[k]);

  // lateral (escritorio): categorías y «Mostrar»; en el móvil las categorías van en una tira y «Mostrar» se abre con el botón de filtros
  const lado = `<aside class="lado" aria-label="${esc(t('Filtros'))}">
    <h2 class="lado-t solo-escritorio">${t('Categorías')}</h2>
    <div class="lado-caja lado-cats solo-escritorio">${opCat('', t('Todas'), todas.length, 'lado-op')}${catsVisibles.map((k) => opCat(k, CATS[k], porCat[k], 'lado-op')).join('')}</div>
    <h2 class="lado-t">${t('Mostrar')}</h2>
    <div class="lado-caja lado-mostrar">
      <label class="lado-op"><input type="checkbox" id="rev" ${ui.revisar ? 'checked' : ''}>${t('Con «pendiente»')}<span class="n">${n((c) => c.revisar)}</span></label>
      <label class="lado-op"><input type="checkbox" id="sin-foto" ${ui.sinFoto ? 'checked' : ''}>${t('Sin foto')}<span class="n">${n((c) => !c.foto)}</span></label>
      ${sitios.length ? `<label class="lado-sitio"><span>${t('Sitio')}</span><select id="ubic" class="sel"><option value="">${t('Cualquier sitio')}</option>
        <option value="∅" ${ui.ubic === '∅' ? 'selected' : ''}>${t('Sin sitio')} (${n((c) => !c.ubicacion)})</option>
        ${sitios.map((u) => `<option ${ui.ubic === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>` : ''}
    </div></aside>`;
  const cab = `<div class="inv-cab"><h1>${t('Inventario')} <small>${piezasTxt(todas.length)}</small></h1>
    <button class="btn icono solo-movil${ui.filtros || activos ? ' on' : ''}" id="filtros-abrir" type="button" aria-expanded="${!!ui.filtros}" aria-label="${esc(t('Filtros y vista'))}">${ICO.filtros}${activos ? `<span class="n">${activos}</span>` : ''}</button>
    <div class="inv-acciones">
      <div class="seg" role="group" aria-label="${esc(t('Vista'))}">${[['cuadricula', t('Cuadrícula'), ICO.rejilla], ['lista', t('Lista'), ICO.lista]].map(([k, v, i]) =>
        `<button type="button" class="${vistaInv() === k ? 'on' : ''}" data-vista-inv="${k}" aria-pressed="${vistaInv() === k}">${i}${v}</button>`).join('')}</div>
      <button class="btn${ui.seleccionando ? ' on' : ''}" id="sel-modo" type="button">${ui.seleccionando ? t('Terminar') : t('Seleccionar')}</button>
      <a class="btn solo-escritorio" href="#/nuevo">${ICO.mas}${t('A mano')}</a>
    </div></div>
    <div class="chips solo-movil">${opCat('', t('Todas'), todas.length, 'chip')}${catsVisibles.map((k) => opCat(k, CATS[k], porCat[k], 'chip')).join('')}</div>`;

  let cuerpo;
  const sel = ui.seleccionando, rejilla = vistaInv() === 'cuadricula';
  if (!todas.length) cuerpo = vacio(t('Aún no hay piezas. Pulsa + para añadir la primera.'));
  else if (!cs.length) cuerpo = tambien(query, 'piezas') + vacio(t('Nada coincide con el filtro.'));
  else {
    cs.sort((a, b) => orden.indexOf(catOf(a)) - orden.indexOf(catOf(b)) || byName(a, b));
    ui.visibles = cs.map((c) => c.id);
    const cabSel = sel ? `<div class="sel-cab"><span class="gris">${t('Elige las piezas:')}</span>
      <button class="f" type="button" data-sel="visibles">${t('Todas las que se ven ({n})', {n: cs.length})}</button>
      <button class="f" type="button" data-sel="ninguna">${t('Ninguna')}</button></div>` : '';
    cuerpo = tambien(query, 'piezas') + cabSel + (rejilla
      ? `<div class="rejilla">${cs.map(sel ? tarjetaSel : tarjetaComp).join('')}</div>`
      : `<div class="lista-piezas${sel ? ' sel' : ''}">${sel ? '' : cabInventario()}${cs.map(sel ? filaSel : filaComp).join('')}</div>`);
  }
  return `<div class="inv${ui.filtros ? ' filtros-abiertos' : ''}">${lado}<div class="inv-main">${cab}${sel ? '' : cajaIA()}
    <div id="pend-aviso" aria-live="polite"></div>${cuerpo}</div></div>${sel ? `<div class="sel-hueco"></div>${barraSel()}` : ''}`;
}

// ---------- varias piezas a la vez: elegir en el Inventario, editarlas juntas y corregirlas con la IA ----------
// ui.sel: ids elegidos (se mantienen al ir a «Editar juntas»); ui.seleccionando: el Inventario está en modo elegir
const MAX_LOTE_IA = 30;
const selIds = () => [...ui.sel].filter((id) => comp(id));
function filaSel(c) {
  const marcada = ui.sel.has(c.id);
  return `<label class="fila fila-sel${marcada ? ' marcada' : ''}"><input type="checkbox" class="sel-pieza" value="${c.id}" ${marcada ? 'checked' : ''} aria-label="${esc(t('Elegir {n}', {n: c.nombre}))}">
    ${imgPieza(c, 'fila-img')}
    <span class="fila-sel-txt"><span class="nombre">${esc(c.nombre)} ${etqPend(c)}</span>
      <span class="sub">${[c.tipo ? g(c.tipo).nombre : '', c.ubicacion].filter(Boolean).map(esc).join(' · ')}</span></span>
    <span class="der num">${esc(qtyText(c))}</span></label>`;
}
function tarjetaSel(c) {
  const marcada = ui.sel.has(c.id);
  return `<label class="tarjeta tarjeta-sel${marcada ? ' marcada' : ''}">
    <input type="checkbox" class="sel-pieza" value="${c.id}" ${marcada ? 'checked' : ''} aria-label="${esc(t('Elegir {n}', {n: c.nombre}))}">
    ${imgPieza(c, 'tarjeta-img')}${cuenta(c)}${tarjetaTxt(c)}</label>`;
}
// barra fija abajo con lo que se puede hacer con las elegidas
function barraSel() {
  const n = selIds().length, ia = D.ia?.activa;
  if (ui.selIA) {
    const m = (MODELOS_IA || []).find((x) => x.id === D.ia?.modelo);
    const coste = m?.coste_medio?.dolares ?? (m ? ((m.precio.entrada ?? 0) * 6000 + (m.precio.salida ?? 0) * 900) / 1e6 : null);
    return `<div class="sel-barra sel-barra-ia" id="sel-barra" role="region" aria-label="${esc(t('Corregir con IA las elegidas'))}">
      <p><strong>${t('Corregir {piezas} con IA.', {piezas: piezasTxt(n)})}</strong> ${n > MAX_LOTE_IA ? `<span class="mal">${t('Como mucho {max} a la vez.', {max: MAX_LOTE_IA})}</span>`
        : t('Una consulta por pieza{coste}; después revisas los cambios de todas en una pantalla.', {coste: coste != null ? t(' (≈ {c} en total)', {c: dolares(coste * n)}) : ''})}</p>
      <textarea id="sel-ia-texto" rows="2" maxlength="1000" placeholder="${esc(t('Qué corregir (opcional, vale para todas): «revisa los pines», «pon el nombre con el modelo»…'))}"></textarea>
      <div class="sel-botones"><button class="btn prim" type="button" data-sel-acc="ia-enviar" ${n && n <= MAX_LOTE_IA ? '' : 'disabled'}>${t(n === 1 ? 'Pedir 1 corrección' : 'Pedir {n} correcciones', {n})}</button>
        <button class="btn" type="button" data-sel-acc="ia-cancelar">${t('Cancelar')}</button></div></div>`;
  }
  return `<div class="sel-barra" id="sel-barra" role="region" aria-label="${esc(t('Piezas elegidas'))}">
    <span class="sel-n">${n ? t(n === 1 ? '<strong>{n}</strong> elegida' : '<strong>{n}</strong> elegidas', {n}) : t('Toca las piezas para elegirlas')}</span>
    <div class="sel-botones">
      <button class="btn prim" type="button" data-sel-acc="editar" ${n ? '' : 'disabled'}>${t('Editar juntas')}</button>
      ${ia ? `<button class="btn" type="button" data-sel-acc="ia" ${n ? '' : 'disabled'}>${t('Corregir con IA')}</button>` : ''}
      ${menuMas([
        `<button role="menuitem" type="button" data-sel-acc="pendiente" ${n ? '' : 'disabled'}>${t('Marcar como pendientes')}</button>`,
        `<button role="menuitem" type="button" data-sel-acc="sin-pendiente" ${n ? '' : 'disabled'}>${t('Quitar la marca de pendiente')}</button>`,
        `<button role="menuitem" type="button" class="peligro" data-sel-acc="borrar" ${n ? '' : 'disabled'}>${t('Borrar las elegidas')}</button>`])}
    </div></div>`;
}
export const refrescarBarraSel = () => { const b = $('#sel-barra'); if (b) b.outerHTML = barraSel(); };

export async function accionSel(acc) {
  const ids = selIds();
  if (acc === 'editar') { location.hash = '#/lote'; return; }
  if (acc === 'ia') { ui.selIA = true; if (!MODELOS_IA && D.ia?.activa) modelosIA().then(refrescarBarraSel).catch(() => {}); refrescarBarraSel(); $('#sel-ia-texto')?.focus(); return; }
  if (acc === 'ia-cancelar') { ui.selIA = false; refrescarBarraSel(); return; }
  if (acc === 'ia-enviar') {
    const r = await api('POST', 'api/ia/revisar-lote', {ids, texto: $('#sel-ia-texto')?.value || ''});
    salirSeleccion();
    location.hash = `#/ia/lote/${r.lote}`;
    return;
  }
  if (acc === 'pendiente' || acc === 'sin-pendiente') {
    await api('POST', 'api/componentes/lote', {piezas: ids.map((id) => ({id, revisar: acc === 'pendiente'}))});
    await cargar(); contadores();
    toast(t(acc === 'pendiente' ? '{piezas} marcadas como pendientes' : 'Marca quitada a {piezas}', {piezas: piezasTxt(ids.length)}));
    route();
    return;
  }
  if (acc === 'borrar') {
    if (!(await confirmar(t('¿Borrar {piezas}?\nPodrás deshacerlo durante 2 minutos.', {piezas: piezasTxt(ids.length)}), {si: 'Borrar', peligro: true}))) return;
    const r = await api('POST', 'api/componentes/lote/borrar', {ids});
    D.componentes = D.componentes.filter((c) => !ids.includes(c.id));
    salirSeleccion(); contadores(); route();
    toast(t('{piezas} borradas', {piezas: piezasTxt(r.borradas)}), false, {texto: t('Deshacer'), fn: async () => {
      try { await api('POST', 'api/componentes/restaurar', {tokens: r.deshacer}); await cargar(); contadores(); route(); toast(t('Recuperadas')); }
      catch (err) { toast(err.message, true); }
    }});
  }
}
export function salirSeleccion() { ui.seleccionando = false; ui.sel.clear(); ui.selIA = false; }

// ---- «Editar juntas»: una tabla con las elegidas; arriba, «A todas» para poner lo mismo a todas ----
export function opcionesTiposLista(sel) {
  return `<option value="">${t('Sin tipo')}</option>` + Object.keys(CATS).map((cat) => {
    const ts = Object.entries(D.tipos).filter(([k, tp]) => tp.categoria === cat && (!tp.archivado || k === sel)).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, I18N.lang()));
    return ts.length ? `<optgroup label="${esc(CATS[cat])}">${ts.map(([k, tp]) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${esc(tp.nombre)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}
export function vLote() {
  const cs = selIds().map(comp).sort(byName);
  if (!cs.length) return `${migas([`<a href="#/">${t('Inventario')}</a>`, `<span>${t('Editar varias')}</span>`])}${vacio(t('No hay piezas elegidas. En el Inventario, pulsa «Seleccionar» y toca las que quieras.'))}`;
  return `${migas([`<a href="#/">${t('Inventario')}</a>`, `<span>${t('Editar {piezas}', {piezas: piezasTxt(cs.length)})}</span>`])}
    <div class="plano">
      ${cabIA(t('Editar {piezas}', {piezas: piezasTxt(cs.length)}), t('Cambia lo que quieras: solo se guarda lo que cambies. Con «A todas» les pones lo mismo a todas de una vez.'))}
      <section class="caja bloque-caja lote-todas">
        <h3 class="rotulo">${t('A todas')}</h3>
        <div class="lote-todas-filas">
          <label>${t('Sitio')}<input id="lt-sitio" list="ubics" maxlength="120" placeholder="${esc(t('Cajita 3'))}"></label>
          <button class="btn mini" type="button" data-lote-todas="sitio">${t('Poner')}</button>
          <label>${t('Tipo')}<select id="lt-tipo">${opcionesTiposLista('')}</select></label>
          <button class="btn mini" type="button" data-lote-todas="tipo">${t('Poner')}</button>
          <span class="lote-todas-pend">${t('Pendiente')}</span>
          <span class="lote-todas-botones"><button class="btn mini" type="button" data-lote-todas="pend-si">${t('Marcar')}</button>
            <button class="btn mini" type="button" data-lote-todas="pend-no">${t('Quitar')}</button></span>
        </div>
      </section>
      <form id="form-lote" class="caja bloque-caja lote" autocomplete="off">
        <div class="lote-cab" aria-hidden="true"><span>${t('Nombre')}</span><span>${t('Cantidad')}</span><span>${t('Sitio')}</span><span>${t('Tipo')}</span><span>${t('Pendiente')}</span></div>
        ${cs.map((c) => `<div class="lote-fila" data-id="${c.id}">
          <label class="lote-celda lc-nombre"><span class="ed-et">${t('Nombre')}</span><input name="nombre" maxlength="200" required value="${esc(c.nombre)}"></label>
          <label class="lote-celda lc-cantidad"><span class="ed-et">${t('Cantidad')}</span><input name="cantidad" type="number" min="0" inputmode="numeric"
            value="${c.varios ? '' : esc(c.cantidad ?? '')}" placeholder="${c.varios ? esc(t('muchas')) : esc(t('Cantidad'))}"></label>
          <label class="lote-celda lc-sitio"><span class="ed-et">${t('Sitio')}</span><input name="ubicacion" list="ubics" maxlength="120" value="${esc(c.ubicacion)}" placeholder="${esc(t('Sitio'))}"></label>
          <label class="lote-celda lc-tipo"><span class="ed-et">${t('Tipo')}</span><select name="tipo">${opcionesTiposLista(c.tipo || '')}</select></label>
          <label class="lote-celda lc-pend"><input type="checkbox" name="revisar" ${c.revisar ? 'checked' : ''}><span class="ed-et">${t('Pendiente')}</span></label>
        </div>`).join('')}
        <datalist id="ubics">${ubicaciones().map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
        <div class="acciones"><button class="btn prim" type="submit">${t('Guardar cambios')}</button><a class="btn" href="#/">${t('Cancelar')}</a></div>
      </form>
    </div>`;
}
export function ponerATodas(que) {
  const filas = document.querySelectorAll('#form-lote .lote-fila');
  if (que === 'sitio') { const v = $('#lt-sitio').value.trim(); filas.forEach((f) => (f.querySelector('[name=ubicacion]').value = v)); toast(v ? t('Sitio «{v}» puesto a todas (falta guardar)', {v}) : t('Sitio vaciado en todas (falta guardar)')); }
  if (que === 'tipo') { const v = $('#lt-tipo').value; filas.forEach((f) => (f.querySelector('[name=tipo]').value = v)); toast(t('Tipo «{v}» puesto a todas (falta guardar)', {v: v ? g(v).nombre : t('Sin tipo')})); }
  if (que === 'pend-si' || que === 'pend-no') { filas.forEach((f) => (f.querySelector('[name=revisar]').checked = que === 'pend-si')); toast(t('Hecho en todas (falta guardar)')); }
}
export async function guardarLote(form) {
  const piezas = [];
  for (const f of form.querySelectorAll('.lote-fila')) {
    const c = comp(f.dataset.id), v = (n) => f.querySelector(`[name=${n}]`);
    if (!c) continue;
    const p = {id: c.id};
    const nombre = v('nombre').value.trim();
    if (nombre && nombre !== c.nombre) p.nombre = nombre;
    const cant = v('cantidad').value.trim();
    if (c.varios ? cant !== '' : cant !== String(c.cantidad ?? '')) p.cantidad = cant === '' ? null : cant;
    if (v('ubicacion').value.trim() !== (c.ubicacion || '')) p.ubicacion = v('ubicacion').value.trim();
    if (v('tipo').value !== (c.tipo || '')) p.tipo = v('tipo').value || null;
    if (v('revisar').checked !== !!c.revisar) p.revisar = v('revisar').checked;
    if (Object.keys(p).length > 1) piezas.push(p);
  }
  if (!piezas.length) { toast(t('No has cambiado nada')); return; }
  await api('POST', 'api/componentes/lote', {piezas});
  await cargar(); contadores();
  salirSeleccion();
  location.hash = '#/';
  toast(t(piezas.length === 1 ? '{piezas} guardada' : '{piezas} guardadas', {piezas: piezasTxt(piezas.length)}));
}
