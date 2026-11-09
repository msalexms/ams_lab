// Exportar e importar copias completas (Ajustes → Datos).
//   · Exportar: un .tar.gz con lab.db (VACUUM INTO: completa aunque esté en modo WAL), las fotos y un manifiesto.
//   · Importar: se sube un .tar.gz exportado aquí o un .db suelto (por ejemplo una copia diaria). Se deja preparado en
//     <datos>/restaurar/<token>/ y se comprueba (cabecera SQLite, versión, tablas, integridad) ANTES de tocar nada; el
//     usuario ve el resumen y confirma. Al restaurar, server/index.mjs hace antes una copia del estado actual.
// Sin dependencias: tar (formato ustar) escrito y leído aquí, gzip con node:zlib.
import {createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync, openSync, readSync, closeSync,
  writeSync, rmSync, renameSync, copyFileSync, readFileSync, unlinkSync} from 'node:fs';
import {join, basename} from 'node:path';
import {randomBytes} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Readable, Transform} from 'node:stream';
import {createGzip, createGunzip} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {VERSION} from './db.mjs';

export class ErrorRespaldo extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fallo = (code, msg) => { throw new ErrorRespaldo(code, msg); };

const MAX_SUBIDA = 2 * 1024 ** 3;  // 2 GB comprimido
const MAX_TAR = 4 * 1024 ** 3;     // 4 GB descomprimido (contra ficheros «bomba»)
const FOTO_OK = /^[\w.-]{1,120}\.(jpe?g|png|webp)$/i; // nombres que pone la app (c12-170….jpg, c-ia3-….jpg)
const SQLITE = Buffer.from('SQLite format 3\0');
const sello = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const etapas = (dataDir) => join(dataDir, 'restaurar');

// ---------- tar (ustar) ----------
function cabecera(nombre, bytes, mtime) {
  const h = Buffer.alloc(512);
  const poner = (texto, desde, largo) => h.write(texto, desde, largo, 'utf8');
  const octal = (n, largo) => n.toString(8).padStart(largo - 1, '0') + '\0';
  poner(nombre, 0, 100);
  poner('0000644\0', 100, 8); poner('0000000\0', 108, 8); poner('0000000\0', 116, 8);
  poner(octal(bytes, 12), 124, 12);
  poner(octal(Math.floor(mtime / 1000), 12), 136, 12);
  poner('        ', 148, 8); // la suma se calcula con este campo en blanco
  poner('0', 156, 1);
  poner('ustar\0', 257, 6); poner('00', 263, 2);
  let suma = 0;
  for (const b of h) suma += b;
  poner(suma.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}
const relleno = (bytes) => Buffer.alloc((512 - (bytes % 512)) % 512);

async function* tar(entradas) {
  for (const e of entradas) {
    yield cabecera(e.nombre, e.bytes, e.mtime);
    if (e.contenido) yield e.contenido;
    else for await (const trozo of createReadStream(e.ruta)) yield trozo;
    yield relleno(e.bytes);
  }
  yield Buffer.alloc(1024); // dos bloques vacíos: fin del archivo
}

// lee un .tar y saca solo lo que esperamos (lab.db, manifiesto.json y fotos/<nombre>); el resto se ignora
function extraerTar(rutaTar, destino) {
  const fd = openSync(rutaTar, 'r');
  const h = Buffer.alloc(512);
  let pos = 0, fotos = 0, db = false, manifiesto = null;
  mkdirSync(join(destino, 'fotos'), {recursive: true});
  try {
    const total = statSync(rutaTar).size;
    while (pos + 512 <= total) {
      readSync(fd, h, 0, 512, pos);
      if (h.every((b) => b === 0)) break;
      const cadena = (desde, largo) => h.subarray(desde, desde + largo).toString('utf8').replace(/\0[\s\S]*$/, '');
      const prefijo = cadena(257, 6) === 'ustar' ? cadena(345, 155) : '';
      const nombre = (prefijo ? `${prefijo}/` : '') + cadena(0, 100);
      const bytes = parseInt(cadena(124, 12).trim() || '0', 8);
      const clase = String.fromCharCode(h[156] || 48);
      if (!Number.isFinite(bytes) || bytes < 0) fallo(400, 'El archivo está dañado (tamaño no válido)');
      const datos = pos + 512;
      pos = datos + Math.ceil(bytes / 512) * 512;
      if (pos > total + 512) fallo(400, 'El archivo está incompleto: ¿se cortó la descarga?');
      if (clase !== '0') continue; // carpetas, enlaces y demás: fuera
      const limpio = nombre.replace(/^\.\//, '');
      let salida = null;
      if (limpio === 'lab.db') { salida = join(destino, 'lab.db'); db = true; }
      else if (limpio === 'manifiesto.json' && bytes < 100_000) salida = join(destino, 'manifiesto.json');
      else if (limpio.startsWith('fotos/') && FOTO_OK.test(limpio.slice(6))) { salida = join(destino, 'fotos', basename(limpio)); fotos++; }
      if (!salida) continue;
      const out = openSync(salida, 'w');
      try {
        const trozo = Buffer.alloc(1024 * 1024);
        for (let hecho = 0; hecho < bytes;) {
          const n = readSync(fd, trozo, 0, Math.min(trozo.length, bytes - hecho), datos + hecho);
          if (!n) fallo(400, 'El archivo está incompleto: ¿se cortó la descarga?');
          writeSync(out, trozo, 0, n);
          hecho += n;
        }
      } finally { closeSync(out); }
      if (salida.endsWith('manifiesto.json')) { try { manifiesto = JSON.parse(readFileSync(salida, 'utf8')); } catch {} }
    }
  } finally { closeSync(fd); }
  if (!db) fallo(400, 'En el archivo no hay base de datos (lab.db): ¿es una copia de esta app?');
  return {fotos, manifiesto};
}

// cuenta bytes y corta si pasan del tope
const tope = (max, msg) => {
  let n = 0;
  return new Transform({transform(trozo, _, listo) { n += trozo.length; listo(n > max ? new ErrorRespaldo(413, msg) : null, trozo); }});
};

// ---------- comprobar una base de datos antes de restaurarla ----------
export function comprobarBase(ruta) {
  const cab = Buffer.alloc(16);
  const fd = openSync(ruta, 'r');
  try { readSync(fd, cab, 0, 16, 0); } finally { closeSync(fd); }
  if (!cab.equals(SQLITE)) fallo(400, 'No es una base de datos SQLite');
  let db;
  try { db = new DatabaseSync(ruta); } catch { fallo(400, 'No se puede abrir esa base de datos'); }
  try {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > VERSION) fallo(400, `Es de una versión más nueva de la app (modelo v${version}; esta es v${VERSION}): actualiza antes la app`);
    const hay = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    if (!hay.has('componentes') || !hay.has('tipos')) fallo(400, 'Esa base de datos no es de ams_lab (faltan las tablas de piezas y tipos)');
    const integridad = db.prepare('PRAGMA integrity_check').get();
    if (Object.values(integridad)[0] !== 'ok') fallo(400, 'La base de datos está dañada (falla la comprobación de integridad)');
    const n = (tabla) => (hay.has(tabla) ? db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n : 0);
    const fotos = db.prepare('SELECT COUNT(*) AS n FROM componentes WHERE foto IS NOT NULL').get().n;
    return {version: version || 1, piezas: n('componentes'), tipos: n('tipos'), proyectos: n('proyectos'), fotosUsadas: fotos};
  } finally { db.close(); }
}

// ---------- exportar ----------
export async function exportar(db, dataDir, res) {
  const tmp = join(dataDir, `.exportar-${process.pid}-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
  try {
    const dirFotos = join(dataDir, 'fotos');
    const fotos = (existsSync(dirFotos) ? readdirSync(dirFotos) : []).filter((f) => FOTO_OK.test(f) && !f.startsWith('papelera-'))
      .map((f) => ({f, st: statSync(join(dirFotos, f))})).filter((x) => x.st.isFile());
    const resumen = comprobarBase(tmp);
    const ahora = Date.now();
    const manifiesto = Buffer.from(JSON.stringify({app: 'ams-lab', formato: 1, exportado: new Date(ahora).toISOString(),
      modelo: resumen.version, piezas: resumen.piezas, tipos: resumen.tipos, proyectos: resumen.proyectos, fotos: fotos.length}, null, 2));
    const entradas = [
      {nombre: 'manifiesto.json', bytes: manifiesto.length, mtime: ahora, contenido: manifiesto},
      {nombre: 'lab.db', bytes: statSync(tmp).size, mtime: ahora, ruta: tmp},
      ...fotos.map(({f, st}) => ({nombre: `fotos/${f}`, bytes: st.size, mtime: st.mtimeMs, ruta: join(dirFotos, f)})),
    ];
    const fecha = new Date(ahora).toISOString().slice(0, 10);
    res.writeHead(200, {'content-type': 'application/gzip', 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="ams-lab-${fecha}.tar.gz"`});
    await pipeline(Readable.from(tar(entradas)), createGzip({level: 6}), res);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

// ---------- importar: preparar (sin tocar nada) ----------
const nuevaEtapa = (dataDir) => {
  limpiarEtapas(dataDir); // solo una restauración preparada a la vez
  const token = randomBytes(8).toString('hex');
  const dir = join(etapas(dataDir), token);
  mkdirSync(join(dir, 'fotos'), {recursive: true});
  return {token, dir};
};
const resumenEtapa = (token, dir, extra) => {
  const r = {token, ...comprobarBase(join(dir, 'lab.db')), ...extra};
  writeFileSyncJson(join(dir, 'etapa.json'), r);
  return r;
};
const writeFileSyncJson = (ruta, v) => { const fd = openSync(ruta, 'w'); try { writeSync(fd, JSON.stringify(v)); } finally { closeSync(fd); } };

// desde un fichero subido (el cuerpo de la petición): .tar.gz exportado aquí o .db suelto
export async function prepararSubida(req, dataDir) {
  const {token, dir} = nuevaEtapa(dataDir);
  const subida = join(dir, 'subida');
  try {
    await pipeline(req, tope(MAX_SUBIDA, 'El archivo es demasiado grande (máx. 2 GB)'), createWriteStream(subida));
    const magia = Buffer.alloc(16);
    const fd = openSync(subida, 'r');
    try { readSync(fd, magia, 0, 16, 0); } finally { closeSync(fd); }
    if (magia[0] === 0x1f && magia[1] === 0x8b) {
      const rutaTar = join(dir, 'subida.tar');
      try {
        await pipeline(createReadStream(subida), createGunzip(), tope(MAX_TAR, 'El archivo descomprimido es demasiado grande'), createWriteStream(rutaTar));
      } catch (e) { if (e instanceof ErrorRespaldo) throw e; fallo(400, 'El .tar.gz está dañado o incompleto'); }
      unlinkSync(subida);
      const {fotos, manifiesto} = extraerTar(rutaTar, dir);
      unlinkSync(rutaTar);
      return resumenEtapa(token, dir, {origen: 'archivo', fotos, exportado: manifiesto?.exportado || null});
    }
    if (magia.equals(SQLITE)) {
      renameSync(subida, join(dir, 'lab.db'));
      return resumenEtapa(token, dir, {origen: 'base', fotos: 0, exportado: null});
    }
    fallo(400, 'Ese archivo no es una copia de ams_lab: sube el .tar.gz que exporta la app o un .db');
  } catch (e) {
    rmSync(dir, {recursive: true, force: true});
    throw e;
  }
}

// desde una de las copias del servidor (carpeta de copias diarias)
export function prepararCopia(dataDir, dirCopias, nombre) {
  if (!/^lab-[\w.-]+\.db$/.test(nombre) || !existsSync(join(dirCopias, nombre))) fallo(404, 'No existe esa copia');
  const {token, dir} = nuevaEtapa(dataDir);
  try {
    copyFileSync(join(dirCopias, nombre), join(dir, 'lab.db'));
    return resumenEtapa(token, dir, {origen: 'copia', copia: nombre, fotos: 0, exportado: statSync(join(dirCopias, nombre)).mtime.toISOString()});
  } catch (e) {
    rmSync(dir, {recursive: true, force: true});
    throw e;
  }
}

export function etapa(dataDir, token) {
  if (!/^[a-f0-9]{16}$/.test(String(token || ''))) fallo(400, 'Falta la restauración preparada');
  const dir = join(etapas(dataDir), token);
  if (!existsSync(join(dir, 'etapa.json'))) fallo(410, 'Esa restauración ya no está preparada: vuelve a subir el archivo');
  return {dir, resumen: JSON.parse(readFileSync(join(dir, 'etapa.json'), 'utf8'))};
}

export function limpiarEtapas(dataDir) {
  rmSync(etapas(dataDir), {recursive: true, force: true});
}

// las fotos de la copia que no están ya en la carpeta de fotos (nunca se borra ni se pisa ninguna)
export function moverFotos(dirEtapa, dirFotos) {
  const origen = join(dirEtapa, 'fotos');
  let n = 0;
  for (const f of existsSync(origen) ? readdirSync(origen) : []) {
    if (!FOTO_OK.test(f) || existsSync(join(dirFotos, f))) continue;
    renameSync(join(origen, f), join(dirFotos, f)); // misma carpeta de datos: renombrar es instantáneo
    n++;
  }
  return n;
}

export {sello};
