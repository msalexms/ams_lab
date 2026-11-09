// [AMS] lab — servidor: web estática + API + fotos. Sin dependencias (Node 24).
//   npm start            → http://localhost:4321 (y http://<IP-del-PC>:4321 desde el móvil, misma Wi-Fi)
//   AMS_LAB_DATA=/ruta   → carpeta de la base de datos y las fotos (por defecto ./data)
//   AMS_LAB_COPIAS=/ruta → carpeta de las copias diarias (por defecto <datos>/copias) · ver server/copias.mjs
//   «Añadir con IA» (OpenCode Go): clave y modelo desde la web (o IA_CLAVE / IA_MODELO) · ver server/ia.mjs
import {createServer} from 'node:http';
import {readFile, writeFile, unlink, rename} from 'node:fs/promises';
import {extname, join, normalize, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {networkInterfaces} from 'node:os';
import {abrir, ubicacionId, sincronizarCatalogo, guardarTipo} from './db.mjs';
import {programarCopias} from './copias.mjs';
import {estado, ejecutarAlta, normalizar, cerrarInterrumpidas, modelos, guardarConfig} from './ia.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const DATA = process.env.AMS_LAB_DATA || join(ROOT, 'data');
const FOTOS = join(DATA, 'fotos');
const PORT = Number(process.env.PORT) || 4321;
const MAX_FOTO = 10 * 1024 * 1024;

const SEED = join(ROOT, 'seed');
const db = abrir(DATA, SEED);
// el catálogo (glosario, proyectos, colores…) se aplica desde seed/ en cada arranque: así una imagen nueva de Docker
// trae las fichas al día sin tener que entrar al contenedor. No toca el inventario.
try {
  const n = sincronizarCatalogo(db, SEED);
  console.log(`Catálogo: ${n.tipos} tipos, ${n.proyectos} proyectos${n.respetados ? ` (${n.respetados} tipo(s) cambiado(s) por la IA o por ti: no se pisan)` : ''}`);
} catch (e) {
  console.error('No se pudo aplicar el catálogo de seed/ (sigue el anterior):', e.message);
}
programarCopias(db, DATA);
cerrarInterrumpidas(db);
{ const e = estado(db); console.log(e.activa ? `[ia] activa: ${e.modelo} (clave de ${e.origen_clave})` : '[ia] sin clave: se configura desde la web'); }
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const FOTO_EXT = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'};

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
  res.writeHead(code, {'content-type': type, ...extra});
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function leerCuerpo(req, limit) {
  return new Promise((ok, ko) => {
    const partes = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { ko(new HttpError(413, 'Demasiado grande')); req.destroy(); } else partes.push(c); });
    req.on('end', () => ok(Buffer.concat(partes)));
    req.on('error', ko);
  });
}
const leerJson = async (req) => { try { return JSON.parse((await leerCuerpo(req, 1e6)).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'JSON no válido'); } };
const texto = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const agrupar = (filas, clave) => filas.reduce((m, f) => ((m[f[clave]] ||= []).push(f), m), {});

// ---------- lectura ----------
// la API entrega cada componente con `tipo` (id) y `ubicacion` (nombre), como los usa la web
const SQL_COMP = `SELECT c.id, c.nombre, c.tipo_id AS tipo, c.cantidad, c.varios, COALESCE(u.nombre, '') AS ubicacion,
  c.notas, c.revisar, c.foto, c.creado, c.actualizado FROM componentes c LEFT JOIN ubicaciones u ON u.id = c.ubicacion_id`;
const comp = (id) => {
  const c = db.prepare(`${SQL_COMP} WHERE c.id = ?`).get(Number(id));
  if (!c) throw new HttpError(404, 'No existe esa pieza');
  const datos = db.prepare('SELECT clave, valor FROM componente_datos WHERE componente_id = ? ORDER BY orden').all(c.id);
  return {...c, datos: datos.map((d) => [d.clave, d.valor])};
};

function tipos() {
  const alias = agrupar(db.prepare('SELECT * FROM tipo_alias').all(), 'tipo_id');
  const inter = agrupar(db.prepare('SELECT * FROM tipo_interfaces ORDER BY orden').all(), 'tipo_id');
  const pines = agrupar(db.prepare('SELECT * FROM tipo_pines ORDER BY orden').all(), 'tipo_id');
  const datos = agrupar(db.prepare('SELECT * FROM tipo_datos ORDER BY orden').all(), 'tipo_id');
  return Object.fromEntries(db.prepare('SELECT * FROM tipos').all().map((t) => [t.id, {
    nombre: t.nombre, categoria: t.categoria_id, resumen: t.resumen, voltaje: t.voltaje,
    alias: (alias[t.id] || []).map((a) => a.alias), interfaz: (inter[t.id] || []).map((i) => i.interfaz),
    pines: (pines[t.id] || []).map((p) => [p.pin, p.uso, p.funcion_id]),
    datos: (datos[t.id] || []).map((d) => [d.clave, d.valor]),
    origen: t.origen, revisado: t.revisado,
  }]));
}

// datos extra de cada pieza ([clave, valor]), para añadirlos a los componentes que entrega la API
const datosDe = (filas) => {
  const d = agrupar(db.prepare('SELECT * FROM componente_datos ORDER BY orden').all(), 'componente_id');
  return filas.map((c) => ({...c, datos: (d[c.id] || []).map((x) => [x.clave, x.valor])}));
};

function proyectos() {
  const opciones = agrupar(db.prepare('SELECT * FROM material_opciones').all(), 'material_id');
  const material = agrupar(db.prepare('SELECT * FROM proyecto_material ORDER BY orden').all(), 'proyecto_id');
  const conex = agrupar(db.prepare('SELECT * FROM proyecto_conexiones ORDER BY orden').all(), 'proyecto_id');
  const pasos = agrupar(db.prepare('SELECT * FROM proyecto_pasos ORDER BY orden').all(), 'proyecto_id');
  return db.prepare('SELECT * FROM proyectos ORDER BY nombre').all().map((p) => ({
    ...p,
    material: (material[p.id] || []).map((m) => {
      const ts = (opciones[m.id] || []).map((o) => o.tipo_id);
      return {tipo: ts.length === 1 ? ts[0] : ts, cantidad: m.cantidad, opcional: !!m.opcional, nota: m.nota};
    }),
    conexiones: (conex[p.id] || []).map((c) => [c.desde, c.hasta, c.nota]),
    pasos: (pasos[p.id] || []).map((s) => s.texto),
  }));
}

const todo = () => ({
  ia: estado(db), // nunca la clave entera
  categorias: db.prepare('SELECT id, nombre FROM categorias ORDER BY orden').all(),
  funciones: db.prepare('SELECT id, nombre, color_claro, color_oscuro, tachado FROM funciones_pin ORDER BY orden').all(),
  ajustes: Object.fromEntries(db.prepare('SELECT clave, valor FROM ajustes').all().map((a) => [a.clave, a.valor])),
  dificultades: db.prepare('SELECT nivel, nombre FROM dificultades ORDER BY nivel').all(),
  ubicaciones: db.prepare('SELECT nombre FROM ubicaciones ORDER BY nombre COLLATE NOCASE').all().map((u) => u.nombre),
  tipos: tipos(),
  proyectos: proyectos(),
  componentes: datosDe(db.prepare(`${SQL_COMP} ORDER BY c.nombre COLLATE NOCASE`).all()),
});

// ---------- escritura ----------
function limpiar(b, parcial) {
  const out = {};
  if (!parcial || 'nombre' in b) { out.nombre = texto(b.nombre, 200); if (!out.nombre) throw new HttpError(400, 'Falta el nombre'); }
  if ('tipo' in b) {
    out.tipo_id = b.tipo ? String(b.tipo) : null;
    if (out.tipo_id && !db.prepare('SELECT 1 FROM tipos WHERE id = ?').get(out.tipo_id)) throw new HttpError(400, 'Ese tipo no existe');
  }
  if ('varios' in b) out.varios = b.varios ? 1 : 0;
  if ('cantidad' in b) {
    out.cantidad = b.cantidad === null || b.cantidad === '' ? null : Math.max(0, Math.round(Number(b.cantidad)));
    if (Number.isNaN(out.cantidad)) throw new HttpError(400, 'Cantidad no válida');
  }
  if (out.varios) out.cantidad = null;
  if ('ubicacion' in b) out.ubicacion_id = ubicacionId(db, texto(b.ubicacion, 120));
  if ('notas' in b) out.notas = texto(b.notas, 2000);
  if ('revisar' in b) out.revisar = b.revisar ? 1 : 0;
  return out;
}

function slug(s) {
  const base = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tipo';
  let id = base, n = 2;
  while (db.prepare('SELECT 1 FROM tipos WHERE id = ?').get(id)) id = `${base}-${n++}`;
  return id;
}

async function borrarFoto(nombre) {
  if (nombre) await unlink(join(FOTOS, nombre)).catch(() => {});
}

// ---------- IA: tareas de alta (crear → el modelo propone → el usuario confirma o descarta) ----------
const tarea = (id) => {
  const t = db.prepare('SELECT * FROM ia_tareas WHERE id = ?').get(Number(id));
  if (!t) throw new HttpError(404, 'No existe esa tarea');
  const entrada = JSON.parse(t.entrada);
  return {id: t.id, clase: t.clase, estado: t.estado, texto: entrada.texto || '', foto: entrada.foto || null,
    propuesta: t.propuesta ? JSON.parse(t.propuesta) : null, error: t.error, modelo: t.modelo,
    componente_id: t.componente_id, creada: t.creada, rondas: (entrada.rondas || []).length};
};

// el usuario contesta las dudas (y/o añade información) sobre la propuesta que tiene en pantalla, quizá ya corregida:
// se guarda como una «vuelta» y el modelo rehace la propuesta. Como mucho 5 vueltas por tarea.
const MAX_RONDAS = 5;
function responderAlta(id, b) {
  const t = tarea(id);
  if (t.estado !== 'propuesta') throw new HttpError(409, `Esta tarea está «${t.estado}»: no se puede repensar`);
  if (t.rondas >= MAX_RONDAS) throw new HttpError(409, `Ya van ${MAX_RONDAS} vueltas: corrige a mano y guarda`);
  const respuestas = (Array.isArray(b.respuestas) ? b.respuestas : []).slice(0, 12)
    .map((x) => ({duda: texto(x?.duda, 300), respuesta: texto(x?.respuesta, 500)})).filter((x) => x.duda && x.respuesta);
  const extra = texto(b.extra, 1000);
  if (!respuestas.length && !extra) throw new HttpError(400, 'Contesta alguna duda o escribe algo más');
  // la propuesta tal como la tiene el usuario (con sus correcciones), con el mismo formato y la misma limpieza que al guardar
  const pb = b.propuesta && typeof b.propuesta === 'object' ? b.propuesta : {};
  const actual = normalizar(db, {...t.propuesta, ...pb, dudas: t.propuesta.dudas, confianza: t.propuesta.confianza,
    tipo_existente: pb.tipo === '__nuevo' ? null : pb.tipo ?? t.propuesta.tipo_existente,
    tipo_nuevo: pb.tipo === '__nuevo' ? pb.tipo_nuevo : pb.tipo ? null : t.propuesta.tipo_nuevo});
  const entrada = JSON.parse(db.prepare('SELECT entrada FROM ia_tareas WHERE id = ?').get(t.id).entrada);
  entrada.rondas = [...(entrada.rondas || []), {propuesta: actual, respuestas, extra}];
  db.prepare("UPDATE ia_tareas SET entrada = ?, estado = 'pendiente', error = NULL WHERE id = ? AND estado = 'propuesta'")
    .run(JSON.stringify(entrada), t.id);
  ejecutarAlta(db, FOTOS, t.id); // en segundo plano, como el alta
  return tarea(t.id);
}

async function crearAlta(req) {
  if (!estado(db).activa) throw new HttpError(503, 'Falta la clave de OpenCode Go: ponla en Añadir con IA → Configuración');
  let b;
  try { b = JSON.parse((await leerCuerpo(req, MAX_FOTO * 1.4)).toString('utf8') || '{}'); } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'JSON no válido');
  }
  const textoUsuario = texto(b.texto, 1000);
  const foto = b.foto ? Buffer.from(String(b.foto), 'base64') : null;
  if (!textoUsuario && !foto) throw new HttpError(400, 'Pon una foto o escribe algo de la pieza');
  if (foto && foto.length < 100) throw new HttpError(400, 'Foto vacía');
  const {lastInsertRowid: id} = db.prepare("INSERT INTO ia_tareas (clase, entrada) VALUES ('alta', ?)").run(JSON.stringify({texto: textoUsuario}));
  if (foto) {
    const nombre = `ia-${id}-${Date.now()}.jpg`; // provisional: al confirmar pasa a ser la foto de la pieza
    await writeFile(join(FOTOS, nombre), foto);
    db.prepare('UPDATE ia_tareas SET entrada = ? WHERE id = ?').run(JSON.stringify({texto: textoUsuario, foto: nombre}), id);
  }
  ejecutarAlta(db, FOTOS, Number(id)); // en segundo plano: la web va preguntando el estado
  return tarea(id);
}

// el usuario confirma la propuesta (quizá corregida): ficha nueva si hace falta, pieza, sus datos y la foto
async function aplicarAlta(id, b) {
  const t = tarea(id);
  if (t.estado !== 'propuesta') throw new HttpError(409, `Esta tarea está «${t.estado}», no se puede aplicar`);
  const p = normalizar(db, {...b, tipo_existente: b.tipo === '__nuevo' ? null : b.tipo || null, tipo_nuevo: b.tipo === '__nuevo' ? b.tipo_nuevo : null});
  if (b.tipo && b.tipo !== '__nuevo' && !p.tipo_existente) throw new HttpError(400, 'Ese tipo no existe');
  if (b.tipo === '__nuevo' && !p.tipo_nuevo) throw new HttpError(400, 'Falta el nombre del tipo nuevo');
  const campos = Object.fromEntries(['nombre', 'varios', 'cantidad', 'ubicacion', 'notas', 'revisar']
    .filter((k) => b[k] !== undefined).map((k) => [k, b[k]])); // solo los que llegan (como en el alta normal)
  const pieza = limpiar(campos, false);

  // la foto se mueve ANTES de abrir la transacción (no puede haber un await dentro: la conexión es compartida)
  const foto = t.foto ? `c-ia${t.id}-${Date.now()}.jpg` : null;
  if (foto) await rename(join(FOTOS, t.foto), join(FOTOS, foto));
  let compId, tipoId = p.tipo_existente;
  db.exec('BEGIN');
  try {
    if (b.tipo === '__nuevo') {
      tipoId = slug(p.tipo_nuevo.nombre);
      guardarTipo(db, tipoId, p.tipo_nuevo, {origen: 'ia', revisado: 0});
    }
    const fila = {...pieza, tipo_id: tipoId, foto};
    const cols = Object.keys(fila);
    compId = Number(db.prepare(`INSERT INTO componentes (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(fila)).lastInsertRowid);
    p.datos_pieza.forEach(([clave, valor], n) =>
      db.prepare('INSERT INTO componente_datos (componente_id, orden, clave, valor) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').run(compId, n + 1, clave, valor));
    db.prepare("UPDATE ia_tareas SET estado = 'aplicada', componente_id = ? WHERE id = ?").run(compId, t.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    if (foto) await rename(join(FOTOS, foto), join(FOTOS, t.foto)).catch(() => {}); // la foto vuelve a la tarea
    throw e;
  }
  return {componente: comp(compId), tipo: tipoId};
}

// ---------- rutas de la API ----------
async function api(req, res, path) {
  const m = req.method;
  let r;
  if (m === 'GET' && path === '/api/datos') return send(res, 200, todo());
  if (m === 'GET' && path === '/api/historial') return send(res, 200, db.prepare('SELECT * FROM historial ORDER BY id DESC LIMIT 200').all());
  if (m === 'GET' && path === '/api/exportar')
    return send(res, 200, JSON.stringify({exportado: new Date().toISOString(), ...todo()}, null, 2), 'application/json; charset=utf-8',
      {'content-disposition': `attachment; filename="ams-lab-${new Date().toISOString().slice(0, 10)}.json"`});

  if (m === 'POST' && path === '/api/componentes') {
    const c = limpiar(await leerJson(req), false);
    const cols = Object.keys(c);
    const {lastInsertRowid} = db.prepare(`INSERT INTO componentes (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(c));
    return send(res, 201, comp(lastInsertRowid));
  }
  if (m === 'POST' && path === '/api/tipos') {
    const b = await leerJson(req);
    const nombre = texto(b.nombre, 120);
    if (!nombre) throw new HttpError(400, 'Falta el nombre del tipo');
    if (!db.prepare('SELECT 1 FROM categorias WHERE id = ?').get(b.categoria)) throw new HttpError(400, 'Esa categoría no existe');
    const id = slug(nombre);
    db.prepare("INSERT INTO tipos (id, nombre, categoria_id, origen) VALUES (?, ?, ?, 'usuario')").run(id, nombre, b.categoria);
    return send(res, 201, {id, nombre, categoria: b.categoria});
  }

  // ---- IA ----
  // configuración desde la web: se ve el estado (la clave solo por sus 4 últimos caracteres), se cambia con PUT
  if (m === 'GET' && path === '/api/ia/config') return send(res, 200, estado(db));
  if (m === 'PUT' && path === '/api/ia/config') {
    const b = await leerJson(req);
    try { return send(res, 200, await guardarConfig(db, {clave: b.clave, modelo: b.modelo, quitarClave: b.quitarClave === true})); }
    catch (e) { throw new HttpError(400, e.message); }
  }
  // modelos de OpenCode Go que entienden fotos y devuelven salida estructurada (del catálogo público de Go)
  if (m === 'GET' && path === '/api/ia/modelos') {
    try { return send(res, 200, await modelos()); } catch (e) { throw new HttpError(502, e.message); }
  }
  if (m === 'POST' && path === '/api/ia/alta') return send(res, 202, await crearAlta(req));
  if (m === 'GET' && path === '/api/ia/tareas') // las que siguen abiertas (pensando, propuesta sin confirmar o con error)
    return send(res, 200, db.prepare("SELECT id FROM ia_tareas WHERE estado IN ('pendiente', 'propuesta', 'error') ORDER BY id DESC LIMIT 20")
      .all().map((x) => tarea(x.id)));
  if ((r = path.match(/^\/api\/ia\/tareas\/(\d+)$/)) && m === 'GET') return send(res, 200, tarea(r[1]));
  if ((r = path.match(/^\/api\/ia\/tareas\/(\d+)\/aplicar$/)) && m === 'POST') return send(res, 200, await aplicarAlta(r[1], await leerJson(req)));
  if ((r = path.match(/^\/api\/ia\/tareas\/(\d+)\/responder$/)) && m === 'POST') return send(res, 202, responderAlta(r[1], await leerJson(req)));
  if ((r = path.match(/^\/api\/ia\/tareas\/(\d+)\/descartar$/)) && m === 'POST') {
    const t = tarea(r[1]);
    if (t.estado === 'aplicada') throw new HttpError(409, 'Esa tarea ya se aplicó');
    db.prepare("UPDATE ia_tareas SET estado = 'descartada' WHERE id = ?").run(t.id);
    await borrarFoto(t.foto);
    return send(res, 200, {ok: true});
  }
  // marcar como revisada una ficha escrita por la IA (sigue siendo de origen 'ia': seed no la pisa)
  if ((r = path.match(/^\/api\/tipos\/([a-z0-9-]+)$/)) && m === 'PATCH') {
    const b = await leerJson(req);
    if (!db.prepare('SELECT 1 FROM tipos WHERE id = ?').get(r[1])) throw new HttpError(404, 'Ese tipo no existe');
    if ('revisado' in b) db.prepare('UPDATE tipos SET revisado = ? WHERE id = ?').run(b.revisado ? 1 : 0, r[1]);
    return send(res, 200, {id: r[1], revisado: b.revisado ? 1 : 0});
  }

  if ((r = path.match(/^\/api\/ajustes\/([a-z_]+)$/)) && m === 'PUT') {
    const valor = texto((await leerJson(req)).valor, 200);
    if (!db.prepare('SELECT 1 FROM ajustes WHERE clave = ?').get(r[1])) throw new HttpError(404, 'Ese ajuste no existe');
    db.prepare('UPDATE ajustes SET valor = ? WHERE clave = ?').run(valor, r[1]); // la tabla valida los valores (CHECK)
    return send(res, 200, {clave: r[1], valor});
  }
  if ((r = path.match(/^\/api\/componentes\/(\d+)$/))) {
    const c = comp(r[1]);
    if (m === 'PATCH') {
      const cambios = limpiar(await leerJson(req), true);
      if (Object.keys(cambios).length)
        db.prepare(`UPDATE componentes SET ${Object.keys(cambios).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(cambios), c.id);
      return send(res, 200, comp(c.id));
    }
    if (m === 'DELETE') {
      db.prepare('DELETE FROM componentes WHERE id = ?').run(c.id);
      await borrarFoto(c.foto);
      return send(res, 200, {ok: true});
    }
  }
  if ((r = path.match(/^\/api\/componentes\/(\d+)\/ajuste$/)) && m === 'POST') {
    const c = comp(r[1]);
    const delta = Math.round(Number((await leerJson(req)).delta) || 0);
    db.prepare('UPDATE componentes SET cantidad = MAX(0, COALESCE(cantidad, 0) + ?), varios = 0 WHERE id = ?').run(delta, c.id);
    return send(res, 200, comp(c.id));
  }
  if ((r = path.match(/^\/api\/componentes\/(\d+)\/foto$/))) {
    const c = comp(r[1]);
    if (m === 'PUT') {
      const ext = FOTO_EXT[(req.headers['content-type'] || '').split(';')[0]];
      if (!ext) throw new HttpError(415, 'La foto tiene que ser JPG, PNG o WebP');
      const buf = await leerCuerpo(req, MAX_FOTO);
      if (buf.length < 100) throw new HttpError(400, 'Foto vacía');
      const nombre = `c${c.id}-${Date.now()}${ext}`;
      await writeFile(join(FOTOS, nombre), buf);
      db.prepare('UPDATE componentes SET foto = ? WHERE id = ?').run(nombre, c.id);
      await borrarFoto(c.foto);
      return send(res, 200, comp(c.id));
    }
    if (m === 'DELETE') {
      db.prepare('UPDATE componentes SET foto = NULL WHERE id = ?').run(c.id);
      await borrarFoto(c.foto);
      return send(res, 200, comp(c.id));
    }
  }
  throw new HttpError(404, 'Ruta no encontrada');
}

// ---------- ficheros ----------
async function estatico(res, base, path, cache) {
  const rel = normalize(path).replace(/^([/\\])+/, '');
  if (rel.startsWith('..')) throw new HttpError(403, 'No');
  const file = join(base, rel || 'index.html');
  try {
    send(res, 200, await readFile(file), TYPES[extname(file).toLowerCase()] || 'application/octet-stream', {'cache-control': cache});
  } catch {
    throw new HttpError(404, 'No encontrado');
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/salud') return send(res, 200, 'ok', 'text/plain'); // para el HEALTHCHECK de Docker (no da datos)
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.startsWith('/api/')) return await api(req, res, path);
    if (path.startsWith('/fotos/')) return await estatico(res, FOTOS, path.slice(7), 'public, max-age=31536000, immutable');
    return await estatico(res, PUB, path === '/' ? 'index.html' : path, 'no-cache');
  } catch (e) {
    let code = e instanceof HttpError ? e.code : 500;
    if (/constraint failed/i.test(e.message)) code = 400; // reglas de la base de datos (CHECK, FOREIGN KEY, UNIQUE)
    if (code === 500) console.error(e);
    if (!res.headersSent) send(res, code, {error: e.message || 'Error'});
  }
}).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`[AMS] lab → http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`         móvil → http://${ip}:${PORT}`));
});

// cierre limpio (docker stop, Ctrl+C): deja de aceptar peticiones y cierra la base de datos (vuelca el WAL)
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  console.log(`[AMS] lab: cerrando (${sig})`);
  server.close();
  server.closeAllConnections();
  try { db.close(); } catch {}
  process.exit(0);
});
