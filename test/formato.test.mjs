// Reglas puras de formato y de revisión (sin base de datos): npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {magnitudes, interfaz, claveDato, separarPines, pinAgrupado, mismoValor, mismasInterfaces} from '../server/formato.mjs';
import {reordenar} from '../server/revision.mjs';

test('magnitudes: tensión, corriente, resistencia y rangos con raya', () => {
  for (const [entra, sale] of [['3v3', '3,3 V'], ['3.3V', '3,3 V'], ['5v', '5 V'], ['20ma', '20 mA'], ['3.3-5V', '3,3–5 V'], ['220 ohm', '220 Ω']])
    assert.equal(magnitudes(entra), sale, entra);
});

test('magnitudes: lo que no reconoce lo deja como está', () => {
  assert.equal(magnitudes('3,3 a 5 V'), '3,3 a 5 V');
  assert.equal(magnitudes('10k'), '10k');
});

test('interfaces: nombre estándar y el detalle entre paréntesis intacto', () => {
  for (const [entra, sale] of [['i2c (0x3c)', 'I2C (0x3c)'], ['spi', 'SPI'], ['uart', 'UART'], ['wifi', 'Wi-Fi'], ['Bluetooth LE', 'Bluetooth LE']])
    assert.equal(interfaz(entra), sale, entra);
});

test('nombres de datos: abreviados y con acentos', () => {
  assert.equal(claveDato('corriente máxima'), 'Corriente máx.');
  assert.equal(claveDato('Corriente maxima'), 'Corriente máx.');
});

test('pines: uno por fila, repartiendo el uso', () => {
  assert.deepEqual(separarPines([['GPIO 16 · 17', 'SPI: MOSI · MISO', 'bus', '']]),
    [['GPIO 16', 'SPI MOSI', 'bus', ''], ['GPIO 17', 'SPI MISO', 'bus', '']]);
  assert.deepEqual(separarPines([['SDA, SCL', 'I2C', 'bus', '']]), [['SDA', 'I2C', 'bus', ''], ['SCL', 'I2C', 'bus', '']]);
  assert.deepEqual(separarPines([['GPIO 32–34', 'ADC', 'ana', '']]).map((p) => p[0]), ['GPIO 32', 'GPIO 33', 'GPIO 34']);
});

test('pines: lo que va entre paréntesis es aclaración, no otro pin', () => {
  assert.deepEqual(separarPines([['COM (3 y 8)', 'común', 'gnd', '']]), [['COM (3 y 8)', 'común', 'gnd', '']]);
});

test('pines: un pin repetido queda en una fila y manda «no usar»', () => {
  assert.deepEqual(separarPines([['GPIO4', 'datos', 'dig', ''], ['GPIO4', 'no usar', 'no', '']]), [['GPIO4', 'no usar', 'no', 'También: datos']]);
});

test('pines: la serigrafía («3V3») no es un grupo', () => {
  assert.equal(pinAgrupado('3V3'), false);
  assert.equal(pinAgrupado('GPIO 16 · 17'), true);
});

test('un cambio que solo es de formato no cuenta como cambio', () => {
  assert.equal(mismoValor('voltaje', '3.3V', '3,3 V'), true);
  assert.equal(mismasInterfaces(['i2c'], ['I2C']), true);
});

test('reordenar: los nombrados en su orden, en los huecos que ocupaban; los demás, quietos', () => {
  const pines = [['A', 'x', 'dig', ''], ['B', 'y', 'dig', ''], ['C', 'z', 'dig', '']];
  assert.deepEqual(reordenar(pines, ['C', 'A']).map((p) => p[0]), ['C', 'B', 'A']);
});
