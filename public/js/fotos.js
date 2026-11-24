// CircuitBin · fotos.js — encuadre de la foto de una pieza (recuadro 4:3) y subida.
import {api, esc, guardarLocal, jpeg, lienzoDe, qtyText, t, toast, unidades} from './base.js';

// ---------- encuadre: un recuadro 4:3 fijo (el formato de las tarjetas); la foto se mueve, se amplía y se gira ----------
// para que todas las piezas salgan igual. Devuelve el JPEG recortado, la foto entera («Sin recortar») o null (cancelado).
const ENC_RATIO = 4 / 3, ENC_ZOOM = 5;
export function encuadrar(file) {
  return new Promise(async (resolver) => {
    let S;
    try { S = await lienzoDe(file, 3200); } /* con margen para acercar sin perder detalle */ catch (err) { toast(err.message, true); resolver(null); return; }
    const capa = document.createElement('div');
    capa.className = 'encuadre';
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-modal', 'true');
    capa.setAttribute('aria-label', t('Encuadra la pieza'));
    capa.innerHTML = `<div class="enc-cab"><strong>${t('Encuadra la pieza')}</strong>
        <span>${t('Que quepa entera dentro del recuadro. Arrastra para moverla; pellizca o usa la barra para acercarla.')}</span></div>
      <div class="enc-escena"><canvas class="enc-img"></canvas><div class="enc-marco" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>
      <div class="enc-controles"><label class="enc-zoom-et">${t('Acercar')}<input type="range" class="enc-zoom" min="1" max="${ENC_ZOOM}" step="0.01" value="1"></label>
        <button type="button" class="btn" data-enc="girar">${t('Girar')}</button></div>
      <div class="enc-pie"><button type="button" class="btn" data-enc="cancelar">${t('Cancelar')}</button>
        <button type="button" class="btn" data-enc="entera">${t('Sin recortar')}</button>
        <button type="button" class="btn prim" data-enc="usar">${t('Usar foto')}</button></div>`;
    document.body.append(capa);
    document.body.classList.add('con-encuadre');
    const escena = capa.querySelector('.enc-escena'), img = capa.querySelector('.enc-img'), marcoEl = capa.querySelector('.enc-marco'), zoom = capa.querySelector('.enc-zoom');
    const lim = (v, a, b) => Math.min(b, Math.max(a, v));
    let M = {x: 0, y: 0, w: 1, h: 1}, s = 1, smin = 1, x = 0, y = 0; // marco (px de pantalla), escala y posición de la foto respecto al marco
    const pintar = () => { img.width = S.width; img.height = S.height; img.getContext('2d').drawImage(S, 0, 0); };
    const medir = () => {
      const r = escena.getBoundingClientRect();
      let w = r.width - 32, h = w / ENC_RATIO;
      if (h > r.height - 32) { h = r.height - 32; w = h * ENC_RATIO; }
      M = {x: (r.width - w) / 2, y: (r.height - h) / 2, w, h};
      Object.assign(marcoEl.style, {left: `${M.x}px`, top: `${M.y}px`, width: `${w}px`, height: `${h}px`});
      smin = Math.max(w / S.width, h / S.height); // la foto siempre cubre el recuadro
    };
    const ajustar = () => {
      s = lim(s, smin, smin * ENC_ZOOM);
      x = lim(x, M.w - S.width * s, 0);
      y = lim(y, M.h - S.height * s, 0);
      Object.assign(img.style, {width: `${S.width * s}px`, height: `${S.height * s}px`, transform: `translate(${M.x + x}px, ${M.y + y}px)`});
      zoom.value = String(s / smin);
    };
    const centrar = () => { s = smin; x = (M.w - S.width * s) / 2; y = (M.h - S.height * s) / 2; ajustar(); };
    const acercar = (nueva, px, py) => { // px, py: punto fijo, en px respecto al marco
      const k = lim(nueva, smin, smin * ENC_ZOOM) / s;
      x = px - (px - x) * k; y = py - (py - y) * k; s *= k;
      ajustar();
    };
    pintar(); medir(); centrar();

    // arrastrar con un dedo (o el ratón), pellizcar con dos, rueda en el ordenador
    const dedos = new Map();
    escena.addEventListener('pointerdown', (e) => { escena.setPointerCapture(e.pointerId); dedos.set(e.pointerId, {x: e.clientX, y: e.clientY}); });
    escena.addEventListener('pointermove', (e) => {
      const antes = dedos.get(e.pointerId);
      if (!antes) return;
      const ahora = {x: e.clientX, y: e.clientY};
      if (dedos.size === 1) { x += ahora.x - antes.x; y += ahora.y - antes.y; ajustar(); }
      else if (dedos.size === 2) {
        const otro = [...dedos.entries()].find(([k]) => k !== e.pointerId)[1];
        const d0 = Math.hypot(antes.x - otro.x, antes.y - otro.y), d1 = Math.hypot(ahora.x - otro.x, ahora.y - otro.y);
        const r = escena.getBoundingClientRect();
        x += (ahora.x - antes.x) / 2; y += (ahora.y - antes.y) / 2;
        if (d0 > 0) acercar(s * (d1 / d0), (ahora.x + otro.x) / 2 - r.left - M.x, (ahora.y + otro.y) / 2 - r.top - M.y); else ajustar();
      }
      dedos.set(e.pointerId, ahora);
    });
    const soltar = (e) => dedos.delete(e.pointerId);
    escena.addEventListener('pointerup', soltar);
    escena.addEventListener('pointercancel', soltar);
    escena.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = escena.getBoundingClientRect();
      acercar(s * Math.exp(-e.deltaY / 400), e.clientX - r.left - M.x, e.clientY - r.top - M.y);
    }, {passive: false});
    zoom.addEventListener('input', () => acercar(smin * Number(zoom.value), M.w / 2, M.h / 2));
    const alCambiarTamano = () => { const rel = s / smin; medir(); s = smin * rel; ajustar(); };
    window.addEventListener('resize', alCambiarTamano);
    const tecla = (e) => { if (e.key === 'Escape') cerrar(null); };
    document.addEventListener('keydown', tecla);

    function cerrar(valor) {
      window.removeEventListener('resize', alCambiarTamano);
      document.removeEventListener('keydown', tecla);
      capa.remove();
      document.body.classList.remove('con-encuadre');
      resolver(valor);
    }
    capa.addEventListener('click', async (e) => {
      const accion = e.target.closest('[data-enc]')?.dataset.enc;
      if (accion === 'cancelar') cerrar(null);
      else if (accion === 'girar') { // 90° a la derecha
        const r = document.createElement('canvas');
        r.width = S.height; r.height = S.width;
        const c = r.getContext('2d');
        c.translate(r.width, 0); c.rotate(Math.PI / 2); c.drawImage(S, 0, 0);
        S = r; pintar(); medir(); centrar();
      } else if (accion === 'entera') {
        const k = Math.min(1, 1600 / Math.max(S.width, S.height)), o = document.createElement('canvas');
        o.width = Math.round(S.width * k); o.height = Math.round(S.height * k);
        o.getContext('2d').drawImage(S, 0, 0, o.width, o.height);
        cerrar(await jpeg(o));
      } else if (accion === 'usar') {
        const sw = M.w / s, sh = M.h / s, o = document.createElement('canvas');
        o.width = Math.round(lim(sw, 400, 1600)); o.height = Math.round(o.width / ENC_RATIO);
        o.getContext('2d').drawImage(S, -x / s, -y / s, sw, sh, 0, 0, o.width, o.height);
        cerrar(await jpeg(o));
      }
    });
  });
}
// la foto que se sube: encuadrada por el usuario; null si canceló
export async function fotoEncuadrada(file) {
  const blob = await encuadrar(file);
  if (!blob) toast(t('Foto cancelada: no se ha subido nada'));
  return blob;
}

export async function subirFoto(id, file) {
  const blob = await fotoEncuadrada(file);
  if (!blob) return null;
  toast(t('Subiendo foto…'));
  const c = await api('PUT', `api/componentes/${id}/foto`, blob, {'content-type': 'image/jpeg'});
  guardarLocal(c);
  toast(t('Foto guardada'));
  return c;
}

export const stepper = (c, grande = false) => c.varios
  ? `<span class="muchos">${t('muchos')}</span>`
  : `<div class="stepper ${grande ? 'grande' : ''}"><button data-adj="-1" data-id="${c.id}" aria-label="${esc(t('Quitar uno'))}">−</button>
     <span class="num ${unidades(c) ? '' : 'cero'}">${esc(qtyText(c))}</span>
     <button data-adj="1" data-id="${c.id}" aria-label="${esc(t('Añadir uno'))}">+</button></div>`;
