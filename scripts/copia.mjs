// Copia de seguridad ahora mismo (base de datos + fotos nuevas): npm run copia
// En Docker: docker compose exec circuitbin npm run copia
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {copiar, opcionesCopias} from '../server/copias.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DATA = process.env.CIRCUITBIN_DATA || process.env.AMS_LAB_DATA || join(ROOT, 'data');
const db = new DatabaseSync(join(DATA, 'lab.db'), {readOnly: true});
const op = opcionesCopias(DATA);
console.log(`✔ copia hecha: ${copiar(db, DATA, {...op, max: op.max || 14}, true)}`);
