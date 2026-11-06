// [AMS] lab — servidor: web estática + API + fotos. Sin dependencias (Node 24).
//   npm start            → http://localhost:4321 (y http://<IP-del-PC>:4321 desde el móvil, misma Wi-Fi)
//   AMS_LAB_PASS=xxxx    → pide contraseña (usuario cualquiera)
//   AMS_LAB_DATA=/ruta   → carpeta de la base de datos y las fotos (por defecto ./data)
//   AMS_LAB_COPIAS=/ruta → carpeta de las copias diarias (por defecto <datos>/copias) · ver server/copias.mjs
import {createServer} from 'node:http';
import {readFile, writeFile, unlink} from 'node:fs/promises';
import {extname, join, normalize, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {networkInterfaces} from 'node:os';
import {abrir, ubicacionId, sincronizarCatalogo} from './db.mjs';
import {programarCopias} from './copias.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const DATA = process.env.AMS_LAB_DATA || join(ROOT, 'data');
const FOTOS = join(DATA, 'fotos');
const PORT = Number(process.env.PORT) || 4321;
const PASS = process.env.AMS_LAB_PASS || '';
const MAX_FOTO = 10 * 1024 * 1024;

const SEED = join(ROOT, 'seed');
const db = abrir(DATA, SEED);
// el catálogo (glosario, proyectos, colores…) se aplica desde seed/ en cada arranque: así una imagen nueva de Docker
// trae las fichas al día sin tener que entrar al contenedor. No toca el inventario.
try {
  const n = sincronizarCatalogo(db, SEED);
  console.log(`Catálogo: ${n.tipos} tipos, ${n.proyectos} proyectos`);
} catch (e) {
  console.error('No se pudo aplicar el catálogo de seed/ (sigue el anterior):', e.message);
}
programarCopias(db, DATA);
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
  return c;
};

function tipos() {
  const alias = agrupar(db.prepare('SELECT * FROM tipo_alias').all(), 'tipo_id');
  const inter = agrupar(db.prepare('SELECT * FROM tipo_interfaces ORDER BY orden').all(), 'tipo_id');
  const pines = agrupar(db.prepare('SELECT * FROM tipo_pines ORDER BY orden').all(), 'tipo_id');
  return Object.fromEntries(db.prepare('SELECT * FROM tipos').all().map((t) => [t.id, {
    nombre: t.nombre, categoria: t.categoria_id, resumen: t.resumen, voltaje: t.voltaje,
    alias: (alias[t.id] || []).map((a) => a.alias), interfaz: (inter[t.id] || []).map((i) => i.interfaz),
    pines: (pines[t.id] || []).map((p) => [p.pin, p.uso, p.funcion_id]),
  }]));
}

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
  categorias: db.prepare('SELECT id, nombre FROM categorias ORDER BY orden').all(),
  funciones: db.prepare('SELECT id, nombre, color_claro, color_oscuro, tachado FROM funciones_pin ORDER BY orden').all(),
  ajustes: Object.fromEntries(db.prepare('SELECT clave, valor FROM ajustes').all().map((a) => [a.clave, a.valor])),
  dificultades: db.prepare('SELECT nivel, nombre FROM dificultades ORDER BY nivel').all(),
  ubicaciones: db.prepare('SELECT nombre FROM ubicaciones ORDER BY nombre COLLATE NOCASE').all().map((u) => u.nombre),
  tipos: tipos(),
  proyectos: proyectos(),
  componentes: db.prepare(`${SQL_COMP} ORDER BY c.nombre COLLATE NOCASE`).all(),
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
    db.prepare('INSERT INTO tipos (id, nombre, categoria_id) VALUES (?, ?, ?)').run(id, nombre, b.categoria);
    return send(res, 201, {id, nombre, categoria: b.categoria});
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

function autorizado(req) {
  if (!PASS) return true;
  const [tipo, val] = (req.headers.authorization || '').split(' ');
  return tipo === 'Basic' && Buffer.from(val || '', 'base64').toString().split(':').slice(1).join(':') === PASS;
}

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/salud') return send(res, 200, 'ok', 'text/plain'); // para el HEALTHCHECK de Docker (no da datos)
    if (!autorizado(req)) return send(res, 401, 'Contraseña', 'text/plain', {'www-authenticate': 'Basic realm="ams-lab"'});
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
  if (!PASS) console.log('         (sin contraseña: pon AMS_LAB_PASS para pedirla)');
});

// cierre limpio (docker stop, Ctrl+C): deja de aceptar peticiones y cierra la base de datos (vuelca el WAL)
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  console.log(`[AMS] lab: cerrando (${sig})`);
  server.close();
  server.closeAllConnections();
  try { db.close(); } catch {}
  process.exit(0);
});
