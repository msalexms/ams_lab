// Base de datos SQLite (node:sqlite, sin dependencias). Fichero: data/lab.db · modelo: docs/modelo-datos.md
//
// Dos clases de datos:
//   · REFERENCIA y CATÁLOGO (categorías, funciones de pin y sus colores, dificultades, tipos, pines, proyectos):
//     vienen de seed/*.json y se actualizan con `npm run catalogo` (nunca tocan el inventario).
//   · INVENTARIO del usuario (componentes, ubicaciones, historial): solo los cambia la aplicación.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';

export const VERSION = 2;
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
    orden   INTEGER NOT NULL
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
    advertencias  TEXT
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
  ref.categorias.forEach((c, i) => db.prepare(`INSERT INTO categorias (id, nombre, orden) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, orden = excluded.orden`).run(c.id, c.nombre, i + 1));
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

export function guardarTipo(db, id, t) {
  db.prepare(`INSERT INTO tipos (id, nombre, categoria_id, resumen, voltaje, usos, conexion, advertencias) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, categoria_id = excluded.categoria_id, resumen = excluded.resumen,
      voltaje = excluded.voltaje, usos = excluded.usos, conexion = excluded.conexion, advertencias = excluded.advertencias`)
    .run(id, t.nombre, t.categoria || 'otro', t.resumen ?? null, t.voltaje ?? null, t.usos ?? null, t.conexion ?? null, t.ojo ?? t.advertencias ?? null);
  for (const tabla of ['tipo_alias', 'tipo_interfaces', 'tipo_pines']) db.prepare(`DELETE FROM ${tabla} WHERE tipo_id = ?`).run(id);
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
  list(p.material).forEach((m, n) => {
    const {lastInsertRowid} = db.prepare('INSERT INTO proyecto_material (proyecto_id, orden, cantidad, opcional, nota) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, n + 1, m.cantidad || 1, m.opcional ? 1 : 0, m.nota ?? null);
    for (const t of new Set(list(m.tipo))) db.prepare('INSERT INTO material_opciones (material_id, tipo_id) VALUES (?, ?)').run(lastInsertRowid, t);
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

// actualiza referencia + catálogo desde seed/ (npm run catalogo). No toca componentes, ubicaciones ni historial.
export function sincronizarCatalogo(db, seedDir) {
  const ref = leer(seedDir, 'referencia.json'), glosario = leer(seedDir, 'glosario.json') || {}, proyectos = leer(seedDir, 'proyectos.json') || [];
  enTransaccion(db, () => {
    if (ref) guardarReferencia(db, ref);
    for (const [id, t] of Object.entries(glosario)) guardarTipo(db, id, t);
    for (const p of proyectos) guardarProyecto(db, p);
  });
  return {tipos: Object.keys(glosario).length, proyectos: proyectos.length};
}

// ---------- apertura, creación y migraciones ----------
const tablas = (db) => new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));

export function abrir(dataDir, seedDir) {
  mkdirSync(join(dataDir, 'fotos'), {recursive: true});
  const db = new DatabaseSync(join(dataDir, 'lab.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;

  if (version === 0 && tablas(db).has('componentes')) migrarDesdeV0(db, seedDir);
  else if (version === 0) crearNueva(db, seedDir);
  else if (version === 1) migrarDesdeV1(db, seedDir);
  else if (version > VERSION) throw new Error(`La base de datos es de una versión más nueva (${version}) que esta aplicación (${VERSION})`);

  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function crearNueva(db, seedDir) {
  enTransaccion(db, () => {
    db.exec(ESQUEMA);
    const ref = leer(seedDir, 'referencia.json'), glosario = leer(seedDir, 'glosario.json') || {}, proyectos = leer(seedDir, 'proyectos.json') || [];
    guardarReferencia(db, ref);
    for (const [id, t] of Object.entries(glosario)) guardarTipo(db, id, t);
    for (const p of proyectos) guardarProyecto(db, p);
    for (const c of leer(seedDir, 'componentes.json') || [])
      db.prepare('INSERT INTO componentes (nombre, tipo_id, cantidad, varios, ubicacion_id, notas, revisar) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(c.nombre, glosario[c.tipo] ? c.tipo : null, c.varios ? null : c.cantidad ?? null, c.varios ? 1 : 0, ubicacionId(db, c.ubicacion), c.notas || '', c.seguro === false ? 1 : 0);
    db.exec(TRIGGERS); // después de cargar: el inventario inicial no cuenta como «alta» en el historial
    db.exec(`PRAGMA user_version = ${VERSION}`);
  });
  console.log(`Base de datos creada (modelo v${VERSION})`);
}

// v0 = primera versión (fichas y proyectos como JSON dentro de una columna). Conserva ids, cantidades y fotos.
function migrarDesdeV0(db, seedDir) {
  db.exec('PRAGMA foreign_keys = OFF');
  enTransaccion(db, () => {
    for (const t of ['componentes', 'tipos', 'proyectos', 'historial']) db.exec(`ALTER TABLE ${t} RENAME TO v0_${t}`);
    db.exec(ESQUEMA);
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
    db.exec(TRIGGERS);
    const rotas = db.prepare('PRAGMA foreign_key_check').all();
    if (rotas.length) throw new Error(`Migración con referencias rotas: ${JSON.stringify(rotas.slice(0, 5))}`);
    db.exec(`PRAGMA user_version = ${VERSION}`);
  });
  console.log(`Base de datos migrada al modelo v${VERSION}`);
}

// v1 → v2: cada función de pin tiene color para modo claro y para modo noche; tabla de ajustes (tema)
function migrarDesdeV1(db, seedDir) {
  enTransaccion(db, () => {
    db.exec(`ALTER TABLE funciones_pin RENAME COLUMN color TO color_oscuro;
      ALTER TABLE funciones_pin ADD COLUMN color_claro TEXT NOT NULL DEFAULT '#888888' ${HEX('color_claro')};
      ${AJUSTES}`);
    guardarReferencia(db, leer(seedDir, 'referencia.json'));
    db.exec(`PRAGMA user_version = ${VERSION}`);
  });
  console.log(`Base de datos migrada al modelo v${VERSION}`);
}
