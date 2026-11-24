// normalizar(): lo que propone la IA se limpia antes de enseñarlo (sin llamar a ningún modelo)
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {abrir} from '../server/db.mjs';
import {extraerJson, normalizar} from '../server/ia.mjs';

let dir, db;
before(() => { dir = mkdtempSync(join(tmpdir(), 'circuitbin-')); db = abrir(dir, fileURLToPath(new URL('../seed', import.meta.url))); });
after(() => { db.close(); rmSync(dir, {recursive: true, force: true, maxRetries: 5}); });

const tipoNuevo = (extra = {}) => ({nombre: 'Sensor raro', categoria: 'sensor', resumen: 'Mide cosas', voltaje: '3v3', interfaz: ['i2c (0x3c)'], alias: [], pines: [], datos: {}, ojo: '', ...extra});

test('un tipo existente que no está en el catálogo se quita y queda como duda', () => {
  const p = normalizar(db, {nombre: 'Algo', tipo_existente: 'no-existe', confianza: 'alta'});
  assert.equal(p.tipo_existente, null);
  assert.ok(p.dudas.includes('El tipo «no-existe» no existe.'));
});

test('un tipo existente válido se conserva', () => {
  assert.equal(normalizar(db, {nombre: 'Mi ESP32', tipo_existente: 'esp32-wroom-devkit'}).tipo_existente, 'esp32-wroom-devkit');
});

test('ficha nueva: categoría desconocida → «otro», formato uniforme y un pin por fila', () => {
  const p = normalizar(db, {nombre: 'X', tipo_nuevo: tipoNuevo({categoria: 'inventada', pines: [['GPIO 16 · 17', 'UART2: RX · TX', 'bus', ''], {pin: 'GND', uso: 'masa', funcion: 'nada', nota: ''}]})});
  const n = p.tipo_nuevo;
  assert.equal(n.categoria, 'otro');
  assert.ok(p.dudas.some((d) => d.startsWith('Categoría «inventada» desconocida')));
  assert.equal(n.voltaje, '3,3 V');
  assert.deepEqual(n.interfaz, ['I2C (0x3c)']);
  assert.deepEqual(n.pines.map((x) => x[0]), ['GPIO 16', 'GPIO 17', 'GND']);
  assert.equal(n.pines[2][2], 'otro', 'una función que no existe pasa a «otro»');
});

test('las dudas quedan como textos y sus respuestas aparte (con 2 o más)', () => {
  const p = normalizar(db, {nombre: 'X', dudas: [{pregunta: '¿Qué tensión?', opciones: ['3,3 V', '5 V', '5 V']}, {pregunta: '¿Color?', opciones: ['rojo']}, 'Texto suelto', '']});
  assert.deepEqual(p.dudas, ['¿Qué tensión?', '¿Color?', 'Texto suelto']);
  assert.deepEqual(p.opciones, {'¿Qué tensión?': ['3,3 V', '5 V']});
});

test('cantidad: número entero entre 0 y 99999, o sin contar', () => {
  const c = (cantidad) => normalizar(db, {nombre: 'X', cantidad}).cantidad;
  assert.equal(c('5'), 5);
  assert.equal(c(2.6), 3);
  assert.equal(c(1e9), 99999);
  assert.equal(c(-1), null);
  assert.equal(c(''), null);
  assert.equal(c(null), null);
  assert.equal(c('muchas'), null);
});

test('confianza desconocida → «baja»; sin objeto → error', () => {
  assert.equal(normalizar(db, {nombre: 'X', confianza: 'total'}).confianza, 'baja');
  assert.throws(() => normalizar(db, null), /no es un objeto/);
});

test('extraerJson saca el objeto de una respuesta con texto y ```json', () => {
  assert.deepEqual(extraerJson('Claro:\n```json\n{"nombre": "LED"}\n```\nListo.'), {nombre: 'LED'});
  assert.equal(extraerJson('sin json'), null);
  assert.equal(extraerJson('{roto'), null);
});
