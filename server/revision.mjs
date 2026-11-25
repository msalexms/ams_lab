// «Corregir con IA»: el modelo devuelve la ficha (y la pieza) corregida ENTERA; aquí se compara con lo que hay
// y se sacan los cambios campo a campo, para que el usuario marque cuáles aplicar. Al aplicar se comprueba que lo de
// «antes» sigue igual (si alguien editó la ficha entretanto, no se pisa: hay que pedir otra revisión).
import {leerFicha, guardarTipo} from './db.mjs';
import {idLibre} from './catalogo.mjs';
import {mismoValor, mismasInterfaces} from './formato.mjs';

const limpio = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const clave = (v) => limpio(v).toLowerCase();
const lista = (v) => [...new Set((Array.isArray(v) ? v : []).map(limpio).filter(Boolean))];
const mismaLista = (a, b) => [...lista(a)].map(clave).sort().join('|') === [...lista(b)].map(clave).sort().join('|');

export class ConflictoRevision extends Error { constructor(msg) { super(msg); this.code = 409; } }

const CAMPOS_TIPO = {nombre: 'Nombre del tipo', categoria: 'Categoría', resumen: 'Resumen', voltaje: 'Tensión', ojo: 'Advertencia («Ojo»)'};
const LISTAS_TIPO = {interfaz: 'Interfaces', alias: 'También se llama'};
const CAMPOS_PIEZA = {nombre: 'Nombre de la pieza', notas: 'Notas'};

// cambios entre la ficha actual y la propuesta; nombres de categoría y de función de pin para que se lean bien
export function diferencias(actual, nueva, {categorias = {}, funciones = {}, tipos = {}} = {}) {
  const cambios = [];
  const poner = (c) => cambios.push(c);
  if (actual.tipo && nueva.tipo) {
    const a = actual.tipo, n = nueva.tipo, verCat = (id) => categorias[id] || id;
    for (const [campo, etiqueta] of Object.entries(CAMPOS_TIPO)) {
      // iguales una vez uniformados (tensión) o salvo mayúsculas y punto final (resumen, «Ojo»): no es un cambio.
      // En el nombre las mayúsculas sí cuentan
      if (mismoValor(campo, a[campo], n[campo])) continue;
      if (campo === 'nombre' && !limpio(n.nombre)) continue; // nunca dejar un tipo sin nombre
      poner({id: `tipo.${campo}`, ambito: 'tipo', campo, etiqueta, antes: campo === 'categoria' ? verCat(a[campo]) : limpio(a[campo]),
        despues: campo === 'categoria' ? verCat(n[campo]) : limpio(n[campo]), actual: limpio(a[campo]), nuevo: limpio(n[campo])});
    }
    for (const [campo, etiqueta] of Object.entries(LISTAS_TIPO)) {
      if (campo === 'interfaz' ? mismasInterfaces(a[campo], n[campo]) : mismaLista(a[campo], n[campo])) continue;
      poner({id: `tipo.${campo}`, ambito: 'tipo', campo, etiqueta, antes: lista(a[campo]).join(', '), despues: lista(n[campo]).join(', '),
        actual: lista(a[campo]), nuevo: lista(n[campo])});
    }
    // pines: se emparejan por su nombre (el orden no cuenta como cambio)
    const verPin = (p) => (p ? `${p[1]} · ${funciones[p[2]] || p[2]}${limpio(p[3]) ? ` · ${limpio(p[3])}` : ''}` : '');
    const pinesA = new Map((a.pines || []).map((p) => [clave(p[0]), p])), pinesN = new Map((n.pines || []).map((p) => [clave(p[0]), p]));
    for (const [k, p] of pinesN) {
      const viejo = pinesA.get(k);
      if (viejo && clave(viejo[1]) === clave(p[1]) && viejo[2] === p[2] && clave(viejo[3]) === clave(p[3])) continue;
      poner({id: `tipo.pin.${k}`, ambito: 'tipo', campo: 'pin', etiqueta: `Pin ${limpio(p[0])}`, antes: viejo ? verPin(viejo) : '', despues: verPin(p),
        actual: viejo || null, nuevo: p, tipoCambio: viejo ? 'cambio' : 'nuevo'});
    }
    for (const [k, p] of pinesA) if (!pinesN.has(k))
      poner({id: `tipo.pin.${k}`, ambito: 'tipo', campo: 'pin', etiqueta: `Pin ${limpio(p[0])}`, antes: verPin(p), despues: '', actual: p, nuevo: null, tipoCambio: 'quitado'});
    // orden y nombre exacto (mayúsculas) de los pines que están en las dos: un cambio aparte, que se aplica al final
    const comunes = (lista, otros) => (lista || []).filter((p) => otros.has(clave(p[0]))).map((p) => limpio(p[0]));
    const ordenA = comunes(a.pines, pinesN), ordenN = comunes(n.pines, pinesA);
    if (ordenA.join('|') !== ordenN.join('|')) {
      const mismoOrden = ordenA.map(clave).join('|') === ordenN.map(clave).join('|');
      poner({id: 'tipo.pines.orden', ambito: 'tipo', campo: 'ordenPines', etiqueta: mismoOrden ? 'Nombres de los pines' : 'Orden de los pines',
        antes: ordenA.join(' · '), despues: ordenN.join(' · '), actual: ordenA, nuevo: ordenN});
    }
    datosCambios('tipo', 'dato', 'Dato del tipo', a.datos, n.datos, poner);
  }
  if (actual.pieza && nueva.pieza) {
    const a = actual.pieza, n = nueva.pieza;
    for (const [campo, etiqueta] of Object.entries(CAMPOS_PIEZA)) {
      if (limpio(a[campo]) === limpio(n[campo]) || (campo === 'nombre' && !limpio(n.nombre))) continue; // las mayúsculas cuentan
      poner({id: `pieza.${campo}`, ambito: 'pieza', campo, etiqueta, antes: limpio(a[campo]), despues: limpio(n[campo]), actual: limpio(a[campo]), nuevo: limpio(n[campo])});
    }
    datosCambios('pieza', 'datoPieza', 'Dato de la pieza', a.datos_pieza, n.datos_pieza, poner);
    // tipo de la pieza: a otro que ya existe o a uno nuevo (la ficha nueva se crea al aplicar, «sin comprobar»)
    if (n.tipo?.existente || n.tipo?.nuevo) {
      const f = n.tipo.nuevo;
      poner({id: 'pieza.tipo', ambito: 'pieza', campo: 'tipo', etiqueta: 'Tipo de la pieza', tipoCambio: f ? 'nuevo' : 'cambio',
        antes: a.tipo_id ? tipos[a.tipo_id] || a.tipo_id : 'Sin tipo',
        despues: f ? `${limpio(f.nombre)} (tipo nuevo: ${[categorias[f.categoria] || f.categoria, limpio(f.voltaje), `${(f.pines || []).length} pines`].filter(Boolean).join(' · ')})`
          : tipos[n.tipo.existente] || n.tipo.existente,
        actual: a.tipo_id || null, nuevo: f ? {nuevo: f} : {existente: n.tipo.existente}});
    }
  }
  return cambios;
}
// datos clave → valor: se emparejan por la clave
function datosCambios(ambito, campo, rotulo, actuales = [], nuevos = [], poner) {
  const A = new Map(actuales.map((d) => [clave(d[0]), d])), N = new Map(nuevos.map((d) => [clave(d[0]), d]));
  for (const [k, d] of N) {
    const viejo = A.get(k);
    if (viejo && clave(viejo[1]) === clave(d[1])) continue;
    poner({id: `${ambito}.${campo}.${k}`, ambito, campo, etiqueta: `${rotulo}: ${limpio(d[0])}`, antes: viejo ? limpio(viejo[1]) : '', despues: limpio(d[1]),
      actual: viejo || null, nuevo: d, tipoCambio: viejo ? 'cambio' : 'nuevo'});
  }
  for (const [k, d] of A) if (!N.has(k))
    poner({id: `${ambito}.${campo}.${k}`, ambito, campo, etiqueta: `${rotulo}: ${limpio(d[0])}`, antes: limpio(d[1]), despues: '', actual: d, nuevo: null, tipoCambio: 'quitado'});
}

// pone los pines de «nombres» en ese orden y con ese nombre exacto; los demás (nuevos, o que no estaban) no se mueven
export function reordenar(pines, nombres) {
  const pos = new Map(nombres.map((x, i) => [clave(x), i]));
  const huecos = [], suyos = [];
  pines.forEach((p, i) => { if (pos.has(clave(p[0]))) { huecos.push(i); suyos.push([nombres[pos.get(clave(p[0]))], ...p.slice(1)]); } });
  suyos.sort((x, y) => pos.get(clave(x[0])) - pos.get(clave(y[0])));
  const out = pines.map((p) => [...p]);
  huecos.forEach((h, i) => (out[h] = suyos[i]));
  return out;
}

// lo que hay ahora en la base de datos para el objetivo de una revisión
export function estadoActual(db, objetivo) {
  const out = {};
  if (objetivo.tipo_id) out.tipo = leerFicha(db, objetivo.tipo_id);
  if (objetivo.componente_id) {
    const c = db.prepare('SELECT nombre, notas, tipo_id FROM componentes WHERE id = ?').get(objetivo.componente_id);
    if (c) out.pieza = {nombre: c.nombre, notas: c.notas || '', tipo_id: c.tipo_id || null,
      datos_pieza: db.prepare('SELECT clave, valor FROM componente_datos WHERE componente_id = ? ORDER BY orden').all(objetivo.componente_id).map((r) => [r.clave, r.valor])};
  }
  return out;
}

// aplica los cambios elegidos (ids) sobre lo que hay AHORA; si algo de «antes» ya no coincide, no aplica nada
export function aplicarCambios(db, objetivo, cambios, ids) {
  const elegidos = cambios.filter((c) => ids.includes(c.id));
  if (!elegidos.length) throw Object.assign(new Error('Marca al menos un cambio'), {code: 400});
  const ahora = estadoActual(db, objetivo);
  if (elegidos.some((c) => c.ambito === 'tipo') && !ahora.tipo) throw new ConflictoRevision('Ese tipo ya no existe');
  if (elegidos.some((c) => c.ambito === 'pieza') && !ahora.pieza) throw new ConflictoRevision('Esa pieza ya no existe');
  const cambiado = (c) => { throw new ConflictoRevision(`«${c.etiqueta}» ha cambiado desde que lo miró la IA: pide otra corrección para no pisar lo nuevo`); };
  const fila = (filas, k) => filas.find((x) => clave(x[0]) === k);

  // orden de los pines: se comprueba con lo de ahora antes de tocar nada y se aplica al final (después de los demás pines)
  const orden = elegidos.find((c) => c.campo === 'ordenPines');
  if (orden) {
    const enLista = new Set(orden.actual.map(clave));
    if (ahora.tipo.pines.filter((p) => enLista.has(clave(p[0]))).map((p) => limpio(p[0])).join('|') !== orden.actual.join('|')) cambiado(orden);
  }
  let nuevoTipo; // id del tipo que pasa a tener la pieza (si se eligió ese cambio)
  for (const c of elegidos) {
    if (c.campo === 'ordenPines') continue;
    const obj = c.ambito === 'tipo' ? ahora.tipo : ahora.pieza;
    if (c.ambito === 'pieza' && c.campo === 'tipo') {
      if ((ahora.pieza.tipo_id || null) !== (c.actual || null)) cambiado(c);
      if (c.nuevo?.existente) {
        if (!db.prepare('SELECT 1 FROM tipos WHERE id = ?').get(c.nuevo.existente)) throw new ConflictoRevision('Ese tipo ya no existe: pide otra corrección');
        nuevoTipo = c.nuevo.existente;
      } else if (c.nuevo?.nuevo) {
        const f = {...c.nuevo.nuevo};
        if (!db.prepare('SELECT 1 FROM categorias WHERE id = ?').get(f.categoria)) f.categoria = 'otro';
        nuevoTipo = idLibre(db, 'tipos', f.nombre, 'tipo');
        guardarTipo(db, nuevoTipo, f, {origen: 'ia', revisado: 0}); // ficha nueva de la IA: «sin comprobar»
      }
      continue;
    }
    if (c.campo === 'pin' || c.campo === 'dato' || c.campo === 'datoPieza') {
      const filas = c.campo === 'pin' ? obj.pines : c.campo === 'dato' ? obj.datos : obj.datos_pieza;
      const k = c.id.split('.').slice(2).join('.');
      const hay = fila(filas, k) || null;
      const cols = (f) => f && Array.from({length: c.campo === 'pin' ? 4 : f.length}, (_, i) => limpio(f[i])); // pines: siempre pin, uso, función y nota
      if (JSON.stringify(cols(hay)) !== JSON.stringify(cols(c.actual))) cambiado(c);
      const resto = filas.filter((x) => clave(x[0]) !== k);
      const idx = filas.findIndex((x) => clave(x[0]) === k);
      if (c.nuevo) resto.splice(idx >= 0 ? idx : resto.length, 0, c.nuevo); // en su sitio si ya estaba; si no, al final
      if (c.campo === 'pin') obj.pines = resto; else if (c.campo === 'dato') obj.datos = resto; else obj.datos_pieza = resto;
    } else if (Array.isArray(c.actual)) {
      if (!mismaLista(obj[c.campo], c.actual)) cambiado(c);
      obj[c.campo] = c.nuevo;
    } else {
      if (clave(obj[c.campo]) !== clave(c.actual)) cambiado(c);
      obj[c.campo] = c.nuevo;
    }
  }
  if (orden) ahora.tipo.pines = reordenar(ahora.tipo.pines, orden.nuevo);
  if (elegidos.some((c) => c.ambito === 'tipo')) {
    if (!db.prepare('SELECT 1 FROM categorias WHERE id = ?').get(ahora.tipo.categoria)) ahora.tipo.categoria = 'otro';
    guardarTipo(db, objetivo.tipo_id, ahora.tipo, {origen: 'ia', revisado: 0}); // lo cambió la IA: sin comprobar
  }
  if (elegidos.some((c) => c.ambito === 'pieza')) {
    const p = ahora.pieza;
    db.prepare('UPDATE componentes SET nombre = ?, notas = ? WHERE id = ?').run(limpio(p.nombre).slice(0, 200) || 'Pieza', String(p.notas ?? '').slice(0, 2000), objetivo.componente_id);
    if (nuevoTipo) db.prepare('UPDATE componentes SET tipo_id = ? WHERE id = ?').run(nuevoTipo, objetivo.componente_id);
    db.prepare('DELETE FROM componente_datos WHERE componente_id = ?').run(objetivo.componente_id);
    p.datos_pieza.forEach(([k, v], n) => db.prepare('INSERT OR IGNORE INTO componente_datos (componente_id, orden, clave, valor) VALUES (?, ?, ?, ?)')
      .run(objetivo.componente_id, n + 1, limpio(k).slice(0, 60), limpio(v).slice(0, 200)));
  }
  return elegidos.length;
}
