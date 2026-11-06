// Actualiza en la base de datos la referencia (categorías, funciones de pin y colores, dificultades) y el catálogo
// (tipos con sus pines, proyectos) desde seed/*.json. No toca el inventario: npm run catalogo
import {fileURLToPath} from 'node:url';
import {abrir, sincronizarCatalogo} from '../server/db.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const db = abrir(process.env.AMS_LAB_DATA || `${ROOT}data`, `${ROOT}seed`);
const n = sincronizarCatalogo(db, `${ROOT}seed`);
console.log(`✔ catálogo actualizado: ${n.tipos} tipos, ${n.proyectos} proyectos` +
  (n.respetados ? ` · ${n.respetados} tipo(s) no se tocan (los cambió la IA o el usuario)` : ''));
