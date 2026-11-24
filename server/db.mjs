// Base de datos SQLite (node:sqlite, sin dependencias). Fichero: data/lab.db · modelo: docs/modelo-datos.md
//
// Dos clases de datos:
//   · REFERENCIA y CATÁLOGO (categorías, funciones de pin y sus colores, dificultades, tipos, pines, proyectos).
//     La base de datos es la fuente de verdad. seed/*.json crea lo que falta y actualiza solo lo que sigue siendo
//     «de seed» (origen = 'seed'): nunca pisa una categoría o un tipo creados o cambiados por la IA o por el usuario.
//   · INVENTARIO del usuario (componentes, ubicaciones, datos de cada pieza): solo los cambia la aplicación.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {opcionesCopias} from './copias.mjs';

export const VERSION = 10;
export const ESTADOS_PROYECTO = ['idea', 'en_marcha', 'pausa', 'terminado'];
export const COLUMNAS_TAREA = ['hacer', 'curso', 'hecho'];
const ORIGEN = `TEXT NOT NULL DEFAULT 'seed' CHECK (origen IN ('seed', 'ia', 'usuario'))`;
const ESTADO_PROYECTO = `TEXT NOT NULL DEFAULT 'idea' CHECK (estado IN ('idea', 'en_marcha', 'pausa', 'terminado'))`;
const HEX = (col) => `CHECK (${col} GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]')`;
export const COLOR_NEUTRO = '#C9C6DA'; // categorías nuevas o sin color en seed/
const COLOR_CATEGORIA = `TEXT NOT NULL DEFAULT '${COLOR_NEUTRO}' ${HEX('color')}`;
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
    origen  ${ORIGEN},          -- quién manda en la fila: seed/ solo actualiza las que siguen siendo 'seed'
    color   ${COLOR_CATEGORIA}  -- color de la categoría (pegatinas y fondos teñidos; el mismo en claro y en noche)
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
    nota        TEXT,          -- lo que hay que saber de ese pin además de su uso («También: UART2 RX», «solo entrada») (v8)
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
    resumen     TEXT,
    origen      ${ORIGEN},          -- seed/ solo actualiza los que siguen siendo 'seed' (v8)
    estado      ${ESTADO_PROYECTO}  -- lo pone el usuario; seed/ nunca lo toca
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
`;

// v3: datos extra (clave → valor) de cada tipo y de cada pieza, y las tareas de la IA (propuestas pendientes de revisar)
// tareas de la IA: «alta» (pieza nueva), «revisar» (corregir una ficha o una pieza, v6), «detectar» (separar las piezas
// de una foto con muchas, v8) y «reorganizar» (reservada)
const IA_TAREAS = (nombre) => `
  CREATE TABLE ${nombre} (                  -- cada llamada al modelo: lo que se le pidió, lo que propuso y qué se hizo
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    clase          TEXT NOT NULL CHECK (clase IN ('alta', 'revisar', 'detectar', 'reorganizar')),
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
const QUITADOS = (nombre) => `
  CREATE TABLE ${nombre} (
    clase      TEXT NOT NULL CHECK (clase IN ('tipo', 'categoria', 'proyecto')),
    id         TEXT NOT NULL,
    reemplazo  TEXT,
    fecha      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (clase, id)
  ) WITHOUT ROWID;
`;
const TABLAS_V5 = QUITADOS('catalogo_quitados');

// v7: historial de cambios de toda la aplicación (Ajustes → Historial y el de cada pieza o ficha). Lo escribe el
// servidor (server/auditoria.mjs) al cambiar algo: quién (tú, la IA con su modelo, o el sistema), qué y el detalle
// (los campos con su antes y su después). Nunca guarda la clave de la IA. (Convivió con la tabla «historial» de stock hasta v10.)
const AUDITORIA = (nombre) => `
  CREATE TABLE ${nombre} (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha      TEXT NOT NULL DEFAULT (datetime('now')),
    quien      TEXT NOT NULL CHECK (quien IN ('usuario', 'ia', 'sistema')),
    accion     TEXT NOT NULL,                 -- «pieza.editar», «tipo.fusionar», «ia.aplicar», «copia.restaurar»…
    objeto     TEXT NOT NULL CHECK (objeto IN ('pieza', 'tipo', 'categoria', 'sitio', 'ia', 'copia', 'ajustes', 'proyecto')),
    objeto_id  TEXT,                          -- id de la pieza, del tipo… (puede que ya no exista)
    nombre     TEXT,                          -- su nombre en ese momento
    resumen    TEXT NOT NULL,                 -- frase que se lee en la web
    detalle    TEXT CHECK (detalle IS NULL OR json_valid(detalle)),   -- {cambios: [{campo, antes, despues}], …}
    modelo     TEXT                           -- si lo hizo la IA: con qué modelo
  );
`;
const INDICE_AUDITORIA = 'CREATE INDEX auditoria_objeto ON auditoria(objeto, objeto_id);';
const TABLAS_V7 = AUDITORIA('auditoria') + INDICE_AUDITORIA;

// v8: lo que el usuario apunta de cada proyecto. Cuelga de «proyectos» (se borra con él), pero seed/ ya no borra la
// fila del proyecto al arrancar: solo reescribe su material, conexiones y pasos, y solo si sigue siendo «de seed».
// Las fotos de las notas y los archivos (diagramas: imagen o PDF) están en data/fotos con el prefijo «p-».
const TABLAS_V8 = `
  CREATE TABLE proyecto_notas (             -- bitácora: cómo avanza, con foto opcional
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    proyecto_id  TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    texto        TEXT NOT NULL DEFAULT '',
    foto         TEXT UNIQUE,
    fecha        TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (length(trim(texto)) > 0 OR foto IS NOT NULL)
  );
  CREATE INDEX proyecto_notas_proyecto ON proyecto_notas(proyecto_id);
  CREATE TABLE proyecto_tareas (            -- tablero: por hacer, en curso, hecho
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    proyecto_id  TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    texto        TEXT NOT NULL CHECK (length(trim(texto)) > 0),
    columna      TEXT NOT NULL DEFAULT 'hacer' CHECK (columna IN ('hacer', 'curso', 'hecho')),
    orden        INTEGER NOT NULL DEFAULT 0,
    creada       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX proyecto_tareas_proyecto ON proyecto_tareas(proyecto_id);
  CREATE TABLE proyecto_archivos (          -- diagramas y esquemas
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    proyecto_id  TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    fichero      TEXT NOT NULL UNIQUE,       -- en data/fotos
    nombre       TEXT NOT NULL,              -- el que le puso el usuario
    tipo         TEXT NOT NULL,              -- image/jpeg, application/pdf…
    bytes        INTEGER NOT NULL,
    fecha        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX proyecto_archivos_proyecto ON proyecto_archivos(proyecto_id);
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

// la fecha de actualización la mantiene la propia base de datos (lo que cambia lo apunta la app en «auditoria»)
const TRIGGERS = `
  CREATE TRIGGER componentes_actualizado AFTER UPDATE ON componentes
    WHEN NEW.actualizado IS OLD.actualizado
    BEGIN UPDATE componentes SET actualizado = datetime('now') WHERE id = NEW.id; END;
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
  ref.categorias.forEach((c, i) => fuera.has(c.id) || db.prepare(`INSERT INTO categorias (id, nombre, orden, color) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, orden = excluded.orden, color = excluded.color WHERE categorias.origen = 'seed'`)
    .run(c.id, c.nombre, i + 1, c.color || COLOR_NEUTRO));
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
  list(t.pines).forEach(([pin, uso, fn, nota], n) =>
    db.prepare('INSERT INTO tipo_pines (tipo_id, orden, pin, uso, funcion_id, nota) VALUES (?, ?, ?, ?, ?, ?)').run(id, n + 1, pin, uso, fn || deducirFuncion(pin), nota || null));
}

// escribe un proyecto entero (formato de seed/proyectos.json). La fila no se borra nunca (de ella cuelgan el estado, la
// bitácora, el tablero y los archivos del usuario): se actualiza, y se reescriben su material, conexiones y pasos.
export function guardarProyecto(db, p, {origen = 'seed'} = {}) {
  db.prepare(`INSERT INTO proyectos (id, nombre, dificultad, tiempo, resumen, origen) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, dificultad = excluded.dificultad, tiempo = excluded.tiempo,
      resumen = excluded.resumen, origen = excluded.origen`)
    .run(p.id, p.nombre, p.dificultad || 1, p.tiempo ?? null, p.resumen ?? null, origen);
  db.prepare('DELETE FROM material_opciones WHERE material_id IN (SELECT id FROM proyecto_material WHERE proyecto_id = ?)').run(p.id);
  for (const tabla of ['proyecto_material', 'proyecto_conexiones', 'proyecto_pasos']) db.prepare(`DELETE FROM ${tabla} WHERE proyecto_id = ?`).run(p.id);
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
  let tipos = 0, respetados = 0, nPro = 0;
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
    // proyectos: igual que los tipos. Los que el usuario cambió o borró no se tocan
    const proAjenos = new Set(db.prepare("SELECT id FROM proyectos WHERE origen <> 'seed'").all().map((r) => r.id));
    const proFuera = quitados(db, 'proyecto');
    for (const p of proyectos) {
      if (proFuera.has(p.id) || proAjenos.has(p.id)) continue;
      guardarProyecto(db, p);
      nPro++;
    }
  });
  return {tipos, respetados, proyectos: nPro};
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
    if (version === 6) { migrarDesdeV6(db); version = 7; }
    if (version === 7) { migrarDesdeV7(db); version = 8; }
    if (version === 8) { migrarDesdeV8(db, seedDir); version = 9; }
    if (version === 9) { migrarDesdeV9(db); version = 10; }
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
    db.exec(ESQUEMA + TABLAS_V3 + TABLAS_V4 + TABLAS_V5 + TABLAS_V7 + TABLAS_V8);
    const ref = leer(seedDir, 'referencia.json'), glosario = leer(seedDir, 'glosario.json') || {}, proyectos = leer(seedDir, 'proyectos.json') || [];
    guardarReferencia(db, ref);
    for (const [id, t] of Object.entries(glosario)) guardarTipo(db, id, t);
    for (const p of proyectos) guardarProyecto(db, p);
    for (const c of leer(seedDir, 'componentes.json') || [])
      db.prepare('INSERT INTO componentes (nombre, tipo_id, cantidad, varios, ubicacion_id, notas, revisar) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(c.nombre, glosario[c.tipo] ? c.tipo : null, c.varios ? null : c.cantidad ?? null, c.varios ? 1 : 0, ubicacionId(db, c.ubicacion), c.notas || '', c.seguro === false ? 1 : 0);
    db.exec(TRIGGERS + TRIGGERS_V3);
    db.exec(`PRAGMA user_version = ${VERSION}`);
  });
  console.log(`Base de datos creada (modelo v${VERSION})`);
}

// v0 = primera versión (fichas y proyectos como JSON dentro de una columna). Conserva ids, cantidades y fotos.
function migrarDesdeV0(db, seedDir) {
  db.exec('PRAGMA foreign_keys = OFF');
  enTransaccion(db, () => {
    for (const t of ['componentes', 'tipos', 'proyectos', 'historial']) db.exec(`ALTER TABLE ${t} RENAME TO v0_${t}`);
    db.exec(ESQUEMA + TABLAS_V3 + TABLAS_V4 + TABLAS_V5 + TABLAS_V7 + TABLAS_V8);
    guardarReferencia(db, leer(seedDir, 'referencia.json'));
    for (const t of db.prepare('SELECT * FROM v0_tipos').all()) guardarTipo(db, t.id, {nombre: t.nombre, categoria: t.categoria, ...JSON.parse(t.ficha)});
    for (const p of db.prepare('SELECT * FROM v0_proyectos').all()) guardarProyecto(db, {id: p.id, ...JSON.parse(p.datos)});
    for (const c of db.prepare('SELECT * FROM v0_componentes').all())
      db.prepare(`INSERT INTO componentes (id, nombre, tipo_id, cantidad, varios, ubicacion_id, notas, revisar, foto, creado, actualizado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.id, c.nombre, c.tipo, c.varios ? null : c.cantidad, c.varios, ubicacionId(db, c.ubicacion),
        c.notas, c.revisar, c.foto, c.creado, c.actualizado);
    for (const h of db.prepare('SELECT * FROM v0_historial').all())
      db.prepare("INSERT INTO auditoria (fecha, quien, accion, objeto, nombre, resumen) VALUES (?, 'usuario', 'pieza.stock', 'pieza', ?, ?)")
        .run(h.fecha, h.nombre || '?', `Cantidad: ${h.cambio ?? '—'}`);
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

// v6 → v7: tabla auditoria. Se rellena con lo que ya se sabía: altas, cambios de stock y bajas del historial, y las
// propuestas de la IA que se aplicaron (con su modelo), en orden de fecha.
function migrarDesdeV6(db) {
  enTransaccion(db, () => {
    db.exec(TABLAS_V7);
    const filas = [];
    for (const h of db.prepare('SELECT * FROM historial').all()) {
      const cant = (v) => (v == null ? '—' : String(v));
      filas.push(h.accion === 'alta' ? [h.fecha, 'usuario', 'pieza.alta', 'pieza', h.componente_id, h.componente_nombre, `Pieza añadida (${cant(h.despues)})`, null, null]
        : h.accion === 'stock' ? [h.fecha, 'usuario', 'pieza.stock', 'pieza', h.componente_id, h.componente_nombre, `Cantidad: ${cant(h.antes)} → ${cant(h.despues)}`,
          JSON.stringify({cambios: [{campo: 'Cantidad', antes: cant(h.antes), despues: cant(h.despues)}]}), null]
        : [h.fecha, 'usuario', 'pieza.borrar', 'pieza', h.componente_id, h.componente_nombre, 'Pieza borrada', null, null]);
    }
    for (const t of db.prepare("SELECT * FROM ia_tareas WHERE estado = 'aplicada'").all()) {
      const e = JSON.parse(t.entrada || '{}'), p = t.propuesta ? JSON.parse(t.propuesta) : {};
      if (t.clase === 'alta')
        filas.push([t.actualizada, 'ia', 'ia.alta', 'pieza', t.componente_id, p.nombre || null, 'Pieza añadida con IA', JSON.stringify({tarea: t.id}), t.modelo]);
      else if (t.clase === 'revisar') {
        const o = e.objetivo || {};
        const nombre = o.componente_id ? db.prepare('SELECT nombre FROM componentes WHERE id = ?').get(o.componente_id)?.nombre
          : o.tipo_id ? db.prepare('SELECT nombre FROM tipos WHERE id = ?').get(o.tipo_id)?.nombre : null;
        filas.push([t.actualizada, 'ia', 'ia.aplicar', o.componente_id ? 'pieza' : 'tipo', o.componente_id ?? o.tipo_id ?? null, nombre ?? null,
          'Correcciones de la IA aplicadas', JSON.stringify({tarea: t.id}), t.modelo]);
      }
    }
    filas.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const ins = db.prepare('INSERT INTO auditoria (fecha, quien, accion, objeto, objeto_id, nombre, resumen, detalle, modelo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const f of filas) ins.run(f[0], f[1], f[2], f[3], f[4] == null ? null : String(f[4]), f[5], f[6], f[7], f[8]);
    db.exec('PRAGMA user_version = 7');
  });
  console.log('Base de datos migrada al modelo v7');
}

// v7 → v8: cada pin puede llevar una nota (tipo_pines.nota). Los proyectos pasan a ser también del usuario: origen (como los tipos) y estado, y sus tablas de bitácora,
// tablero y archivos. «catalogo_quitados» y «auditoria» admiten proyectos e «ia_tareas» la clase «detectar» (foto con
// varias piezas): SQLite no deja cambiar un CHECK, así que las tres se rehacen con las mismas columnas y se copian las filas.
function migrarDesdeV7(db) {
  enTransaccion(db, () => {
    db.exec(`ALTER TABLE tipo_pines ADD COLUMN nota TEXT;
      ALTER TABLE proyectos ADD COLUMN origen ${ORIGEN};
      ALTER TABLE proyectos ADD COLUMN estado ${ESTADO_PROYECTO};
      ${TABLAS_V8}
      ${QUITADOS('catalogo_quitados_v8')}
      INSERT INTO catalogo_quitados_v8 (clase, id, reemplazo, fecha) SELECT clase, id, reemplazo, fecha FROM catalogo_quitados;
      DROP TABLE catalogo_quitados;
      ALTER TABLE catalogo_quitados_v8 RENAME TO catalogo_quitados;
      ${AUDITORIA('auditoria_v8')}
      INSERT INTO auditoria_v8 (id, fecha, quien, accion, objeto, objeto_id, nombre, resumen, detalle, modelo)
        SELECT id, fecha, quien, accion, objeto, objeto_id, nombre, resumen, detalle, modelo FROM auditoria;
      DROP TABLE auditoria;
      ALTER TABLE auditoria_v8 RENAME TO auditoria;
      ${INDICE_AUDITORIA}
      ${IA_TAREAS('ia_tareas_v8')}
      INSERT INTO ia_tareas_v8 (id, clase, estado, entrada, propuesta, componente_id, modelo, error, creada, actualizada)
        SELECT id, clase, estado, entrada, propuesta, componente_id, modelo, error, creada, actualizada FROM ia_tareas;
      DROP TABLE ia_tareas;
      ALTER TABLE ia_tareas_v8 RENAME TO ia_tareas;
      CREATE INDEX ia_tareas_estado ON ia_tareas(estado);
      ${TRIGGERS_V3}`);
    db.exec('PRAGMA user_version = 8');
  });
  console.log('Base de datos migrada al modelo v8');
}

// v8 → v9: cada categoría tiene su color (estilo AMSTech: pegatinas y fondos teñidos). Se pone el de seed/referencia.json
// a todas las que lo tienen, aunque el usuario las haya renombrado (el color no lo había elegido nadie); las demás, neutro.
function migrarDesdeV8(db, seedDir) {
  const colores = Object.fromEntries((leer(seedDir, 'referencia.json')?.categorias || []).filter((c) => c.color).map((c) => [c.id, c.color]));
  enTransaccion(db, () => {
    db.exec(`ALTER TABLE categorias ADD COLUMN color ${COLOR_CATEGORIA}`);
    const poner = db.prepare('UPDATE categorias SET color = ? WHERE id = ?');
    for (const [id, color] of Object.entries(colores)) poner.run(color, id);
    db.exec('PRAGMA user_version = 9');
  });
  console.log('Base de datos migrada al modelo v9');
}

// v9 → v10: fuera la tabla «historial» y sus triggers. Desde v7 lo mismo (altas, cambios de stock y bajas) lo apunta
// la app en «auditoria», y lo de antes de v7 ya se pasó allí al migrar a v7: no se pierde nada.
function migrarDesdeV9(db) {
  enTransaccion(db, () => {
    db.exec(`DROP TRIGGER IF EXISTS historial_alta; DROP TRIGGER IF EXISTS historial_stock; DROP TRIGGER IF EXISTS historial_baja;
      DROP TABLE IF EXISTS historial;`);
    db.exec('PRAGMA user_version = 10');
  });
  console.log('Base de datos migrada al modelo v10');
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
    pines: db.prepare('SELECT pin, uso, funcion_id, nota FROM tipo_pines WHERE tipo_id = ? ORDER BY orden').all(id).map((r) => [r.pin, r.uso, r.funcion_id, r.nota || '']),
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
