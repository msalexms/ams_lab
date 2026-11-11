// Proyectos (modelo v8): además de la receta (material, conexiones, pasos), cada proyecto lleva lo que el usuario
// apunta de él: estado, bitácora (notas con foto), tablero (tareas en tres columnas) y archivos (diagramas).
//   · Los de seed/ se pueden editar: al guardar pasan a origen 'usuario' y seed/ ya no los cambia. Estado, bitácora,
//     tablero y archivos no cambian el origen: seed/ nunca los toca.
//   · Un proyecto borrado se apunta en catalogo_quitados (clase 'proyecto') para que seed/ no lo resucite.
//   · Las fotos de las notas y los archivos van a data/fotos con el prefijo «p-» (entran en las copias como las demás).
// La conexión se recibe en cada llamada (cambia al restaurar una copia).
import {writeFile, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {guardarProyecto, ESTADOS_PROYECTO, COLUMNAS_TAREA} from './db.mjs';
import {idLibre} from './catalogo.mjs';

export class ErrorProyecto extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fallo = (code, msg) => { throw new ErrorProyecto(code, msg); };
const texto = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const linea = (v, max) => texto(v, max).replace(/\s+/g, ' ');
const agrupar = (filas, clave) => filas.reduce((m, f) => ((m[f[clave]] ||= []).push(f), m), {});
const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []);

export const NOMBRE_ESTADO = {idea: 'idea', en_marcha: 'en marcha', pausa: 'en pausa', terminado: 'terminado'};
export const NOMBRE_COLUMNA = {hacer: 'por hacer', curso: 'en curso', hecho: 'hecho'};
export const ARCHIVO_EXT = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf'};
export const MAX_ARCHIVO = 20 * 1024 * 1024;
const MAX = {material: 60, conexiones: 120, pasos: 60, tareas: 200, notas: 2000, archivos: 40};

const existe = (db, id) => {
  const p = db.prepare('SELECT id, nombre, origen, estado FROM proyectos WHERE id = ?').get(String(id));
  if (!p) fallo(404, 'No existe ese proyecto');
  return p;
};

// ---------- lectura ----------
// todos los proyectos como los usa la web (/api/datos): la receta entera y, de lo del usuario, solo los recuentos
export function listar(db) {
  const opciones = agrupar(db.prepare('SELECT * FROM material_opciones').all(), 'material_id');
  const material = agrupar(db.prepare('SELECT * FROM proyecto_material ORDER BY orden').all(), 'proyecto_id');
  const conex = agrupar(db.prepare('SELECT * FROM proyecto_conexiones ORDER BY orden').all(), 'proyecto_id');
  const pasos = agrupar(db.prepare('SELECT * FROM proyecto_pasos ORDER BY orden').all(), 'proyecto_id');
  const tareas = agrupar(db.prepare('SELECT proyecto_id, columna, COUNT(*) AS n FROM proyecto_tareas GROUP BY proyecto_id, columna').all(), 'proyecto_id');
  const notas = Object.fromEntries(db.prepare('SELECT proyecto_id, COUNT(*) AS n, MAX(fecha) AS ultima FROM proyecto_notas GROUP BY proyecto_id').all().map((r) => [r.proyecto_id, r]));
  const archivos = Object.fromEntries(db.prepare('SELECT proyecto_id, COUNT(*) AS n FROM proyecto_archivos GROUP BY proyecto_id').all().map((r) => [r.proyecto_id, r.n]));
  return db.prepare('SELECT * FROM proyectos ORDER BY nombre COLLATE NOCASE').all().map((p) => ({
    ...p,
    material: (material[p.id] || []).map((m) => {
      const ts = (opciones[m.id] || []).map((o) => o.tipo_id);
      return {tipo: ts.length === 1 ? ts[0] : ts, cantidad: m.cantidad, opcional: !!m.opcional, nota: m.nota};
    }),
    conexiones: (conex[p.id] || []).map((c) => [c.desde, c.hasta, c.nota]),
    pasos: (pasos[p.id] || []).map((s) => s.texto),
    tareas: Object.fromEntries(COLUMNAS_TAREA.map((c) => [c, (tareas[p.id] || []).find((t) => t.columna === c)?.n || 0])),
    notas: notas[p.id]?.n || 0, ultima_nota: notas[p.id]?.ultima || null, archivos: archivos[p.id] || 0,
  }));
}
export const uno = (db, id) => listar(db).find((p) => p.id === String(id)) || fallo(404, 'No existe ese proyecto');

// lo del usuario en un proyecto: se pide al abrir su ficha
export function detalle(db, id) {
  const p = existe(db, id);
  return {
    id: p.id,
    notas: db.prepare('SELECT id, texto, foto, fecha FROM proyecto_notas WHERE proyecto_id = ? ORDER BY id DESC').all(p.id),
    tareas: db.prepare('SELECT id, texto, columna FROM proyecto_tareas WHERE proyecto_id = ? ORDER BY orden, id').all(p.id),
    archivos: db.prepare('SELECT id, fichero, nombre, tipo, bytes, fecha FROM proyecto_archivos WHERE proyecto_id = ? ORDER BY id DESC').all(p.id),
  };
}

// ---------- la receta: crear y editar ----------
// deja el proyecto que llega de la web en el formato de seed/proyectos.json, ya comprobado
function limpiar(db, b) {
  const nombre = linea(b.nombre, 120);
  if (!nombre) fallo(400, 'Falta el nombre del proyecto');
  const dificultad = Number(b.dificultad) || 1;
  if (!db.prepare('SELECT 1 FROM dificultades WHERE nivel = ?').get(dificultad)) fallo(400, 'Esa dificultad no existe');
  const hayTipo = db.prepare('SELECT 1 FROM tipos WHERE id = ?');
  const material = lista(b.material).slice(0, MAX.material).map((m) => {
    const tipos = [...new Set(lista(m?.tipo).map(String).filter(Boolean))];
    if (!tipos.length) return null;
    const falta = tipos.find((t) => !hayTipo.get(t));
    if (falta) fallo(400, `En el material hay un tipo que no existe («${falta}»)`);
    const cantidad = Math.round(Number(m.cantidad)) || 1;
    if (cantidad < 1 || cantidad > 9999) fallo(400, 'La cantidad de cada material tiene que estar entre 1 y 9999');
    return {tipo: tipos, cantidad, opcional: !!m.opcional, nota: linea(m.nota, 200) || null};
  }).filter(Boolean);
  const conexiones = lista(b.conexiones).slice(0, MAX.conexiones).filter(Array.isArray)
    .map(([desde, hasta, nota]) => [linea(desde, 80), linea(hasta, 80), linea(nota, 200) || null]).filter(([d, h]) => d && h);
  const pasos = lista(b.pasos).slice(0, MAX.pasos).map((s) => linea(s, 600)).filter(Boolean);
  return {nombre, dificultad, tiempo: linea(b.tiempo, 40) || null, resumen: texto(b.resumen, 600) || null, material, conexiones, pasos};
}

export function crear(db, b) {
  const p = limpiar(db, b);
  const id = idLibre(db, 'proyectos', p.nombre, 'proyecto');
  db.exec('BEGIN');
  try { guardarProyecto(db, {id, ...p}, {origen: 'usuario'}); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  return uno(db, id);
}
// devuelve {antes, despues} para el historial
export function editar(db, id, b) {
  const antes = uno(db, id);
  const p = limpiar(db, b);
  db.exec('BEGIN');
  try { guardarProyecto(db, {id: antes.id, ...p}, {origen: 'usuario'}); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  return {antes, despues: uno(db, antes.id)};
}
export function cambiarEstado(db, id, estado) {
  const p = existe(db, id);
  if (!ESTADOS_PROYECTO.includes(estado)) fallo(400, 'Ese estado no existe');
  db.prepare('UPDATE proyectos SET estado = ? WHERE id = ?').run(estado, p.id);
  return {antes: p.estado, despues: estado, nombre: p.nombre};
}
// borra el proyecto con su bitácora, su tablero y sus archivos (también los ficheros)
export async function borrar(db, fotosDir, id) {
  const p = existe(db, id);
  const ficheros = [...db.prepare('SELECT foto AS f FROM proyecto_notas WHERE proyecto_id = ? AND foto IS NOT NULL').all(p.id),
    ...db.prepare('SELECT fichero AS f FROM proyecto_archivos WHERE proyecto_id = ?').all(p.id)].map((r) => r.f);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM proyectos WHERE id = ?').run(p.id); // en cascada: material, conexiones, pasos, notas, tareas y archivos
    db.prepare(`INSERT INTO catalogo_quitados (clase, id) VALUES ('proyecto', ?) ON CONFLICT(clase, id) DO UPDATE SET fecha = datetime('now')`).run(p.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  for (const f of ficheros) await unlink(join(fotosDir, f)).catch(() => {});
  return {ok: true, nombre: p.nombre, ficheros: ficheros.length};
}

// cambios de la receta, legibles (para el historial). nombresTipo: id → nombre
export function cambios(a, b, nombresTipo = {}, dificultades = {}) {
  const out = [];
  const poner = (campo, x, y) => { if (String(x ?? '') !== String(y ?? '')) out.push({campo, antes: x ?? '', despues: y ?? ''}); };
  const mat = (p) => p.material.map((m) => `${m.cantidad} × ${lista(m.tipo).map((t) => nombresTipo[t] || t).join(' o ')}${m.opcional ? ' (opcional)' : ''}${m.nota ? ` · ${m.nota}` : ''}`).join('; ');
  poner('Nombre', a.nombre, b.nombre);
  poner('Resumen', a.resumen, b.resumen);
  poner('Dificultad', dificultades[a.dificultad] || a.dificultad, dificultades[b.dificultad] || b.dificultad);
  poner('Tiempo', a.tiempo, b.tiempo);
  poner('Material', mat(a), mat(b));
  poner('Conexiones', a.conexiones.map((c) => c.filter(Boolean).join(' → ')).join('; '), b.conexiones.map((c) => c.filter(Boolean).join(' → ')).join('; '));
  poner('Pasos', a.pasos.join(' / '), b.pasos.join(' / '));
  return out;
}

// ---------- bitácora ----------
export async function anadirNota(db, fotosDir, id, b) {
  const p = existe(db, id);
  const t = texto(b.texto, 4000);
  const foto = b.foto ? Buffer.from(String(b.foto), 'base64') : null;
  if (foto && foto.length < 100) fallo(400, 'Foto vacía');
  if (!t && !foto) fallo(400, 'Escribe algo o pon una foto');
  if (db.prepare('SELECT COUNT(*) AS n FROM proyecto_notas WHERE proyecto_id = ?').get(p.id).n >= MAX.notas) fallo(409, 'Este proyecto ya tiene demasiadas notas');
  const fichero = foto ? `p-n${Date.now()}-${randomBytes(3).toString('hex')}.jpg` : null;
  if (fichero) await writeFile(join(fotosDir, fichero), foto); // antes de la base de datos: no hay await con la fila a medias
  try {
    const {lastInsertRowid} = db.prepare('INSERT INTO proyecto_notas (proyecto_id, texto, foto) VALUES (?, ?, ?)').run(p.id, t, fichero);
    return {proyecto: p, nota: db.prepare('SELECT id, texto, foto, fecha FROM proyecto_notas WHERE id = ?').get(lastInsertRowid)};
  } catch (e) {
    if (fichero) await unlink(join(fotosDir, fichero)).catch(() => {});
    throw e;
  }
}
export async function borrarNota(db, fotosDir, id, notaId) {
  const p = existe(db, id);
  const n = db.prepare('SELECT * FROM proyecto_notas WHERE id = ? AND proyecto_id = ?').get(Number(notaId), p.id);
  if (!n) fallo(404, 'No existe esa nota');
  db.prepare('DELETE FROM proyecto_notas WHERE id = ?').run(n.id);
  if (n.foto) await unlink(join(fotosDir, n.foto)).catch(() => {});
  return {proyecto: p, nota: n};
}

// ---------- tablero ----------
const siguienteOrden = (db, id) => db.prepare('SELECT COALESCE(MAX(orden), 0) + 1 AS n FROM proyecto_tareas WHERE proyecto_id = ?').get(id).n;
const tareaDe = (db, p, tareaId) => db.prepare('SELECT * FROM proyecto_tareas WHERE id = ? AND proyecto_id = ?').get(Number(tareaId), p.id) || fallo(404, 'No existe esa tarea');
export function anadirTareas(db, id, b) {
  const p = existe(db, id);
  // {pasos: true}: una tarea por cada paso del proyecto que aún no esté en el tablero
  const ya = new Set(db.prepare('SELECT texto FROM proyecto_tareas WHERE proyecto_id = ?').all(p.id).map((t) => t.texto.toLowerCase()));
  const textos = b.pasos === true
    ? db.prepare('SELECT texto FROM proyecto_pasos WHERE proyecto_id = ? ORDER BY orden').all(p.id).map((s) => linea(s.texto, 300)).filter((t) => !ya.has(t.toLowerCase()))
    : [linea(b.texto, 300)].filter(Boolean);
  if (!textos.length) fallo(400, b.pasos === true ? 'Los pasos ya están todos en el tablero' : 'Escribe la tarea');
  if (ya.size + textos.length > MAX.tareas) fallo(409, `Como mucho ${MAX.tareas} tareas por proyecto`);
  const columna = COLUMNAS_TAREA.includes(b.columna) ? b.columna : 'hacer';
  db.exec('BEGIN');
  try {
    for (const t of textos) db.prepare('INSERT INTO proyecto_tareas (proyecto_id, texto, columna, orden) VALUES (?, ?, ?, ?)').run(p.id, t, columna, siguienteOrden(db, p.id));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return {proyecto: p, textos, columna};
}
// mover de columna (va al final de la nueva) y/o cambiar el texto
export function cambiarTarea(db, id, tareaId, b) {
  const p = existe(db, id), t = tareaDe(db, p, tareaId);
  const nuevo = 'texto' in b ? linea(b.texto, 300) : t.texto;
  if (!nuevo) fallo(400, 'La tarea no puede quedarse sin texto');
  const columna = 'columna' in b ? b.columna : t.columna;
  if (!COLUMNAS_TAREA.includes(columna)) fallo(400, 'Esa columna no existe');
  db.prepare('UPDATE proyecto_tareas SET texto = ?, columna = ?, orden = ? WHERE id = ?')
    .run(nuevo, columna, columna === t.columna ? t.orden : siguienteOrden(db, p.id), t.id);
  return {proyecto: p, antes: t, despues: {...t, texto: nuevo, columna}};
}
export function borrarTarea(db, id, tareaId) {
  const p = existe(db, id), t = tareaDe(db, p, tareaId);
  db.prepare('DELETE FROM proyecto_tareas WHERE id = ?').run(t.id);
  return {proyecto: p, tarea: t};
}

// ---------- archivos (diagramas, esquemas) ----------
export async function anadirArchivo(db, fotosDir, id, {tipo, nombre, datos}) {
  const p = existe(db, id);
  const ext = ARCHIVO_EXT[tipo];
  if (!ext) fallo(415, 'El archivo tiene que ser una imagen (JPG, PNG o WebP) o un PDF');
  if (!datos || datos.length < 100) fallo(400, 'Archivo vacío');
  if (ext === '.pdf' && datos.subarray(0, 5).toString('latin1') !== '%PDF-') fallo(400, 'Ese archivo no es un PDF');
  if (db.prepare('SELECT COUNT(*) AS n FROM proyecto_archivos WHERE proyecto_id = ?').get(p.id).n >= MAX.archivos) fallo(409, `Como mucho ${MAX.archivos} archivos por proyecto`);
  const fichero = `p-a${Date.now()}-${randomBytes(3).toString('hex')}${ext}`;
  await writeFile(join(fotosDir, fichero), datos);
  try {
    const {lastInsertRowid} = db.prepare('INSERT INTO proyecto_archivos (proyecto_id, fichero, nombre, tipo, bytes) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, fichero, linea(nombre, 120) || (ext === '.pdf' ? 'Documento' : 'Diagrama'), tipo, datos.length);
    return {proyecto: p, archivo: db.prepare('SELECT id, fichero, nombre, tipo, bytes, fecha FROM proyecto_archivos WHERE id = ?').get(lastInsertRowid)};
  } catch (e) {
    await unlink(join(fotosDir, fichero)).catch(() => {});
    throw e;
  }
}
export async function borrarArchivo(db, fotosDir, id, archivoId) {
  const p = existe(db, id);
  const a = db.prepare('SELECT * FROM proyecto_archivos WHERE id = ? AND proyecto_id = ?').get(Number(archivoId), p.id);
  if (!a) fallo(404, 'No existe ese archivo');
  db.prepare('DELETE FROM proyecto_archivos WHERE id = ?').run(a.id);
  await unlink(join(fotosDir, a.fichero)).catch(() => {});
  return {proyecto: p, archivo: a};
}
