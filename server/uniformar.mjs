// Formato uniforme sobre la base de datos (las reglas, puras, están en formato.mjs):
//   · vocabularios(): cómo están escritos ya los nombres de datos y las interfaces (para la IA y para uniformar);
//   · pendientes(): lo que cambiaría en las fichas y en los datos de las piezas si se uniformara todo;
//   · aplicar(): aplica los cambios que el usuario marca (Ajustes → Uniformar formato). No llama al modelo.
// Una ficha uniformada conserva su origen y su «comprobada»: solo cambia cómo está escrito, no lo que dice.
import {leerFicha, guardarTipo} from './db.mjs';
import {fichaUniforme, datosUniformes, vocabulario, nombreInterfaz, separarPines, pinesSeparados} from './formato.mjs';

export function vocabularios(db) {
  const datos = db.prepare('SELECT clave, COUNT(*) AS n FROM tipo_datos GROUP BY clave ORDER BY n DESC, clave').all();
  const datosPieza = db.prepare('SELECT clave, COUNT(*) AS n FROM componente_datos GROUP BY clave ORDER BY n DESC, clave').all();
  // interfaces: por su nombre (sin el detalle entre paréntesis) y ya con el nombre estándar
  const cuenta = new Map();
  for (const {interfaz, n} of db.prepare('SELECT interfaz, COUNT(*) AS n FROM tipo_interfaces GROUP BY interfaz').all()) {
    const k = nombreInterfaz(interfaz);
    if (k) cuenta.set(k, (cuenta.get(k) || 0) + n);
  }
  const interfaces = [...cuenta].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es')).map(([nombre, n]) => ({nombre, n}));
  const tipo = vocabulario(datos), pieza = vocabulario(datosPieza);
  return {tipo, pieza, interfaces,
    // listas para la guía de estilo del modelo: lo que ya se usa, de más a menos
    // (las interfaces de una sola ficha suelen ser descripciones, no nombres: no se le enseñan como modelo a seguir)
    estilo: {interfaces: interfaces.filter((x) => x.n >= 2).map((x) => x.nombre), datos: [...new Set(tipo.values())], datosPieza: [...new Set(pieza.values())]}};
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// todos los cambios de formato posibles ahora mismo. Cada uno: {id, objeto: 'tipo' | 'pieza', objeto_id, nombre, etiqueta, antes, despues}
export function pendientes(db) {
  const v = vocabularios(db), cambios = [];
  for (const {id} of db.prepare('SELECT id FROM tipos ORDER BY nombre COLLATE NOCASE').all()) {
    const f = leerFicha(db, id), u = fichaUniforme(f, v.tipo);
    const poner = (parte, etiqueta, antes, despues) => cambios.push({id: `tipo:${id}:${parte}`, objeto: 'tipo', objeto_id: id, nombre: f.nombre, etiqueta, antes, despues});
    if ((f.voltaje || '') !== (u.voltaje || '')) poner('voltaje', 'Tensión', f.voltaje, u.voltaje);
    if (!igual(f.interfaz, u.interfaz)) poner('interfaz', 'Interfaces', f.interfaz.join(', '), u.interfaz.join(', '));
    f.pines.forEach((p, i) => { if (p[1] !== u.pines[i][1]) poner(`pin:${i}`, `Pin ${p[0]}`, p[1], u.pines[i][1]); });
    // filas con varios pines (o un pin repetido): una fila por pin; lo que compartan pasa a la nota
    if (!pinesSeparados(f.pines)) {
      const sep = separarPines(u.pines);
      poner('pines', 'Pines: uno por fila', `${f.pines.length} filas: ${f.pines.map((p) => p[0]).join(' | ')}`,
        `${sep.length} pines: ${sep.map((p) => `${p[0]}${p[3] ? ` (${p[3]})` : ''}`).join(' | ')}`);
    }
    f.datos.forEach((d, i) => { if (!igual(d, u.datos[i])) poner(`dato:${i}`, 'Dato', `${d[0]}: ${d[1]}`, `${u.datos[i][0]}: ${u.datos[i][1]}`); });
  }
  for (const c of db.prepare('SELECT id, nombre FROM componentes WHERE id IN (SELECT componente_id FROM componente_datos) ORDER BY nombre COLLATE NOCASE').all()) {
    const datos = datosDePieza(db, c.id), u = datosUniformes(datos, v.pieza);
    datos.forEach((d, i) => { if (!igual(d, u[i])) cambios.push({id: `pieza:${c.id}:dato:${i}`, objeto: 'pieza', objeto_id: String(c.id), nombre: c.nombre,
      etiqueta: 'Dato de la pieza', antes: `${d[0]}: ${d[1]}`, despues: `${u[i][0]}: ${u[i][1]}`}); });
  }
  return {cambios, interfaces: v.interfaces};
}
const datosDePieza = (db, id) => db.prepare('SELECT clave, valor FROM componente_datos WHERE componente_id = ? ORDER BY orden').all(id).map((r) => [r.clave, r.valor]);

// aplica los cambios marcados (ids de pendientes()). Se recalculan con lo que hay AHORA: si algo cambió entretanto, lo
// que ya no sea un cambio de formato simplemente no se aplica. Devuelve, por ficha o pieza, lo aplicado (para el historial).
export function aplicar(db, ids) {
  const elegidos = new Set((Array.isArray(ids) ? ids : []).map(String));
  const porObjeto = new Map();
  for (const c of pendientes(db).cambios) if (elegidos.has(c.id)) {
    const k = `${c.objeto}:${c.objeto_id}`;
    if (!porObjeto.has(k)) porObjeto.set(k, {objeto: c.objeto, id: c.objeto_id, nombre: c.nombre, cambios: []});
    porObjeto.get(k).cambios.push(c);
  }
  if (!porObjeto.size) throw Object.assign(new Error('Marca algún cambio'), {code: 400});
  const v = vocabularios(db);
  db.exec('BEGIN');
  try {
    for (const o of porObjeto.values()) {
      const partes = new Set(o.cambios.map((c) => c.id.split(':').slice(2).join(':')));
      if (o.objeto === 'tipo') {
        const f = leerFicha(db, o.id), u = fichaUniforme(f, v.tipo);
        const nueva = {...f, voltaje: partes.has('voltaje') ? u.voltaje : f.voltaje, interfaz: partes.has('interfaz') ? u.interfaz : f.interfaz,
          pines: ((l) => (partes.has('pines') ? separarPines(l) : l))(f.pines.map((p, i) => (partes.has(`pin:${i}`) ? u.pines[i] : p))), datos: f.datos.map((d, i) => (partes.has(`dato:${i}`) ? u.datos[i] : d))};
        guardarTipo(db, o.id, nueva, {origen: f.origen, revisado: f.revisado}); // solo cambia la forma: sigue siendo de quien era
      } else {
        const datos = datosDePieza(db, Number(o.id)), u = datosUniformes(datos, v.pieza);
        db.prepare('DELETE FROM componente_datos WHERE componente_id = ?').run(Number(o.id));
        datos.map((d, i) => (partes.has(`dato:${i}`) ? u[i] : d)).forEach(([k, val], n) =>
          db.prepare('INSERT INTO componente_datos (componente_id, orden, clave, valor) VALUES (?, ?, ?, ?)').run(Number(o.id), n + 1, k, val));
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return [...porObjeto.values()];
}
