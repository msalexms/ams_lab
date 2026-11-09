// Base de datos SQLite (node:sqlite, sin dependencias). Fichero: data/lab.db · modelo: docs/modelo-datos.md
//
// Dos clases de datos:
//   · REFERENCIA y CATÁLOGO (categorías, funciones de pin y sus colores, dificultades, tipos, pines, proyectos).
//     La base de datos es la fuente de verdad. seed/*.json crea lo que falta y actualiza solo lo que sigue siendo
//     «de seed» (origen = 'seed'): nunca pisa una categoría o un tipo creados o cambiados por la IA o por el usuario.
//   · INVENTARIO del usuario (componentes, ubicaciones, historial, datos de cada pieza): solo los cambia la aplicación.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {opcionesCopias} from './copias.mjs';

export const VERSION = 6;
export const ORIGENES = ['seed', 'ia', 'usuario'];
const ORIGEN = `TEXT NOT NULL DEFAULT 'seed' CHECK (origen IN ('seed', 'ia', 'usuario'))`;
const HEX = (col) => `CHECK (${col} GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]')`;
const AJUSTES = `
  CREATE TABLE ajustes (                    -- preferencias de la aplicación (no del navegador)
    clave  TEXT PRIMARY KEY,
    valor  TEXT NOT NULL,
    CHECK (clave <> 'tema' OR valor IN ('auto', 'claro', 'noche'))
  );`;

const ESQUEMA = `
  CREATE TABLE categorias (
    id      TEXT PRIMARY KEY,
    nombre  TEXT NOT NULL UNIQUE,
    orden   INTEGER NOT NULL,
    origen  ${ORIGEN}           -- quién manda en la fila: seed/ solo actualiza las que siguen siendo 'seed'
  );
  CREATE TABLE funciones_pin (
    id      TEXT PRIMARY KEY,
    nombre  TEXT NOT NULL UNIQUE,
    color_claro   TEXT NOT NULL ${HEX('color_claro')},    -- sobre fondo claro (hoja de datos)
    color_oscuro  TEXT NOT NULL ${HEX('color_oscuro')},   -- sobre fondo oscuro (modo noche)
    tachado INTEGER NOT NULL DEFAULT 0 CHECK (tachado IN (0, 1)),
    orden   INTEGER NOT NULL
  );
  ${AJUSTES}
  CREATE TABLE dificultades (
    nivel   INTEGER PRIMARY KEY CHECK (nivel BETWEEN 1 AND 5),
    nombre  TEXT NOT NULL UNIQUE
  );

  CREATE TABLE tipos (
    id            TEXT PRIMARY KEY,
    nombre        TEXT NOT NULL,
    categoria_id  TEXT NOT NULL REFERENCES categorias(id) ON UPDATE CASCADE,
    resumen       TEXT,
    voltaje       TEXT,
    usos          TEXT,          -- textos largos guardados pero no mostrados (decisión del usuario, 03/11/2026)
    conexion      TEXT,
    advertencias  TEXT,
    origen        ${ORIGEN},
    revisado      INTEGER NOT NULL DEFAULT 1 CHECK (revisado IN (0, 1)),  -- 0 = ficha de la IA aún sin comprobar
    archivado     INTEGER NOT NULL DEFAULT 0 CHECK (archivado IN (0, 1))  -- 1 = oculto (no sale en el glosario ni al elegir tipo)
  );
  CREATE INDEX tipos_categoria ON tipos(categoria_id);
  CREATE TABLE tipo_alias (
    tipo_id  TEXT NOT NULL REFERENCES tipos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    alias    TEXT NOT NULL,
    PRIMARY KEY (tipo_id, alias)
  ) WITHOUT ROWID;
  CREATE TABLE tipo_interfaces (
    tipo_id   TEXT NOT NULL REFERENCES tipos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    orden     INTEGER NOT NULL,
    interfaz  TEXT NOT NULL,
    PRIMARY KEY (tipo_id, orden)
  ) WITHOUT ROWID;
  CREATE TABLE tipo_pines (
    tipo_id     TEXT NOT NULL REFERENCES tipos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    orden       INTEGER NOT NULL,
    pin         TEXT NOT NULL,
    uso         TEXT NOT NULL,
    funcion_id  TEXT NOT NULL REFERENCES funciones_pin(id) ON UPDATE CASCADE,
    PRIMARY KEY (tipo_id, orden)
  ) WITHOUT ROWID;
  CREATE INDEX tipo_pines_funcion ON tipo_pines(funcion_id);

  CREATE TABLE ubicaciones (
    id      INTEGER PRIMARY KEY,
    nombre  TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(nombre)) > 0)
  );
  CREATE TABLE componentes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre        TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
    tipo_id       TEXT REFERENCES tipos(id) ON DELETE SET NULL ON UPDATE CASCADE,
    cantidad      INTEGER CHECK (cantidad IS NULL OR cantidad >= 0),     -- NULL = sin contar
    varios        INTEGER NOT NULL DEFAULT 0 CHECK (varios IN (0, 1)),  -- 1 = «hay muchos»
    ubicacion_id  INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL,
    notas         TEXT NOT NULL DEFAULT '',
    revisar       INTEGER NOT NULL DEFAULT 0 CHECK (revisar IN (0, 1)),
    foto          TEXT UNIQUE,                                           -- fichero en data/fotos
    creado        TEXT NOT NULL DEFAULT (datetime('now')),
    actualizado   TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (varios = 0 OR cantidad IS NULL)
  );
  CREATE INDEX componentes_tipo ON componentes(tipo_id);
  CREATE INDEX componentes_ubicacion ON componentes(ubicacion_id);

  CREATE TABLE proyectos (
    id          TEXT PRIMARY KEY,
    nombre      TEXT NOT NULL,
    dificultad  INTEGER NOT NULL DEFAULT 1 REFERENCES dificultades(nivel),
    tiempo      TEXT,
    resumen     TEXT
  );
  CREATE TABLE proyecto_material (
    id           INTEGER PRIMARY KEY,
    proyecto_id  TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    orden        INTEGER NOT NULL,
    cantidad     INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
    opcional     INTEGER NOT NULL DEFAULT 0 CHECK (opcional IN (0, 1)),
    nota         TEXT,
    UNIQUE (proyecto_id, orden)
  );
  CREATE TABLE material_opciones (          -- un hueco de material admite varios tipos («ESP32-WROOM o S3»)
    material_id  INTEGER NOT NULL REFERENCES proyecto_material(id) ON DELETE CASCADE,
    tipo_id      TEXT NOT NULL REFERENCES tipos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (material_id, tipo_id)
  ) WITHOUT ROWID;
  CREATE INDEX material_opciones_tipo ON material_opciones(tipo_id);
  CREATE TABLE proyecto_conexiones (
    proyecto_id  TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    orden        INTEGER NOT NULL,
    desde        TEXT NOT NULL,
    hasta        TEXT NOT NULL,
    nota         TEXT,
    PRIMARY KEY (proyecto_id, orden)
  ) WITHOUT ROWID;
  CREATE TABLE proyecto_pasos (
    proyecto_id  TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    orden        INTEGER NOT NULL,
    texto        TEXT NOT NULL,
    PRIMARY KEY (proyecto_id, orden)
  ) WITHOUT ROWID;

  CREATE TABLE historial (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    componente_id      INTEGER REFERENCES componentes(id) ON DELETE SET NULL,
    componente_nombre  TEXT NOT NULL,
    accion             TEXT NOT NULL CHECK (accion IN ('alta', 'stock', 'baja')),
    antes              TEXT,
    despues            TEXT,
    fecha              TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX historial_componente ON historial(componente_id);
`;

// v3: datos extra (clave → valor) de cada tipo y de cada pieza, y las tareas de la IA (propuestas pendientes de revisar)
// tareas de la IA: «alta» (pieza nueva), «revisar» (corregir una ficha o una pieza, v6) y «reorganizar» (reservada)
const IA_TAREAS = (nombre) => `
  CREATE TABLE ${nombre} (                  -- cada llamada al modelo: lo que se le pidió, lo que propuso y qué se hizo
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    clase          TEXT NOT NULL CHECK (clase IN ('alta', 'revisar', 'reorganizar')),
    estado         TEXT NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente', 'propuesta', 'aplicada', 'descartada', 'error')),
    entrada        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(entrada)),
    propuesta      TEXT CHECK (propuesta IS NULL OR json_valid(propuesta)),
    componente_id  INTEGER REFERENCES componentes(id) ON DELETE SET NULL,   -- la pieza creada (alta) o revisada
    modelo         TEXT,
    error          TEXT,
    creada         TEXT NOT NULL DEFAULT (datetime('now')),
    actualizada    TEXT NOT NULL DEFAULT (datetime('now'))
  );`;

const TABLAS_V3 = `
  CREATE TABLE tipo_datos (                 -- ficha técnica extendida: «Corriente máx.» → «20 mA», «Dirección I2C» → «0x3C»
    tipo_id  TEXT NOT NULL REFERENCES tipos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    orden    INTEGER NOT NULL,
    clave    TEXT NOT NULL CHECK (length(trim(clave)) > 0),
    valor    TEXT NOT NULL,
    PRIMARY KEY (tipo_id, clave)
  ) WITHOUT ROWID;
  CREATE TABLE componente_datos (           -- lo que cambia de una pieza a otra del mismo tipo: «Valor» → «220 Ω»
    componente_id  INTEGER NOT NULL REFERENCES componentes(id) ON DELETE CASCADE,
    orden          INTEGER NOT NULL,
    clave          TEXT NOT NULL CHECK (length(trim(clave)) > 0),
    valor          TEXT NOT NULL,
    PRIMARY KEY (componente_id, clave)
  ) WITHOUT ROWID;
  ${IA_TAREAS('ia_tareas')}
  CREATE INDEX ia_tareas_estado ON ia_tareas(estado);
`;
const TRIGGERS_V3 = `
  CREATE TRIGGER ia_tareas_actualizada AFTER UPDATE ON ia_tareas
    WHEN NEW.actualizada IS OLD.actualizada
    BEGIN UPDATE ia_tareas SET actualizada = datetime('now') WHERE id = NEW.id; END;
`;

// v4: configuración de la IA puesta desde la web. Una sola fila. La clave NUNCA sale por la API (ni en /api/datos ni en
// /api/exportar): solo se puede poner, cambiar o quitar. Ojo: sí viaja en las copias de seguridad de la base de datos.
const TABLAS_V4 = `
  CREATE TABLE ia_config (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    clave        TEXT CHECK (clave IS NULL OR (length(clave) BETWEEN 16 AND 300 AND clave NOT GLOB '*[ 	]*')),
    modelo       TEXT CHECK (modelo IS NULL OR (length(modelo) BETWEEN 1 AND 80 AND modelo GLOB '[a-z0-9]*' AND modelo NOT GLOB '*[^a-z0-9.-]*')),
    actualizado  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO ia_config (id) VALUES (1);
`;

// v5: lo que el usuario quitó del catálogo (borrado o fusionado). seed/ lo consulta para no volver a crearlo, y
// «reemplazo» dice por qué se sustituyó (fusión de tipos, categoría a la que se movieron sus tipos): los proyectos y
// las fichas de seed/ que apuntaban a lo quitado se redirigen solos.
const TABLAS_V5 = `
  CREATE TABLE catalogo_quitados (
    clase      TEXT NOT NULL CHECK (clase IN ('tipo', 'categoria')),
    id         TEXT NOT NULL,
    reemplazo  TEXT,
    fecha      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (clase, id)
  ) WITHOUT ROWID;
`;

// lo quitado: id → reemplazo (o null). resolver() sigue la cadena de reemplazos (A→B→C) hasta algo que exista.
const quitados = (db, clase) => new Map(db.prepare('SELECT id, reemplazo FROM catalogo_quitados WHERE clase = ?').all(clase).map((r) => [r.id, r.reemplazo]));
export function resolver(db, clase, id) {
  const tabla = clase === 'tipo' ? 'tipos' : 'categorias', q = quitados(db, clase);
  for (let i = 0, actual = id; i < 6 && actual; i++) {
    if (!q.has(actual) && db.prepare(`SELECT 1 FROM ${tabla} WHERE id = ?`).get(actual)) return actual;
    actual = q.get(actual) ?? null;
  }
  return null;
}

// el historial y la fecha de actualización los mantiene la propia base de datos
const TRIGGERS = `
  CREATE TRIGGER componentes_actualizado AFTER UPDATE ON componentes
    WHEN NEW.actualizado IS OLD.actualizado
    BEGIN UPDATE componentes SET actualizado = datetime('now') WHERE id = NEW.id; END;
  CREATE TRIGGER historial_alta AFTER INSERT ON componentes
    BEGIN INSERT INTO historial (componente_id, componente_nombre, accion, despues)
      VALUES (NEW.id, NEW.nombre, 'alta', CASE WHEN NEW.varios THEN 'muchos' ELSE NEW.cantidad END); END;
  CREATE TRIGGER historial_stock AFTER UPDATE OF cantidad, varios ON componentes
    WHEN NEW.cantidad IS NOT OLD.cantidad OR NEW.varios IS NOT OLD.varios
    BEGIN INSERT INTO historial (componente_id, componente_nombre, accion, antes, despues)
      VALUES (NEW.id, NEW.nombre, 'stock',
              CASE WHEN OLD.varios THEN 'muchos' ELSE OLD.cantidad END,
              CASE WHEN NEW.varios THEN 'muchos' ELSE NEW.cantidad END); END;
  CREATE TRIGGER historial_baja AFTER DELETE ON componentes
    BEGIN INSERT INTO historial (componente_id, componente_nombre, accion, antes)
      VALUES (NULL, OLD.nombre, 'baja', CASE WHEN OLD.varios THEN 'muchos' ELSE OLD.cantidad END); END;
`;

const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const leer = (dir, n) => (existsSync(join(dir, n)) ? JSON.parse(readFileSync(join(dir, n), 'utf8')) : null);

// función de un pin cuando la ficha no la trae (fichas antiguas): se deduce del nombre
function deducirFuncion(pin) {
  const p = String(pin).toLowerCase();
  if (/gnd|masa|^g$|^[−-]$/.test(p)) return 'gnd';
  if (/vcc|vin|vdd|3v3|5v|^\+/.test(p)) return 'vcc';
  if (/sda|scl|sck|mosi|miso|tx|rx|ws|bck/.test(p)) return 'bus';
  if (/^a\d|ao|vr/.test(p)) return 'ana';
  return 'dig';
}

// ---------- escritura del catálogo (formato de seed/glosario.json y seed/proyectos.json) ----------
function guardarReferencia(db, ref) {
  // las categorías que ya no son «de seed» (creadas o renombradas por la IA o el usuario) no se tocan,
  // y las que el usuario borró no se vuelven a crear
  const fuera = quitados(db, 'categoria');
  ref.categorias.forEach((c, i) => fuera.has(c.id) || db.prepare(`INSERT INTO categorias (id, nombre, orden) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, orden = excluded.orden WHERE categorias.origen = 'seed'`).run(c.id, c.nombre, i + 1));
  ref.funciones_pin.forEach((f, i) => db.prepare(`INSERT INTO funciones_pin (id, nombre, color_claro, color_oscuro, tachado, orden) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, color_claro = excluded.color_claro, color_oscuro = excluded.color_oscuro,
      tachado = excluded.tachado, orden = excluded.orden`)
    .run(f.id, f.nombre, f.color_claro, f.color_oscuro, f.tachado ? 1 : 0, i + 1));
  ref.dificultades.forEach((d) => db.prepare(`INSERT INTO dificultades (nivel, nombre) VALUES (?, ?)
    ON CONFLICT(nivel) DO UPDATE SET nombre = excluded.nombre`).run(d.nivel, d.nombre));
  // valores por defecto: nunca pisan lo que el usuario ya eligió
  for (const [clave, valor] of Object.entries(ref.ajustes || {}))
    db.prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO NOTHING').run(clave, String(valor));
}

// pares [clave, valor] desde {clave: valor} o [[clave, valor], …]; descarta claves o valores vacíos
const pares = (v) => (Array.isArray(v) ? v : Object.entries(v || {}))
  .map(([k, val]) => [String(k ?? '').trim(), String(val ?? '').trim()]).filter(([k, val]) => k && val);

// escribe una ficha completa (formato de seed/glosario.json). origen: 'seed' | 'ia' | 'usuario'; revisado: 0 si nadie la ha comprobado
export function guardarTipo(db, id, t, {origen = 'seed', revisado = 1} = {}) {
  db.prepare(`INSERT INTO tipos (id, nombre, categoria_id, resumen, voltaje, usos, conexion, advertencias, origen, revisado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, categoria_id = excluded.categoria_id, resumen = excluded.resumen,
      voltaje = excluded.voltaje, usos = excluded.usos, conexion = excluded.conexion, advertencias = excluded.advertencias,
      origen = excluded.origen, revisado = excluded.revisado`)
    .run(id, t.nombre, t.categoria || 'otro', t.resumen ?? null, t.voltaje ?? null, t.usos ?? null, t.conexion ?? null,
      t.ojo ?? t.advertencias ?? null, origen, revisado ? 1 : 0);
  for (const tabla of ['tipo_alias', 'tipo_interfaces', 'tipo_pines', 'tipo_datos']) db.prepare(`DELETE FROM ${tabla} WHERE tipo_id = ?`).run(id);
  pares(t.datos).forEach(([clave, valor], n) =>
    db.prepare('INSERT INTO tipo_datos (tipo_id, orden, clave, valor) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').run(id, n + 1, clave, valor));
  for (const a of new Set(list(t.alias))) db.prepare('INSERT INTO tipo_alias (tipo_id, alias) VALUES (?, ?)').run(id, a);
  const interfaces = Array.isArray(t.interfaz) ? t.interfaz : String(t.interfaz || '').split(/,\s*(?![^(]*\))/);
  interfaces.filter((i) => i && i !== '—').forEach((i, n) => db.prepare('INSERT INTO tipo_interfaces (tipo_id, orden, interfaz) VALUES (?, ?, ?)').run(id, n + 1, i));
  list(t.pines).forEach(([pin, uso, fn], n) =>
    db.prepare('INSERT INTO tipo_pines (tipo_id, orden, pin, uso, funcion_id) VALUES (?, ?, ?, ?, ?)').run(id, n + 1, pin, uso, fn || deducirFuncion(pin)));
}

export function guardarProyecto(db, p) {
  db.prepare('DELETE FROM proyectos WHERE id = ?').run(p.id); // borra en cascada material, conexiones y pasos
  db.prepare('INSERT INTO proyectos (id, nombre, dificultad, tiempo, resumen) VALUES (?, ?, ?, ?, ?)')
    .run(p.id, p.nombre, p.dificultad || 1, p.tiempo ?? null, p.resumen ?? null);
  // cada tipo del material se resuelve: si se fusionó, va al que se quedó; si se borró sin reemplazo, se omite
  let orden = 0;
  list(p.material).forEach((m) => {
    const tipos = [...new Set(list(m.tipo).map((t) => resolver(db, 'tipo', t)).filter(Boolean))];
    if (!tipos.length) return;
    const {lastInsertRowid} = db.prepare('INSERT INTO proyecto_material (proyecto_id, orden, cantidad, opcional, nota) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, ++orden, m.cantidad || 1, m.opcional ? 1 : 0, m.nota ?? null);
    for (const t of tipos) db.prepare('INSERT INTO material_opciones (material_id, tipo_id) VALUES (?, ?)').run(lastInsertRowid, t);
  });
  list(p.conexiones).forEach(([desde, hasta, nota], n) =>
    db.prepare('INSERT INTO proyecto_conexiones (proyecto_id, orden, desde, hasta, nota) VALUES (?, ?, ?, ?, ?)').run(p.id, n + 1, desde, hasta, nota ?? null));
  list(p.pasos).forEach((s, n) => db.prepare('INSERT INTO proyecto_pasos (proyecto_id, orden, texto) VALUES (?, ?, ?)').run(p.id, n + 1, s));
}

export function ubicacionId(db, nombre) {
  const n = String(nombre ?? '').trim();
  if (!n) return null;
  db.prepare('INSERT INTO ubicaciones (nombre) VALUES (?) ON CONFLICT(nombre) DO NOTHING').run(n);
  return db.prepare('SELECT id FROM ubicaciones WHERE nombre = ?').get(n).id;
}

function enTransaccion(db, fn) {
  db.exec('BEGIN');
  try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// actualiza referencia + catálogo desde seed/ (npm run catalogo y en cada arranque). No toca el inventario.
// Respeta los tipos que ya no son «de seed» (creados o cambiados por la IA o por el usuario): esos no se pisan.
export function sincronizarCatalogo(db, seedDir) {
  const ref = leer(seedDir, 'referencia.json'), glosario = leer(seedDir, 'glosario.json') || {}, proyectos = leer(seedDir, 'proyectos.json') || [];
  let tipos = 0, respetados = 0;
  enTransaccion(db, () => {
    if (ref) guardarReferencia(db, ref);
    const ajenos = new Set(db.prepare("SELECT id FROM tipos WHERE origen <> 'seed'").all().map((r) => r.id));
    const tiposFuera = quitados(db, 'tipo');
    for (const [id, t] of Object.entries(glosario)) {
      if (tiposFuera.has(id)) continue; // borrado o fusionado por el usuario: no se resucita
      if (ajenos.has(id)) { respetados++; continue; }
      // si su categoría se borró, va a la que recibió sus tipos (o a «otro»)
      guardarTipo(db, id, {...t, categoria: resolver(db, 'categoria', t.categoria || 'otro') || 'otro'});
      tipos++;
    }
    for (const p of proyectos) guardarProyecto(db, p);
  });
  return {tipos, respetados, proyectos: proyectos.length};
}

// ---------- apertura, creación y migraciones ----------
const tablas = (db) => new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));

export function abrir(dataDir, seedDir) {
  mkdirSync(join(dataDir, 'fotos'), {recursive: true});
  const db = new DatabaseSync(join(dataDir, 'lab.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  let version = db.prepare('PRAGMA user_version').get().user_version;
  const conTablas = tablas(db).has('componentes');

  if (version > VERSION) throw new Error(`La base de datos es de una versión más nueva (${version}) que esta aplicación (${VERSION})`);
  if (version === 0 && !conTablas) crearNueva(db, seedDir);
  else if (version < VERSION) {
    copiaAntesDeMigrar(db, dataDir, version);
    if (version === 0) { migrarDesdeV0(db, seedDir); version = VERSION; } // crea directamente el esquema actual
    if (version === 1) { migrarDesdeV1(db); version = 2; }
    if (version === 2) { migrarDesdeV2(db, seedDir); version = 3; }
    if (version === 3) { migrarDesdeV3(db); version = 4; }
    if (version === 4) { migrarDesdeV4(db); version = 5; }
    if (version === 5) { migrarDesdeV5(db); version = 6; }
  }

  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

// antes de cambiar el esquema, copia completa (VACUUM INTO) junto a las copias diarias. El nombre «lab-antes-…»
// la deja fuera de la rotación: no se borra sola.
function copiaAntesDeMigrar(db, dataDir, version) {
  const {dir} = opcionesCopias(dataDir);
  mkdirSync(dir, {recursive: true});
  const sello = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  let destino = join(dir, `lab-antes-v${version}-a-v${VERSION}-${sello}.db`);
  for (let n = 2; existsSync(destino); n++) destino = join(dir, `lab-antes-v${version}-a-v${VERSION}-${sello}-${n}.db`); // dos en el mismo segundo
  db.exec(`VACUUM INTO '${destino.replaceAll("'", "''")}'`);
  console.log(`[migración] copia previa: ${destino}`);
}

function crearNueva(db, seedDir) {
  enTransaccion(db, () => {
    db.exec(ESQUEMA + TABLAS_V3 + TABLAS_V4 + TABLAS_V5);
    const ref = leer(seedDir, 'referencia.json'), glosario = leer(seedDir, 'glosario.json') || {}, proyectos = leer(seedDir, 'proyectos.json') || [];
    guardarReferencia(db, ref);
    for (const [id, t] of Object.entries(glosario)) guardarTipo(db, id, t);
    for (const p of proyectos) guardarProyecto(db, p);
    for (const c of leer(seedDir, 'componentes.json') || [])
      db.prepare('INSERT INTO componentes (nombre, tipo_id, cantidad, varios, ubicacion_id, notas, revisar) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(c.nombre, glosario[c.tipo] ? c.tipo : null, c.varios ? null : c.cantidad ?? null, c.varios ? 1 : 0, ubicacionId(db, c.ubicacion), c.notas || '', c.seguro === false ? 1 : 0);
    db.exec(TRIGGERS + TRIGGERS_V3); // después de cargar: el inventario inicial no cuenta como «alta» en el historial
    db.exec(`PRAGMA user_version = ${VERSION}`);
  });
  console.log(`Base de datos creada (modelo v${VERSION})`);
}

// v0 = primera versión (fichas y proyectos como JSON dentro de una columna). Conserva ids, cantidades y fotos.
function migrarDesdeV0(db, seedDir) {
  db.exec('PRAGMA foreign_keys = OFF');
  enTransaccion(db, () => {
    for (const t of ['componentes', 'tipos', 'proyectos', 'historial']) db.exec(`ALTER TABLE ${t} RENAME TO v0_${t}`);
    db.exec(ESQUEMA + TABLAS_V3 + TABLAS_V4 + TABLAS_V5);
    guardarReferencia(db, leer(seedDir, 'referencia.json'));
    for (const t of db.prepare('SELECT * FROM v0_tipos').all()) guardarTipo(db, t.id, {nombre: t.nombre, categoria: t.categoria, ...JSON.parse(t.ficha)});
    for (const p of db.prepare('SELECT * FROM v0_proyectos').all()) guardarProyecto(db, {id: p.id, ...JSON.parse(p.datos)});
    for (const c of db.prepare('SELECT * FROM v0_componentes').all())
      db.prepare(`INSERT INTO componentes (id, nombre, tipo_id, cantidad, varios, ubicacion_id, notas, revisar, foto, creado, actualizado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.id, c.nombre, c.tipo, c.varios ? null : c.cantidad, c.varios, ubicacionId(db, c.ubicacion),
        c.notas, c.revisar, c.foto, c.creado, c.actualizado);
    for (const h of db.prepare('SELECT * FROM v0_historial').all())
      db.prepare("INSERT INTO historial (componente_id, componente_nombre, accion, despues, fecha) VALUES (?, ?, 'stock', ?, ?)")
        .run(null, h.nombre || '?', h.cambio, h.fecha);
    for (const t of ['componentes', 'tipos', 'proyectos', 'historial']) db.exec(`DROP TABLE v0_${t}`);
    db.exec(TRIGGERS + TRIGGERS_V3);
    const rotas = db.prepare('PRAGMA foreign_key_check').all();
    if (rotas.length) throw new Error(`Migración con referencias rotas: ${JSON.stringify(rotas.slice(0, 5))}`);
    db.exec(`PRAGMA user_version = ${VERSION}`);
  });
  console.log(`Base de datos migrada al modelo v${VERSION}`);
}

// v1 → v2: cada función de pin tiene color para modo claro y para modo noche; tabla de ajustes (tema).
// Los colores reales los pone sincronizarCatalogo() al arrancar (referencia.json), ya con el esquema final.
function migrarDesdeV1(db) {
  enTransaccion(db, () => {
    db.exec(`ALTER TABLE funciones_pin RENAME COLUMN color TO color_oscuro;
      ALTER TABLE funciones_pin ADD COLUMN color_claro TEXT NOT NULL DEFAULT '#888888' ${HEX('color_claro')};
      ${AJUSTES}`);
    db.exec('PRAGMA user_version = 2');
  });
  console.log('Base de datos migrada al modelo v2');
}

// v5 → v6: las tareas de la IA admiten «revisar» (corregir una ficha o una pieza). SQLite no deja cambiar un CHECK:
// se rehace la tabla con las mismas columnas y se copian las filas (y su índice y su trigger).
function migrarDesdeV5(db) {
  enTransaccion(db, () => {
    db.exec(`${IA_TAREAS('ia_tareas_v6')}
      INSERT INTO ia_tareas_v6 (id, clase, estado, entrada, propuesta, componente_id, modelo, error, creada, actualizada)
        SELECT id, clase, estado, entrada, propuesta, componente_id, modelo, error, creada, actualizada FROM ia_tareas;
      DROP TABLE ia_tareas;
      ALTER TABLE ia_tareas_v6 RENAME TO ia_tareas;
      CREATE INDEX ia_tareas_estado ON ia_tareas(estado);
      ${TRIGGERS_V3}`);
    db.exec('PRAGMA user_version = 6');
  });
  console.log('Base de datos migrada al modelo v6');
}

// una ficha tal como está en la base de datos, en el formato de guardarTipo() (para revisarla o reescribirla entera)
export function leerFicha(db, id) {
  const t = db.prepare('SELECT * FROM tipos WHERE id = ?').get(id);
  if (!t) return null;
  return {
    nombre: t.nombre, categoria: t.categoria_id, resumen: t.resumen || '', voltaje: t.voltaje || '', usos: t.usos, conexion: t.conexion,
    ojo: t.advertencias || '', origen: t.origen, revisado: t.revisado, archivado: t.archivado,
    alias: db.prepare('SELECT alias FROM tipo_alias WHERE tipo_id = ? ORDER BY alias').all(id).map((r) => r.alias),
    interfaz: db.prepare('SELECT interfaz FROM tipo_interfaces WHERE tipo_id = ? ORDER BY orden').all(id).map((r) => r.interfaz),
    pines: db.prepare('SELECT pin, uso, funcion_id FROM tipo_pines WHERE tipo_id = ? ORDER BY orden').all(id).map((r) => [r.pin, r.uso, r.funcion_id]),
    datos: db.prepare('SELECT clave, valor FROM tipo_datos WHERE tipo_id = ? ORDER BY orden').all(id).map((r) => [r.clave, r.valor]),
  };
}

// v4 → v5: tipos archivados (ocultos sin borrar) y lo quitado del catálogo (para que seed/ no lo resucite)
function migrarDesdeV4(db) {
  enTransaccion(db, () => {
    db.exec(`ALTER TABLE tipos ADD COLUMN archivado INTEGER NOT NULL DEFAULT 0 CHECK (archivado IN (0, 1));
      ${TABLAS_V5}`);
    db.exec('PRAGMA user_version = 5');
  });
  console.log('Base de datos migrada al modelo v5');
}

// v3 → v4: tabla ia_config (clave y modelo de la IA puestos desde la web)
function migrarDesdeV3(db) {
  enTransaccion(db, () => {
    db.exec(TABLAS_V4);
    db.exec('PRAGMA user_version = 4');
  });
  console.log('Base de datos migrada al modelo v4');
}

// v2 → v3: origen y revisado en categorías y tipos, datos extra de tipos y piezas, tareas de la IA.
// Los tipos que no están en seed/glosario.json los creó el usuario desde la web: quedan como origen 'usuario'.
function migrarDesdeV2(db, seedDir) {
  const glosario = leer(seedDir, 'glosario.json') || {};
  enTransaccion(db, () => {
    db.exec(`ALTER TABLE categorias ADD COLUMN origen ${ORIGEN};
      ALTER TABLE tipos ADD COLUMN origen ${ORIGEN};
      ALTER TABLE tipos ADD COLUMN revisado INTEGER NOT NULL DEFAULT 1 CHECK (revisado IN (0, 1));
      ${TABLAS_V3}
      ${TRIGGERS_V3}`);
    for (const {id} of db.prepare('SELECT id FROM tipos').all())
      if (!glosario[id]) db.prepare("UPDATE tipos SET origen = 'usuario' WHERE id = ?").run(id);
    db.exec('PRAGMA user_version = 3');
  });
  console.log('Base de datos migrada al modelo v3');
}
