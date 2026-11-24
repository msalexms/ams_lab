// Recreaciones SVG de cada tipo de componente (sin imágenes de terceros): npm run dibujos → public/img/tipos/<tipo>.svg
// Todas en un lienzo de 200×140, vistas desde arriba, con los rasgos que sirven para reconocer la pieza.
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const OUT = fileURLToPath(new URL('../public/img/tipos/', import.meta.url));
const C = {
  blue: '#1f56b0', red: '#b8232b', black: '#262626', green: '#1f7a45', purple: '#7c2f91',
  gold: '#d6b04a', silver: '#c9ccd1', white: '#f2f2f2', txt: '#ffffff', dark: '#0d0d0d', led: '#ff3b3b',
};

// ---------- piezas básicas ----------
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 140" font-family="ui-monospace,Consolas,monospace">${inner}</svg>`;
const rect = (x, y, w, h, fill, r = 3, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${extra}/>`;
const circ = (cx, cy, r, fill, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
const line = (x1, y1, x2, y2, stroke, w = 2, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" ${extra}/>`;
const txt = (x, y, s, size = 8, fill = C.txt, anchor = 'middle', extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="700" ${extra}>${s}</text>`;
const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;

function pcb(x, y, w, h, fill, holes = true) {
  let s = rect(x, y, w, h, fill, 5, 'stroke="#000" stroke-opacity=".35"');
  if (holes) for (const [hx, hy] of [[x + 7, y + 7], [x + w - 7, y + 7], [x + 7, y + h - 7], [x + w - 7, y + h - 7]])
    s += circ(hx, hy, 3.2, C.dark, `stroke="${C.gold}" stroke-width="1.5"`);
  return s;
}
// fila de pines con etiquetas; dir = lado hacia el que salen
function pins(x, y, labels, {dir = 'down', step = 12, size = 5.5, lab = true} = {}) {
  let s = '';
  labels.forEach((l, i) => {
    const horiz = dir === 'down' || dir === 'up';
    const px = horiz ? x + i * step : x, py = horiz ? y : y + i * step;
    const [dx, dy] = {down: [0, 9], up: [0, -9], left: [-9, 0], right: [9, 0]}[dir];
    s += line(px, py, px + dx, py + dy, C.gold, 2.2) + rect(px - 2.5, py - 2.5, 5, 5, C.dark, 1, `stroke="${C.gold}"`);
    if (lab && l) {
      const [tx, ty] = {down: [px, py - 5], up: [px, py + 10], left: [px + 6, py + 2], right: [px - 6, py + 2]}[dir];
      s += txt(tx, ty, l, size, C.txt, dir === 'left' ? 'start' : dir === 'right' ? 'end' : 'middle');
    }
  });
  return s;
}
const header = (x, y, n, step = 6, vertical = false) =>
  Array.from({length: n}, (_, i) => rect(vertical ? x : x + i * step, vertical ? y + i * step : y, 4, 4, C.gold, 1)).join('');
function chip(x, y, w, h, label = '', legs = 4) {
  let s = rect(x, y, w, h, '#111', 1.5);
  for (let i = 0; i < legs; i++) {
    const ly = y + ((i + 0.5) * h) / legs - 1;
    s += rect(x - 3, ly, 3, 2, C.silver, 0) + rect(x + w, ly, 3, 2, C.silver, 0);
  }
  return s + (label ? txt(x + w / 2, y + h / 2 + 2.5, label, Math.min(7, (w / label.length) * 1.6), '#aaa') : '');
}
const usb = (x, y, w = 16, h = 10) => rect(x, y, w, h, C.silver, 2, 'stroke="#888"') + rect(x + 3, y + 3, w - 6, h - 6, '#555', 1);
const btn = (x, y) => rect(x, y, 10, 10, C.silver, 1.5) + circ(x + 5, y + 5, 3, '#222');
const name = () => ''; // sin rótulo: el nombre ya sale junto al dibujo, y en gris claro sobre el fondo teñido no se leía
function segDigit(x, y, s = 1, on = C.led, off = '#3a1212') {
  // dígito de 7 segmentos mostrando «8»
  const w = 14 * s, h = 24 * s, t = 3 * s;
  const seg = (sx, sy, sw, sh) => rect(x + sx, y + sy, sw, sh, on, t / 2);
  return seg(t, 0, w - 2 * t, t) + seg(0, t, t, h / 2 - 1.5 * t) + seg(w - t, t, t, h / 2 - 1.5 * t) +
    seg(t, h / 2 - t / 2, w - 2 * t, t) + seg(0, h / 2 + t / 2, t, h / 2 - 1.5 * t) + seg(w - t, h / 2 + t / 2, t, h / 2 - 1.5 * t) +
    seg(t, h - t, w - 2 * t, t) + circ(x + w + 2.5 * s, y + h - t / 2, t / 2, off);
}
const wires = (x, y, colors, len = 40, gap = 4) => colors.map((c, i) => line(x, y + i * gap, x + len, y + i * gap, c, 2.6)).join('');
function espModule(x, y, w, h, label) {
  return rect(x, y, w, h * 0.22, '#222', 1) + path(`M${x + 4} ${y + 4} h${w - 8} v${h * 0.12} h-${w - 8}`, 'none', `stroke="${C.gold}" stroke-width="1.5"`) +
    rect(x, y + h * 0.22, w, h * 0.78, C.silver, 2) + txt(x + w / 2, y + h * 0.55, 'ESPRESSIF', 6.5, '#555') + txt(x + w / 2, y + h * 0.72, label, 6, '#555');
}

// ---------- dibujos por tipo ----------
const D = {
  'esp32-wrover-freenove': () => svg(pcb(25, 18, 150, 96, C.black) + espModule(35, 28, 62, 66, 'ESP32-WROVER') +
    rect(108, 40, 34, 22, '#e8dcc0', 2) + rect(111, 43, 28, 6, '#333', 1) + txt(125, 72, 'CAM', 6, '#bbb') +
    usb(150, 86, 14, 10) + btn(108, 86) + btn(126, 86) + header(30, 20, 23, 6) + header(30, 108, 23, 6) +
    txt(135, 34, 'FREENOVE', 6, '#fff') + name('ESP32-WROVER (Freenove, cámara)')),
  'esp32-s3-devkit': () => svg(pcb(20, 30, 160, 76, C.black, false) + espModule(28, 38, 60, 60, 'ESP32-S3') +
    usb(160, 40, 18, 12) + usb(160, 82, 18, 12) + txt(150, 50, 'USB', 5.5, '#ccc', 'end') + txt(150, 92, 'UART', 5.5, '#ccc', 'end') +
    btn(118, 44) + btn(118, 80) + txt(123, 63, 'RST', 5, '#ccc') + txt(123, 99, 'BOOT', 5, '#ccc') +
    header(24, 31, 26, 6) + header(24, 101, 26, 6) + name('ESP32-S3 DevKit (2 USB)')),
  'esp32-wroom-devkit': () => svg(pcb(20, 32, 160, 72, C.black, false) + espModule(26, 40, 62, 56, 'WROOM-32') +
    usb(162, 62, 16, 12) + btn(130, 44) + btn(130, 82) + txt(135, 64, 'EN', 5, '#ccc') + chip(100, 58, 18, 18, '') +
    header(24, 33, 26, 6) + header(24, 99, 26, 6) + name('ESP32-WROOM-32 DevKit (38 pines)')),
  'freenove-gpio-extension': () => svg(path('M20 20 h60 v30 h100 v40 h-100 v30 h-60 z', C.black, 'stroke="#000"') +
    rect(26, 26, 48, 88, '#2a2a2a', 3) + txt(50, 70, 'ESP32', 7, '#888') + header(84, 56, 15, 6) + header(84, 80, 15, 6) +
    rect(150, 24, 26, 18, '#222', 2) + txt(163, 36, '5V', 6, '#fff') + rect(150, 98, 26, 18, '#222', 2) + txt(163, 110, '3V3', 6, '#fff') +
    txt(130, 72, 'GPIO Extension', 6.5, '#fff') + name('Extensión GPIO Freenove')),
  'esp32-expansion-board': () => svg(pcb(25, 15, 150, 108, C.purple) + rect(32, 22, 22, 20, '#111', 2) + txt(43, 50, 'DC', 6) +
    usb(70, 22) + usb(100, 22) + rect(140, 24, 8, 12, '#e3d34a', 1) + txt(144, 45, '3V3/5V', 5) +
    Array.from({length: 9}, (_, i) => rect(40, 56 + i * 7, 5, 5, '#e8d63a', 1) + rect(47, 56 + i * 7, 5, 5, '#d6302e', 1) + rect(140, 56 + i * 7, 5, 5, '#e8d63a', 1) + rect(147, 56 + i * 7, 5, 5, '#d6302e', 1)).join('') +
    rect(62, 52, 72, 62, '#1b1b1b', 3) + txt(98, 86, 'ESP32', 7, '#777') + name('Placa de expansión ESP32')),
  'hc-sr04': () => svg(pcb(15, 25, 170, 80, C.blue, true) + [55, 145].map((x) => circ(x, 62, 30, C.silver) + circ(x, 62, 23, '#555') +
    circ(x, 62, 23, 'url(#m)')).join('') + rect(88, 82, 24, 10, C.silver, 5) + pins(82, 28, ['Vcc', 'Trig', 'Echo', 'Gnd'], {dir: 'up', step: 12}) +
    '<defs><pattern id="m" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill="#444"/><circle cx="1.5" cy="1.5" r=".8" fill="#888"/></pattern></defs>' +
    name('HC-SR04 · ultrasonidos', 130)),
  'vl53l0x': () => svg(pcb(55, 15, 90, 100, C.black) + rect(86, 48, 28, 16, '#111', 2, `stroke="${C.gold}"`) + circ(94, 56, 3, '#3a3') + circ(106, 56, 3, '#a33') +
    pins(140, 30, ['VIN', 'GND', 'SCL', 'SDA', 'GPIO1', 'XSHUT'], {dir: 'right', step: 13}) + txt(85, 88, 'VL53L0X', 8) + name('VL53L0X · distancia láser')),
  'hc-sr501': () => svg(pcb(35, 15, 130, 105, C.green) + circ(100, 66, 44, '#e9eef3') +
    Array.from({length: 6}, (_, i) => `<path d="M100 66 L${100 + 44 * Math.cos(i * Math.PI / 3)} ${66 + 44 * Math.sin(i * Math.PI / 3)}" stroke="#c8d0d8" stroke-width="1.2"/>`).join('') +
    circ(100, 66, 26, 'none', 'stroke="#c8d0d8" stroke-width="1.2"') + circ(100, 66, 10, 'none', 'stroke="#c8d0d8" stroke-width="1.2"') + name('HC-SR501 · movimiento PIR', 134)),
  'ens160-aht21': () => svg(pcb(50, 15, 110, 105, C.blue) + chip(95, 35, 20, 20, '') + rect(120, 75, 18, 18, '#222', 2, `stroke="${C.silver}"`) + txt(129, 101, 'AHT21', 5.5) +
    txt(105, 64, 'ENS160', 6) + pins(55, 22, ['VIN', '3V3', 'GND', 'SCL', 'SDA', 'ADD', 'CS', 'INT'], {dir: 'left', step: 12, size: 5}) + name('ENS160 + AHT21 · aire')),
  'sensor-agua': () => svg(path('M20 30 h130 l20 15 v50 l-20 15 h-130 z', C.red) + Array.from({length: 10}, (_, i) =>
    line(26, 38 + i * 7, 140, 38 + i * 7, i % 2 ? '#f0c8c8' : C.silver, 2.4)).join('') +
    pins(176, 58, ['S', '+', '−'], {dir: 'right', step: 10}) + name('Sensor de nivel de agua')),
  'ky-037': () => svg(pcb(20, 30, 160, 70, C.red, false) + circ(52, 65, 24, C.silver) + circ(52, 65, 20, '#222') + rect(92, 48, 22, 30, '#2a59c9', 2) +
    circ(97, 52, 2.5, C.gold) + chip(122, 52, 18, 22, '') + pins(176, 47, ['AO', 'G', '+', 'DO'], {dir: 'right', step: 11}) + name('KY-037 · sonido')),
  'inmp441': () => svg(circ(100, 68, 52, C.silver) + circ(100, 68, 46, '#b9bcc2') + rect(90, 58, 20, 20, C.white, 2) +
    ['SCK', 'WS', 'L/R', 'SD', 'VDD', 'GND'].map((l, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 3; const x = 100 + 34 * Math.cos(a), y = 68 + 34 * Math.sin(a);
      return circ(x, y, 5, C.gold) + txt(x, y + (Math.sin(a) > 0 ? 14 : -8), l, 6, '#222'); }).join('') + name('INMP441 · micrófono I2S')),
  'mpu6050': () => svg(pcb(40, 15, 120, 100, C.blue) + rect(85, 45, 30, 30, '#111', 2) + circ(90, 50, 1.5, '#666') + txt(100, 90, 'GY-521', 7) +
    pins(51, 122, ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'], {dir: 'down', step: 14, size: 5}) + name('MPU6050 · acelerómetro', 138)),
  'hmc5883l': () => svg(pcb(45, 15, 110, 95, C.blue) + rect(88, 40, 24, 24, '#111', 2) + txt(100, 80, 'HMC5883L', 7) +
    line(150, 30, 150, 60, '#fff', 1.5, 'marker-end="url(#a)"') + txt(150, 26, 'Y', 6) +
    '<defs><marker id="a" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0 0L6 3L0 6z" fill="#fff"/></marker></defs>' +
    pins(64, 117, ['VCC', 'GND', 'SCL', 'SDA', 'DRDY'], {dir: 'down', step: 18}) + name('HMC5883L · brújula', 138)),
  'gps-neo6m': () => svg(pcb(15, 25, 100, 90, C.blue) + rect(35, 45, 60, 50, C.silver, 3) + txt(65, 70, 'u-blox', 7, '#444') + txt(65, 82, 'NEO-6M', 7, '#444') +
    rect(130, 35, 60, 60, '#d9c8a0', 4) + rect(145, 50, 30, 30, '#b9a576', 2) + circ(160, 65, 4, C.silver) + line(115, 70, 130, 70, '#333', 2) +
    pins(30, 118, ['VCC', 'RX', 'TX', 'GND'], {dir: 'down', step: 20}) + name('GPS NEO-6M + antena', 138)),
  'joystick': () => svg(pcb(40, 10, 120, 110, C.black) + rect(60, 25, 80, 80, '#222', 6) + circ(100, 65, 32, '#333') + circ(100, 65, 22, '#111') +
    Array.from({length: 5}, (_, i) => circ(100, 65, 6 + i * 3.5, 'none', 'stroke="#333" stroke-width="1"')).join('') +
    pins(155, 35, ['GND', '+5V', 'VRx', 'VRy', 'SW'], {dir: 'right', step: 14}) + name('Joystick analógico')),
  'potenciometro-b10k': () => svg(rect(55, 30, 90, 70, '#2f6fd0', 6) + circ(100, 65, 30, C.silver) + circ(100, 65, 14, '#888') + rect(97, 51, 6, 28, '#666', 1) +
    txt(100, 24, 'B10K', 8, '#2f6fd0') + [80, 100, 120].map((x) => line(x, 100, x, 125, C.silver, 3)).join('') + name('Potenciómetro B10K', 138)),
  'pn532': () => svg(pcb(20, 10, 160, 115, C.red) + Array.from({length: 4}, (_, i) => rect(30 + i * 5, 18 + i * 5, 95 - i * 10, 95 - i * 10, 'none', 3, `stroke="${C.gold}" stroke-width="2"`)).join('') +
    chip(140, 45, 26, 26, 'PN532') + pins(140, 100, ['GND', 'VCC', 'SDA', 'SCL'], {dir: 'down', step: 9, size: 4.5}) + name('PN532 · NFC/RFID', 136)),
  'rf433-rx': () => svg(pcb(30, 40, 120, 50, C.green, false) + chip(90, 52, 20, 18, '') + rect(60, 50, 18, 10, C.silver, 4) +
    path('M150 60 q6 -6 12 0 t12 0 t12 0', 'none', `stroke="${C.gold}" stroke-width="2.5"`) + pins(40, 93, ['VCC', 'DATA', 'GND'], {dir: 'down', step: 14}) + name('SRX882S · receptor 433 MHz', 130)),
  'rf433-tx': () => svg(pcb(50, 40, 90, 50, C.green, false) + chip(70, 52, 16, 16, '') + rect(95, 52, 16, 9, C.silver, 4) +
    path('M140 60 q6 -6 12 0 t12 0 t12 0', 'none', `stroke="${C.gold}" stroke-width="2.5"`) + pins(62, 93, ['GND', 'DATA', 'VCC'], {dir: 'down', step: 14}) + name('STX882 · emisor 433 MHz', 130)),
  'infrarrojo': () => svg(rect(40, 35, 40, 45, '#222', 4) + circ(60, 50, 12, '#111', 'stroke="#444"') + [50, 60, 70].map((x) => line(x, 80, x, 110, C.silver, 2.5)).join('') +
    txt(60, 122, 'receptor', 7, '#e6e6e6') + path('M130 40 a14 14 0 0 1 28 0 v35 h-28 z', '#3b3046') + rect(126, 75, 36, 5, '#3b3046', 1) +
    line(138, 80, 138, 115, C.silver, 2.5) + line(150, 80, 150, 108, C.silver, 2.5) + txt(144, 122, 'LED IR', 7, '#e6e6e6') + name('Infrarrojos', 138)),
  'tft-st7735': () => svg(pcb(25, 10, 150, 115, C.red) + rect(45, 30, 95, 75, '#0e2236', 2) + rect(50, 35, 85, 65, '#14324f', 1) + txt(92, 72, '128×160', 8, '#8fc7ff') +
    rect(145, 40, 22, 55, C.silver, 2) + txt(156, 104, 'SD', 6) + header(48, 16, 8, 9) + txt(100, 120, '1.8" TFT SPI', 6.5) + name('TFT 1,8" ST7735', 138)),
  'oled-ssd1306': () => svg(pcb(35, 10, 130, 115, C.blue) + rect(45, 35, 110, 65, '#050505', 2) + txt(100, 62, '128×64', 10, '#7fe3ff') + txt(100, 80, 'OLED', 8, '#7fe3ff') +
    pins(80, 22, ['GND', 'VCC', 'SCL', 'SDA'], {dir: 'up', step: 13}) + name('OLED 0,96" SSD1306', 136)),
  'tm1637-4dig': () => svg(pcb(15, 25, 155, 85, C.blue) + rect(30, 38, 125, 58, '#2c2c2c', 3) +
    [0, 1, 2, 3].map((i) => segDigit(40 + i * 29, 48, 1.4)).join('') + circ(98, 60, 2, C.led) + circ(98, 76, 2, C.led) +
    pins(178, 45, ['CLK', 'DIO', 'VCC', 'GND'], {dir: 'right', step: 13}) + name('4 dígitos TM1637', 130)),
  'matriz-8x8': () => svg(rect(50, 12, 100, 100, '#2c2c2c', 3, 'stroke="#555"') + Array.from({length: 64}, (_, i) =>
    circ(58 + (i % 8) * 12, 20 + Math.floor(i / 8) * 12, 4, (i * 7) % 5 ? '#4a1515' : C.led)).join('') + name('Matriz LED 8×8 (788BS)', 132)),
  'display-7seg-4dig': () => svg(rect(25, 30, 150, 70, '#2c2c2c', 3, 'stroke="#555"') + [0, 1, 2, 3].map((i) => segDigit(38 + i * 35, 44, 1.75)).join('') +
    name('7 segmentos · 4 dígitos', 125)),
  'display-7seg-1dig': () => svg(rect(70, 15, 60, 95, '#2c2c2c', 3, 'stroke="#555"') + segDigit(80, 28, 2.6) +
    Array.from({length: 5}, (_, i) => line(80 + i * 10, 110, 80 + i * 10, 122, C.silver, 2)).join('') + name('7 segmentos · 1 dígito', 136)),
  'barra-led-10': () => svg(rect(30, 30, 140, 60, '#f0f0f0', 3) + Array.from({length: 10}, (_, i) => rect(38 + i * 13, 40, 8, 40, i < 6 ? C.led : '#5a1d1d', 1)).join('') +
    Array.from({length: 10}, (_, i) => line(42 + i * 13, 90, 42 + i * 13, 105, C.silver, 1.6)).join('') + name('Barra de 10 LED', 125)),
  'led-ws2812-8': () => svg(path('M60 15 h80 l30 30 v40 l-30 30 h-80 l-30 -30 v-40 z', C.black) + Array.from({length: 8}, (_, i) => {
    const a = (i * Math.PI) / 4, x = 100 + 40 * Math.cos(a), y = 65 + 36 * Math.sin(a);
    return rect(x - 8, y - 8, 16, 16, C.white, 2) + circ(x, y, 4, ['#f33', '#3f3', '#39f', '#ff3', '#f3f', '#3ff', '#f93', '#fff'][i]); }).join('') +
    txt(100, 69, 'RGB×8', 7) + name('8 LED RGB (WS2812)', 135)),
  'buzzer-activo': () => svg(circ(100, 60, 38, '#2c2c2c', 'stroke="#5a5a5a" stroke-width="2"') + circ(100, 60, 6, '#000') + rect(80, 30, 40, 14, '#eee', 2) + txt(100, 40, 'REMOVE', 6, '#333') + txt(70, 64, '+', 12) +
    line(88, 98, 88, 122, C.silver, 2.5) + line(112, 98, 112, 116, C.silver, 2.5) + name('Zumbador activo', 136)),
  'buzzer-pasivo': () => svg(circ(100, 60, 38, '#2c2c2c', 'stroke="#5a5a5a" stroke-width="2"') + circ(100, 60, 6, '#000') + path('M70 88 a38 38 0 0 0 60 0 z', C.green) +
    line(88, 98, 88, 122, C.silver, 2.5) + line(112, 98, 112, 122, C.silver, 2.5) + txt(100, 30, 'Hz ~', 8, '#aaa') + name('Zumbador pasivo', 136)),
  'altavoz': () => svg(circ(90, 65, 50, '#1e1e1e', `stroke="#333" stroke-width="4"`) + circ(90, 65, 34, '#2a2a2a') + circ(90, 65, 14, '#111') +
    Array.from({length: 12}, (_, i) => line(90 + 16 * Math.cos(i * 0.52), 65 + 16 * Math.sin(i * 0.52), 90 + 33 * Math.cos(i * 0.52), 65 + 33 * Math.sin(i * 0.52), '#333', 1)).join('') +
    path('M138 55 C160 50 170 40 190 38', 'none', 'stroke="#d33" stroke-width="2.5"') + path('M138 75 C160 80 170 90 190 92', 'none', 'stroke="#222" stroke-width="2.5"') + name('Altavoz', 136)),
  'motor-dc': () => svg(rect(40, 35, 100, 60, C.silver, 12) + rect(40, 35, 20, 60, '#e8c94a', 6) + rect(140, 58, 30, 6, '#999', 2) +
    rect(46, 30, 6, 10, '#c7a43a', 1) + rect(46, 90, 6, 10, '#c7a43a', 1) + txt(100, 70, 'DC', 12, '#555') + name('Motor DC', 125)),
  'servo-sg90': () => svg(rect(40, 40, 120, 55, '#2f74d0', 4) + rect(25, 55, 150, 10, '#2f74d0', 2) + circ(70, 40, 16, '#2f74d0') + circ(70, 40, 6, C.white) +
    path('M58 32 h24 l-4 16 h-16 z', C.white, 'transform="rotate(-30 70 40)"') + txt(115, 72, 'SG90', 10) + wires(160, 80, ['#6b3d1f', '#d33', '#f90'], 30, 4) + name('Micro servo SG90', 125)),
  'stepper-28byj48': () => svg(circ(85, 70, 45, C.silver) + circ(85, 70, 38, '#b5b8bd') + rect(60, 20, 50, 18, C.silver, 3) + circ(85, 45, 8, '#2f74d0') + rect(83, 30, 4, 12, '#ddd', 1) +
    txt(85, 85, '28BYJ-48', 7, '#444') + wires(130, 60, ['#2f74d0', '#e5d22a', '#f80', '#ec5b9c', '#d33'], 40, 4) + rect(168, 56, 14, 22, C.white, 2) + name('Paso a paso 28BYJ-48', 132)),
  'uln2003': () => svg(pcb(30, 15, 140, 100, C.green) + chip(55, 40, 50, 22, 'ULN2003', 8) + Array.from({length: 4}, (_, i) => circ(130, 35 + i * 14, 4, C.led)).join('') +
    rect(55, 80, 60, 16, C.white, 2) + txt(85, 91, '5 hilos', 6, '#333') + pins(150, 105, ['−', '+'], {dir: 'down', step: 10}) + name('Driver ULN2003', 136)),
  'es7148-pam8403': () => svg(pcb(35, 15, 130, 105, C.black) + chip(65, 45, 30, 20, 'ES7148') + chip(110, 75, 26, 18, 'PAM8403') + rect(45, 22, 26, 20, '#111', 3, 'stroke="#555"') +
    circ(58, 32, 5, '#000') + txt(58, 52, 'jack', 5.5) + pins(150, 30, ['L+', 'L−', 'R+', 'R−'], {dir: 'right', step: 11, size: 5}) +
    pins(55, 113, ['VCC', 'GND', 'BCK', 'WS', 'DIN', 'MCK'], {dir: 'down', step: 15, size: 5}) + name('Audio ES7148 + PAM8403', 138)),
  'microsd': () => svg(pcb(45, 15, 110, 110, C.blue) + rect(62, 55, 76, 58, C.silver, 2) + rect(70, 63, 60, 42, '#aaa', 1) + chip(80, 25, 26, 18, '') +
    pins(57, 22, ['CS', 'SCK', 'MOSI', 'MISO', 'VCC', 'GND'], {dir: 'up', step: 17, size: 5}) + name('Módulo microSD', 138)),
  'jq-v360': () => svg(pcb(40, 20, 120, 90, C.blue) + circ(80, 60, 16, '#111') + circ(130, 80, 16, C.silver) + txt(100, 105, 'JQ-V360', 7) + txt(140, 50, '?', 22, '#ffb000') + name('JQ-V360 F100 (por identificar)', 132)),
  '10m-486': () => svg(pcb(40, 25, 120, 80, C.blue) + chip(80, 50, 30, 24, '') + txt(100, 98, '10M 486', 8) + txt(140, 60, '?', 22, '#ffb000') + name('«10M 486» (por identificar)', 130)),
  'led': () => svg([['#ff3b3b', 50], ['#3bff6a', 85], ['#3b8bff', 120], ['#ffd23f', 155]].map(([c, x]) =>
    path(`M${x - 11} 60 v-18 a11 11 0 0 1 22 0 v18 z`, c, 'opacity=".9"') + rect(x - 13, 58, 26, 5, c, 1) + line(x - 4, 63, x - 4, 112, C.silver, 2) + line(x + 4, 63, x + 4, 104, C.silver, 2)).join('') + name('LED de 5 mm', 132)),
  'resistencia': () => svg(line(15, 70, 185, 70, C.silver, 2.5) + rect(55, 55, 90, 30, '#d9c49a', 12) +
    ['#8b4513', '#111', '#e33', '#d4af37'].map((c, i) => rect(70 + i * 16 + (i === 3 ? 10 : 0), 55, 7, 30, c, 0)).join('') + name('Resistencias', 125)),
  'cable-dupont': () => svg(['#e33', '#111', '#f90', '#fd3', '#3c3', '#36f', '#a3f', '#eee'].map((c, i) =>
    line(40, 30 + i * 10, 160, 30 + i * 10, c, 3.2) + rect(22, 26 + i * 10, 18, 8, '#111', 1) + rect(160, 26 + i * 10, 18, 8, '#111', 1) + line(178, 30 + i * 10, 186, 30 + i * 10, C.gold, 1.6)).join('') + name('Cables dupont', 125)),
  'protoboard-830': () => svg(rect(10, 25, 180, 90, '#f2f2f2', 3) + line(16, 32, 184, 32, '#e33', 1.2) + line(16, 108, 184, 108, '#36f', 1.2) +
    Array.from({length: 30}, (_, i) => Array.from({length: 5}, (_, j) => rect(16 + i * 5.7, 42 + j * 5, 2.5, 2.5, '#777', 0) + rect(16 + i * 5.7, 76 + j * 5, 2.5, 2.5, '#777', 0)).join('')).join('') +
    rect(10, 68, 180, 4, '#ddd', 0) + name('Protoboard 830 puntos', 132)),
  'tornillo-allen': () => svg(rect(30, 45, 34, 40, '#b5b8bd', 6) + path('M40 57 l7 -5 l7 5 v10 l-7 5 l-7 -5 z', '#555') + rect(64, 57, 100, 16, '#c9ccd1', 1) +
    Array.from({length: 16}, (_, i) => line(68 + i * 6, 57, 64 + i * 6, 73, '#888', 1.2)).join('') + name('Tornillo Allen M2/M3', 115)),
  'tuerca': () => svg(path('M100 25 l35 20 v40 l-35 20 l-35 -20 v-40 z', '#b5b8bd') + circ(100, 65, 17, '#0a0a0a', 'stroke="#888" stroke-width="3"') + name('Tuerca M2/M3', 128)),
  'inserto-laton': () => svg(rect(70, 30, 60, 75, '#d4a94a', 6) + Array.from({length: 8}, (_, i) => line(72, 36 + i * 9, 128, 42 + i * 9, '#a87f2c', 2)).join('') +
    rect(88, 30, 24, 75, '#a87f2c', 2, 'opacity=".4"') + name('Inserto de latón', 125)),
  'camara-ov2640': () => svg(rect(70, 20, 60, 50, C.black, 4) + circ(100, 45, 20, '#333') + circ(100, 45, 13, '#111') + circ(96, 41, 4, '#3a5a8a') +
    rect(85, 70, 30, 45, '#d7a84a', 1) + Array.from({length: 8}, (_, i) => line(88 + i * 3.4, 75, 88 + i * 3.4, 112, '#a87f2c', 1)).join('') + name('Cámara OV2640', 132)),
  'pulsador-12x12': () => svg(rect(55, 25, 90, 90, '#2c2c2c', 4, 'stroke="#5a5a5a"') + circ(64, 34, 3, '#333') + circ(136, 34, 3, '#333') + circ(64, 106, 3, '#333') + circ(136, 106, 3, '#333') +
    circ(100, 70, 30, '#e33') + circ(100, 70, 24, '#f55') + name('Pulsador 12×12', 132)),
  'pulsador-6x6': () => svg(rect(70, 40, 60, 60, '#2c2c2c', 3, 'stroke="#5a5a5a"') + circ(100, 70, 15, '#333') + circ(100, 70, 10, '#222') +
    [[64, 48], [130, 48], [64, 92], [130, 92]].map(([x, y]) => line(x, y, x + (x < 100 ? -12 : 12), y, C.silver, 2.5)).join('') + name('Pulsador 6×6', 125)),
  'interruptor-deslizante': () => svg(rect(50, 50, 100, 34, C.silver, 2) + rect(60, 58, 80, 18, '#333', 1) + rect(70, 30, 16, 32, '#222', 2) +
    [75, 100, 125].map((x) => line(x, 84, x, 115, C.silver, 2.5)).join('') + name('Interruptor deslizante', 132)),
  'dip-switch': () => svg(rect(25, 40, 150, 55, '#1d4fd0', 3) + Array.from({length: 6}, (_, i) => rect(36 + i * 23, 48, 14, 32, '#0e2f86', 1) + rect(38 + i * 23, i % 2 ? 50 : 64, 10, 14, C.white, 1) +
    txt(43 + i * 23, 91, i + 1, 6)).join('') + txt(30, 36, 'ON', 7, '#e6e6e6', 'start') + name('DIP de 6 posiciones', 125)),
  // genérico: para los tipos sin dibujo propio (los que crea la IA o el usuario); un chip DIP sin rótulo
  '_pieza': () => svg(Array.from({length: 7}, (_, i) => line(62 + i * 12.7, 38, 62 + i * 12.7, 24, C.silver, 3) + line(62 + i * 12.7, 102, 62 + i * 12.7, 116, C.silver, 3)).join('') +
    rect(50, 36, 100, 68, '#2c2c2c', 4) + circ(62, 48, 4, '#1a1a1a')),
};

mkdirSync(OUT, {recursive: true});
for (const [k, f] of Object.entries(D)) writeFileSync(`${OUT}${k}.svg`, f() + '\n');
console.log(`✔ ${Object.keys(D).length} dibujos en public/img/tipos/`);
