// Base de datos: crear una nueva desde seed/ y migrar una v9 real (test/datos/v9.sql) al modelo actual, siempre en carpetas temporales
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {abrir, VERSION} from '../server/db.mjs';

const SEED = fileURLToPath(new URL('../seed', import.meta.url));
// carpeta temporal que se borra al acabar la prueba (antes se cierran sus bases de datos: en Windows, abiertas no se borran)
const carpeta = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'circuitbin-')), abiertas = [];
  t.after(() => { abiertas.forEach((db) => db.isOpen && db.close()); rmSync(dir, {recursive: true, force: true, maxRetries: 5}); });
  return {dir, abrir: () => { const db = abrir(dir, SEED); abiertas.push(db); return db; }};
};
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const hay = (db, tipo, nombre) => !!db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(tipo, nombre);
const contar = (db, tabla) => db.prepare(`SELECT count(*) AS n FROM ${tabla}`).get().n;
const copiasPrevias = (dir) => (existsSync(join(dir, 'copias')) ? readdirSync(join(dir, 'copias')).filter((f) => f.startsWith('lab-antes-')) : []);

test('una base de datos nueva sale en la versión actual, con el catálogo básico y las piezas de ejemplo', (t) => {
  const db = carpeta(t).abrir();
  const seed = (f) => JSON.parse(readFileSync(join(SEED, f), 'utf8'));
  assert.equal(version(db), VERSION);
  assert.equal(contar(db, 'componentes'), seed('componentes.json').length);
  assert.ok(contar(db, 'tipos') >= Object.keys(seed('glosario.json')).length);
  assert.ok(!hay(db, 'table', 'historial'));
});

test('una v9 migra a la actual sin perder piezas, con copia previa y sin la tabla historial', (t) => {
  const c = carpeta(t);
  const vieja = new DatabaseSync(join(c.dir, 'lab.db'));
  vieja.exec(readFileSync(new URL('./datos/v9.sql', import.meta.url), 'utf8'));
  assert.equal(version(vieja), 9);
  const piezas = (db) => db.prepare('SELECT id, nombre, cantidad FROM componentes ORDER BY id').all().map((x) => ({...x}));
  const antes = piezas(vieja), tipos = contar(vieja, 'tipos'), auditoria = contar(vieja, 'auditoria');
  vieja.close();

  const db = c.abrir();
  assert.equal(version(db), VERSION);
  assert.deepEqual(piezas(db), antes);
  assert.equal(contar(db, 'tipos'), tipos);
  assert.ok(contar(db, 'auditoria') >= auditoria);
  assert.ok(!hay(db, 'table', 'historial'));
  for (const tr of ['historial_alta', 'historial_stock', 'historial_baja']) assert.ok(!hay(db, 'trigger', tr), tr);
  assert.ok(copiasPrevias(c.dir).some((f) => f.startsWith('lab-antes-v9-')), 'falta la copia previa');
  db.prepare('UPDATE componentes SET cantidad = 7 WHERE id = ?').run(antes[0].id); // ningún trigger apunta ya a la tabla quitada
});

test('abrir otra vez una base de datos ya al día no la migra ni copia', (t) => {
  const c = carpeta(t);
  c.abrir().close();
  assert.equal(version(c.abrir()), VERSION);
  assert.deepEqual(copiasPrevias(c.dir), []);
});

test('una base de datos de una versión más nueva no se abre', (t) => {
  const c = carpeta(t);
  const db = new DatabaseSync(join(c.dir, 'lab.db'));
  db.exec(`CREATE TABLE componentes (id INTEGER); PRAGMA user_version = ${VERSION + 1}`);
  db.close();
  assert.throws(() => c.abrir(), /versión más nueva/);
});
