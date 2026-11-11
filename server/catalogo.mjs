// Gestión del catálogo y del inventario desde «Ajustes» (fase B): categorías, tipos, sitios y papelera de piezas.
// Reglas (docs/modelo-datos.md):
//   · Lo que se borra o fusiona del catálogo se apunta en catalogo_quitados: seed/ no lo resucita y los proyectos que
//     lo usaban se redirigen al reemplazo.
//   · Un tipo con piezas o usado en proyectos no se borra: se archiva (oculto) o se fusiona con otro.
//   · Una categoría con tipos se borra moviendo antes sus tipos a otra. «otro» no se borra (es la de reserva).
//   · Borrar una pieza deja 2 minutos para deshacerlo (la foto espera en la papelera).
import {fichaUniforme, separarPines} from './formato.mjs';
import {vocabularios} from './uniformar.mjs';
import {rename, unlink, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {leerFicha, guardarTipo} from './db.mjs';

export class ErrorCatalogo extends Error { constructor(code, msg, extra = {}) { super(msg); this.code = code; Object.assign(this, extra); } }
const fallo = (code, msg, extra) => { throw new ErrorCatalogo(code, msg, extra); };
const texto = (v, max = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function enTransaccion(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
const quitar = (db, clase, id, reemplazo = null) => db.prepare(`INSERT INTO catalogo_quitados (clase, id, reemplazo) VALUES (?, ?, ?)
  ON CONFLICT(clase, id) DO UPDATE SET reemplazo = excluded.reemplazo, fecha = datetime('now')`).run(clase, id, reemplazo);

// id libre a partir de un nombre: que no exista ni esté en la lista de quitados (si no, seed/ lo confundiría)
export function idLibre(db, tabla, nombre, porDefecto) {
  const clase = {tipos: 'tipo', proyectos: 'proyecto'}[tabla] || 'categoria';
  const base = String(nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || porDefecto;
  const ocupado = (id) => db.prepare(`SELECT 1 FROM ${tabla} WHERE id = ?`).get(id) || db.prepare('SELECT 1 FROM catalogo_quitados WHERE clase = ? AND id = ?').get(clase, id);
  let id = base, n = 2;
  while (ocupado(id)) id = `${base}-${n++}`;
  return id;
}

// ---------- categorías ----------
export function listarCategorias(db) {
  return db.prepare(`SELECT c.id, c.nombre, c.orden, c.origen, COUNT(t.id) AS tipos FROM categorias c
    LEFT JOIN tipos t ON t.categoria_id = c.id GROUP BY c.id ORDER BY c.orden, c.nombre`).all();
}
export function crearCategoria(db, b) {
  const nombre = texto(b.nombre, 60);
  if (!nombre) fallo(400, 'Falta el nombre de la categoría');
  if (db.prepare('SELECT 1 FROM categorias WHERE nombre = ? COLLATE NOCASE').get(nombre)) fallo(409, 'Ya hay una categoría con ese nombre');
  const id = idLibre(db, 'categorias', nombre, 'categoria');
  const orden = (db.prepare('SELECT MAX(orden) AS m FROM categorias').get().m || 0) + 1;
  db.prepare("INSERT INTO categorias (id, nombre, orden, origen) VALUES (?, ?, ?, 'usuario')").run(id, nombre, orden);
  return {id, nombre, orden};
}
export function renombrarCategoria(db, id, b) {
  if (!db.prepare('SELECT 1 FROM categorias WHERE id = ?').get(id)) fallo(404, 'Esa categoría no existe');
  const nombre = texto(b.nombre, 60);
  if (!nombre) fallo(400, 'Falta el nombre');
  if (db.prepare('SELECT 1 FROM categorias WHERE nombre = ? COLLATE NOCASE AND id <> ?').get(nombre, id)) fallo(409, 'Ya hay otra categoría con ese nombre');
  db.prepare("UPDATE categorias SET nombre = ?, origen = 'usuario' WHERE id = ?").run(nombre, id);
  return {id, nombre};
}
// nuevo orden: hay que mandar todas; pasan a ser «del usuario» para que seed/ no las recoloque
export function ordenarCategorias(db, ids) {
  const actuales = db.prepare('SELECT id FROM categorias').all().map((r) => r.id).sort();
  const pedidos = (Array.isArray(ids) ? ids.map(String) : []);
  if (pedidos.length !== actuales.length || [...pedidos].sort().join() !== actuales.join()) fallo(400, 'El orden tiene que incluir todas las categorías');
  enTransaccion(db, () => pedidos.forEach((id, i) => db.prepare("UPDATE categorias SET orden = ?, origen = 'usuario' WHERE id = ?").run(i + 1, id)));
  return listarCategorias(db);
}
// borrar: si tiene tipos, hace falta «destino» (a dónde se mueven). Los tipos de seed/ siguen siéndolo: al
// sincronizar, su categoría borrada se resuelve al destino gracias a catalogo_quitados.
export function borrarCategoria(db, id, destino) {
  if (id === 'otro') fallo(400, '«Otros» no se puede borrar: es la categoría de reserva');
  if (!db.prepare('SELECT 1 FROM categorias WHERE id = ?').get(id)) fallo(404, 'Esa categoría no existe');
  const n = db.prepare('SELECT COUNT(*) AS n FROM tipos WHERE categoria_id = ?').get(id).n;
  if (n && !destino) fallo(409, `Tiene ${n} tipo${n === 1 ? '' : 's'}: elige a qué categoría pasan`, {tipos: n});
  if (destino && (destino === id || !db.prepare('SELECT 1 FROM categorias WHERE id = ?').get(destino))) fallo(400, 'Elige otra categoría a la que mover sus tipos');
  enTransaccion(db, () => {
    if (n) db.prepare('UPDATE tipos SET categoria_id = ? WHERE categoria_id = ?').run(destino, id);
    db.prepare('DELETE FROM categorias WHERE id = ?').run(id);
    quitar(db, 'categoria', id, destino || 'otro');
  });
  return {ok: true, movidos: n};
}

// ---------- tipos ----------
export function listarTipos(db) {
  return db.prepare(`SELECT t.id, t.nombre, t.categoria_id AS categoria, t.origen, t.revisado, t.archivado,
      (SELECT COUNT(*) FROM componentes c WHERE c.tipo_id = t.id) AS piezas,
      (SELECT COUNT(DISTINCT pm.proyecto_id) FROM material_opciones mo JOIN proyecto_material pm ON pm.id = mo.material_id WHERE mo.tipo_id = t.id) AS proyectos
    FROM tipos t ORDER BY t.nombre COLLATE NOCASE`).all();
}
export function cambiarTipo(db, id, b) {
  if (!db.prepare('SELECT 1 FROM tipos WHERE id = ?').get(id)) fallo(404, 'Ese tipo no existe');
  if ('revisado' in b) db.prepare('UPDATE tipos SET revisado = ? WHERE id = ?').run(b.revisado ? 1 : 0, id);
  if ('archivado' in b) db.prepare('UPDATE tipos SET archivado = ? WHERE id = ?').run(b.archivado ? 1 : 0, id);
  return db.prepare('SELECT id, revisado, archivado FROM tipos WHERE id = ?').get(id);
}
// fusionar: las piezas y los proyectos de «id» pasan a «destino» y «id» desaparece (apuntado como sustituido).
// Si el que se queda no es de seed/, se lleva el nombre y los alias del otro (si es de seed/, seed los pisaría).
export function fusionarTipo(db, id, destino) {
  const a = db.prepare('SELECT * FROM tipos WHERE id = ?').get(id), b = db.prepare('SELECT * FROM tipos WHERE id = ?').get(String(destino || ''));
  if (!a) fallo(404, 'Ese tipo no existe');
  if (!b) fallo(400, 'Elige con qué tipo fusionarlo');
  if (a.id === b.id) fallo(400, 'Un tipo no se puede fusionar consigo mismo');
  return enTransaccion(db, () => {
    const piezas = db.prepare('UPDATE componentes SET tipo_id = ? WHERE tipo_id = ?').run(b.id, a.id).changes;
    db.prepare(`INSERT OR IGNORE INTO material_opciones (material_id, tipo_id) SELECT material_id, ? FROM material_opciones WHERE tipo_id = ?`).run(b.id, a.id);
    if (b.origen !== 'seed') {
      const alias = [a.nombre, ...db.prepare('SELECT alias FROM tipo_alias WHERE tipo_id = ?').all(a.id).map((r) => r.alias)];
      for (const al of alias) if (al && al !== b.nombre) db.prepare('INSERT OR IGNORE INTO tipo_alias (tipo_id, alias) VALUES (?, ?)').run(b.id, al);
    }
    db.prepare('DELETE FROM tipos WHERE id = ?').run(a.id); // en cascada: sus pines, alias, datos y opciones de material
    quitar(db, 'tipo', a.id, b.id);
    return {ok: true, piezas, queda: b.id};
  });
}
export function borrarTipo(db, id) {
  const t = listarTipos(db).find((x) => x.id === id);
  if (!t) fallo(404, 'Ese tipo no existe');
  if (t.piezas || t.proyectos) fallo(409, `No se puede borrar: ${[t.piezas ? `${t.piezas} pieza${t.piezas === 1 ? '' : 's'}` : '', t.proyectos ? `${t.proyectos} proyecto${t.proyectos === 1 ? '' : 's'}` : ''].filter(Boolean).join(' y ')} lo usan. Archívalo o fúndelo con otro.`, t);
  enTransaccion(db, () => {
    db.prepare('DELETE FROM tipos WHERE id = ?').run(id);
    quitar(db, 'tipo', id, null);
  });
  return {ok: true};
}

// ---------- sitios (ubicaciones) ----------
export function listarSitios(db) {
  return db.prepare(`SELECT u.id, u.nombre, COUNT(c.id) AS piezas FROM ubicaciones u LEFT JOIN componentes c ON c.ubicacion_id = u.id
    GROUP BY u.id ORDER BY u.nombre COLLATE NOCASE`).all();
}
// renombrar; si ya existe otro con ese nombre (sin mirar mayúsculas), se fusionan: sus piezas pasan al existente
export function renombrarSitio(db, id, b) {
  id = Number(id);
  if (!db.prepare('SELECT 1 FROM ubicaciones WHERE id = ?').get(id)) fallo(404, 'Ese sitio no existe');
  const nombre = texto(b.nombre, 120);
  if (!nombre) fallo(400, 'Falta el nombre');
  const otro = db.prepare('SELECT id, nombre FROM ubicaciones WHERE nombre = ? AND id <> ?').get(nombre, id);
  if (!otro) { db.prepare('UPDATE ubicaciones SET nombre = ? WHERE id = ?').run(nombre, id); return {id, nombre, fusionado: false}; }
  return enTransaccion(db, () => {
    const piezas = db.prepare('UPDATE componentes SET ubicacion_id = ? WHERE ubicacion_id = ?').run(otro.id, id).changes;
    db.prepare('DELETE FROM ubicaciones WHERE id = ?').run(id);
    return {id: otro.id, nombre: otro.nombre, fusionado: true, piezas}; // se queda el nombre del que ya existía
  });
}
export function borrarSitio(db, id) {
  id = Number(id);
  if (!db.prepare('SELECT 1 FROM ubicaciones WHERE id = ?').get(id)) fallo(404, 'Ese sitio no existe');
  const piezas = db.prepare('SELECT COUNT(*) AS n FROM componentes WHERE ubicacion_id = ?').get(id).n;
  db.prepare('DELETE FROM ubicaciones WHERE id = ?').run(id); // las piezas se quedan «sin sitio» (ON DELETE SET NULL)
  return {ok: true, piezas};
}

// ---------- papelera de piezas: borrar con «Deshacer» ----------
const ESPERA_DESHACER = 2 * 60 * 1000;
const papelera = new Map(); // token → {fila, datos, foto, tope}
export async function borrarPieza(db, fotosDir, id) {
  const fila = db.prepare('SELECT * FROM componentes WHERE id = ?').get(Number(id));
  if (!fila) fallo(404, 'No existe esa pieza');
  const datos = db.prepare('SELECT orden, clave, valor FROM componente_datos WHERE componente_id = ?').all(fila.id);
  let foto = null;
  if (fila.foto) { // la foto espera en la papelera por si se deshace
    foto = `papelera-${fila.foto}`;
    await rename(join(fotosDir, fila.foto), join(fotosDir, foto)).catch(() => (foto = null));
  }
  db.prepare('DELETE FROM componentes WHERE id = ?').run(fila.id);
  const token = `${fila.id}-${Date.now().toString(36)}`;
  papelera.set(token, {fila, datos, foto, tope: Date.now() + ESPERA_DESHACER});
  setTimeout(() => vaciar(fotosDir, token), ESPERA_DESHACER + 1000).unref();
  return {ok: true, deshacer: token, segundos: ESPERA_DESHACER / 1000};
}
async function vaciar(fotosDir, token) {
  const p = papelera.get(token);
  if (!p) return;
  papelera.delete(token);
  if (p.foto) await unlink(join(fotosDir, p.foto)).catch(() => {});
}
export async function restaurarPieza(db, fotosDir, token) {
  const p = papelera.get(String(token || ''));
  if (!p || Date.now() > p.tope) fallo(410, 'Ya no se puede deshacer');
  papelera.delete(token);
  let foto = null;
  if (p.foto) { foto = p.fila.foto; await rename(join(fotosDir, p.foto), join(fotosDir, foto)).catch(() => (foto = null)); }
  const f = p.fila;
  const libre = !db.prepare('SELECT 1 FROM componentes WHERE id = ?').get(f.id);
  const ubic = f.ubicacion_id && db.prepare('SELECT 1 FROM ubicaciones WHERE id = ?').get(f.ubicacion_id) ? f.ubicacion_id : null;
  const tipo = f.tipo_id && db.prepare('SELECT 1 FROM tipos WHERE id = ?').get(f.tipo_id) ? f.tipo_id : null;
  return enTransaccion(db, () => {
    const {lastInsertRowid} = db.prepare(`INSERT INTO componentes (${libre ? 'id, ' : ''}nombre, tipo_id, cantidad, varios, ubicacion_id, notas, revisar, foto, creado)
      VALUES (${libre ? '?, ' : ''}?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(...(libre ? [f.id] : []), f.nombre, tipo, f.cantidad, f.varios, ubic, f.notas, f.revisar, foto, f.creado);
    for (const d of p.datos) db.prepare('INSERT INTO componente_datos (componente_id, orden, clave, valor) VALUES (?, ?, ?, ?)').run(lastInsertRowid, d.orden, d.clave, d.valor);
    return {ok: true, id: Number(lastInsertRowid)};
  });
}
// al arrancar: fotos que se quedaron en la papelera (el servidor se paró antes de vaciarla)
export async function limpiarPapelera(fotosDir) {
  for (const f of await readdir(fotosDir).catch(() => [])) if (f.startsWith('papelera-')) await unlink(join(fotosDir, f)).catch(() => {});
}
// al restaurar una copia: lo que había en la papelera era de la base de datos anterior (ya no se puede deshacer)
export function vaciarPapelera() { papelera.clear(); }

// ---------- editor de fichas (fase D): el usuario reescribe la ficha entera ----------
// «huella»: resumen de la ficha tal como estaba al abrir el editor; si al guardar no coincide (la cambió la IA u otra
// pestaña entretanto), no se pisa: 409 y hay que recargar.
const camposFicha = (f) => ({nombre: f.nombre, categoria: f.categoria, resumen: f.resumen || '', voltaje: f.voltaje || '', ojo: f.ojo || '',
  alias: [...f.alias].sort(), interfaz: f.interfaz, pines: f.pines, datos: f.datos});
const huella = (f) => createHash('sha1').update(JSON.stringify(camposFicha(f))).digest('hex').slice(0, 16);

export function fichaEditable(db, id) {
  const f = leerFicha(db, id);
  if (!f) fallo(404, 'Ese tipo no existe');
  return {id, ...f, huella: huella(f)};
}

export function guardarFicha(db, id, b) {
  const actual = leerFicha(db, id);
  if (!actual) fallo(404, 'Ese tipo no existe');
  if (String(b.huella || '') !== huella(actual)) fallo(409, 'La ficha ha cambiado mientras la editabas (¿la IA u otra pestaña?): recarga y vuelve a hacer tus cambios');
  const funcs = new Set(db.prepare('SELECT id FROM funciones_pin').all().map((r) => r.id));
  const nombre = texto(b.nombre, 120);
  if (!nombre) fallo(400, 'Falta el nombre del tipo');
  const categoria = String(b.categoria || '');
  if (!db.prepare('SELECT 1 FROM categorias WHERE id = ?').get(categoria)) fallo(400, 'Esa categoría no existe');
  const filas = (v) => (Array.isArray(v) ? v : []).filter(Array.isArray);
  const repetido = (claves) => claves.find((k, i) => claves.findIndex((x) => x.toLowerCase() === k.toLowerCase()) !== i);
  // un pin por fila: si llega una fila con varios («GPIO 16 · 17»), se separa (el editor ya lo hace al escribir)
  const pines = separarPines(filas(b.pines).map(([pin, uso, fn, nota]) => [texto(pin, 60), texto(uso, 60), String(fn || ''), texto(nota, 200)])
    .filter(([pin]) => pin)).slice(0, 120);
  const pinRepe = repetido(pines.map((p) => p[0]));
  if (pinRepe) fallo(400, `El pin «${pinRepe}» está repetido`);
  for (const p of pines) if (!funcs.has(p[2])) fallo(400, `Elige la función del pin «${p[0]}»`);
  const datos = filas(b.datos).map(([k, v]) => [texto(k, 60), texto(v, 200)]).filter(([k, v]) => k && v).slice(0, 40);
  const datoRepe = repetido(datos.map((d) => d[0]));
  if (datoRepe) fallo(400, `El dato «${datoRepe}» está repetido`);
  const lista = (v, max, n) => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map((x) => texto(x, max)).filter(Boolean))].slice(0, n);
  // lo que escribes a mano también queda con el formato de siempre («3v3» → «3,3 V», «i2c» → «I2C»)
  const ficha = fichaUniforme({...actual, nombre, categoria, resumen: texto(b.resumen, 400), voltaje: texto(b.voltaje, 120), ojo: texto(b.ojo, 400),
    alias: lista(b.alias, 80, 12), interfaz: lista(b.interfaz, 40, 12), pines, datos}, vocabularios(db).tipo);
  return enTransaccion(db, () => {
    guardarTipo(db, id, ficha, {origen: 'usuario', revisado: 1}); // la escribe el usuario: comprobada y seed/ ya no la pisa
    return fichaEditable(db, id);
  });
}
