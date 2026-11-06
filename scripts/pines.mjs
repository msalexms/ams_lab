// Pines resumidos de cada tipo: [pin, uso corto, función]. Funciones: vcc, gnd, bus, dig, ana, no, otro.
// npm run pines → los guarda en seed/glosario.json; después, npm run catalogo los pasa a la base de datos
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const P = {
  'esp32-wrover-freenove': [['3V3', 'Salida 3,3 V', 'vcc'], ['5V', 'Entrada 5 V', 'vcc'], ['GND', 'Masa', 'gnd'],
    ['GPIO 2 · 12–15', 'Libres con cámara', 'dig'], ['GPIO 32 · 33', 'Analógico (ADC1)', 'ana'],
    ['GPIO 4 · 5 · 18 · 19 · 21–23 · 25–27 · 34–36 · 39', 'Cámara', 'no'], ['GPIO 16 · 17', 'PSRAM, no usar', 'no'], ['GPIO 0', 'Botón BOOT', 'otro']],
  'esp32-s3-devkit': [['3V3', 'Salida 3,3 V', 'vcc'], ['5V', 'Entrada 5 V', 'vcc'], ['GND', 'Masa', 'gnd'],
    ['GPIO 8 · 9', 'I2C: SDA · SCL', 'bus'], ['GPIO 11 · 12 · 13 · 10', 'SPI: MOSI · SCK · MISO · CS', 'bus'],
    ['GPIO 43 · 44', 'UART: TX · RX', 'bus'], ['GPIO 1–10', 'Analógico (ADC1)', 'ana'], ['GPIO 19 · 20', 'USB nativo, no usar', 'no'], ['GPIO 0', 'Botón BOOT', 'otro']],
  'esp32-wroom-devkit': [['3V3', 'Salida 3,3 V', 'vcc'], ['VIN', 'Entrada 5 V', 'vcc'], ['GND', 'Masa', 'gnd'],
    ['GPIO 21 · 22', 'I2C: SDA · SCL', 'bus'], ['GPIO 23 · 19 · 18 · 5', 'SPI: MOSI · MISO · SCK · CS', 'bus'],
    ['GPIO 16 · 17', 'UART2: RX · TX', 'bus'], ['GPIO 32–39', 'Analógico (ADC1)', 'ana'], ['GPIO 25 · 26', 'Salida analógica (DAC)', 'ana'],
    ['GPIO 34–39', 'Solo entrada', 'otro'], ['GPIO 0 · 2 · 12 · 15', 'Arranque, con cuidado', 'otro'], ['GPIO 6–11', 'Flash, no usar', 'no']],
  'freenove-gpio-extension': [['Jack', 'Entrada 7–12 V', 'vcc'], ['5V', 'Salida 5 V', 'vcc'], ['3V3', 'Salida 3,3 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['Filas GPIO', 'Mismo pin del ESP32', 'dig']],
  'esp32-expansion-board': [['Jack DC', 'Entrada 6,5–16 V', 'vcc'], ['Fila roja', 'VCC 3,3 o 5 V (puente)', 'vcc'], ['Fila negra', 'Masa', 'gnd'], ['Fila amarilla', 'Señal (GPIO)', 'dig']],
  'hc-sr04': [['Vcc', '5 V', 'vcc'], ['Trig', 'Disparo (pulso 10 µs)', 'dig'], ['Echo', 'Eco, sale a 5 V: divisor', 'dig'], ['Gnd', 'Masa', 'gnd']],
  'vl53l0x': [['VIN', '3–5 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['SCL', 'I2C reloj', 'bus'], ['SDA', 'I2C datos', 'bus'], ['GPIO1', 'Interrupción', 'dig'], ['XSHUT', 'Apagar / cambiar dirección', 'dig']],
  'hc-sr501': [['VCC', '5–20 V', 'vcc'], ['OUT', 'HIGH al detectar (3,3 V)', 'dig'], ['GND', 'Masa', 'gnd']],
  'ens160-aht21': [['VIN', '5 V', 'vcc'], ['3V3', '3,3 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['SCL', 'I2C reloj', 'bus'], ['SDA', 'I2C datos', 'bus'],
    ['ADD', 'Dirección del ENS160', 'otro'], ['INT', 'Interrupción', 'dig'], ['CS', 'Solo modo SPI', 'no']],
  'sensor-agua': [['+', 'Alimentación (desde un GPIO)', 'vcc'], ['−', 'Masa', 'gnd'], ['S', 'Nivel (analógico)', 'ana']],
  'ky-037': [['+', '3,3–5 V', 'vcc'], ['G', 'Masa', 'gnd'], ['AO', 'Volumen (analógico)', 'ana'], ['DO', 'Supera el umbral', 'dig']],
  'inmp441': [['VDD', '3,3 V (no 5 V)', 'vcc'], ['GND', 'Masa', 'gnd'], ['SCK', 'I2S reloj (BCLK)', 'bus'], ['WS', 'I2S canal (LRCLK)', 'bus'], ['SD', 'I2S datos', 'bus'], ['L/R', 'GND = izquierdo', 'otro']],
  'mpu6050': [['VCC', '3,3–5 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['SCL', 'I2C reloj', 'bus'], ['SDA', 'I2C datos', 'bus'], ['INT', 'Interrupción', 'dig'], ['AD0', 'Dirección 0x68 / 0x69', 'otro'], ['XDA · XCL', 'Bus auxiliar', 'no']],
  'hmc5883l': [['VCC', '3,3–5 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['SCL', 'I2C reloj', 'bus'], ['SDA', 'I2C datos', 'bus'], ['DRDY', 'Dato listo', 'dig']],
  'gps-neo6m': [['VCC', '3,3–5 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['TX', 'Datos → RX del ESP32', 'bus'], ['RX', 'Config ← TX del ESP32', 'bus']],
  'pn532': [['VCC', '3,3–5 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['SDA', 'I2C datos', 'bus'], ['SCL', 'I2C reloj', 'bus'], ['Interruptores 1 · 2', 'Modo I2C / SPI / UART', 'otro']],
  'rf433-rx': [['VCC', '3,3–5 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['DATA', 'Datos recibidos', 'dig'], ['ANT', 'Antena de 17,3 cm', 'otro']],
  'rf433-tx': [['VCC', '1,2–5 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['DATA', 'Datos a emitir', 'dig'], ['ANT', 'Antena de 17,3 cm', 'otro']],
  'infrarrojo': [['Receptor VCC', '3,3–5 V', 'vcc'], ['Receptor GND', 'Masa', 'gnd'], ['Receptor OUT', 'Código recibido', 'dig'], ['LED pata larga', 'GPIO con 100 Ω', 'dig'], ['LED pata corta', 'Masa', 'gnd']],
  'tft-st7735': [['VCC', '3,3–5 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['LED', 'Luz de fondo (3,3 V)', 'vcc'], ['SCK', 'SPI reloj', 'bus'], ['SDA', 'SPI datos (MOSI)', 'bus'],
    ['CS', 'Selección pantalla', 'bus'], ['A0', 'Dato / comando (DC)', 'dig'], ['RESET', 'Reinicio', 'dig'], ['SD_CS', 'Selección tarjeta SD', 'bus'], ['SD_MOSI · MISO · SCK', 'SPI de la SD', 'bus']],
  'oled-ssd1306': [['VCC', '3,3–5 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['SCL', 'I2C reloj', 'bus'], ['SDA', 'I2C datos', 'bus']],
  'tm1637-4dig': [['VCC', '3,3–5 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['CLK', 'Reloj', 'dig'], ['DIO', 'Datos', 'dig']],
  'matriz-8x8': [['Filas (8)', 'Ánodos → GPIO', 'dig'], ['Columnas (8)', 'Cátodos, 220 Ω → GPIO', 'dig']],
  'display-7seg-4dig': [['D1–D4', 'Común de cada dígito (ánodo)', 'vcc'], ['a–g · dp', 'Segmentos, 220 Ω, LOW enciende', 'dig']],
  'display-7seg-1dig': [['COM (3 y 8)', 'Ánodo común → 3,3 / 5 V', 'vcc'], ['a–g · dp', 'Segmentos, 220 Ω, LOW enciende', 'dig']],
  'barra-led-10': [['Lado serigrafía (10)', 'Ánodos → GPIO con 220 Ω', 'dig'], ['Lado opuesto (10)', 'Cátodos → masa', 'gnd']],
  'led-ws2812-8': [['VCC', '5 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['DIN', 'Datos (con 330 Ω)', 'dig'], ['DOUT', 'Encadenar más LED', 'otro']],
  'buzzer-activo': [['+ (pata larga)', 'GPIO o transistor', 'dig'], ['−', 'Masa', 'gnd']],
  'buzzer-pasivo': [['+', 'PWM (tone)', 'dig'], ['−', 'Masa', 'gnd']],
  'altavoz': [['+ (rojo)', 'Salida + del amplificador', 'otro'], ['− (negro)', 'Salida − del amplificador', 'otro']],
  'motor-dc': [['Terminales A · B', 'Al driver, nunca a un GPIO', 'otro']],
  'servo-sg90': [['Rojo', '5 V', 'vcc'], ['Marrón', 'Masa', 'gnd'], ['Naranja', 'Señal PWM', 'dig']],
  'stepper-28byj48': [['Rojo', '+5 V común', 'vcc'], ['Conector de 5 hilos', 'Al driver ULN2003', 'otro']],
  'uln2003': [['+', '5–12 V del motor', 'vcc'], ['−', 'Masa', 'gnd'], ['IN1–IN4', 'Desde 4 GPIO', 'dig'], ['Conector blanco', 'Motor 28BYJ-48', 'otro']],
  'es7148-pam8403': [['VCC', '5 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['BCK', 'I2S reloj', 'bus'], ['WS', 'I2S canal', 'bus'], ['DIN', 'I2S datos', 'bus'], ['MCK', 'Reloj maestro (opcional)', 'bus'], ['L± · R±', 'Altavoces', 'otro']],
  'microsd': [['VCC', '5 V', 'vcc'], ['GND', 'Masa', 'gnd'], ['SCK', 'SPI reloj', 'bus'], ['MOSI', 'SPI datos →', 'bus'], ['MISO', 'SPI datos ←', 'bus'], ['CS', 'Selección', 'bus']],
  'led': [['Pata larga (+)', 'GPIO con 220–330 Ω', 'dig'], ['Pata corta (−)', 'Masa (lado plano)', 'gnd']],
  'protoboard-830': [['Línea roja (+)', 'Alimentación a lo largo', 'vcc'], ['Línea azul (−)', 'Masa a lo largo', 'gnd'], ['Columnas de 5', 'Unidas entre sí', 'otro']],
  'pulsador-12x12': [['Una pata', 'GPIO (INPUT_PULLUP)', 'dig'], ['Pata en diagonal', 'Masa', 'gnd']],
  'pulsador-6x6': [['Una pata', 'GPIO (INPUT_PULLUP)', 'dig'], ['Pata en diagonal', 'Masa', 'gnd']],
  'interruptor-deslizante': [['Central', 'Común → GPIO', 'dig'], ['Lateral', 'Masa', 'gnd'], ['Otro lateral', 'Libre / 2.ª opción', 'otro']],
  'dip-switch': [['Lado 1–6', 'GPIO (INPUT_PULLUP)', 'dig'], ['Lado opuesto', 'Masa', 'gnd']],
  'joystick': [['+5V', '3,3 V con ESP32', 'vcc'], ['GND', 'Masa', 'gnd'], ['VRx', 'Eje X', 'ana'], ['VRy', 'Eje Y', 'ana'], ['SW', 'Pulsador (PULLUP)', 'dig']],
  'potenciometro-b10k': [['Extremo 1', '3,3 V', 'vcc'], ['Centro', 'Pin analógico', 'ana'], ['Extremo 2', 'Masa', 'gnd']],
  'camara-ov2640': [['Cable plano', 'Conector de la placa', 'otro']],
};

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const seed = `${ROOT}seed/glosario.json`;
const g = JSON.parse(readFileSync(seed, 'utf8'));
for (const [k, pines] of Object.entries(P)) if (g[k]) g[k].pines = pines;
writeFileSync(seed, JSON.stringify(g, null, 2) + '\n');

console.log('✔ pines guardados en seed/glosario.json (aplícalos con: npm run catalogo)');
