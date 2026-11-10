// Registro del servidor (Ajustes → Registro): los últimos mensajes de la consola (arranque, copias, IA, errores y las
// peticiones que cambian algo), guardados en memoria. Se importa lo primero en server/index.mjs para no perderse
// nada del arranque. Siguen saliendo por la consola como siempre (docker logs). Se pierden al reiniciar.
import {format} from 'node:util';

const MAX = 1000;
const lineas = [];
let n = 0;
const ARRANQUE = new Date().toISOString();
const NIVEL = {log: 'info', info: 'info', warn: 'aviso', error: 'error'};

for (const metodo of Object.keys(NIVEL)) {
  const original = console[metodo].bind(console);
  console[metodo] = (...args) => {
    original(...args);
    anotar(NIVEL[metodo], format(...args));
  };
}

function anotar(nivel, texto) {
  // por si algún mensaje trajera una clave (oc_…, sk-…): nunca al registro que se ve desde la web
  const limpio = String(texto).trimStart().replace(/\b(oc|sk)[-_][A-Za-z0-9_-]{8,}/g, '$1-…').slice(0, 4000);
  lineas.push({n: ++n, fecha: new Date().toISOString(), nivel, texto: limpio});
  if (lineas.length > MAX) lineas.splice(0, lineas.length - MAX);
}

// f: {nivel: 'todo' | 'avisos' | 'errores', desde (n: solo las más nuevas), q}
export function leer(f = {}) {
  const niveles = f.nivel === 'errores' ? ['error'] : f.nivel === 'avisos' ? ['aviso', 'error'] : null;
  const q = String(f.q || '').toLowerCase().slice(0, 80);
  const desde = Number(f.desde) || 0;
  const filas = lineas.filter((l) => l.n > desde && (!niveles || niveles.includes(l.nivel)) && (!q || l.texto.toLowerCase().includes(q)));
  return {lineas: filas.slice(-500).reverse(), ultimo: n, arranque: ARRANQUE, guardadas: lineas.length, maximo: MAX};
}
