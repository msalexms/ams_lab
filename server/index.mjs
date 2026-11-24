// CircuitBin — servidor: web estática + API + fotos (Node 24; las únicas dependencias de npm son las de la IA).
//   npm start            → http://localhost:4321 (y http://<IP-del-PC>:4321 desde el móvil, misma Wi-Fi)
//   AMS_LAB_DATA=/ruta   → carpeta de la base de datos y las fotos (por defecto ./data)
//   AMS_LAB_COPIAS=/ruta → carpeta de las copias diarias (por defecto <datos>/copias) · ver server/copias.mjs
//   «Añadir con IA» (OpenCode Go): clave y modelo desde la web (o IA_CLAVE / IA_MODELO) · ver server/ia.mjs
import * as registro from './registro.mjs'; // lo primero: guarda los mensajes desde el arranque
import {createServer} from 'node:http';
import {readFile, writeFile, unlink, rename, copyFile} from 'node:fs/promises';
import {extname, join, normalize, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {networkInterfaces} from 'node:os';
import {randomBytes, createHash} from 'node:crypto';
import {readdirSync, readFileSync, statSync, existsSync, createReadStream, copyFileSync, renameSync, rmSync, mkdirSync} from 'node:fs';
import {abrir, ubicacionId, sincronizarCatalogo, guardarTipo, leerFicha, VERSION} from './db.mjs';
import * as aud from './auditoria.mjs';
import {programarCopias, opcionesCopias, copiar, copiarFotosNuevas} from './copias.mjs';
import * as respaldo from './respaldo.mjs';
import * as cat from './catalogo.mjs';
import * as pro from './proyectos.mjs';
import * as uniformar from './uniformar.mjs';
import {separarPines} from './formato.mjs';
import {aplicarCambios} from './revision.mjs';
import {estado, ejecutarAlta, normalizar, cerrarInterrumpidas, modelos, guardarConfig, modeloValido, infoModelo, MAX_DETECTADAS, MODELO_RECOMENDADO} from './ia.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const DATA = process.env.CIRCUITBIN_DATA || process.env.AMS_LAB_DATA || join(ROOT, 'data');
const FOTOS = join(DATA, 'fotos');
const PORT = Number(process.env.PORT) || 4321;
const MAX_FOTO = 10 * 1024 * 1024;

const SEED = join(ROOT, 'seed');
// «let»: al restaurar una copia se cierra y se vuelve a abrir (los demás módulos la reciben en cada llamada)
let db = abrir(DATA, SEED);
// el catálogo (glosario, proyectos, colores…) se aplica desde seed/ en cada arranque: así una imagen nueva de Docker
// trae las fichas al día sin tener que entrar al contenedor. No toca el inventario.
function aplicarCatalogo() {
  try {
    const n = sincronizarCatalogo(db, SEED);
    console.log(`Catálogo: ${n.tipos} tipos, ${n.proyectos} proyectos${n.respetados ? ` (${n.respetados} tipo(s) cambiado(s) por la IA o por ti: no se pisan)` : ''}`);
  } catch (e) {
    console.error('No se pudo aplicar el catálogo de seed/ (sigue el anterior):', e.message);
  }
}
aplicarCatalogo();
programarCopias(() => db, DATA);
respaldo.limpiarEtapas(DATA); // restauraciones preparadas y no confirmadas
cat.limpiarPapelera(FOTOS);
cerrarInterrumpidas(db);
aud.podar(db);
{ const e = estado(db); console.log(e.activa ? `[ia] activa: ${e.modelo} (clave de ${e.origen_clave})` : '[ia] sin clave: se configura desde la web'); }
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
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
    req.on('data', (c) => { n += c.length; if (n > limit) { ko(new HttpError(413, 'Es demasiado grande')); req.destroy(); } else partes.push(c); });
    req.on('end', () => ok(Buffer.concat(partes)));
    req.on('error', ko);
  });
}
// cuerpo JSON (por defecto, hasta 1 MB; con fotos en base64, más): demasiado grande → 413, mal formado → 400
async function leerJson(req, limite = 1e6) {
  const cuerpo = await leerCuerpo(req, limite);
  try { return JSON.parse(cuerpo.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'JSON no válido'); }
}
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

// tipos con dibujo propio (public/img/tipos/<id>.svg); los demás usan el genérico (_pieza.svg)
const conDibujo = () => new Set(readdirSync(join(PUB, 'img', 'tipos')).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)));
function tipos() {
  const dibujos = conDibujo();
  const alias = agrupar(db.prepare('SELECT * FROM tipo_alias').all(), 'tipo_id');
  const inter = agrupar(db.prepare('SELECT * FROM tipo_interfaces ORDER BY orden').all(), 'tipo_id');
  const pines = agrupar(db.prepare('SELECT * FROM tipo_pines ORDER BY orden').all(), 'tipo_id');
  const datos = agrupar(db.prepare('SELECT * FROM tipo_datos ORDER BY orden').all(), 'tipo_id');
  return Object.fromEntries(db.prepare('SELECT * FROM tipos').all().map((t) => [t.id, {
    nombre: t.nombre, categoria: t.categoria_id, resumen: t.resumen, voltaje: t.voltaje,
    alias: (alias[t.id] || []).map((a) => a.alias), interfaz: (inter[t.id] || []).map((i) => i.interfaz),
    pines: (pines[t.id] || []).map((p) => [p.pin, p.uso, p.funcion_id, p.nota || '']),
    datos: (datos[t.id] || []).map((d) => [d.clave, d.valor]),
    ojo: t.advertencias || '', origen: t.origen, revisado: t.revisado, archivado: t.archivado, dibujo: dibujos.has(t.id),
  }]));
}

// datos extra de cada pieza ([clave, valor]), para añadirlos a los componentes que entrega la API
const datosDe = (filas) => {
  const d = agrupar(db.prepare('SELECT * FROM componente_datos ORDER BY orden').all(), 'componente_id');
  return filas.map((c) => ({...c, datos: (d[c.id] || []).map((x) => [x.clave, x.valor])}));
};

const todo = () => ({
  ia: estado(db), // nunca la clave entera
  categorias: db.prepare('SELECT id, nombre, color FROM categorias ORDER BY orden').all(),
  funciones: db.prepare('SELECT id, nombre, color_claro, color_oscuro, tachado FROM funciones_pin ORDER BY orden').all(),
  ajustes: Object.fromEntries(db.prepare('SELECT clave, valor FROM ajustes').all().map((a) => [a.clave, a.valor])),
  dificultades: db.prepare('SELECT nivel, nombre FROM dificultades ORDER BY nivel').all(),
  ubicaciones: db.prepare('SELECT nombre FROM ubicaciones ORDER BY nombre COLLATE NOCASE').all().map((u) => u.nombre),
  tipos: tipos(),
  proyectos: pro.listar(db),
  componentes: datosDe(db.prepare(`${SQL_COMP} ORDER BY c.nombre COLLATE NOCASE`).all()),
});

// ---------- historial de cambios (Ajustes → Historial) ----------
const apuntar = (x) => aud.apuntar(db, x);
const nombresTipo = () => Object.fromEntries(db.prepare('SELECT id, nombre FROM tipos').all().map((t) => [t.id, t.nombre]));
const nombresCategoria = () => Object.fromEntries(db.prepare('SELECT id, nombre FROM categorias').all().map((t) => [t.id, t.nombre]));
const cantidadDe = (c) => (c.varios ? 'muchas' : c.cantidad == null ? 'sin contar' : String(c.cantidad));
// lo que cambió en una pieza entre dos lecturas (comp()); si no cambió nada, no se apunta
function apuntarPieza(antes, despues, {accion = 'pieza.editar', sufijo = '', detalle = null} = {}) {
  const cambios = aud.cambiosPieza(antes, despues, nombresTipo());
  if (cambios.length) apuntar({accion, objeto: 'pieza', id: despues.id, nombre: despues.nombre, resumen: aud.resumenCambios('Editada', cambios) + sufijo, cambios, detalle});
}
function apuntarBorrado(c, detalle = {}) {
  apuntar({accion: 'pieza.borrar', objeto: 'pieza', id: c.id, nombre: c.nombre, resumen: 'Pieza borrada',
    detalle: {...detalle, cantidad: cantidadDe(c), sitio: c.ubicacion || null, tipo: c.tipo ? nombresTipo()[c.tipo] || c.tipo : null}});
}

// ---------- escritura ----------
function limpiar(b, parcial) {
  const out = {};
  if (!parcial || 'nombre' in b) { out.nombre = texto(b.nombre, 200); if (!out.nombre) throw new HttpError(400, 'Falta el nombre de la pieza'); }
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

// datos extra de una pieza («Valor» → «220 Ω»): se reescriben enteros cuando llegan
function guardarDatosPieza(id, datos) {
  if (!Array.isArray(datos)) return;
  const limpio = (v, max) => texto(v, max).replace(/\s+/g, ' ');
  const filas = datos.filter(Array.isArray).map(([k, v]) => [limpio(k, 60), limpio(v, 200)]).filter(([k, v]) => k && v).slice(0, 40);
  const repe = filas.find(([k], i) => filas.findIndex(([x]) => x.toLowerCase() === k.toLowerCase()) !== i);
  if (repe) throw new HttpError(400, `El dato «${repe[0]}» está repetido`);
  db.prepare('DELETE FROM componente_datos WHERE componente_id = ?').run(id);
  filas.forEach(([k, v], n) => db.prepare('INSERT INTO componente_datos (componente_id, orden, clave, valor) VALUES (?, ?, ?, ?)').run(id, n + 1, k, v));
}

// preferencias que se pueden cambiar desde la web y sus valores válidos (los valores por defecto están en seed/referencia.json)
const NOMBRE_AJUSTE = {tema: 'Tema', vista_inventario: 'Vista del inventario', fuente: 'Letra', ia_razonar: 'Cuánto razona la IA', idioma: 'Idioma'}; // «Letra» ya no se elige (estilo AMSTech), pero sale en el historial antiguo
const AJUSTES = {tema: ['auto', 'claro', 'noche'], vista_inventario: ['lista', 'cuadricula'], ia_razonar: ['poco', 'medio', 'mucho'], idioma: ['en', 'es']};

// ---------- restaurar una copia (Ajustes → Datos) ----------
// antes de nada, copia completa del estado actual (base de datos + fotos) en la carpeta de copias, fuera de la rotación.
// Luego se cierra la base de datos, se pone la de la copia, se añaden sus fotos (sin borrar ni pisar ninguna) y se
// vuelve a abrir (con su migración si es de una versión anterior). Todo síncrono: ninguna petición se cuela entre medias.
function restaurar(token) {
  const {dir, resumen: r} = respaldo.etapa(DATA, token);
  if (db.prepare("SELECT COUNT(*) AS n FROM ia_tareas WHERE estado = 'pendiente'").get().n)
    throw new HttpError(409, 'La IA está trabajando en algo: espera a que termine y vuelve a intentarlo');
  respaldo.comprobarBase(join(dir, 'lab.db')); // otra vez, por si acaso
  const op = opcionesCopias(DATA);
  mkdirSync(op.dir, {recursive: true});
  let antes = join(op.dir, `lab-antes-restaurar-${respaldo.sello()}.db`);
  for (let n = 2; existsSync(antes); n++) antes = join(op.dir, `lab-antes-restaurar-${respaldo.sello()}-${n}.db`); // dos en el mismo segundo
  db.exec(`VACUUM INTO '${antes.replaceAll("'", "''")}'`);
  copiarFotosNuevas(DATA, op.dir);
  db.close();
  let fotos = 0;
  try {
    copyFileSync(join(dir, 'lab.db'), join(DATA, 'lab.db.nueva'));
    for (const x of ['-wal', '-shm']) rmSync(join(DATA, `lab.db${x}`), {force: true});
    renameSync(join(DATA, 'lab.db.nueva'), join(DATA, 'lab.db'));
    fotos = respaldo.moverFotos(dir, FOTOS);
  } finally {
    db = abrir(DATA, SEED); // la restaurada, o la de antes si algo falló al cambiarla
    aplicarCatalogo();
    cerrarInterrumpidas(db);
    cat.vaciarPapelera();
  }
  respaldo.limpiarEtapas(DATA);
  console.log(`[copias] restaurada (${r.origen}): ${r.piezas} piezas, +${fotos} fotos · estado anterior en ${antes}`);
  apuntar({accion: 'copia.restaurar', objeto: 'copia', nombre: r.origen, resumen: `Copia restaurada: ${r.piezas} piezas, ${r.tipos} tipos${fotos ? `, ${fotos} fotos nuevas` : ''}`,
    detalle: {origen: r.origen, antes: antes.split(/[\\/]/).pop()}});
  return {ok: true, piezas: r.piezas, tipos: r.tipos, fotos, antes: antes.split(/[\\/]/).pop()};
}
function listaCopias() {
  const {dir} = opcionesCopias(DATA);
  try {
    return readdirSync(dir).filter((f) => /^lab-[\w.-]+\.db$/.test(f)).map((f) => {
      const st = statSync(join(dir, f));
      return {nombre: f, bytes: st.size, fecha: st.mtime.toISOString()};
    }).sort((a, b) => b.fecha.localeCompare(a.fecha));
  } catch { return []; }
}

// id para un tipo nuevo: libre y que no esté entre los quitados (si no, seed/ lo confundiría con el borrado)
const slug = (s) => cat.idLibre(db, 'tipos', s, 'tipo');

// Ajustes → Datos: versión, recuentos y copias de seguridad
function resumen() {
  const {dir, max} = opcionesCopias(DATA);
  const copias = listaCopias();
  const n = (sql) => db.prepare(sql).get().n;
  return {
    version: VERSION, piezas: n('SELECT COUNT(*) AS n FROM componentes'), tipos: n('SELECT COUNT(*) AS n FROM tipos WHERE archivado = 0'),
    archivados: n('SELECT COUNT(*) AS n FROM tipos WHERE archivado = 1'), categorias: n('SELECT COUNT(*) AS n FROM categorias'),
    sitios: n('SELECT COUNT(*) AS n FROM ubicaciones'), proyectos: n('SELECT COUNT(*) AS n FROM proyectos'),
    fotos: n('SELECT COUNT(*) AS n FROM componentes WHERE foto IS NOT NULL'),
    copias: {carpeta: dir, guardadas: copias.length, maximo: max, ultima: copias[0] || null, lista: copias.slice(0, 12)},
  };
}

async function borrarFoto(nombre) {
  if (nombre) await unlink(join(FOTOS, nombre)).catch(() => {});
}

// ---------- fotos de las tareas de la IA ----------
// una tarea lleva su foto principal (entrada.foto: en un alta pasa a ser la de la pieza), hasta 3 más al empezar
// (entrada.fotos_extra) y las que se añaden al contestar las dudas (entrada.rondas[].fotos). Como mucho MAX_FOTOS_TAREA.
const MAX_FOTOS_INICIO = 4, MAX_FOTOS_RONDA = 4, MAX_FOTOS_TAREA = 8;
const MAX_CUERPO_FOTOS = MAX_FOTOS_INICIO * MAX_FOTO * 1.4; // base64 ocupa ~4/3
const fotosDeEntrada = (e) => [e.foto, ...(e.fotos_extra || []), ...(e.rondas || []).flatMap((r) => r.fotos || [])].filter(Boolean);
// lista de fotos en base64 → Buffers comprobados (vacías o enormes: error)
function fotosDe(lista, max) {
  const fotos = (Array.isArray(lista) ? lista : []).filter(Boolean).map((x) => Buffer.from(String(x), 'base64'));
  if (fotos.length > max) throw new HttpError(400, `Como mucho ${max} fotos a la vez`);
  for (const f of fotos) {
    if (f.length < 100) throw new HttpError(400, 'Una de las fotos está vacía');
    if (f.length > MAX_FOTO) throw new HttpError(413, 'Una de las fotos es demasiado grande');
  }
  return fotos;
}
async function guardarFotosTarea(id, fotos, prefijo) {
  const nombres = [];
  for (const [i, f] of fotos.entries()) {
    const n = `ia-${id}-${prefijo}${i + 1}-${Date.now()}.jpg`;
    await writeFile(join(FOTOS, n), f);
    nombres.push(n);
  }
  return nombres;
}
const leerJsonFotos = (req) => leerJson(req, MAX_CUERPO_FOTOS);

const exigirIA = () => { if (!estado(db).activa) throw new HttpError(503, 'Falta la clave de OpenCode Go: ponla en Ajustes → IA'); };

// estados de una tarea de la IA, para los mensajes
const ESTADO = {pendiente: 'en marcha', propuesta: 'esperando', aplicada: 'aplicada', descartada: 'descartada', error: 'con error'};

// ---------- IA: tareas de alta (crear → el modelo propone → el usuario confirma o descarta) ----------
// nombre legible de lo que se revisa: la pieza (si se revisa desde una pieza) o el tipo
function nombreObjetivo(o) {
  if (!o) return null;
  if (o.componente_id) return db.prepare('SELECT nombre FROM componentes WHERE id = ?').get(o.componente_id)?.nombre || null;
  return o.tipo_id ? db.prepare('SELECT nombre FROM tipos WHERE id = ?').get(o.tipo_id)?.nombre || null : null;
}
const tarea = (id) => {
  const t = db.prepare('SELECT * FROM ia_tareas WHERE id = ?').get(Number(id));
  if (!t) throw new HttpError(404, 'No existe esa tarea');
  const entrada = JSON.parse(t.entrada);
  return {id: t.id, clase: t.clase, estado: t.estado, texto: entrada.texto || '', foto: entrada.foto || null, foto_de_pieza: !!entrada.foto_de_pieza,
    fotos: fotosDeEntrada(entrada),
    propuesta: t.propuesta ? JSON.parse(t.propuesta) : null, error: t.error, modelo: t.modelo,
    componente_id: t.componente_id, creada: t.creada, rondas: (entrada.rondas || []).length,
    actualizada: t.actualizada, ahora: db.prepare("SELECT datetime('now') AS t").get().t, // para el contador de segundos
    modelo_pedido: entrada.modelo || null, objetivo: entrada.objetivo || null, objetivo_nombre: nombreObjetivo(entrada.objetivo), lote: entrada.lote || null};
};

// el usuario contesta las dudas (y/o añade información) sobre la propuesta que tiene en pantalla, quizá ya corregida:
// se guarda como una «vuelta» y el modelo rehace la propuesta. Como mucho 5 vueltas por tarea.
const MAX_RONDAS = 5;
async function responderAlta(id, b) {
  const t = tarea(id);
  if (t.estado !== 'propuesta') throw new HttpError(409, `Esta propuesta ya está ${ESTADO[t.estado] || t.estado}: no se puede repensar`);
  if (t.rondas >= MAX_RONDAS) throw new HttpError(409, `Ya van ${MAX_RONDAS} vueltas: ${t.clase === 'revisar' ? 'aplica lo que te sirva y corrige a mano el resto' : 'corrige a mano y guarda'}`);
  // cada respuesta puede llevar su foto («¿qué pone en la serigrafía?» → la foto de la serigrafía); una foto sola ya contesta
  const contestadas = (Array.isArray(b.respuestas) ? b.respuestas : []).slice(0, 12)
    .map((x) => ({duda: texto(x?.duda, 300), respuesta: texto(x?.respuesta, 500), fotos: fotosDe(x?.fotos, MAX_FOTOS_RONDA)})).filter((x) => x.duda && (x.respuesta || x.fotos.length));
  const extra = texto(b.extra, 1000);
  // primero las de las respuestas, en su orden, y después las sueltas: así se numeran dentro de la vuelta
  const nuevas = [...contestadas.flatMap((x) => x.fotos), ...fotosDe(b.fotos, MAX_FOTOS_RONDA)];
  if (nuevas.length > MAX_FOTOS_RONDA) throw new HttpError(400, `Como mucho ${MAX_FOTOS_RONDA} fotos en cada vuelta (has puesto ${nuevas.length})`);
  let numero = 0;
  const respuestas = contestadas.map((x) => ({duda: x.duda, respuesta: x.respuesta, ...(x.fotos.length ? {fotos: x.fotos.map(() => ++numero)} : {})}));
  if (!respuestas.length && !extra && !nuevas.length) throw new HttpError(400, 'Contesta alguna duda, escribe algo más o añade una foto');
  if (nuevas.length) {
    const m = await infoModelo(db, t.modelo_pedido);
    if (m && !m.vision) throw new HttpError(400, `${m.nombre} no ve fotos: contesta con texto`);
    if (t.fotos.length + nuevas.length > MAX_FOTOS_TAREA) throw new HttpError(400, `Como mucho ${MAX_FOTOS_TAREA} fotos por consulta (ya lleva ${t.fotos.length})`);
  }
  const entrada = JSON.parse(db.prepare('SELECT entrada FROM ia_tareas WHERE id = ?').get(t.id).entrada);
  const fotos = await guardarFotosTarea(t.id, nuevas, `r${(entrada.rondas || []).length + 1}-`);
  if (t.clase === 'revisar') {
    // corrección: el modelo vuelve a mirar la ficha (tal como está AHORA) con las respuestas; los cambios se recalculan
    entrada.rondas = [...(entrada.rondas || []), {respuestas, extra, ...(fotos.length ? {fotos} : {})}];
  } else {
    // alta: la propuesta tal como la tiene el usuario (con sus correcciones), con la misma limpieza que al guardar
    const pb = b.propuesta && typeof b.propuesta === 'object' ? b.propuesta : {};
    const actual = normalizar(db, {...t.propuesta, ...pb, dudas: t.propuesta.dudas, opciones: t.propuesta.opciones, confianza: t.propuesta.confianza,
      tipo_existente: pb.tipo === '__nuevo' ? null : pb.tipo ?? t.propuesta.tipo_existente,
      tipo_nuevo: pb.tipo === '__nuevo' ? pb.tipo_nuevo : pb.tipo ? null : t.propuesta.tipo_nuevo});
    entrada.rondas = [...(entrada.rondas || []), {propuesta: actual, respuestas, extra, ...(fotos.length ? {fotos} : {})}];
  }
  db.prepare("UPDATE ia_tareas SET entrada = ?, estado = 'pendiente', error = NULL WHERE id = ? AND estado = 'propuesta'")
    .run(JSON.stringify(entrada), t.id);
  encolarIA(t.id); // en segundo plano, como el alta
  return tarea(t.id);
}

// «Corregir con IA» desde una pieza (revisa la pieza y su tipo) o desde un tipo (revisa la ficha)
async function crearRevision(req) {
  exigirIA();
  const b = await leerJsonFotos(req); // la foto y hasta 3 más
  const id = await nuevaRevision(b);
  encolarIA(id);
  return tarea(id);
}

// crea una tarea de corrección (sin lanzarla). b: {objetivo: 'pieza' | 'tipo', id, texto, modelo, foto (base64), lote}
async function nuevaRevision(b) {
  const objetivo = {};
  if (b.objetivo === 'pieza') {
    const c = db.prepare('SELECT id, tipo_id FROM componentes WHERE id = ?').get(Number(b.id));
    if (!c) throw new HttpError(404, 'No existe esa pieza');
    objetivo.componente_id = c.id;
    if (c.tipo_id) objetivo.tipo_id = c.tipo_id;
  } else if (b.objetivo === 'tipo') {
    if (!db.prepare('SELECT 1 FROM tipos WHERE id = ?').get(String(b.id))) throw new HttpError(404, 'Ese tipo no existe');
    objetivo.tipo_id = String(b.id);
  } else throw new HttpError(400, 'Di qué hay que corregir (una pieza o un tipo)');
  const entrada = {texto: texto(b.texto, 1000), objetivo, ...(b.lote ? {lote: String(b.lote)} : {})};
  if (b.modelo) {
    if (!(await modeloValido(String(b.modelo)))) throw new HttpError(400, 'Ese modelo no está en el catálogo');
    entrada.modelo = String(b.modelo);
  }
  const foto = b.foto ? Buffer.from(String(b.foto), 'base64') : null;
  if (foto && foto.length < 100) throw new HttpError(400, 'Foto vacía');
  // sin foto nueva, el modelo ve la que ya tiene la pieza (o, desde un tipo, la de una de sus piezas)
  const suya = foto ? null : db.prepare(`SELECT foto FROM componentes WHERE foto LIKE '%.jpg' AND ${objetivo.componente_id ? 'id = ?' : 'tipo_id = ?'}
    ORDER BY actualizado DESC LIMIT 1`).get(objetivo.componente_id ?? objetivo.tipo_id)?.foto;
  const extras = foto ? fotosDe(b.fotos, MAX_FOTOS_INICIO - 1) : []; // otras fotos que manda el usuario (solo para el modelo)
  const {lastInsertRowid: id} = db.prepare("INSERT INTO ia_tareas (clase, entrada, componente_id) VALUES ('revisar', ?, ?)")
    .run(JSON.stringify(entrada), objetivo.componente_id ?? null);
  if (foto || suya) {
    entrada.foto = `ia-${id}-${Date.now()}.jpg`; // una copia solo para el modelo: se borra al aplicar o descartar (la de la pieza no se toca)
    if (foto) await writeFile(join(FOTOS, entrada.foto), foto);
    else { await copyFile(join(FOTOS, suya), join(FOTOS, entrada.foto)); entrada.foto_de_pieza = true; }
    if (extras.length) entrada.fotos_extra = await guardarFotosTarea(id, extras, 'x');
    db.prepare('UPDATE ia_tareas SET entrada = ? WHERE id = ?').run(JSON.stringify(entrada), id);
  }
  return Number(id);
}

// cola de llamadas al modelo: como mucho 2 a la vez (un lote de 20 piezas no lanza 20 peticiones juntas)
const colaIA = [];
let enCurso = 0;
function encolarIA(id) {
  if (id != null) colaIA.push(id);
  while (enCurso < 2 && colaIA.length) {
    enCurso++;
    const tid = colaIA.shift(), t0 = Date.now();
    Promise.resolve(ejecutarAlta(db, FOTOS, tid)).catch(() => {}).finally(() => {
      enCurso--;
      try {
        const t = db.prepare('SELECT clase, estado, modelo, error FROM ia_tareas WHERE id = ?').get(tid);
        if (t) console[t.estado === 'error' ? 'warn' : 'log'](`[ia] tarea ${tid} (${t.clase === 'revisar' ? 'corrección' : t.clase === 'detectar' ? 'foto con varias' : 'alta'}, ${t.modelo || '?'}): ${t.estado === 'propuesta' ? 'propuesta lista' : t.estado}${t.error ? ` · ${t.error}` : ''} · ${Math.round((Date.now() - t0) / 1000)} s`);
      } catch {}
      encolarIA();
    });
  }
}

// «Corregir con IA» de varias piezas a la vez: una tarea por pieza, todas con el mismo «lote»
const MAX_LOTE = 30;
async function corregirLote(b) {
  exigirIA();
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw new HttpError(400, 'Elige alguna pieza');
  if (ids.length > MAX_LOTE) throw new HttpError(400, `Como mucho ${MAX_LOTE} piezas a la vez`);
  const faltan = ids.filter((id) => !db.prepare('SELECT 1 FROM componentes WHERE id = ?').get(id));
  if (faltan.length) throw new HttpError(404, `No existe${faltan.length > 1 ? 'n' : ''} ${faltan.length > 1 ? 'algunas piezas' : 'esa pieza'}`);
  const lote = randomBytes(6).toString('hex'), tareas = [];
  for (const id of ids) tareas.push(await nuevaRevision({objetivo: 'pieza', id, texto: b.texto, lote}));
  tareas.forEach(encolarIA);
  return {lote, tareas};
}
// «IA pendiente»: lo que la IA tiene abierto (pensando, esperando a que lo mires o con error). Los lotes van juntos.
const ESTADOS_ABIERTOS = ['pendiente', 'propuesta', 'error'];
const ABIERTAS = `estado IN (${ESTADOS_ABIERTOS.map((e) => `'${e}'`).join(', ')})`;
function pendientesIA() {
  const filas = db.prepare(`SELECT id, json_extract(entrada, '$.lote') AS lote FROM ia_tareas WHERE ${ABIERTAS} ORDER BY id DESC`).all();
  const lotes = [...new Set(filas.map((f) => f.lote).filter(Boolean))].map((lote) => {
    const ts = tareasLote(lote), abiertas = ts.filter((t) => ESTADOS_ABIERTOS.includes(t.estado));
    const estados = {};
    for (const t of ts) estados[t.estado] = (estados[t.estado] || 0) + 1;
    return {lote, clase: ts[0]?.clase, creada: ts[0]?.creada, total: ts.length, estados, piezas: abiertas.map((t) => t.objetivo_nombre || t.propuesta?.nombre || t.texto).filter(Boolean),
      cambios: abiertas.reduce((n, t) => n + (t.estado === 'propuesta' ? t.propuesta?.cambios?.length || 0 : 0), 0),
      texto: ts[0]?.clase === 'alta' ? '' : ts[0]?.texto || ''}; // en un lote de piezas nuevas el texto es la pista interna de cada recorte
  });
  return {lotes, tareas: filas.filter((f) => !f.lote).slice(0, 100).map((f) => tarea(f.id)), total: filas.length};
}
// para el aviso del Inventario: cuántas cosas esperan (un lote cuenta como una)
function cuentaPendientes() {
  const r = db.prepare(`SELECT COUNT(*) AS tareas, COUNT(DISTINCT json_extract(entrada, '$.lote')) AS lotes,
    SUM(json_extract(entrada, '$.lote') IS NULL) AS sueltas, SUM(estado = 'pendiente') AS pensando FROM ia_tareas WHERE ${ABIERTAS}`).get();
  return {tareas: r.tareas, grupos: r.lotes + (r.sueltas || 0), pensando: r.pensando || 0};
}
const tareasLote = (lote) => db.prepare("SELECT id FROM ia_tareas WHERE json_extract(entrada, '$.lote') = ? ORDER BY id").all(String(lote)).map((x) => tarea(x.id));

// edición rápida de varias piezas (cada una con sus campos), todo o nada
const MAX_PIEZAS_LOTE = 300;
function editarLote(b) {
  const piezas = Array.isArray(b.piezas) ? b.piezas.slice(0, MAX_PIEZAS_LOTE) : [];
  if (!piezas.length) throw new HttpError(400, 'No hay nada que guardar');
  const antes = [];
  db.exec('BEGIN');
  try {
    for (const p of piezas) {
      const c = comp(p.id);
      antes.push(c);
      // una cantidad concreta quiere decir que ya están contadas: deja de ser «hay muchas»
      const cambios = limpiar(p.cantidad != null && p.cantidad !== '' && !('varios' in p) ? {...p, varios: false} : p, true);
      if (Object.keys(cambios).length)
        db.prepare(`UPDATE componentes SET ${Object.keys(cambios).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(cambios), c.id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  for (const a of antes) apuntarPieza(a, comp(a.id), {sufijo: ' (varias a la vez)', detalle: {varias: true}});
  return {ok: true, guardadas: piezas.length, componentes: piezas.map((p) => comp(p.id))};
}

// aplica los cambios marcados de una revisión, todos o ninguno, comprobando que nada ha cambiado desde entonces
async function aplicarRevision(id, b) {
  const t = tarea(id);
  if (t.clase !== 'revisar') throw new HttpError(400, 'Esta tarea no es una corrección');
  if (t.estado !== 'propuesta') throw new HttpError(409, `Estas correcciones ya están ${ESTADO[t.estado] || t.estado}`);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String);
  const o = t.propuesta.objetivo || {};
  const tipoAntes = o.componente_id ? db.prepare('SELECT tipo_id FROM componentes WHERE id = ?').get(o.componente_id)?.tipo_id : null;
  let n;
  db.exec('BEGIN');
  try {
    n = aplicarCambios(db, t.propuesta.objetivo, t.propuesta.cambios, ids);
    db.prepare("UPDATE ia_tareas SET estado = 'aplicada' WHERE id = ?").run(t.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    if (e.code === 400 || e.code === 409) throw new HttpError(e.code, e.message);
    throw e;
  }
  for (const f of t.fotos) await borrarFoto(f);
  // al historial: lo de la pieza y lo de la ficha por separado (cada uno sale en su historial), con el modelo
  const elegidos = t.propuesta.cambios.filter((c) => ids.includes(c.id));
  const lote = JSON.parse(db.prepare('SELECT entrada FROM ia_tareas WHERE id = ?').get(t.id).entrada).lote || null;
  const comun = {quien: 'ia', accion: 'ia.aplicar', modelo: t.modelo, detalle: {tarea: t.id, ...(lote ? {lote} : {})}};
  const verCambio = (c) => ({campo: c.etiqueta, antes: c.antes, despues: c.despues});
  const dePieza = elegidos.filter((c) => c.ambito === 'pieza').map(verCambio), deTipo = elegidos.filter((c) => c.ambito === 'tipo').map(verCambio);
  const nuevoTipo = elegidos.find((c) => c.id === 'pieza.tipo' && c.nuevo?.nuevo) && o.componente_id
    ? db.prepare('SELECT tipo_id FROM componentes WHERE id = ?').get(o.componente_id)?.tipo_id : null;
  if (nuevoTipo && nuevoTipo !== tipoAntes)
    apuntar({...comun, accion: 'tipo.alta', objeto: 'tipo', id: nuevoTipo, nombre: nombresTipo()[nuevoTipo], resumen: 'Ficha nueva creada por la IA (sin comprobar)'});
  if (dePieza.length && o.componente_id)
    apuntar({...comun, objeto: 'pieza', id: o.componente_id, nombre: db.prepare('SELECT nombre FROM componentes WHERE id = ?').get(o.componente_id)?.nombre,
      resumen: aud.resumenCambios('Corregida con IA', dePieza), cambios: dePieza});
  if (deTipo.length && o.tipo_id)
    apuntar({...comun, objeto: 'tipo', id: o.tipo_id, nombre: nombresTipo()[o.tipo_id], resumen: aud.resumenCambios('Ficha corregida con IA', deTipo), cambios: deTipo});
  return {ok: true, aplicados: n, objetivo: t.propuesta.objetivo};
}

async function crearAlta(req) {
  exigirIA();
  const b = await leerJsonFotos(req); // la foto principal y hasta 3 más
  const id = await nuevaTareaFoto('alta', b);
  encolarIA(id); // en segundo plano: la web va preguntando el estado
  return tarea(id);
}

// crea (sin lanzarla) una tarea que parte de una foto y/o un texto: «alta» (una pieza) o «detectar» (foto con varias).
// b: {texto, foto (base64), modelo, lote}
async function nuevaTareaFoto(clase, b) {
  const textoUsuario = texto(b.texto, 1000);
  const foto = b.foto ? Buffer.from(String(b.foto), 'base64') : null;
  if (clase === 'detectar' && !foto) throw new HttpError(400, 'Falta la foto con las piezas');
  if (!textoUsuario && !foto) throw new HttpError(400, 'Pon una foto o escribe algo de la pieza');
  if (foto && foto.length < 100) throw new HttpError(400, 'Foto vacía');
  if (foto && foto.length > MAX_FOTO) throw new HttpError(413, 'La foto es demasiado grande');
  // modelo solo para esta vez (opcional): tiene que estar en el catálogo
  const entrada = {texto: textoUsuario, ...(b.lote ? {lote: String(b.lote)} : {})};
  if (b.modelo) {
    const pedido = String(b.modelo);
    if (!(await modeloValido(pedido))) throw new HttpError(400, 'Ese modelo no está en el catálogo');
    entrada.modelo = pedido;
  }
  // lo que sabe hacer el modelo: uno que no ve fotos necesita texto, y no puede separar las piezas de una foto
  const m = await infoModelo(db, entrada.modelo);
  if (m && !m.vision && clase === 'detectar') throw new HttpError(400, `${m.nombre} no ve fotos: elige otro modelo para la foto con varias piezas`);
  if (m && !m.vision && !textoUsuario) throw new HttpError(400, `${m.nombre} no ve fotos: escribe qué es la pieza o elige otro modelo`);
  const extras = clase === 'alta' && foto ? fotosDe(b.fotos, MAX_FOTOS_INICIO - 1) : []; // otras caras de la pieza (solo para el modelo)
  const {lastInsertRowid: id} = db.prepare('INSERT INTO ia_tareas (clase, entrada) VALUES (?, ?)').run(clase, JSON.stringify(entrada));
  if (foto) {
    entrada.foto = `ia-${id}-${Date.now()}.jpg`; // provisional: al confirmar pasa a ser la foto de la pieza
    await writeFile(join(FOTOS, entrada.foto), foto);
    if (extras.length) entrada.fotos_extra = await guardarFotosTarea(id, extras, 'x');
    db.prepare('UPDATE ia_tareas SET entrada = ? WHERE id = ?').run(JSON.stringify(entrada), id);
  }
  return Number(id);
}

// foto con varias piezas, paso 1: el modelo las separa (nombre aproximado y recuadro de cada una)
async function crearDeteccion(req) {
  exigirIA();
  const id = await nuevaTareaFoto('detectar', await leerJson(req, MAX_FOTO * 1.4));
  encolarIA(id);
  return tarea(id);
}
// paso 2: el usuario ha elegido las piezas; llega el recorte de cada una (lo hace la web) y cada recorte se identifica
// por el camino de siempre, todas con el mismo «lote». b: {piezas: [{nombre, descripcion, cantidad, foto (base64)}]}
async function crearPiezasDetectadas(id, req) {
  const t = tarea(id);
  if (t.clase !== 'detectar') throw new HttpError(400, 'Esta tarea no es una foto con varias piezas');
  if (t.estado !== 'propuesta') throw new HttpError(409, `Esta foto ya está ${ESTADO[t.estado] || t.estado}`);
  const b = await leerJson(req, 60e6);
  const piezas = (Array.isArray(b.piezas) ? b.piezas : []).slice(0, MAX_DETECTADAS).filter((p) => p && p.foto);
  if (!piezas.length) throw new HttpError(400, 'Elige alguna pieza');
  const lote = randomBytes(6).toString('hex'), ids = [];
  for (const p of piezas) {
    const cant = Math.round(Number(p.cantidad));
    const pista = [`Esta pieza sale de una foto con varias. Allí se vio como «${texto(p.nombre, 200) || 'pieza sin identificar'}»`,
      texto(p.descripcion, 300) ? ` (${texto(p.descripcion, 300)})` : '', '.', cant >= 1 ? ` Unidades que se veían: ${cant}.` : '',
      t.texto ? ` Lo que dije de la foto entera: ${t.texto}` : ''].join('');
    ids.push(await nuevaTareaFoto('alta', {texto: pista, foto: p.foto, modelo: t.modelo_pedido || undefined, lote}));
  }
  db.prepare("UPDATE ia_tareas SET estado = 'aplicada', propuesta = json_set(propuesta, '$.lote', ?) WHERE id = ?").run(lote, t.id);
  await borrarFoto(t.foto); // la foto grande ya no hace falta: cada pieza lleva su recorte
  apuntar({quien: 'ia', accion: 'ia.detectar', objeto: 'ia', id: t.id, modelo: t.modelo, nombre: 'Foto con varias piezas',
    resumen: `${ids.length} pieza${ids.length === 1 ? '' : 's'} de una foto, a identificar`, detalle: {tarea: t.id, lote}});
  ids.forEach(encolarIA);
  return {lote, tareas: ids};
}
// guarda de una vez las propuestas marcadas de un lote de piezas nuevas, tal como las propuso el modelo (las que el
// usuario quiera corregir las abre una a una). Si dos piezas proponen el mismo tipo nuevo, se crea una sola ficha.
async function guardarLoteAltas(lote, b) {
  const ids = new Set((Array.isArray(b.ids) ? b.ids : []).map(Number));
  const ts = tareasLote(lote).filter((t) => t.clase === 'alta' && t.estado === 'propuesta' && ids.has(t.id));
  if (!ts.length) throw new HttpError(400, 'Marca alguna pieza');
  const guardadas = [], fallos = [];
  for (const t of ts) {
    const p = t.propuesta;
    const cuerpo = {nombre: p.nombre, tipo: p.tipo_existente || (p.tipo_nuevo ? '__nuevo' : null), tipo_nuevo: p.tipo_nuevo,
      datos_pieza: p.datos_pieza, cantidad: p.cantidad ?? 1, varios: false};
    if (cuerpo.tipo === '__nuevo') { // ¿ya hay un tipo con ese nombre (de antes o de otra pieza de este lote)?
      const ya = db.prepare('SELECT id FROM tipos WHERE lower(nombre) = lower(?) AND archivado = 0').get(p.tipo_nuevo.nombre);
      if (ya) { cuerpo.tipo = ya.id; cuerpo.tipo_nuevo = null; }
    }
    try { guardadas.push((await aplicarAlta(t.id, cuerpo)).componente.id); }
    catch (e) { fallos.push({id: t.id, nombre: p.nombre, error: e.message}); }
  }
  return {guardadas, fallos};
}

// el usuario confirma la propuesta (quizá corregida): ficha nueva si hace falta, pieza, sus datos y la foto
async function aplicarAlta(id, b) {
  const t = tarea(id);
  if (t.clase !== 'alta') throw new HttpError(400, 'Esta tarea no es un alta');
  if (t.estado !== 'propuesta') throw new HttpError(409, `Esta propuesta ya está ${ESTADO[t.estado] || t.estado}: no se puede guardar`);
  const p = normalizar(db, {...b, tipo_existente: b.tipo === '__nuevo' ? null : b.tipo || null, tipo_nuevo: b.tipo === '__nuevo' ? b.tipo_nuevo : null});
  if (b.tipo && b.tipo !== '__nuevo' && !p.tipo_existente) throw new HttpError(400, 'Ese tipo no existe');
  if (b.tipo === '__nuevo' && !p.tipo_nuevo) throw new HttpError(400, 'Falta el nombre del tipo nuevo');
  const campos = Object.fromEntries(['nombre', 'varios', 'cantidad', 'ubicacion', 'notas', 'revisar']
    .filter((k) => b[k] !== undefined).map((k) => [k, b[k]])); // solo los que llegan (como en el alta normal)
  const pieza = limpiar(campos, false);

  // la foto se mueve ANTES de abrir la transacción (no puede haber un await dentro: la conexión es compartida)
  const foto = t.foto ? `c-ia${t.id}-${Date.now()}.jpg` : null;
  if (foto) await rename(join(FOTOS, t.foto), join(FOTOS, foto));
  const sobran = t.fotos.filter((f) => f !== t.foto); // las otras caras y las de las respuestas: solo eran para el modelo
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
  for (const f of sobran) await borrarFoto(f);
  const nueva = comp(compId), comunIA = {quien: 'ia', modelo: t.modelo, detalle: {tarea: t.id}};
  if (b.tipo === '__nuevo')
    apuntar({...comunIA, accion: 'tipo.alta', objeto: 'tipo', id: tipoId, nombre: nombresTipo()[tipoId], resumen: 'Ficha nueva creada por la IA (sin comprobar)'});
  apuntar({...comunIA, accion: 'ia.alta', objeto: 'pieza', id: compId, nombre: nueva.nombre, resumen: `Pieza añadida con IA (${cantidadDe(nueva)})`});
  return {componente: nueva, tipo: tipoId};
}

// ---------- rutas de la API ----------
async function api(req, res, path) {
  const m = req.method;
  let r;
  if (m === 'GET' && path === '/api/datos') return send(res, 200, todo());
  if (m === 'GET' && path === '/api/exportar')
    return send(res, 200, JSON.stringify({exportado: new Date().toISOString(), ...todo()}, null, 2), 'application/json; charset=utf-8',
      {'content-disposition': `attachment; filename="circuitbin-${new Date().toISOString().slice(0, 10)}.json"`});

  if (m === 'POST' && path === '/api/componentes') {
    const b = await leerJson(req), c = limpiar(b, false);
    const cols = Object.keys(c);
    let id;
    db.exec('BEGIN');
    try {
      id = db.prepare(`INSERT INTO componentes (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(c)).lastInsertRowid;
      guardarDatosPieza(id, b.datos);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const nueva = comp(id);
    apuntar({accion: 'pieza.alta', objeto: 'pieza', id: nueva.id, nombre: nueva.nombre, resumen: `Pieza añadida (${cantidadDe(nueva)})`});
    return send(res, 201, nueva);
  }
  if (m === 'POST' && path === '/api/tipos') {
    const b = await leerJson(req);
    const nombre = texto(b.nombre, 120);
    if (!nombre) throw new HttpError(400, 'Falta el nombre del tipo');
    if (!db.prepare('SELECT 1 FROM categorias WHERE id = ?').get(b.categoria)) throw new HttpError(400, 'Esa categoría no existe');
    const id = slug(nombre);
    db.prepare("INSERT INTO tipos (id, nombre, categoria_id, origen) VALUES (?, ?, ?, 'usuario')").run(id, nombre, b.categoria);
    apuntar({accion: 'tipo.alta', objeto: 'tipo', id, nombre, resumen: `Tipo creado (${nombresCategoria()[b.categoria] || b.categoria})`});
    return send(res, 201, {id, nombre, categoria: b.categoria});
  }

  // ---- Proyectos (v8): la receta, el estado y lo que el usuario apunta (bitácora, tablero, archivos) ----
  const apuntarPro = (p, accion, resumen, extra = {}) => apuntar({accion, objeto: 'proyecto', id: p.id, nombre: p.nombre, resumen, ...extra});
  if (m === 'POST' && path === '/api/proyectos') {
    const p = pro.crear(db, await leerJson(req));
    apuntarPro(p, 'proyecto.alta', 'Proyecto creado');
    return send(res, 201, p);
  }
  if ((r = path.match(/^\/api\/proyectos\/([a-z0-9-]+)$/))) {
    if (m === 'GET') return send(res, 200, pro.detalle(db, r[1]));
    if (m === 'PUT') {
      const {antes, despues} = pro.editar(db, r[1], await leerJson(req));
      const cambios = pro.cambios(antes, despues, nombresTipo(), Object.fromEntries(db.prepare('SELECT nivel, nombre FROM dificultades').all().map((d) => [d.nivel, d.nombre])));
      if (cambios.length) apuntarPro(despues, 'proyecto.editar', aud.resumenCambios('Proyecto editado', cambios), {cambios});
      return send(res, 200, despues);
    }
    if (m === 'PATCH') {
      const x = pro.cambiarEstado(db, r[1], (await leerJson(req)).estado);
      if (x.antes !== x.despues) apuntarPro({id: r[1], nombre: x.nombre}, 'proyecto.estado', `Estado: ${pro.NOMBRE_ESTADO[x.antes]} → ${pro.NOMBRE_ESTADO[x.despues]}`);
      return send(res, 200, pro.uno(db, r[1]));
    }
    if (m === 'DELETE') {
      const x = await pro.borrar(db, FOTOS, r[1]);
      apuntarPro({id: r[1], nombre: x.nombre}, 'proyecto.borrar', 'Proyecto borrado (con su bitácora, su tablero y sus archivos)');
      return send(res, 200, x);
    }
  }
  if ((r = path.match(/^\/api\/proyectos\/([a-z0-9-]+)\/notas$/)) && m === 'POST') {
    const x = await pro.anadirNota(db, FOTOS, r[1], await leerJson(req, MAX_FOTO * 1.4));
    apuntarPro(x.proyecto, 'proyecto.nota', `Nota en la bitácora${x.nota.foto ? ' (con foto)' : ''}`, {detalle: {texto: x.nota.texto.slice(0, 200)}});
    return send(res, 201, pro.detalle(db, r[1]));
  }
  if ((r = path.match(/^\/api\/proyectos\/([a-z0-9-]+)\/notas\/(\d+)$/)) && m === 'DELETE') {
    const x = await pro.borrarNota(db, FOTOS, r[1], r[2]);
    apuntarPro(x.proyecto, 'proyecto.nota', 'Nota de la bitácora borrada', {detalle: {texto: x.nota.texto.slice(0, 200)}});
    return send(res, 200, pro.detalle(db, r[1]));
  }
  if ((r = path.match(/^\/api\/proyectos\/([a-z0-9-]+)\/tareas$/)) && m === 'POST') {
    const x = pro.anadirTareas(db, r[1], await leerJson(req));
    apuntarPro(x.proyecto, 'proyecto.tarea', x.textos.length === 1 ? `Tarea añadida: ${x.textos[0]}` : `${x.textos.length} tareas añadidas al tablero (los pasos)`);
    return send(res, 201, pro.detalle(db, r[1]));
  }
  if ((r = path.match(/^\/api\/proyectos\/([a-z0-9-]+)\/tareas\/(\d+)$/))) {
    if (m === 'PATCH') {
      const x = pro.cambiarTarea(db, r[1], r[2], await leerJson(req));
      const cambios = [x.antes.texto !== x.despues.texto ? {campo: 'Tarea', antes: x.antes.texto, despues: x.despues.texto} : null,
        x.antes.columna !== x.despues.columna ? {campo: x.despues.texto, antes: pro.NOMBRE_COLUMNA[x.antes.columna], despues: pro.NOMBRE_COLUMNA[x.despues.columna]} : null].filter(Boolean);
      if (cambios.length) apuntarPro(x.proyecto, 'proyecto.tarea', aud.resumenCambios('Tarea cambiada', cambios), {cambios});
      return send(res, 200, pro.detalle(db, r[1]));
    }
    if (m === 'DELETE') {
      const x = pro.borrarTarea(db, r[1], r[2]);
      apuntarPro(x.proyecto, 'proyecto.tarea', `Tarea borrada: ${x.tarea.texto}`);
      return send(res, 200, pro.detalle(db, r[1]));
    }
  }
  // el archivo llega tal cual en el cuerpo (imagen o PDF); su nombre, en ?nombre=
  if ((r = path.match(/^\/api\/proyectos\/([a-z0-9-]+)\/archivos$/)) && m === 'POST') {
    const tipo = (req.headers['content-type'] || '').split(';')[0];
    if (!pro.ARCHIVO_EXT[tipo]) throw new HttpError(415, 'El archivo tiene que ser una imagen (JPG, PNG o WebP) o un PDF');
    const x = await pro.anadirArchivo(db, FOTOS, r[1], {tipo, nombre: new URL(req.url, 'http://x').searchParams.get('nombre'), datos: await leerCuerpo(req, pro.MAX_ARCHIVO)});
    apuntarPro(x.proyecto, 'proyecto.archivo', `Archivo añadido: ${x.archivo.nombre}`);
    return send(res, 201, pro.detalle(db, r[1]));
  }
  if ((r = path.match(/^\/api\/proyectos\/([a-z0-9-]+)\/archivos\/(\d+)$/)) && m === 'DELETE') {
    const x = await pro.borrarArchivo(db, FOTOS, r[1], r[2]);
    apuntarPro(x.proyecto, 'proyecto.archivo', `Archivo borrado: ${x.archivo.nombre}`);
    return send(res, 200, pro.detalle(db, r[1]));
  }

  // ---- IA ----
  // configuración desde la web: se ve el estado (la clave solo por sus 4 últimos caracteres), se cambia con PUT
  if (m === 'GET' && path === '/api/ia/config') return send(res, 200, estado(db));
  if (m === 'PUT' && path === '/api/ia/config') {
    const b = await leerJson(req);
    const antes = estado(db);
    let e2;
    try { e2 = await guardarConfig(db, {clave: b.clave, modelo: b.modelo, quitarClave: b.quitarClave === true}); }
    catch (e) { throw new HttpError(400, e.message); }
    if (b.quitarClave === true) apuntar({accion: 'ia.config', objeto: 'ia', resumen: 'Clave de la IA quitada'});
    else if (b.clave) apuntar({accion: 'ia.config', objeto: 'ia', resumen: 'Clave de la IA cambiada'});
    if (e2.modelo !== antes.modelo) apuntar({accion: 'ia.config', objeto: 'ia', resumen: `Modelo de siempre: ${antes.modelo || '—'} → ${e2.modelo || '—'}`});
    return send(res, 200, e2);
  }
  // modelos de chat de OpenCode Go (del catálogo público de Go), cada uno con lo que sabe hacer: «vision» y «estructurada»
  if (m === 'GET' && path === '/api/ia/modelos') {
    let lista;
    try { lista = await modelos(); } catch (e) { throw new HttpError(502, e.message); }
    // coste real medio por pieza con cada modelo (de tus consultas anteriores), para elegir con datos y no a ojo
    const medias = Object.fromEntries(db.prepare(`SELECT modelo, COUNT(*) AS n, AVG(json_extract(propuesta, '$.coste.dolares')) AS media
      FROM ia_tareas WHERE propuesta IS NOT NULL AND json_extract(propuesta, '$.coste.dolares') IS NOT NULL GROUP BY modelo`).all()
      .map((r) => [r.modelo, {consultas: r.n, dolares: r.media}]));
    return send(res, 200, lista.map((x) => ({...x, recomendado: x.id === MODELO_RECOMENDADO, coste_medio: medias[x.id] || null})));
  }
  if (m === 'POST' && path === '/api/ia/alta') return send(res, 202, await crearAlta(req));
  if (m === 'POST' && path === '/api/ia/detectar') return send(res, 202, await crearDeteccion(req));
  if ((r = path.match(/^\/api\/ia\/tareas\/(\d+)\/crear-piezas$/)) && m === 'POST') return send(res, 202, await crearPiezasDetectadas(r[1], req));
  if ((r = path.match(/^\/api\/ia\/lotes\/([a-f0-9]{12})\/guardar$/)) && m === 'POST') return send(res, 200, await guardarLoteAltas(r[1], await leerJson(req)));
  if (m === 'POST' && path === '/api/ia/revisar') return send(res, 202, await crearRevision(req));
  if (m === 'POST' && path === '/api/ia/revisar-lote') return send(res, 202, await corregirLote(await leerJson(req)));
  if ((r = path.match(/^\/api\/ia\/lotes\/([a-f0-9]{12})$/)) && m === 'GET') return send(res, 200, tareasLote(r[1]));
  if ((r = path.match(/^\/api\/ia\/tareas\/(\d+)\/aplicar-cambios$/)) && m === 'POST') return send(res, 200, await aplicarRevision(r[1], await leerJson(req)));
  if ((r = path.match(/^\/api\/ia\/tareas\/(\d+)$/)) && m === 'GET') return send(res, 200, tarea(r[1]));
  if (m === 'GET' && path === '/api/ia/pendientes') return send(res, 200, pendientesIA());
  if (m === 'GET' && path === '/api/ia/pendientes/cuenta') return send(res, 200, cuentaPendientes());
  if (m === 'GET' && path === '/api/auditoria') return send(res, 200, aud.listar(db, Object.fromEntries(new URL(req.url, 'http://x').searchParams)));
  if (m === 'GET' && path === '/api/registro') return send(res, 200, registro.leer(Object.fromEntries(new URL(req.url, 'http://x').searchParams)));
  if ((r = path.match(/^\/api\/ia\/tareas\/(\d+)\/aplicar$/)) && m === 'POST') return send(res, 200, await aplicarAlta(r[1], await leerJson(req)));
  if ((r = path.match(/^\/api\/ia\/tareas\/(\d+)\/responder$/)) && m === 'POST') return send(res, 202, await responderAlta(r[1], await leerJsonFotos(req)));
  if ((r = path.match(/^\/api\/ia\/tareas\/(\d+)\/descartar$/)) && m === 'POST') {
    const t = tarea(r[1]);
    if (t.estado === 'aplicada') throw new HttpError(409, 'Eso ya se guardó: no se puede descartar');
    db.prepare("UPDATE ia_tareas SET estado = 'descartada' WHERE id = ?").run(t.id);
    for (const f of t.fotos) await borrarFoto(f);
    if (t.estado !== 'descartada') {
      const o = t.objetivo || {};
      apuntar({accion: 'ia.descartar', modelo: t.modelo, detalle: {tarea: t.id},
        ...(t.clase === 'revisar' ? {objeto: o.componente_id ? 'pieza' : 'tipo', id: o.componente_id ?? o.tipo_id, nombre: t.objetivo_nombre, resumen: 'Correcciones de la IA descartadas'}
          : t.clase === 'detectar' ? {objeto: 'ia', id: t.id, nombre: 'Foto con varias piezas', resumen: 'Foto con varias piezas descartada'}
          : {objeto: 'ia', id: t.id, nombre: t.propuesta?.nombre || t.texto || null, resumen: 'Propuesta de pieza de la IA descartada'})});
    }
    return send(res, 200, {ok: true});
  }
  // marcar como revisada una ficha escrita por la IA (sigue siendo de origen 'ia': seed no la pisa)
  if ((r = path.match(/^\/api\/tipos\/([a-z0-9-]+)$/)) && m === 'PATCH') {
    const antes = db.prepare('SELECT nombre, revisado, archivado FROM tipos WHERE id = ?').get(r[1]);
    const x = cat.cambiarTipo(db, r[1], await leerJson(req));
    if (x.revisado !== antes.revisado) apuntar({accion: 'tipo.comprobar', objeto: 'tipo', id: r[1], nombre: antes.nombre, resumen: x.revisado ? 'Ficha marcada como comprobada' : 'Ficha marcada como sin comprobar'});
    if (x.archivado !== antes.archivado) apuntar({accion: 'tipo.archivar', objeto: 'tipo', id: r[1], nombre: antes.nombre, resumen: x.archivado ? 'Tipo archivado' : 'Tipo sacado del archivo'});
    return send(res, 200, x);
  }

  // ---- Ajustes: catálogo, sitios y datos (fase B) ----
  if (m === 'GET' && path === '/api/ajustes/resumen') return send(res, 200, resumen());
  // el editor de pines manda sus filas cuando alguien escribe varios pines en una («GPIO 16 · 17»): vuelven una por pin
  if (m === 'POST' && path === '/api/pines/separar') {
    const filas = ((await leerJson(req)).pines || []).filter(Array.isArray).slice(0, 200).map((p) => p.slice(0, 4).map((x) => texto(x, 200)));
    return send(res, 200, {pines: separarPines(filas).slice(0, 200)});
  }
  // Ajustes → Uniformar formato: lo que cambiaría (sin llamar al modelo) y aplicar lo que el usuario marque
  if (m === 'GET' && path === '/api/ajustes/formato') return send(res, 200, uniformar.pendientes(db));
  if (m === 'POST' && path === '/api/ajustes/formato') {
    let hechos;
    try { hechos = uniformar.aplicar(db, (await leerJson(req)).ids); } catch (e) { if (e.code === 400) throw new HttpError(400, e.message); throw e; }
    for (const o of hechos) {
      const cambios = o.cambios.map((c) => ({campo: c.etiqueta, antes: c.antes, despues: c.despues}));
      apuntar({accion: `${o.objeto}.formato`, objeto: o.objeto, id: o.id, nombre: o.nombre, resumen: aud.resumenCambios('Formato uniformado', cambios), cambios});
    }
    return send(res, 200, {ok: true, aplicados: hechos.reduce((n, o) => n + o.cambios.length, 0), ...uniformar.pendientes(db)});
  }
  if (m === 'POST' && path === '/api/copias') {
    const op = opcionesCopias(DATA);
    const ruta = copiar(db, DATA, {...op, max: op.max || 14}, true);
    apuntar({accion: 'copia.hacer', objeto: 'copia', nombre: String(ruta).split(/[\\/]/).pop(), resumen: 'Copia de seguridad hecha en el servidor'});
    return send(res, 200, {ok: true, nombre: String(ruta).split(/[\\/]/).pop(), resumen: resumen()});
  }
  // copias completas: exportar (.tar.gz), preparar una restauración (subida o copia del servidor) y confirmarla
  if (m === 'GET' && path === '/api/copia/exportar') {
    apuntar({accion: 'copia.exportar', objeto: 'copia', resumen: 'Copia completa descargada (base de datos y fotos)'});
    return respaldo.exportar(db, DATA, res);
  }
  if (m === 'POST' && path === '/api/copia/preparar') {
    if (Number(req.headers['content-length']) > 2 * 1024 ** 3) throw new HttpError(413, 'El archivo es demasiado grande (máx. 2 GB)');
    return send(res, 200, {...(await respaldo.prepararSubida(req, DATA)), actual: resumen()});
  }
  if (m === 'POST' && path === '/api/copia/restaurar') return send(res, 200, restaurar((await leerJson(req)).token));
  if (m === 'DELETE' && path === '/api/copia/preparada') { respaldo.limpiarEtapas(DATA); return send(res, 200, {ok: true}); }
  if ((r = path.match(/^\/api\/copias\/(lab-[\w.-]+\.db)(\/preparar)?$/))) {
    const copia = listaCopias().find((x) => x.nombre === r[1]);
    if (!copia) throw new HttpError(404, 'No existe esa copia');
    if (m === 'POST' && r[2]) return send(res, 200, {...respaldo.prepararCopia(DATA, opcionesCopias(DATA).dir, copia.nombre), actual: resumen()});
    if (m === 'GET' && !r[2]) {
      res.writeHead(200, {'content-type': 'application/vnd.sqlite3', 'content-length': copia.bytes, 'cache-control': 'no-store',
        'content-disposition': `attachment; filename="ams-${copia.nombre}"`});
      return createReadStream(join(opcionesCopias(DATA).dir, copia.nombre)).pipe(res);
    }
  }
  // editor de fichas (fase D)
  if ((r = path.match(/^\/api\/tipos\/([a-z0-9-]+)\/ficha$/))) {
    if (m === 'GET') return send(res, 200, cat.fichaEditable(db, r[1]));
    if (m === 'PUT') {
      const antes = leerFicha(db, r[1]);
      const x = cat.guardarFicha(db, r[1], await leerJson(req));
      const cambios = aud.cambiosFicha(antes, x, nombresCategoria());
      if (cambios.length) apuntar({accion: 'tipo.editar', objeto: 'tipo', id: r[1], nombre: x.nombre, resumen: aud.resumenCambios('Ficha editada', cambios), cambios});
      return send(res, 200, x);
    }
  }
  if (m === 'GET' && path === '/api/categorias') return send(res, 200, cat.listarCategorias(db));
  if (m === 'POST' && path === '/api/categorias') {
    const x = cat.crearCategoria(db, await leerJson(req));
    apuntar({accion: 'categoria.alta', objeto: 'categoria', id: x.id, nombre: x.nombre, resumen: 'Categoría creada'});
    return send(res, 201, x);
  }
  if (m === 'PUT' && path === '/api/categorias/orden') {
    const x = cat.ordenarCategorias(db, (await leerJson(req)).ids);
    apuntar({accion: 'categoria.ordenar', objeto: 'categoria', resumen: 'Categorías reordenadas', detalle: {orden: x.map((c) => c.nombre)}});
    return send(res, 200, x);
  }
  if ((r = path.match(/^\/api\/categorias\/([a-z0-9-]+)$/))) {
    const antes = nombresCategoria();
    if (m === 'PATCH') {
      const x = cat.renombrarCategoria(db, r[1], await leerJson(req));
      if (x.nombre !== antes[r[1]]) apuntar({accion: 'categoria.renombrar', objeto: 'categoria', id: r[1], nombre: x.nombre, resumen: `Renombrada: ${antes[r[1]]} → ${x.nombre}`});
      return send(res, 200, x);
    }
    if (m === 'DELETE') {
      const destino = new URL(req.url, 'http://x').searchParams.get('destino');
      const x = cat.borrarCategoria(db, r[1], destino);
      apuntar({accion: 'categoria.borrar', objeto: 'categoria', id: r[1], nombre: antes[r[1]],
        resumen: `Categoría borrada${x.movidos ? ` (${x.movidos} tipo${x.movidos === 1 ? '' : 's'} pasan a «${antes[destino] || destino}»)` : ''}`});
      return send(res, 200, x);
    }
  }
  if (m === 'GET' && path === '/api/tipos') return send(res, 200, cat.listarTipos(db));
  if ((r = path.match(/^\/api\/tipos\/([a-z0-9-]+)\/fusionar$/)) && m === 'POST') {
    const antes = nombresTipo();
    const x = cat.fusionarTipo(db, r[1], (await leerJson(req)).destino);
    const piezas = `${x.piezas} pieza${x.piezas === 1 ? '' : 's'}`;
    apuntar({accion: 'tipo.fusionar', objeto: 'tipo', id: r[1], nombre: antes[r[1]], resumen: `Fusionado con «${antes[x.queda]}» (${piezas} pasan a él)`, detalle: {queda: x.queda}});
    apuntar({accion: 'tipo.fusionar', objeto: 'tipo', id: x.queda, nombre: antes[x.queda], resumen: `Recibe a «${antes[r[1]]}» (${piezas})`, detalle: {quitado: r[1]}});
    return send(res, 200, x);
  }
  if ((r = path.match(/^\/api\/tipos\/([a-z0-9-]+)$/)) && m === 'DELETE') {
    const nombre = nombresTipo()[r[1]];
    const x = cat.borrarTipo(db, r[1]);
    apuntar({accion: 'tipo.borrar', objeto: 'tipo', id: r[1], nombre, resumen: 'Tipo borrado'});
    return send(res, 200, x);
  }
  if (m === 'GET' && path === '/api/ubicaciones') return send(res, 200, cat.listarSitios(db));
  if ((r = path.match(/^\/api\/ubicaciones\/(\d+)$/))) {
    const antes = db.prepare('SELECT nombre FROM ubicaciones WHERE id = ?').get(Number(r[1]))?.nombre;
    if (m === 'PATCH') {
      const x = cat.renombrarSitio(db, r[1], await leerJson(req));
      if (x.fusionado) apuntar({accion: 'sitio.juntar', objeto: 'sitio', id: x.id, nombre: x.nombre, resumen: `«${antes}» juntado con «${x.nombre}» (${x.piezas} pieza${x.piezas === 1 ? '' : 's'})`});
      else if (x.nombre !== antes) apuntar({accion: 'sitio.renombrar', objeto: 'sitio', id: x.id, nombre: x.nombre, resumen: `Renombrado: ${antes} → ${x.nombre}`});
      return send(res, 200, x);
    }
    if (m === 'DELETE') {
      const x = cat.borrarSitio(db, r[1]);
      apuntar({accion: 'sitio.borrar', objeto: 'sitio', id: r[1], nombre: antes, resumen: `Sitio borrado${x.piezas ? ` (${x.piezas} pieza${x.piezas === 1 ? '' : 's'} se quedan sin sitio)` : ''}`});
      return send(res, 200, x);
    }
  }
  if (m === 'POST' && path === '/api/componentes/restaurar') {
    const b = await leerJson(req);
    const deshecha = (id) => { const c = comp(id); apuntar({accion: 'pieza.restaurar', objeto: 'pieza', id, nombre: c.nombre, resumen: 'Borrado deshecho'}); };
    if (!Array.isArray(b.tokens)) {
      const x = await cat.restaurarPieza(db, FOTOS, b.token);
      deshecha(x.id);
      return send(res, 200, x);
    }
    const ids = []; // deshacer el borrado de varias: las que aún se puedan
    for (const t of b.tokens.slice(0, MAX_PIEZAS_LOTE)) { try { ids.push((await cat.restaurarPieza(db, FOTOS, t)).id); } catch {} }
    if (!ids.length) throw new HttpError(410, 'Ya no se puede deshacer');
    ids.forEach(deshecha);
    return send(res, 200, {ok: true, ids});
  }
  if (m === 'POST' && path === '/api/componentes/lote') return send(res, 200, editarLote(await leerJson(req)));
  if (m === 'POST' && path === '/api/componentes/lote/borrar') {
    const ids = [...new Set(((await leerJson(req)).ids || []).map(Number).filter(Number.isInteger))].slice(0, MAX_PIEZAS_LOTE);
    if (!ids.length) throw new HttpError(400, 'Elige alguna pieza');
    const deshacer = [];
    for (const id of ids) { // se puede deshacer 2 minutos
      const c = comp(id);
      deshacer.push((await cat.borrarPieza(db, FOTOS, id)).deshacer);
      apuntarBorrado(c, {varias: true});
    }
    return send(res, 200, {ok: true, borradas: ids.length, deshacer});
  }

  if ((r = path.match(/^\/api\/ajustes\/([a-z_]+)$/)) && m === 'PUT') {
    const valor = texto((await leerJson(req)).valor, 200);
    if (!AJUSTES[r[1]] || !db.prepare('SELECT 1 FROM ajustes WHERE clave = ?').get(r[1])) throw new HttpError(404, 'Ese ajuste no existe');
    if (!AJUSTES[r[1]].includes(valor)) throw new HttpError(400, `Valor no válido para «${r[1]}»`);
    const antes = db.prepare('SELECT valor FROM ajustes WHERE clave = ?').get(r[1]).valor;
    db.prepare('UPDATE ajustes SET valor = ? WHERE clave = ?').run(valor, r[1]);
    if (antes !== valor) apuntar({accion: 'ajustes.cambiar', objeto: 'ajustes', id: r[1], nombre: NOMBRE_AJUSTE[r[1]] || r[1], resumen: `${NOMBRE_AJUSTE[r[1]] || r[1]}: ${antes} → ${valor}`});
    return send(res, 200, {clave: r[1], valor});
  }
  if ((r = path.match(/^\/api\/componentes\/(\d+)$/))) {
    const c = comp(r[1]);
    if (m === 'PATCH') {
      const b = await leerJson(req), cambios = limpiar(b, true);
      db.exec('BEGIN');
      try {
        if (Object.keys(cambios).length)
          db.prepare(`UPDATE componentes SET ${Object.keys(cambios).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(cambios), c.id);
        guardarDatosPieza(c.id, b.datos);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      const despues = comp(c.id);
      apuntarPieza(c, despues);
      return send(res, 200, despues);
    }
    if (m === 'DELETE') { // se puede deshacer durante 2 minutos
      const x = await cat.borrarPieza(db, FOTOS, c.id);
      apuntarBorrado(c);
      return send(res, 200, x);
    }
  }
  if ((r = path.match(/^\/api\/componentes\/(\d+)\/ajuste$/)) && m === 'POST') {
    const c = comp(r[1]);
    const delta = Math.round(Number((await leerJson(req)).delta) || 0);
    db.prepare('UPDATE componentes SET cantidad = MAX(0, COALESCE(cantidad, 0) + ?), varios = 0 WHERE id = ?').run(delta, c.id);
    const despues = comp(c.id);
    apuntarPieza(c, despues, {accion: 'pieza.stock'});
    return send(res, 200, despues);
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
      apuntar({accion: 'pieza.foto', objeto: 'pieza', id: c.id, nombre: c.nombre, resumen: c.foto ? 'Foto cambiada' : 'Foto puesta'});
      return send(res, 200, comp(c.id));
    }
    if (m === 'DELETE') {
      db.prepare('UPDATE componentes SET foto = NULL WHERE id = ?').run(c.id);
      await borrarFoto(c.foto);
      if (c.foto) apuntar({accion: 'pieza.foto', objeto: 'pieza', id: c.id, nombre: c.nombre, resumen: 'Foto quitada'});
      return send(res, 200, comp(c.id));
    }
  }
  throw new HttpError(404, 'Ruta no encontrada');
}

// ---------- ficheros ----------
// huella de la web: cambia cuando cambian app.js, style.css o sw.js. index.html los pide con «?v=<huella>», así que un
// proxy que guarde los .js y .css (Nginx Proxy Manager con «Cache Assets») o el navegador nunca sirven una versión vieja.
const WEB_HUELLA = ['i18n.js', 'app.js', 'style.css', 'sw.js', 'icon.svg', 'amstech-ui/fuentes.css', 'amstech-ui/tokens.css', 'amstech-ui/componentes.css'];
let huellaWeb = {clave: '', valor: ''};
function huella() {
  const rutas = WEB_HUELLA.map((f) => join(PUB, f));
  const clave = rutas.map((f) => statSync(f).mtimeMs).join(); // se recalcula solo si alguno cambió (npm run dev)
  if (clave !== huellaWeb.clave) {
    const h = createHash('sha1');
    for (const f of rutas) h.update(readFileSync(f));
    huellaWeb = {clave, valor: h.digest('hex').slice(0, 10)};
  }
  return huellaWeb.valor;
}
async function paginaPrincipal(res) {
  const v = huella();
  const html = (await readFile(join(PUB, 'index.html'), 'utf8'))
    .replace(/href="((?:amstech-ui\/)?[\w-]+\.css)"/g, `href="$1?v=${v}"`).replace(/src="(i18n|app)\.js"/g, `src="$1.js?v=${v}"`)
    .replace(/href="icon\.svg"/g, `href="icon.svg?v=${v}"`)
    .replace('</head>', `  <meta name="version-web" content="${v}">\n</head>`);
  send(res, 200, html, TYPES['.html'], {'cache-control': 'no-cache'});
}

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
  const t0 = Date.now();
  res.on('finish', () => {
    const ruta = String(req.url || '').split('?')[0];
    if (!ruta.startsWith('/api/') || (req.method === 'GET' && res.statusCode < 400)) return; // las consultas normales no (la web pregunta mucho)
    const nivel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'log';
    console[nivel](`[http] ${req.method} ${ruta} → ${res.statusCode} · ${Date.now() - t0} ms${res.motivo ? ` · ${res.motivo}` : ''}`);
  });
  try {
    if (req.url === '/salud') return send(res, 200, 'ok', 'text/plain'); // para el HEALTHCHECK de Docker (no da datos)
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { throw new HttpError(400, 'Dirección no válida'); }
    if (path.startsWith('/api/')) return await api(req, res, path);
    if (path.startsWith('/fotos/')) return await estatico(res, FOTOS, path.slice(7), 'public, max-age=31536000, immutable');
    if (path === '/' || path === '/index.html') return await paginaPrincipal(res);
    return await estatico(res, PUB, path, 'no-cache');
  } catch (e) {
    let code = e instanceof HttpError || e instanceof cat.ErrorCatalogo || e instanceof respaldo.ErrorRespaldo || e instanceof pro.ErrorProyecto ? e.code : 500;
    if (/constraint failed/i.test(e.message)) code = 400; // reglas de la base de datos (CHECK, FOREIGN KEY, UNIQUE)
    if (code === 500) console.error(e);
    res.motivo = String(e.message || '').slice(0, 200);
    if (!res.headersSent) send(res, code, {error: e.message || 'Error', ...(e instanceof cat.ErrorCatalogo ? {tipos: e.tipos, piezas: e.piezas, proyectos: e.proyectos} : {})});
  }
}).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`CircuitBin → http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`         móvil → http://${ip}:${PORT}`));
});

// cierre limpio (docker stop, Ctrl+C): deja de aceptar peticiones y cierra la base de datos (vuelca el WAL)
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  console.log(`CircuitBin: cerrando (${sig})`);
  server.close();
  server.closeAllConnections();
  try { db.close(); } catch {}
  process.exit(0);
});
