// CircuitBin · ia.js — «Añadir con IA» (una pieza o varias en una foto), configuración de la IA, propuesta, dudas y vista previa.
import {$, CATS, D, api, base64, cabIA, campoFoto, cargar, dolares, esc, fechaSql, fotosDelCampo, g, jpeg, lienzoDe, list, migas, piezasTxt, pintarArchivo, plural, proyectosDe, reducida, repetirEn, t, toast, ubicaciones, ui, vacio} from './base.js';
import {ICO, etqCat} from './piezas.js';
import {LOTE, iaLote} from './lotes.js';
import {cajaEsta, cantidadTxt, editorFilas, fichaDelTipo, imagenGrande, leerEditor, notaOjo, selectorTipo} from './fichas.js';
import {contadores} from './app.js';
import {desdePendientes, fichaRevision, textoVolver, vistaCambios, volverRevision} from './revision.js';
import {encuadrar} from './fotos.js';
import {filaLotePendiente, filaPendiente} from './actividad.js';

// ---------- IA: «Añadir con IA» (el modelo propone, el usuario confirma) ----------

// espera mientras el modelo piensa: línea de progreso, qué está pasando, segundos y el esqueleto de la ficha
// (no hay progreso real que medir: los textos dicen lo que se sabe y dan una salida si tarda mucho)
function vistaEspera(foto, modelo, titulo = t('Analizando…')) {
  return `${cabIA(titulo)}
    <div class="ia-progreso" role="progressbar" aria-label="${esc(t('El modelo está pensando'))}"><span></span></div>
    <p class="ia-paso" role="status"><span id="ia-paso">${t('Enviando al modelo…')}</span> · <span id="ia-seg" class="num">0 s</span>
      ${modelo ? `<span class="gris"> · ${esc(nombreModelo(modelo))}</span>` : ''}</p>
    <div class="caja bloque-caja ia-espera">
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
    paso.textContent = s < 4 ? t('Enviando al modelo…')
      : s < 30 ? t('El modelo está mirando la pieza…')
      : s < 90 ? t('Sigue pensando: algunos modelos tardan hasta un minuto…')
      : t('Está tardando mucho. Puedes salir: la propuesta te esperará en «Añadir con IA».');
  };
  tic();
  ticContador = setInterval(tic, 1000);
}
export const avisoIA = (tipo, conBoton = false) => `<div class="nota nota-ia"><p><span class="nota-t">${t('Sin comprobar')}</span> ${t('Esta ficha la escribió la IA: comprueba la tensión y los pines antes de conectar nada.')}</p>
  ${conBoton ? `<button class="btn mini" id="revisada" data-tipo="${esc(tipo)}">${t('Ya la he comprobado')}</button>` : ''}</div>`;
const ESTADO_IA = {pendiente: 'Analizando…', propuesta: 'Esperando a que la mires', error: 'Error', aplicada: 'Guardada', descartada: 'Descartada'};
export const comas = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

// las dos formas de añadir con IA, como pestañas (misma cabecera en las dos pantallas)
const modosIA = (actual) => `<nav class="seg ia-modos" aria-label="${esc(t('Qué quieres añadir'))}">${[['#/ia', t('Una pieza'), 'una'], ['#/ia/varias', t('Varias piezas en una foto'), 'varias']]
  .map(([h, lbl, k]) => `<a class="${k === actual ? 'on' : ''}" href="${h}"${k === actual ? ' aria-current="page"' : ''}>${lbl}</a>`).join('')}</nav>`;
// nombre de una tarea de la IA en las listas. Una pieza que sale de una foto con varias aún no tiene propuesta: se
// enseña el nombre con el que se la vio (va en la pista que se le da al modelo), no la pista entera
export const nombreTareaIA = (tr) => (tr.clase === 'revisar' ? t('Correcciones para «{n}»', {n: tr.objetivo_nombre || '¿?'}) : tr.clase === 'detectar' ? t('Foto con varias piezas')
  : tr.propuesta?.nombre || (String(tr.texto || '').match(/^Esta pieza sale de una foto con varias\. Allí se vio como «([^»]+)»/) || [])[1] || tr.texto || t('Pieza sin nombre'));
// «Añadir con IA» sin clave puesta
const iaSinClave = () => `${migas([`<a href="#/">${t('Inventario')}</a>`, `<span>${t('Añadir con IA')}</span>`])}${vacio(`${t('Falta la clave de OpenCode Go. ')}<a class="btn prim" href="#/ia/ajustes">${t('Configurar')}</a>`)}`;
export function vIA(id) {
  if (id === 'ajustes') return `${migas([`<a href="#/ia">${t('Añadir con IA')}</a>`, `<span>${t('Configuración')}</span>`])}<div class="plano" id="ia-ajustes"><p class="gris">${t('Cargando…')}</p></div>`;
  if (id === 'varias') return vIAVarias();
  if (id) return `${migas([`<a class="back" href="#/ia">${t('Añadir con IA')}</a>`, `<span id="ia-miga">${t('Propuesta')}</span>`])}<div class="plano ia-plano" id="ia-zona"><p class="gris">${t('Cargando…')}</p></div>`;
  if (!D.ia?.activa) return iaSinClave();
  return `${migas([`<a href="#/">${t('Inventario')}</a>`, `<span>${t('Añadir con IA')}</span>`])}
    <div class="plano">
      ${cabIA(t('Añadir con IA'), t('Haz una foto de la pieza y añade lo que sepas. La IA propone el nombre, el tipo y la ficha; tú lo miras y lo corriges antes de guardar.'))}
      ${modosIA('una')}
      <form id="form-ia" class="form caja" autocomplete="off">
        ${campoFoto(t('Fotos'), t('Hasta 4: por delante, por detrás, la serigrafía de cerca. La primera será la foto de la pieza.'), {varias: 4, principal: true})}
        <label>${t('Lo que sepas (opcional)')}<textarea name="texto" rows="2" maxlength="1000" placeholder="${esc(t('Sensor de humedad del kit de Freenove, 3 pines'))}"></textarea></label>
        <label>${t('Modelo')}<select name="modelo" id="ia-modelo-alta"><option value="">${t('El de siempre ({m})', {m: esc(nombreModelo(D.ia.modelo))})}</option></select>
          <span class="ayuda">${t('Solo para esta pieza, por si una difícil merece otro. El de siempre y la clave se cambian en ')}<a href="#/ia/ajustes">${t('Ajustes → IA')}</a>.</span></label>
        <p class="nota" id="ia-aviso-modelo" hidden></p>
        <div class="acciones"><button class="btn prim" type="submit">${t('Analizar')}</button></div>
      </form>
    </div>
    <div id="ia-abiertas"></div>`;
}

// lo que cuesta de verdad una pieza con cada modelo: la media de tus consultas, o una estimación si aún no hay
// (≈ 6000 tokens de entrada —instrucciones, lista de tipos y foto— y 900 de salida)
const costePieza = (m) => (m.coste_medio
  ? t('≈ {c} por pieza · media de tus {n}', {c: dolares(m.coste_medio.dolares), n: plural(m.coste_medio.consultas, 'consulta')})
  : t('≈ {c} por pieza (estimado)', {c: dolares(((m.precio.entrada ?? 0) * 6000 + (m.precio.salida ?? 0) * 900) / 1e6)}));
export let MODELOS_IA = null;
export const olvidarModelosIA = () => { MODELOS_IA = null; }; // tras restaurar una copia (puede traer otra clave)
// lo que NO sabe hacer un modelo, en pocas palabras (vacío si lo hace todo)
const limitesModelo = (m) => [m.vision ? '' : t('no ve fotos'), m.estructurada ? '' : t('sin formato fijo')].filter(Boolean);
export const modeloIA = (id) => MODELOS_IA?.find((m) => m.id === (id || D.ia?.modelo)) || null;
// nombre legible de un modelo («Claude Haiku 5.5») si ya tenemos el catálogo; si no, su identificador
export const nombreModelo = (id) => MODELOS_IA?.find((m) => m.id === id)?.nombre || id || '';
export async function modelosIA(forzar = false) {
  if (!MODELOS_IA || forzar) MODELOS_IA = await api('GET', 'api/ia/modelos');
  return MODELOS_IA;
}

// cuánto razona el modelo antes de responder (tabla ajustes «ia_razonar»); con lo que significa para el modelo elegido
export const RAZONAR = {
  poco: {nombre: 'Poco', sub: 'Rápido y barato. Suficiente para casi todas las piezas.'},
  medio: {nombre: 'Medio', sub: 'Piensa más: para placas raras o serigrafías difíciles. Tarda y cuesta más.'},
  mucho: {nombre: 'Mucho', sub: 'Lo máximo que admita el modelo. Lento y bastante más caro: solo si lo demás falla.'},
};
// lo que pide la app al modelo con cada nivel (igual que server/ia.mjs → esfuerzoPara)
function esfuerzoDe(m, nivel) {
  const l = m?.esfuerzos || [];
  if (m?.api === 'messages' && nivel === 'poco') return t('sin pensamiento');
  if (!l.length) return m?.api === 'messages' ? t(nivel === 'medio' ? 'pensamiento corto' : 'pensamiento largo') : t('lo que decida el modelo');
  return nivel === 'mucho' ? l[l.length - 1] : nivel === 'medio' ? (l.includes('medium') ? 'medium' : l[Math.floor((l.length - 1) / 2)]) : l[0];
}
function bloqueRazonar(m) {
  const actual = RAZONAR[D.ajustes.ia_razonar] ? D.ajustes.ia_razonar : 'poco';
  const nota = !m ? '' : !m.razona ? t('{m} no razona: este ajuste no le cambia nada.', {m: esc(m.nombre)})
    : `${t('Con {m}: ', {m: esc(m.nombre)})}${Object.keys(RAZONAR).map((k) => `${t(RAZONAR[k].nombre).toLowerCase()} = ${esc(esfuerzoDe(m, k))}`).join(' · ')}.`;
  return `<h3>${t('Cuánto razona')}</h3>
    <p class="ayuda">${t('Antes de responder, el modelo «piensa». Más razonamiento acierta más en piezas difíciles, pero tarda más y cuesta más (lo que piensa se cobra como respuesta). Vale para «Añadir con IA» y «Corregir con IA».')}</p>
    <div class="ia-modelos" role="radiogroup" aria-label="${esc(t('Cuánto razona'))}">${Object.entries(RAZONAR).map(([k, v]) => `
      <label class="ia-modelo"><input type="radio" name="ia-razonar" value="${k}" ${k === actual ? 'checked' : ''}>
        <span><span class="nombre">${t(v.nombre)}${k === 'poco' ? `<span class="gris">${t(' · recomendado')}</span>` : ''}</span><span class="sub">${t(v.sub)}</span></span></label>`).join('')}</div>
    ${nota ? `<p class="ayuda">${nota}</p>` : ''}`;
}

// configuración: clave (nunca se vuelve a mostrar) y modelo, elegido de los que el catálogo de Go marca con fotos
// y salida estructurada. Al guardar, el servidor valida el formato y hace una llamada mínima de prueba.
export async function iaAjustes() {
  const zona = $('#ia-ajustes');
  if (!zona) return;
  let cfg, lista = [], fallo = '';
  try { cfg = await api('GET', 'api/ia/config'); } catch (err) { zona.innerHTML = `<p class="mal">${esc(err.message)}</p>`; return; }
  try { lista = await modelosIA(true); } catch (err) { fallo = err.message; }
  const origen = {web: t('guardada en la app'), entorno: t('de la variable IA_CLAVE del servidor')}[cfg.origen_clave];
  const fuera = cfg.modelo && lista.length && !lista.some((m) => m.id === cfg.modelo);
  zona.innerHTML = `${cabIA(t('Configuración de la IA'), t('Proveedor: OpenCode Go. Salen todos sus modelos de chat; los que no ven fotos o no devuelven datos con formato fijo llevan el aviso.'))}
    <section class="caja bloque-caja ia-bloque">
      <h3>${t('Modelo de siempre')}</h3>
      <p class="ayuda">${t('Toca otro para cambiarlo. Se comprueba al momento con tu clave: no hace falta volver a ponerla.')}</p>
      ${lista.length ? `<div class="ia-modelos" role="radiogroup" aria-label="${esc(t('Modelo de siempre'))}">${lista.map((m) => `
        <label class="ia-modelo"><input type="radio" name="ia-modelo" value="${esc(m.id)}" ${m.id === cfg.modelo ? 'checked' : ''}>
          <span><span class="nombre">${esc(m.nombre)}${m.recomendado ? `<span class="gris">${t(' · recomendado')}</span>` : ''}</span>
          <span class="sub">${esc(costePieza(m))}</span>
          ${m.vision ? '' : `<span class="sub aviso">${t('No ve fotos: solo sirve con texto, y no puede con «Varias piezas en una foto».')}</span>`}
          ${m.estructurada ? '' : `<span class="sub aviso">${t('Sin formato fijo: la app saca los datos de su texto. Falla más y deja más cosas por comprobar.')}</span>`}
          <span class="sub">${esc(m.descripcion)}</span></span></label>`).join('')}</div>`
        : `<p class="mal">${esc(fallo || t('No hay modelos disponibles'))}</p>`}
      ${fuera ? `<p class="aviso">${t('El modelo actual («{m}») ya no está en el catálogo: elige otro.', {m: esc(cfg.modelo)})}</p>` : ''}
      <p class="ayuda" id="ia-modelo-estado" role="status"></p>
    </section>
    <section class="caja bloque-caja ia-bloque" id="ia-razonar-zona">${bloqueRazonar(lista.find((m) => m.id === cfg.modelo))}</section>
    <section class="caja bloque-caja ia-bloque">
      <h3>${t('Clave de OpenCode Go')}</h3>
      <p>${cfg.clave ? `${esc(cfg.clave)} · ${esc(origen)}` : `<span class="mal">${t('Sin clave: la IA no funciona hasta que pongas una.')}</span>`}</p>
      ${cfg.clave ? `<div class="acciones"><button class="btn" type="button" id="ia-cambiar-clave">${t('Cambiar clave')}</button></div>` : ''}
      <form id="form-ia-config" class="form sin-pad" autocomplete="off" ${cfg.clave ? 'hidden' : ''}>
        <label>${cfg.clave ? t('Clave nueva') : t('Clave')}
          <input name="clave" type="password" autocomplete="off" spellcheck="false" minlength="16" maxlength="300" pattern="[!-~]{16,300}"
            placeholder="${esc(t('Pega aquí la clave de tu suscripción a Go'))}" required>
          <span class="ayuda">${t('La encontrarás en la consola de OpenCode (suscripción Go). La app la guarda en su base de datos y no la vuelve a enseñar; ojo: va dentro de las copias de seguridad.')}</span></label>
        <div class="acciones">
          <button class="btn prim" type="submit">${t('Probar y guardar')}</button>
          ${cfg.origen_clave === 'web' ? `<button class="btn peligro" type="button" id="ia-quitar">${t('Quitar la clave')}</button>` : ''}
        </div>
      </form>
    </section>`;
}

// cambiar el modelo de siempre con un toque: se comprueba con la clave guardada; si falla, vuelve al anterior
export async function cambiarModeloIA(radio) {
  const estado = $('#ia-modelo-estado'), radios = [...document.querySelectorAll('input[name=ia-modelo]')];
  const anterior = D.ia?.modelo;
  radios.forEach((r) => (r.disabled = true));
  estado.className = 'ayuda';
  estado.textContent = t('Comprobando con OpenCode Go…');
  try {
    D.ia = await api('PUT', 'api/ia/config', {modelo: radio.value});
    const z = $('#ia-razonar-zona');
    if (z) z.innerHTML = bloqueRazonar((MODELOS_IA || []).find((m) => m.id === radio.value));
    estado.textContent = t('Listo: {m} es ahora el modelo de siempre.', {m: radio.closest('label').querySelector('.nombre').firstChild.textContent});
  } catch (err) {
    estado.className = 'mal';
    estado.textContent = err.message;
    const r = radios.find((x) => x.value === anterior);
    if (r) r.checked = true;
  } finally { radios.forEach((r) => (r.disabled = false)); }
}

export async function guardarAjustesIA(form) {
  const clave = String(new FormData(form).get('clave') || '').trim();
  if (!/^[!-~]{16,300}$/.test(clave)) throw new Error(t('La clave no tiene buen formato (16–300 caracteres, sin espacios)'));
  toast(t('Comprobando con OpenCode Go…'));
  D.ia = await api('PUT', 'api/ia/config', {clave});
  toast(t('Clave comprobada y guardada'));
  location.hash = '#/ia';
}

// rellena el desplegable «Modelo para esta pieza» de la pantalla de alta
export async function llenarModelosAlta() {
  const sel = $('#ia-modelo-alta');
  if (!sel) return;
  try {
    const lista = await modelosIA();
    const actual = lista.find((m) => m.id === D.ia?.modelo);
    if (actual) {
      sel.options[0].textContent = t('El de siempre ({m})', {m: `${actual.nombre} · ${costePieza(actual)}`});
      const a = $('#ia-modelo-siempre');
      if (a) a.textContent = actual.nombre;
    }
    sel.insertAdjacentHTML('beforeend', lista.filter((m) => m.id !== D.ia?.modelo && (!sel.dataset.soloFotos || m.vision))
      .map((m) => `<option value="${esc(m.id)}">${esc(m.nombre)}${limitesModelo(m).length ? ` (${limitesModelo(m).join(', ')})` : ''} · ${esc(costePieza(m))}</option>`).join(''));
    avisoModeloAlta();
  } catch {}
}
// con un modelo que no ve fotos, el campo de la foto se apaga (y se dice por qué); sin formato fijo, solo se avisa
export function avisoModeloAlta() {
  const sel = $('#ia-modelo-alta'), aviso = $('#ia-aviso-modelo');
  if (!sel || !aviso) return;
  const m = modeloIA(sel.value), form = sel.form, input = form.querySelector('.archivo-input');
  const sinFotos = !!m && !m.vision, varias = form.id === 'form-ia-varias';
  if (input) {
    if (sinFotos && input.value) { input.value = ''; pintarArchivo(input); }
    input.disabled = sinFotos;
    input.closest('.archivo').classList.toggle('apagado', sinFotos);
  }
  const b = form.querySelector('[type=submit]');
  if (varias && b) b.disabled = sinFotos;
  const partes = !m ? [] : [
    sinFotos ? (varias ? t('{m} no ve fotos: no puede separar las piezas. Elige otro modelo.', {m: m.nombre}) : t('{m} no ve fotos: no se puede subir foto. Describe la pieza con texto (lo que pone en la serigrafía, cuántos pines tiene…).', {m: m.nombre})) : '',
    m.estructurada ? '' : t('{m} no devuelve datos con formato fijo: puede fallar o dejar más cosas por comprobar.', {m: m.nombre})].filter(Boolean);
  aviso.hidden = !partes.length;
  aviso.textContent = partes.join(' ');
}

// ---------- foto con varias piezas: el modelo las separa, tú eliges cuáles, y cada una se identifica con su recorte ----------
function vIAVarias() {
  if (!D.ia?.activa) return iaSinClave();
  return `${migas([`<a href="#/">${t('Inventario')}</a>`, `<span>${t('Añadir con IA')}</span>`])}
    <div class="plano">
      ${cabIA(t('Añadir con IA'), t('Pon las piezas separadas sobre un fondo liso y hazles una foto desde arriba. La IA las separa, tú eliges cuáles dar de alta y después identifica cada una con su recorte. Nada se guarda hasta que lo confirmes.'))}
      ${modosIA('varias')}
      <form id="form-ia-varias" class="form caja" autocomplete="off">
        ${campoFoto(t('Foto con las piezas'), t('Mejor pocas y que se lean (hasta 40). Con muchas piezas pequeñas, haz varias fotos.'))}
        <label>${t('Lo que sepas de ellas (opcional)')}<textarea name="texto" rows="2" maxlength="1000" placeholder="${esc(t('Son del kit de sensores de Freenove'))}"></textarea></label>
        <label>${t('Modelo')}<select name="modelo" id="ia-modelo-alta" data-solo-fotos="1"><option value="">${t('El de siempre ({m})', {m: esc(nombreModelo(D.ia.modelo))})}</option></select>
          <span class="ayuda">${t('Solo salen los que ven fotos. Gasta una consulta para separarlas y otra por cada pieza que elijas.')}</span></label>
        <p class="nota" id="ia-aviso-modelo" hidden></p>
        <div class="acciones"><button class="btn prim" type="submit">${t('Separar las piezas')}</button></div>
      </form>
    </div>`;
}
export async function enviarVarias(form) {
  const fd = new FormData(form), file = fd.get('foto');
  if (!file || !file.size) throw new Error(t('Elige la foto con las piezas'));
  toast(t('Enviando la foto…'));
  const foto = await base64(await jpeg(await lienzoDe(file, 2000))); // entera, sin encuadrar: los recortes salen de ella
  const tr = await api('POST', 'api/ia/detectar', {texto: fd.get('texto'), foto, modelo: fd.get('modelo') || undefined});
  location.hash = `#/ia/${tr.id}`;
}
// recuadro de una pieza con un margen del 8 % (los modelos no afinan los bordes); sin recuadro, la foto entera
const cajaConMargen = (c) => {
  if (!c) return {x: 0, y: 0, ancho: 1000, alto: 1000};
  const mx = c.ancho * 0.08, my = c.alto * 0.08, x = Math.max(0, c.x - mx), y = Math.max(0, c.y - my);
  return {x, y, ancho: Math.min(1000 - x, c.ancho + 2 * mx), alto: Math.min(1000 - y, c.alto + 2 * my)};
};
function recortar(img, caja, max) {
  const c = cajaConMargen(caja), W = img.naturalWidth, H = img.naturalHeight;
  const sx = c.x / 1000 * W, sy = c.y / 1000 * H, sw = Math.max(1, c.ancho / 1000 * W), sh = Math.max(1, c.alto / 1000 * H);
  const k = Math.min(1, max / Math.max(sw, sh)), cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sw * k)); cv.height = Math.max(1, Math.round(sh * k));
  cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return cv;
}
let DETECCION = null; // la tarea que se está mirando
function vistaDeteccion(tr) {
  DETECCION = tr;
  const p = tr.propuesta, url = `fotos/${encodeURIComponent(tr.foto)}`;
  const meta = `<p class="ia-meta"><span>${esc(nombreModelo(tr.modelo))}</span>${costeTexto(p.coste) ? `<span>${esc(costeTexto(p.coste))}</span>` : ''}</p>`;
  return `${cabIA(t('{piezas} en la foto', {piezas: plural(p.piezas.length, 'pieza')}), t('Desmarca las que no quieras y corrige el nombre si hace falta (es solo una pista). Después la IA identifica cada una con su recorte y te las enseña juntas para guardarlas.'), meta)}
    ${p.dudas?.length ? `<div class="ams-aviso aviso-ojo"><b>${ICO.aviso}${t('Ojo')}</b><p>${p.dudas.map((d) => esc(t(d))).join(' ')}</p></div>` : ''}
    <div class="det">
      <div class="caja bloque-caja det-foto-caja"><div class="det-foto"><img id="det-img" src="${url}" alt="${esc(t('La foto con las piezas numeradas'))}">
        ${p.piezas.map((x, i) => (x.caja ? `<span class="det-caja" data-i="${i}" style="left:${x.caja.x / 10}%;top:${x.caja.y / 10}%;width:${x.caja.ancho / 10}%;height:${x.caja.alto / 10}%"><b>${i + 1}</b></span>` : '')).join('')}</div></div>
      <div class="caja bloque-caja det-lista">${p.piezas.map((x, i) => `<div class="det-pieza" data-i="${i}">
        <label class="det-marca"><input type="checkbox" class="det-ok" checked aria-label="${esc(t('Dar de alta la pieza {n}', {n: i + 1}))}"><b>${i + 1}</b></label>
        <span class="det-mini" data-i="${i}"></span>
        <div class="det-datos"><input class="det-nombre" maxlength="200" value="${esc(x.nombre)}" aria-label="${esc(t('Nombre de la pieza {n}', {n: i + 1}))}">
          ${x.descripcion ? `<span class="sub">${esc(x.descripcion)}</span>` : ''}${x.caja ? '' : `<span class="sub aviso">${t('Sin recuadro: se usará la foto entera.')}</span>`}</div>
        <label class="det-cant">${t('Cant.')}<input type="number" class="det-cantidad" min="1" inputmode="numeric" value="${esc(x.cantidad ?? 1)}"></label>
      </div>`).join('')}</div>
    </div>
    <div class="acciones lote-acciones">
      <button class="btn prim" type="button" id="det-crear" data-id="${tr.id}">${t('Identificar las marcadas')}</button>
      <button class="btn" type="button" data-det-marcar="todo">${t('Marcar todas')}</button>
      <button class="btn" type="button" data-det-marcar="nada">${t('Ninguna')}</button>
      <button class="btn peligro" type="button" id="ia-descartar" data-id="${tr.id}" data-volver="#/ia/varias">${t('Descartar')}</button>
    </div>`;
}
// miniaturas de cada pieza (recortes de la foto) y texto del botón
function pintarDeteccion() {
  const img = $('#det-img');
  if (!img || !DETECCION) return;
  const hacer = () => document.querySelectorAll('.det-mini').forEach((m) => { if (!m.firstChild) m.append(recortar(img, DETECCION.propuesta.piezas[m.dataset.i].caja, 160)); });
  if (img.complete && img.naturalWidth) hacer(); else img.addEventListener('load', hacer, {once: true});
  contarDeteccion();
}
export function contarDeteccion() {
  const b = $('#det-crear');
  if (!b) return;
  const n = document.querySelectorAll('.det-ok:checked').length;
  document.querySelectorAll('.det-pieza').forEach((f) => { const ok = f.querySelector('.det-ok').checked; f.classList.toggle('fuera', !ok);
    document.querySelector(`.det-caja[data-i="${f.dataset.i}"]`)?.classList.toggle('fuera', !ok); });
  b.textContent = n ? t('Identificar {piezas} ({consultas})', {piezas: piezasTxt(n), consultas: plural(n, 'consulta')}) : t('Marca alguna pieza');
  b.disabled = !n;
}
export async function crearDeteccion(boton) {
  const img = $('#det-img'), tr = DETECCION;
  if (!img?.naturalWidth) throw new Error(t('La foto aún no ha cargado'));
  boton.disabled = true;
  boton.textContent = t('Recortando…');
  const piezas = [];
  for (const f of document.querySelectorAll('.det-pieza')) {
    if (!f.querySelector('.det-ok').checked) continue;
    const x = tr.propuesta.piezas[f.dataset.i];
    piezas.push({nombre: f.querySelector('.det-nombre').value.trim() || x.nombre, descripcion: x.descripcion, cantidad: Number(f.querySelector('.det-cantidad').value) || 1,
      foto: await base64(await jpeg(recortar(img, x.caja, 1200)))});
  }
  toast(t('Enviando {piezas}…', {piezas: piezasTxt(piezas.length)}));
  const r = await api('POST', `api/ia/tareas/${tr.id}/crear-piezas`, {piezas});
  location.hash = `#/ia/lote/${r.lote}`;
}

// ---- lote de piezas nuevas (de una foto con varias): se guardan las marcadas tal como las propone la IA ----
export function htmlLoteAltas(ts) {
  const listas = ts.filter((tr) => tr.estado !== 'pendiente').length;
  const tarea = (tr) => {
    const p = tr.propuesta || {};
    const tipo = p.tipo_existente ? esc(g(p.tipo_existente).nombre) : p.tipo_nuevo ? `${esc(p.tipo_nuevo.nombre)} <span class="aviso">${t('· tipo nuevo, sin comprobar')}</span>` : t('Sin tipo');
    const estado = {pendiente: t('identificando…'), propuesta: t('confianza {c}', {c: t(p.confianza || '?')}), aplicada: t('guardada'), descartada: t('descartada'), error: t('error')}[tr.estado] || tr.estado;
    const mini = `<span class="fila-img">${tr.foto ? `<img src="fotos/${encodeURIComponent(tr.foto)}" alt="" loading="lazy">` : ''}</span>`;
    const cuerpo = tr.estado === 'error' ? `<p class="mal">${esc(t(tr.error || 'Error'))}</p>`
      : tr.estado === 'propuesta' ? `<p class="sub">${tipo} · ${p.cantidad ?? 1} ${t('ud.')}</p>` : '';
    // la confianza y las dudas como etiquetas; en las demás, su estado
    const etqs = tr.estado === 'propuesta' ? `${etqConfianza(p.confianza)}${p.dudas?.length ? `<span class="ams-etiqueta ams-etiqueta--amarilla">${plural(p.dudas.length, 'duda')}</span>` : ''}`
      : `<span class="ams-etiqueta${tr.estado === 'error' ? ' ams-etiqueta--mal' : tr.estado === 'aplicada' ? ' ams-etiqueta--ok' : ''}">${esc(estado)}</span>`;
    const nombre = esc(p.nombre || t('Pieza sin identificar'));
    return `<section class="lote-tarea lote-alta lote-${tr.estado}">
      ${tr.estado === 'propuesta' ? `<input type="checkbox" class="lote-cambio" data-tarea="${tr.id}" value="alta" aria-label="${esc(t('Guardar {nombre}', {nombre}))}" ${LOTE.desmarcados.has(`${tr.id}:alta`) ? '' : 'checked'}>` : '<span></span>'}
      ${mini}
      <div class="lote-alta-main"><div class="lote-t">${tr.estado === 'aplicada' && tr.componente_id ? `<a class="nombre" href="#/c/${tr.componente_id}">${nombre}</a>` : `<span class="nombre">${nombre}</span>`}
        <span class="lote-etqs">${etqs}</span></div>${cuerpo}</div>
      ${tr.estado === 'propuesta' ? `<a class="btn mini lote-abrir" href="#/ia/${tr.id}">${p.dudas?.length ? t('Contestar') : t('Abrir')}</a>` : '<span></span>'}</section>`;
  };
  const quedan = ts.some((tr) => tr.estado === 'propuesta' || tr.estado === 'error');
  return `${cabIA(t('{piezas} de una foto', {piezas: piezasTxt(ts.length)}), listas < ts.length
      ? t('Identificando… {a} de {b} listas. Puedes ir mirando las que ya han llegado.', {a: listas, b: ts.length})
      : t('Guarda las marcadas tal como están, o abre una para corregirla, contestar sus dudas o ponerle sitio. Las fichas nuevas quedan «sin comprobar».'))}
    ${listas < ts.length ? `<div class="ia-progreso" role="progressbar" aria-label="${esc(t('La IA está identificando las piezas'))}"><span></span></div>` : ''}
    <div class="caja lote-lista">${ts.map(tarea).join('')}</div>
    ${quedan ? `<div class="acciones lote-acciones">
      <button class="btn prim" type="button" id="lote-guardar">${t('Guardar las marcadas')}</button>
      <button class="btn" type="button" data-lote-marcar="todo">${t('Marcar todas')}</button>
      <button class="btn" type="button" data-lote-marcar="nada">${t('Ninguna')}</button>
      <button class="btn peligro" type="button" id="lote-descartar">${t('Descartar lo que quede')}</button></div>` : `<p class="gris">${t('Ya no queda nada por revisar de esta foto.')}</p>`}`;
}
export async function guardarLoteAltas(boton) {
  const ids = [...document.querySelectorAll('.lote-cambio:checked')].map((x) => Number(x.dataset.tarea));
  if (!ids.length) throw new Error(t('Marca alguna pieza'));
  boton.disabled = true;
  boton.textContent = t('Guardando…');
  const r = await api('POST', `api/ia/lotes/${encodeURIComponent(LOTE.id)}/guardar`, {ids});
  await cargar(); contadores();
  await iaLote(LOTE.id);
  toast(t(r.guardadas.length === 1 ? '{piezas} guardada' : '{piezas} guardadas', {piezas: piezasTxt(r.guardadas.length)}) + (r.fallos.length ? `; ${r.fallos.length} (${t(r.fallos[0].error)})` : ''), r.fallos.length > 0);
}

// lista de tareas abiertas (debajo del formulario): nada se pierde si cierras la pestaña mientras el modelo piensa
export async function iaAbiertas() {
  const zona = $('#ia-abiertas');
  if (!zona) return;
  try {
    const p = await api('GET', 'api/ia/pendientes'), n = p.lotes.length + p.tareas.length, MAX = 6;
    const filas = [...p.lotes.map(filaLotePendiente), ...p.tareas.map(filaPendiente)];
    zona.innerHTML = n ? `<section class="grupo"><h3 class="grupo-t">${t('Sin terminar')}<span class="n">${n}</span></h3>${filas.slice(0, MAX).join('')}
      <p class="sub ia-abiertas-mas"><a href="#/pendientes">${n > MAX ? t('Ver las {n} en «Cambios pendientes»', {n}) : t('Verlo en «Cambios pendientes»')} →</a></p></section>` : '';
    if (p.lotes.some((l) => l.estados.pendiente) || p.tareas.some((tr) => tr.estado === 'pendiente')) repetirEn(4000, iaAbiertas, '#/ia');
  } catch {}
}

export async function iaTarea(id) {
  const zona = $('#ia-zona');
  if (!zona) return;
  let tr;
  try { tr = await api('GET', `api/ia/tareas/${id}`); } catch (err) { zona.innerHTML = `<p class="mal">${esc(err.message)}</p>`; return; }
  const foto = tr.foto ? `<img class="foto ia-foto" src="fotos/${encodeURIComponent(tr.foto)}" alt="">` : '';
  const atras = document.querySelector('a.back'), miga = $('#ia-miga');
  if (atras && tr.clase === 'revisar') { atras.href = volverRevision(tr); atras.textContent = textoVolver(tr); }
  else if (atras && tr.lote) { atras.href = `#/ia/lote/${encodeURIComponent(tr.lote)}`; atras.textContent = t('Las piezas de la foto'); }
  else if (atras && desdePendientes(tr)) { atras.href = '#/pendientes'; atras.textContent = t('Cambios pendientes'); }
  if (miga) miga.textContent = tr.clase === 'revisar' ? t('Correcciones') : tr.clase === 'detectar' ? t('Piezas en la foto') : t('Propuesta');
  if (tr.estado === 'pendiente') {
    // la pantalla de espera se pinta UNA vez (si no, la animación y el contador se reiniciarían en cada consulta)
    const clave = `${tr.id}-${tr.rondas}`;
    if (zona.dataset.espera !== clave) {
      zona.dataset.espera = clave;
      const lleva = Math.max(0, (fechaSql(tr.ahora) - fechaSql(tr.actualizada)) / 1000) || 0; // segundos que lleva, según el servidor
      zona.dataset.inicio = String(Date.now() - lleva * 1000);
      zona.innerHTML = vistaEspera(foto, tr.modelo_pedido || D.ia?.modelo, tr.clase === 'revisar' ? t('Repasando la ficha…') : tr.clase === 'detectar' ? t('Separando las piezas…') : t('Analizando…'));
      arrancarContador(zona);
    }
    repetirEn(2500, () => iaTarea(id));
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
  if (tr.estado === 'error') {
    pintar(`${cabIA(t('No ha salido'), t(tr.error || 'Error desconocido'))}
      ${foto ? `<div class="caja bloque-caja">${foto}</div>` : ''}
      <div class="acciones"><a class="btn prim" href="${tr.clase === 'revisar' ? fichaRevision(tr) : tr.clase === 'detectar' ? '#/ia/varias' : '#/ia'}">${t('Probar otra vez')}</a>
        <button class="btn peligro" id="ia-descartar" data-id="${tr.id}">${t('Descartar')}</button></div>`);
    return;
  }
  if (tr.estado !== 'propuesta') {
    const enlace = tr.clase === 'revisar' ? `<a class="btn" href="${volverRevision(tr)}">${textoVolver(tr)}</a>`
      : tr.clase === 'detectar' && tr.propuesta?.lote ? `<a class="btn" href="#/ia/lote/${esc(tr.propuesta.lote)}">${t('Ver las piezas de la foto')}</a>`
      : tr.componente_id ? `<a class="btn" href="#/c/${tr.componente_id}">${t('Ver la pieza')}</a>` : '';
    pintar(`${cabIA(t(ESTADO_IA[tr.estado]))}${enlace ? `<div class="acciones">${enlace}</div>` : ''}`);
    return;
  }
  if (tr.clase === 'revisar') { pintar(vistaCambios(tr)); return; }
  if (tr.clase === 'detectar') { pintar(vistaDeteccion(tr)); pintarDeteccion(); return; }
  const p = tr.propuesta, n = p.tipo_nuevo || {}, sel = p.tipo_existente || (p.tipo_nuevo ? '__nuevo' : '');
  // como una ficha: la foto grande a la izquierda y, a la derecha, las dudas y el formulario en cajas
  const meta = `<p class="ia-meta">${etqConfianza(p.confianza)}<span>${esc(nombreModelo(tr.modelo))}</span>${costeTexto(p.coste) ? `<span>${esc(costeTexto(p.coste))}</span>` : ''}${tr.rondas ? `<span>${t('Vuelta {n}', {n: tr.rondas + 1})}</span>` : ''}</p>`;
  const tira = tiraFotos(tr);
  pintar(`${cabIA(t('Revisa la propuesta'), t('Corrige lo que haga falta, mira cómo quedará y guarda. Nada se ha guardado todavía.'), meta)}
    <div class="seg ia-pestanas" role="group" aria-label="${esc(t('Vista'))}">
      <button class="on" type="button" data-ia-vista="editar" aria-pressed="true">${t('Editar')}</button>
      <button type="button" data-ia-vista="previa" aria-pressed="false">${t('Vista previa')}</button>
    </div>
    <div id="ia-previa" hidden></div>
    <div class="ia-cuerpo${tr.foto ? '' : ' sin-foto'}" id="ia-editar">
    ${tr.foto ? `<aside class="ia-lado"><figure class="fi-img con-foto"><a class="fi-img-marco" href="fotos/${encodeURIComponent(tr.foto)}" target="_blank" rel="noopener" aria-label="${esc(t('Ver la foto grande'))}"><img src="fotos/${encodeURIComponent(tr.foto)}" alt=""></a>
      ${tira ? `<figcaption>${tira}</figcaption>` : ''}</figure></aside>` : ''}
    <div class="ia-principal">
    ${dudasIA(tr, p)}
    <form id="form-ia-ok" class="form caja" autocomplete="off" data-id="${tr.id}" data-foto="${tr.foto ? `fotos/${encodeURIComponent(tr.foto)}` : ''}">
      <label>${t('Nombre')}<input name="nombre" required maxlength="200" value="${esc(p.nombre)}"></label>
      <div class="campo"><span class="campo-t">${t('Tipo')}</span>${selectorTipo(sel, p.tipo_nuevo ? t('Nuevo: {n} (propuesto por la IA)', {n: p.tipo_nuevo.nombre}) : t('Nuevo tipo…'))}</div>
      <div id="nuevo-tipo" class="nuevo-tipo" ${sel === '__nuevo' ? '' : 'hidden'}>
        <p class="nota nota-ia">${t('Ficha nueva escrita por la IA: quedará marcada como «sin comprobar».')}</p>
        <label>${t('Nombre del tipo')}<input name="tn_nombre" maxlength="120" value="${esc(n.nombre || '')}"></label>
        <label>${t('Categoría')}<select name="tn_categoria">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k === (n.categoria || 'otro') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>${t('Resumen')}<textarea name="tn_resumen" rows="2" maxlength="400">${esc(n.resumen || '')}</textarea></label>
        <label>${t('Tensión')}<input name="tn_voltaje" maxlength="120" value="${esc(n.voltaje || '')}"></label>
        <label>${t('Interfaces (separadas por comas)')}<input name="tn_interfaz" value="${esc(list(n.interfaz).join(', '))}"></label>
        <label>${t('Otros nombres (separados por comas)')}<input name="tn_alias" value="${esc(list(n.alias).join(', '))}"></label>
        ${editorFilas('pines', n.pines, {campo: 'tn_pines', etiqueta: t('Pines'), boton: t('Añadir pin'), ayuda: t('Un pin por fila, en el orden de la placa. La función da el color del pin; en la nota, lo que haya que saber de ese pin. Si escribes varios en una fila, se separan solos.')})}
        ${editorFilas('datos', n.datos, {campo: 'tn_datos', etiqueta: t('Datos del tipo'), boton: t('Añadir dato'), ayuda: t('Iguales para todas las piezas de este tipo.')})}
        <label>${t('Ojo (advertencia)')}<textarea name="tn_ojo" rows="2" maxlength="400">${esc(n.ojo || '')}</textarea></label>
      </div>
      ${editorFilas('datos', p.datos_pieza, {campo: 'datos_pieza', etiqueta: t('Datos de esta pieza'), boton: t('Añadir dato')})}
      <div class="dos">
        <label>${t('Cantidad')}<input name="cantidad" type="number" min="0" inputmode="numeric" value="${esc(p.cantidad ?? 1)}"></label>
        <label class="check"><input type="checkbox" name="varios"> ${t('Hay muchos (sin contar)')}</label>
      </div>
      <label>${t('Sitio')}<input name="ubicacion" list="ubics" maxlength="120" placeholder="${esc(t('Cajita 3'))}"></label>
      <datalist id="ubics">${ubicaciones().map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
      <label>${t('Notas')}<textarea name="notas" rows="2" maxlength="2000"></textarea></label>
      <div class="acciones">
        <button class="btn prim" type="submit">${t('Guardar pieza')}</button>
        <button class="btn peligro" type="button" id="ia-descartar" data-id="${tr.id}"${tr.lote ? ` data-volver="#/ia/lote/${esc(tr.lote)}"` : ''}>${t('Descartar')}</button>
      </div>
    </form></div></div>`);
}

export async function enviarIA(form) {
  const fd = new FormData(form);
  const [file, ...otras] = fotosDelCampo(form.querySelector('.archivo-input'));
  let foto = null;
  if (file) { // la primera es la que se queda la pieza: se encuadra como siempre
    const blob = await encuadrar(file);
    if (!blob) throw new Error(t('Foto cancelada: no se ha enviado nada'));
    foto = await base64(blob);
  }
  toast(otras.length ? t('Enviando {n} fotos…', {n: otras.length + 1}) : t('Enviando…'));
  const fotos = await Promise.all(otras.map(reducida));
  const tr = await api('POST', 'api/ia/alta', {texto: fd.get('texto'), foto, fotos, modelo: fd.get('modelo') || undefined});
  location.hash = `#/ia/${tr.id}`;
}

// lo que hay ahora mismo en el formulario de la propuesta (sirve para guardar, para la vista previa y para repensar)
function leerFormIA(form) {
  const fd = new FormData(form);
  const varios = !!fd.get('varios');
  const body = {
    nombre: fd.get('nombre'), tipo: fd.get('tipo') || null, varios, cantidad: varios ? null : fd.get('cantidad'),
    ubicacion: fd.get('ubicacion'), notas: fd.get('notas'), datos_pieza: leerEditor(form, 'datos_pieza'),
  };
  if (body.tipo === '__nuevo') body.tipo_nuevo = {
    nombre: fd.get('tn_nombre'), categoria: fd.get('tn_categoria'), resumen: fd.get('tn_resumen'), voltaje: fd.get('tn_voltaje'),
    interfaz: comas(fd.get('tn_interfaz')), alias: comas(fd.get('tn_alias')), ojo: fd.get('tn_ojo'),
    datos: leerEditor(form, 'tn_datos'), pines: leerEditor(form, 'tn_pines'),
  };
  return body;
}

// las otras fotos que ha mirado el modelo (las de más al empezar y las de las respuestas), en pequeño
export function tiraFotos(tr, todas = false) {
  const fs = (tr.fotos || []).filter((f) => todas || f !== tr.foto);
  if (!fs.length || (todas && fs.length < 2)) return '';
  return `<div class="ia-tira${todas ? ' pad' : ''}">${todas ? '' : `<span class="ayuda">${t('También ha mirado:')}</span>`}${fs.map((f) =>
    `<a href="fotos/${encodeURIComponent(f)}" target="_blank" rel="noopener"><img src="fotos/${encodeURIComponent(f)}" alt="" loading="lazy"></a>`).join('')}</div>`;
}
// la confianza del modelo como etiqueta
export const etqConfianza = (c) => `<span class="ams-etiqueta ${c === 'alta' ? 'ams-etiqueta--ok' : c === 'media' ? 'ams-etiqueta--amarilla' : 'ams-etiqueta--mal'}">${t('Confianza {c}', {c: esc(t(c || '?'))})}</span>`;
export const costeTexto = (c) => (c?.dolares == null ? '' : `≈ ${dolares(c.dolares)}`);

// dudas del modelo, cada una con su hueco para contestar y, si el modelo ve fotos, su foto («¿qué pone en la
// serigrafía?» → la foto de la serigrafía). Debajo, lo que quieras añadir y más fotos sueltas. «Responder y repensar»
// le manda todo junto con lo que hayas corregido en el formulario, y el modelo rehace la propuesta (como mucho 5 vueltas)
export function dudasIA(tr, p) {
  const quedan = (tr.rondas || 0) < 5, correccion = tr.clase === 'revisar';
  const m = modeloIA(tr.modelo_pedido || tr.modelo), usadas = tr.fotos?.length || 0, libres = Math.min(4, 8 - usadas);
  const puedeFotos = quedan && (!m || m.vision) && libres > 0;
  // lo que no es una pregunta (avisos de la app: «se han corregido solos algunos campos») no lleva hueco para contestar
  const avisos = (p.dudas || []).filter((d) => !d.includes('?'));
  p = {...p, dudas: (p.dudas || []).filter((d) => d.includes('?'))};
  // las respuestas que propone el modelo para cada duda (propuesta.opciones[pregunta]): se eligen con un toque
  const ops = (d) => list(p.opciones?.[d]);
  return `<section class="ia-dudas pad" id="ia-dudas" data-libres="${puedeFotos ? libres : 0}">
    <h3>${p.dudas?.length ? (p.dudas.length === 1 ? t('La IA tiene una duda') : t('La IA tiene {n} dudas', {n: p.dudas.length})) : t('¿Algo que aclarar?')}</h3>
    ${avisos.map((d) => `<p class="ia-aviso">${esc(t(d))}</p>`).join('')}
    ${p.dudas?.length ? `<ol class="ia-preguntas">${p.dudas.map((d, i) => `<li><p>${esc(d)}</p>
      ${ops(d).length ? `<div class="ia-ops" role="group" aria-label="${esc(t('Respuestas propuestas a la duda {n}', {n: i + 1}))}">${ops(d).map((o) =>
        `<button class="ia-op" type="button" data-op="${esc(o)}" aria-pressed="false">${esc(o)}</button>`).join('')}</div>` : ''}
      <div class="ia-resp-fila"><input class="ia-resp" data-duda="${esc(d)}" maxlength="500" placeholder="${esc(ops(d).length ? t('Elige una o escribe otra respuesta') : t('Tu respuesta'))}" autocomplete="off" aria-label="${esc(t('Respuesta a la duda {n}', {n: i + 1}))}">
        ${puedeFotos ? campoFoto('', '', {compacto: true}) : ''}</div></li>`).join('')}</ol>` : ''}
    <label class="ia-extra">${p.dudas?.length ? t('Algo más (opcional)') : correccion ? t('Qué más tiene que corregir o saber') : t('Qué más tiene que saber')}
      <textarea id="ia-extra" rows="2" maxlength="1000" placeholder="${esc(correccion ? t('Tiene 16 MB de flash · Añade el consumo') : t('Tiene 3 pines · Es la versión en placa'))}"></textarea></label>
    ${puedeFotos ? campoFoto(p.dudas?.length ? t('Más fotos (opcional)') : t('Fotos (opcional)'), t('La serigrafía de cerca, la otra cara… Hasta {libres} en esta vuelta{contando}{usadas}.', {
      libres, contando: p.dudas?.length ? t(', contando las de las respuestas') : '', usadas: usadas ? t(' (la consulta lleva {usadas} de 8)', {usadas}) : '',
    }), {varias: libres}) : ''}
    <div class="acciones">${quedan
      ? `<button class="btn prim" type="button" id="ia-responder" data-id="${tr.id}">${t('Responder y repensar')}</button>
         <span class="ayuda">${correccion ? t('La IA vuelve a mirar la ficha con tus respuestas y rehace los cambios. Gasta otra consulta.') : t('Rehace la propuesta con tus respuestas y con lo que hayas corregido abajo. Gasta otra consulta.')}</span>`
      : `<span class="ayuda">${t('Ya van 5 vueltas: {msg}.', {msg: correccion ? t('aplica lo que te sirva y corrige a mano el resto') : t('corrige a mano lo que falte y guarda')})}</span>`}</div>
  </section>`;
}

// vista previa: la ficha tal como se verá en el inventario, con la misma disposición AMSTech que la ficha real (.fi)
function vistaPreviaIA(b, urlFoto) {
  const nuevo = b.tipo === '__nuevo';
  const tipoId = !nuevo && b.tipo && D.tipos[b.tipo] ? b.tipo : '';
  const f = nuevo ? {...b.tipo_nuevo, revisado: 0} : tipoId ? g(tipoId) : null;
  const cat = f ? (f.categoria || 'otro') : 'otro';
  const ps = tipoId ? proyectosDe(tipoId) : [];
  const ft = f ? fichaDelTipo(f, tipoId, ps, nuevo ? t('Ficha nueva propuesta por la IA (quedará sin comprobar)') : t('Común a todas las piezas de este tipo')) : {der: '', izq: ''};
  const esta = cajaEsta({cantidad: cantidadTxt(b.varios, b.cantidad), sitio: b.ubicacion, cat, datos: b.datos_pieza, notas: b.notas,
    tipo: f ? `${esc(f.nombre)}${nuevo ? ` <span class="etq-pend">${t('nuevo')}</span>` : ''}` : t('Sin tipo')});
  return `<div class="caja previa-barra"><span class="ams-etiqueta ams-etiqueta--amarilla">${t('Vista previa')}</span>
      <p>${t('Así quedará{extra}. Aún no se ha guardado nada.', {extra: nuevo ? t(' la pieza, y el tipo nuevo «{n}» en el glosario', {n: esc(f.nombre)}) : t(' la pieza')})}</p>
      <button class="btn mini" type="button" data-ia-vista="editar">${t('Volver a editar')}</button></div>
    <article class="fi">
      <div class="fi-izq">
        ${imagenGrande({foto: urlFoto, tipo: tipoId, cat, pie: `<span>${urlFoto ? t('Foto de la pieza') : tipoId ? t('Dibujo del tipo · aún sin foto') : t('Aún sin foto')}</span>`})}
        ${esta}
        ${ft.izq}
      </div>
      <div class="fi-der">
        <header class="fi-cab">${etqCat(cat, 'etq-cat')}<h1>${esc(b.nombre || t('(sin nombre)'))}</h1>
          ${f?.resumen ? `<p class="fi-resumen">${esc(f.resumen)}</p>` : ''}</header>
        ${f ? notaOjo(f) : ''}
        ${nuevo || f?.revisado === 0 ? avisoIA('') : ''}
        ${f ? ft.der : `<p class="gris">${t('Sin tipo: no se verán pines ni ficha técnica.')}</p>`}
      </div>
    </article>
    <div class="acciones"><button class="btn prim" type="button" id="ia-guardar-previa">${t('Guardar pieza')}</button>
      <button class="btn" type="button" data-ia-vista="editar">${t('Volver a editar')}</button></div>`;
}

export function verVistaIA(vista) {
  const form = $('#form-ia-ok'), previa = $('#ia-previa'), editar = $('#ia-editar');
  if (!form || !previa) return;
  const ver = vista === 'previa';
  if (ver) previa.innerHTML = vistaPreviaIA(leerFormIA(form), form.dataset.foto);
  previa.hidden = !ver;
  if (editar) editar.hidden = ver;
  document.querySelectorAll('.ia-pestanas [data-ia-vista]').forEach((b) => {
    const on = b.dataset.iaVista === vista;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

export async function responderIA(boton) {
  const zona = $('#ia-dudas');
  // cada duda con su respuesta y su foto (una foto sola ya es una respuesta)
  const dudas = [...zona.querySelectorAll('.ia-preguntas li')].map((li) => ({duda: li.querySelector('.ia-resp').dataset.duda,
    respuesta: li.querySelector('.ia-resp').value.trim(), archivos: fotosDelCampo(li.querySelector('.archivo-input'))})).filter((r) => r.respuesta || r.archivos.length);
  const extra = ($('#ia-extra')?.value || '').trim();
  const sueltas = fotosDelCampo([...zona.querySelectorAll('.archivo-input')].find((i) => !i.closest('.ia-preguntas')));
  const nFotos = sueltas.length + dudas.reduce((n, r) => n + r.archivos.length, 0), libres = Number(zona.dataset.libres) || 0;
  if (!dudas.length && !extra && !nFotos) throw new Error(t('Contesta alguna duda, escribe algo más o añade una foto antes de repensar'));
  if (nFotos > libres) throw new Error(t('En esta vuelta caben {libres} fotos y has puesto {n}: quita {sobre}', {libres, n: nFotos, sobre: nFotos - libres}));
  boton.disabled = true;
  toast(nFotos ? t('Repensando con tus respuestas y {fotos}…', {fotos: nFotos === 1 ? t('la foto') : `${nFotos} ${t('fotos')}`}) : t('Repensando con tus respuestas…'));
  const respuestas = await Promise.all(dudas.map(async (r) => ({duda: r.duda, respuesta: r.respuesta, fotos: await Promise.all(r.archivos.map(reducida))})));
  const fotos = await Promise.all(sueltas.map(reducida));
  const form = $('#form-ia-ok'); // solo en un alta: lo que el usuario ya ha corregido de la propuesta
  await api('POST', `api/ia/tareas/${boton.dataset.id}/responder`, {respuestas, extra, fotos, ...(form ? {propuesta: leerFormIA(form)} : {})});
  iaTarea(boton.dataset.id); // vuelve a «Analizando…» y se actualiza sola
}

export async function aplicarIA(form) {
  const body = leerFormIA(form);
  const r = await api('POST', `api/ia/tareas/${form.dataset.id}/aplicar`, body);
  await cargar(); // trae la pieza, la ficha nueva (si la hay) y los contadores
  contadores();
  toast(t('Guardada'));
  location.hash = LOTE.id && ui.origenTarea?.desde === `#/ia/lote/${LOTE.id}` ? ui.origenTarea.desde : `#/c/${r.componente.id}`;
}
