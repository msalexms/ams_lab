// Formato uniforme de las fichas: la app decide CÓMO se escribe; quien escribe (la IA o el usuario) decide QUÉ se dice.
//   · magnitudes(): «3v3», «3.3V», «3,3v» → «3,3 V»; «20ma» → «20 mA»; «10k ohm» → «10 kΩ»; «3,3-5 V» → «3,3–5 V».
//   · interfaz(): el nombre estándar delante («i2c», «IIC», «I²C» → «I2C») y el detalle, tal cual, entre paréntesis.
//   · claveDato(): nombre de un dato con mayúscula inicial y «máx.»/«mín.»; si ya existe uno igual, se escribe como ese.
// Nunca se tocan los nombres de pin (ahí «3V3» es lo que pone la serigrafía) ni los textos libres (resumen, «Ojo», notas).
// Lo usan: normalizar() de la IA (lo que propone el modelo), la comparación de «Corregir con IA» (un cambio que solo es
// de formato no es un cambio) y Ajustes → Uniformar formato (repasa lo que ya está guardado; el usuario marca qué aplicar).
// Funciones puras, sin base de datos: el vocabulario (lo que ya hay escrito) se les pasa.

const limpio = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mayuscula = (s) => (s && /^[a-zà-ÿ]/.test(s) ? s[0].toLocaleUpperCase('es') + s.slice(1) : s);

// unidades: cómo se escriben (clave en minúsculas → forma correcta). Los ohmios van aparte (k, M y m no son lo mismo).
const UNIDADES = {v: 'V', mv: 'mV', kv: 'kV', a: 'A', ma: 'mA', 'µa': 'µA', 'μa': 'µA', ua: 'µA', w: 'W', mw: 'mW',
  hz: 'Hz', khz: 'kHz', mhz: 'MHz', ghz: 'GHz', '°c': '°C', 'ºc': '°C', mm: 'mm', cm: 'cm', ms: 'ms', 'µs': 'µs', 'μs': 'µs', us: 'µs',
  'µf': 'µF', 'μf': 'µF', uf: 'µF', nf: 'nF', pf: 'pF', mah: 'mAh', dbm: 'dBm', db: 'dB', lux: 'lux', bps: 'bps', kbps: 'kbps', mbps: 'Mbps'};
const NUM = String.raw`\d+(?:[.,]\d+)?`;
const FIN = String.raw`(?![A-Za-zÀ-ÿ0-9°µμΩ])`; // la unidad acaba ahí (no es el principio de otra palabra)
const ALT = Object.keys(UNIDADES).sort((a, b) => b.length - a.length).map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const RE_UNIDAD = new RegExp(`(${NUM})( ?)(${ALT})${FIN}`, 'gi');
const RE_OHM = new RegExp(`(${NUM}) ?([kKmM]?) ?(?:Ω|Ω|ohm(?:ios|s)?)${FIN}`, 'g');
const RE_VNV = /(?<![A-Za-zÀ-ÿ0-9]|\bpin |\bpines )(\d)[vV](\d)(?![A-Za-zÀ-ÿ0-9])/g; // «3v3» como tensión (no «pin 3V3»)
const coma = (n) => n.replace('.', ',');

export function magnitudes(texto) {
  let s = limpio(texto);
  if (!s) return s;
  s = s.replace(RE_VNV, '$1,$2 V');
  s = s.replace(RE_OHM, (_, n, pref) => `${coma(n)} ${pref === 'K' ? 'k' : pref}Ω`);
  s = s.replace(RE_UNIDAD, (todo, n, espacio, u) => {
    // «a» suelta es una preposición («de 3 a 5 V»), y «m»/«s» no están: una letra en minúscula solo cuenta pegada al número
    if (u.length === 1 && u === u.toLowerCase() && (espacio || u === 'a')) return todo;
    return `${coma(n)} ${UNIDADES[u.toLowerCase()]}`;
  });
  // rangos: guion entre dos números cuando lo que sigue lleva unidad → raya («3,3-5 V» → «3,3–5 V»)
  s = s.replace(new RegExp(`(${NUM}) ?[-‐−] ?(?=${NUM} (?:${Object.values(UNIDADES).join('|')}|[kMm]?Ω)${FIN})`, 'g'), (_, n) => `${coma(n)}–`);
  // la misma unidad a los dos lados de un rango, una sola vez: «3,3 V - 5 V» → «3,3–5 V»
  s = s.replace(new RegExp(`(${NUM}) (${Object.values(UNIDADES).join('|')}|[kMm]?Ω) ?[-‐−–] ?(${NUM}) \\2${FIN}`, 'g'), '$1–$3 $2');
  return siglas(s);
}
// siglas que siempre se escriben igual, dentro de cualquier texto corto («i2c reloj» → «I2C reloj»)
const SIGLAS = {i2c: 'I2C', iic: 'I2C', spi: 'SPI', uart: 'UART', i2s: 'I2S', pwm: 'PWM', adc: 'ADC', dac: 'DAC', usb: 'USB', gpio: 'GPIO', nfc: 'NFC', rfid: 'RFID',
  wifi: 'Wi-Fi', 'wi-fi': 'Wi-Fi', led: 'LED', oled: 'OLED'};
const RE_SIGLAS = new RegExp(`(?<![A-Za-zÀ-ÿ0-9])(${Object.keys(SIGLAS).join('|')})(?![A-Za-zÀ-ÿ0-9])`, 'gi');
const siglas = (s) => s.replace(RE_SIGLAS, (x) => SIGLAS[x.toLowerCase()]);

// interfaces: nombre estándar. La clave es el nombre sin acentos, espacios, guiones ni superíndices
const INTERFACES = {i2c: 'I2C', iic: 'I2C', twi: 'I2C', spi: 'SPI', uart: 'UART', usart: 'UART', i2s: 'I2S', pwm: 'PWM', adc: 'ADC', dac: 'DAC',
  wifi: 'Wi-Fi', bluetooth: 'Bluetooth', ble: 'Bluetooth LE', bluetoothle: 'Bluetooth LE', bluetoothlowenergy: 'Bluetooth LE', usb: 'USB',
  onewire: '1-Wire', '1wire': '1-Wire', gpio: 'GPIO', can: 'CAN', canbus: 'CAN', rs485: 'RS-485', rs232: 'RS-232', lora: 'LoRa', nfc: 'NFC', rfid: 'RFID',
  jtag: 'JTAG', sdio: 'SDIO', hdmi: 'HDMI', ir: 'IR', infrarrojos: 'IR', espnow: 'ESP-NOW', zigbee: 'Zigbee'};
const claveInterfaz = (s) => sinAcentos(s).replace(/²/g, '2').replace(/[\s\-_.]/g, '');
// separa «I2C (0x3C, a veces 0x3D)» en nombre y detalle
const partes = (s) => { const i = s.indexOf('('); return i > 0 ? [s.slice(0, i).trim(), s.slice(i).trim()] : [s, '']; };
export function interfaz(texto) {
  const s = limpio(texto);
  if (!s) return s;
  const [nombre, detalle] = partes(s);
  // «SPI o UART», «I2C / SPI»: cada trozo por su cuenta
  const trozos = nombre.split(/( o | y |\s*\/\s*|\s*\+\s*)/).map((t, i) => (i % 2 ? t : INTERFACES[claveInterfaz(t)] || t));
  return [mayuscula(magnitudes(trozos.join(''))), magnitudes(detalle)].filter(Boolean).join(' ');
}
// el nombre de una interfaz sin su detalle (para el vocabulario que se le enseña al modelo)
export const nombreInterfaz = (texto) => partes(interfaz(texto))[0];

// nombres de datos («Corriente máx.»): para compararlos, sin acentos, sin puntos y con máximo/mínimo abreviados
const abreviar = (s) => s.replace(/\bm[áa]xim[oa]s?\b\.?/gi, 'máx.').replace(/\bm[íi]nim[oa]s?\b\.?/gi, 'mín.').replace(/\bm[áa]x\b(?!\.)/gi, 'máx.').replace(/\bm[íi]n\b(?!\.)/gi, 'mín.');
export const claveComparar = (k) => sinAcentos(abreviar(limpio(k))).replace(/[.:]/g, '').replace(/\s+/g, ' ').trim();
// vocab: Map de claveComparar → la forma ya escrita (se usa esa); sin vocabulario, solo las reglas
export function claveDato(texto, vocab = null) {
  const s = mayuscula(siglas(abreviar(limpio(texto).replace(/\s*:+$/, ''))).replace(/máx\./gi, 'máx.').replace(/mín\./gi, 'mín.'));
  return vocab?.get(claveComparar(s)) || s;
}
// de una lista de nombres ya escritos (con cuántas veces sale cada uno), el vocabulario: gana la forma más usada y,
// a igualdad, la que ya cumple las reglas
export function vocabulario(filas) {
  const mejor = new Map();
  for (const {clave, n} of filas) {
    const k = claveComparar(clave), peso = n + (claveDato(clave) === clave ? 0.5 : 0), ya = mejor.get(k);
    if (!ya || peso > ya.peso) mejor.set(k, {forma: claveDato(clave), peso});
  }
  return new Map([...mejor].map(([k, v]) => [k, v.forma]));
}

// ---------- pines: uno por fila ----------
// Una fila de la tabla de pines es UN pin: [pin, uso, función, nota]. Un nombre con varios («GPIO 16 · 17», «GPIO 32–39»,
// «SDA, SCL») no vale: no se puede buscar, ni validar, ni anotar nada de uno solo. separarPines() los separa; si un
// pin sale dos veces (porque estaba en dos grupos), se queda una fila y el otro uso pasa a su nota («También: …»).
const SEPARADORES = /(?:\s*[·,;]\s*|\s+y\s+)(?![^(]*\))/; // lo que va entre paréntesis es una aclaración, no otro pin: «COM (3 y 8)»
const RANGO = /^(\d+)\s*[–-]\s*(\d+)$|^([a-zA-Z])\s*[–-]\s*([a-zA-Z])$/;
// «GPIO 32–39», «D0-D2» (el prefijo puede repetirse tras el guion), «a–g»
const RANGO_CON_PREFIJO = /^(\D*?)\s?\d+\s*[–-]\s*(?:\1\s?)?\d+$/;
export const pinAgrupado = (nombre) => SEPARADORES.test(limpio(nombre)) || RANGO_CON_PREFIJO.test(limpio(nombre)) || /^[a-zA-Z]\s*[–-]\s*[a-zA-Z]$/.test(limpio(nombre));
// «GPIO 2 · 12–15» → ['GPIO 2', 'GPIO 12', …, 'GPIO 15']; «XDA · XCL» → ['XDA', 'XCL']; «a–g · dp» → ['a', …, 'g', 'dp']
function nombresDe(pin) {
  const s = limpio(pin);
  if (!pinAgrupado(s)) return [s];
  // prefijo común («GPIO », «D», «IO»): lo que va delante del primer número, si lo demás son números o rangos
  const m = s.match(/^([^\d·,;]*?)(\s*)(\d.*)$/);
  const pref = m ? m[1].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  // el prefijo puede repetirse en cada trozo y tras el guion de un rango («D0-D2», «IO4 y IO5»): se quita para leer los números
  const resto = m ? m[3].split(SEPARADORES).map((x) => (pref ? x.replace(new RegExp(`(^|[–-]\\s*)${pref}\\s*`, 'gi'), '$1') : x)) : null;
  const conPrefijo = !!m && resto.every((x) => /^\d+(\s*[–-]\s*\d+)?$/.test(x));
  const prefijo = conPrefijo ? m[1].trim() : '';
  const poner = (x) => (prefijo ? `${prefijo}${m[2]}${x}` : x);
  const out = [];
  for (const trozo of (conPrefijo ? resto : s.split(SEPARADORES)).map((x) => x.trim()).filter(Boolean)) {
    const r = trozo.match(RANGO);
    if (r && r[1] != null) { const a = Number(r[1]), b = Number(r[2]); if (b >= a && b - a < 64) { for (let i = a; i <= b; i++) out.push(poner(i)); continue; } }
    if (r && r[3]) { const a = r[3].charCodeAt(0), b = r[4].charCodeAt(0); if (b >= a && b - a < 26) { for (let i = a; i <= b; i++) out.push(String.fromCharCode(i)); continue; } }
    out.push(poner(trozo));
  }
  return out.length ? out : [s];
}
// el uso de cada pin de una fila agrupada: «SPI: MOSI · MISO · SCK · CS» con 4 pines → «SPI MOSI», «SPI MISO»…;
// «RX · TX» con 2 → «RX», «TX»; si no cuadra, el mismo uso para todos
function usosDe(uso, n) {
  const s = limpio(uso), m = s.match(/^([^:·]+):\s*(.+)$/);
  const partes = (m ? m[2] : s).split(/\s*·\s*/).filter(Boolean);
  if (n > 1 && partes.length === n) return partes.map((p) => (m ? `${m[1].trim()} ${p}` : p));
  return Array(n).fill(s);
}
export function separarPines(pines) {
  const filas = [];
  for (const [pin, uso, fn, nota] of pines || []) {
    const nombres = nombresDe(pin), usos = usosDe(uso, nombres.length);
    nombres.forEach((nombre, i) => filas.push([nombre, usos[i], fn, limpio(nota)]));
  }
  // repetidos: una sola fila. Manda «no usar» (por seguridad); si no, la primera. El otro uso, a la nota
  const porNombre = new Map(), out = [];
  for (const f of filas) {
    const k = f[0].toLowerCase(), ya = porNombre.get(k);
    if (!ya) { porNombre.set(k, f); out.push(f); continue; }
    const tambien = (x) => [x[1], x[3]].filter(Boolean).join(' · ');
    if (f[2] === 'no' && ya[2] !== 'no') { const antes = tambien(ya); ya[1] = f[1]; ya[2] = 'no'; ya[3] = [f[3], antes && `También: ${antes}`].filter(Boolean).join(' · '); }
    else if (f[1].toLowerCase() !== ya[1].toLowerCase() || f[3]) ya[3] = [ya[3], `También: ${tambien(f)}`].filter(Boolean).join(' · ');
  }
  return out.map((f) => [f[0], f[1], f[2], f[3].slice(0, 200)]);
}
export const pinesSeparados = (pines) => !(pines || []).some((p) => pinAgrupado(p[0]))
  && new Set((pines || []).map((p) => limpio(p[0]).toLowerCase())).size === (pines || []).length;

// ---------- una ficha entera ----------
// f: ficha en el formato de guardarTipo() ({voltaje, interfaz: [], pines: [[pin, uso, función]], datos: [[clave, valor]]}).
// Devuelve una copia con el formato uniforme. Los nombres de pin, el nombre, el resumen y el «Ojo» no se tocan.
export function fichaUniforme(f, vocab = null) {
  const out = {...f};
  if ('voltaje' in f) out.voltaje = mayuscula(magnitudes(f.voltaje));
  if (Array.isArray(f.interfaz)) out.interfaz = sinRepetir(f.interfaz.map(interfaz));
  if (Array.isArray(f.pines)) out.pines = f.pines.map(([pin, uso, fn, nota]) => [pin, magnitudes(uso), fn, magnitudes(nota)]);
  if (Array.isArray(f.datos)) out.datos = datosUniformes(f.datos, vocab);
  return out;
}
// datos [clave, valor]: clave con su forma de siempre y valor con las magnitudes bien escritas. Si al uniformar dos
// claves pasan a ser la misma, la segunda se queda como estaba (no se pierde ningún dato)
export function datosUniformes(datos, vocab = null) {
  const vistas = new Set((datos || []).map(([k]) => limpio(k).toLowerCase()));
  return (datos || []).map(([k, v]) => {
    const nueva = claveDato(k, vocab), igual = nueva.toLowerCase() === limpio(k).toLowerCase();
    const clave = igual || !vistas.has(nueva.toLowerCase()) ? nueva : limpio(k);
    vistas.add(clave.toLowerCase());
    return [clave, magnitudes(v)];
  });
}
const sinRepetir = (l) => l.filter((x, i) => x && l.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);

// ¿dos valores de un campo son el mismo una vez uniformados? (para no proponer cambios que solo son de formato)
const sinPunto = (s) => limpio(s).toLowerCase().replace(/[.\s]+$/, '');
export function mismoValor(campo, a, b) {
  if (campo === 'voltaje') return magnitudes(a).toLowerCase() === magnitudes(b).toLowerCase();
  if (campo === 'resumen' || campo === 'ojo') return sinPunto(a) === sinPunto(b); // mayúsculas y punto final: estilo
  return limpio(a) === limpio(b);
}
export const mismasInterfaces = (a, b) => {
  const k = (l) => sinRepetir((l || []).map(interfaz)).map((x) => x.toLowerCase()).sort().join('|');
  return k(a) === k(b);
};

// la guía que se le da al modelo (la misma en «Añadir con IA» y en «Corregir con IA»), con lo que ya hay escrito
export function guiaEstilo({interfaces = [], datos = [], datosPieza = []} = {}) {
  const lista = (l) => l.slice(0, 60).join(' · ');
  return `Formato (escribe siempre igual; la app corrige lo mecánico, pero no adivina lo demás):
- Magnitudes: número con coma decimal, un espacio y la unidad con sus mayúsculas: «3,3 V», «20 mA», «10 kΩ», «433 MHz», «-40 °C».
  Rangos con raya y la unidad una sola vez: «3,3–5 V». Nunca «3v3», «3.3V» ni «5v» (salvo en el nombre de un pin, que es lo serigrafiado).
- Tensión ("voltaje"): primero la cifra y después, si hace falta, la aclaración: «5 V (lleva regulador)», «3,3 V · lógica 3,3 V».
- Interfaces: el nombre estándar y, entre paréntesis, el detalle: «I2C (0x3C)», «UART (9600 baudios)», «1 pin digital», «1 pin analógico».
  ${interfaces.length ? `Ya se usan estas: ${lista(interfaces)}. Si la que necesitas está, escríbela igual; si no, añádela con el mismo estilo.` : ''}
- Nombres de datos: mayúscula inicial, sin dos puntos ni punto final, cortos: «Corriente máx.», «Dirección I2C», «Rango de medida».
  ${datos.length ? `Ya se usan estos en las fichas: ${lista(datos)}.` : ''}${datosPieza.length ? ` Y estos en las piezas: ${lista(datosPieza)}.` : ''}
  Si el dato que vas a poner ya tiene nombre en la lista, usa ese nombre exacto; si es nuevo, ponle uno con el mismo estilo.
- "uso" de un pin: 2–4 palabras, mayúscula inicial, sin punto final.
- Esto solo es la forma de escribir: puedes poner cualquier valor, interfaz o dato que haga falta aunque no esté en las listas.`;
}
