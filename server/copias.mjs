// Copias de seguridad automáticas: una al día de la base de datos (VACUUM INTO, completa aunque esté en modo WAL)
// y de las fotos (solo las nuevas; nunca se borran de la copia, así una foto quitada por error se puede recuperar).
//   AMS_LAB_COPIAS=/ruta     → carpeta de las copias (por defecto <datos>/copias; mejor en otro disco)
//   AMS_LAB_COPIAS_MAX=14    → cuántas copias diarias de la base de datos se guardan (0 = no hacer copias)
//   npm run copia            → copia ahora mismo (por ejemplo antes de cambiar el esquema)
import {mkdirSync, readdirSync, copyFileSync, existsSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';

const PATRON = /^lab-\d{4}-\d{2}-\d{2}\.db$/; // las copias manuales con otro nombre (lab-antes-…) no se tocan nunca

export function opcionesCopias(dataDir) {
  const max = process.env.AMS_LAB_COPIAS_MAX;
  return {dir: process.env.AMS_LAB_COPIAS || join(dataDir, 'copias'), max: max === undefined || max === '' ? 14 : Math.max(0, Number(max) || 0)};
}

const hoy = () => {
  const d = new Date(); // hora local del servidor (TZ)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// hace la copia de hoy si aún no existe; devuelve la ruta de la copia o null si ya estaba
export function copiar(db, dataDir, {dir, max}, forzar = false) {
  mkdirSync(join(dir, 'fotos'), {recursive: true});
  let destino = join(dir, `lab-${hoy()}.db`);
  if (existsSync(destino)) {
    if (!forzar) return null;
    destino = join(dir, `lab-${hoy()}-${Date.now()}.db`); // copia manual extra del mismo día (no entra en la rotación)
  }
  db.exec(`VACUUM INTO '${destino.replaceAll("'", "''")}'`);

  const fotos = join(dataDir, 'fotos');
  let nuevas = 0;
  for (const f of existsSync(fotos) ? readdirSync(fotos) : [])
    if (!existsSync(join(dir, 'fotos', f))) { copyFileSync(join(fotos, f), join(dir, 'fotos', f)); nuevas++; }

  const viejas = readdirSync(dir).filter((f) => PATRON.test(f)).sort().slice(0, -max || undefined);
  if (max > 0) viejas.forEach((f) => unlinkSync(join(dir, f)));
  console.log(`[copias] ${destino} (+${nuevas} fotos)`);
  return destino;
}

// al arrancar y luego cada hora comprueba si falta la copia del día
export function programarCopias(db, dataDir) {
  const op = opcionesCopias(dataDir);
  if (!op.max) return console.log('[copias] desactivadas (AMS_LAB_COPIAS_MAX=0)');
  const intento = () => { try { copiar(db, dataDir, op); } catch (e) { console.error('[copias] error:', e.message); } };
  intento();
  setInterval(intento, 60 * 60 * 1000).unref();
}
