// npm run tipos — revisa el JavaScript con el compilador de TypeScript (sin compilar nada), pero solo avisa de los
// fallos que son siempre un error: nombres que no existen (una variable mal escrita o que quedó en otro módulo),
// imports de algo que no se exporta, usar algo antes de declararlo, reasignar una constante o declarar dos veces.
// El tipado completo da cientos de avisos falsos (las filas de node:sqlite no tienen tipo): esos no se miran.
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
import {readdirSync} from 'node:fs';
import {join, relative} from 'node:path';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const ERRORES = new Map([
  [2304, 'nombre que no existe'], [2552, 'nombre que no existe'], [2662, 'nombre que no existe'], [2663, 'nombre que no existe'],
  [2305, 'import de algo que no se exporta'], [2614, 'import de algo que no se exporta'], [2724, 'import de algo que no se exporta'],
  [2307, 'módulo que no existe'],
  [2448, 'usado antes de declararlo'], [2449, 'usado antes de declararlo'], [2450, 'usado antes de declararlo'], [2454, 'usado antes de asignarlo'],
  [2588, 'se reasigna una constante'], [2632, 'se reasigna un import'], [2451, 'declarado dos veces'], [2300, 'declarado dos veces'],
]);
const ficheros = (dir, ext) => readdirSync(join(RAIZ, dir), {recursive: true}).filter((f) => f.endsWith(ext)).map((f) => join(RAIZ, dir, f));

// dos programas: el servidor (Node) y la web (navegador, con I18N global de public/i18n.js)
const grupos = [
  {nombre: 'servidor', archivos: [...ficheros('server', '.mjs'), ...ficheros('scripts', '.mjs'), ...ficheros('test', '.mjs')],
    opciones: {lib: ['lib.es2024.d.ts'], types: ['node']}},
  {nombre: 'web', archivos: [...ficheros('public/js', '.js'), join(RAIZ, 'scripts/web-globales.d.ts')],
    opciones: {lib: ['lib.es2024.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: []}},
];
let total = 0;
for (const g of grupos) {
  const programa = ts.createProgram(g.archivos, {
    allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true, strict: false,
    target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, ...g.opciones,
  });
  const fallos = ts.getPreEmitDiagnostics(programa).filter((d) => ERRORES.has(d.code) && d.file && !d.file.fileName.includes('node_modules'));
  for (const d of fallos) {
    const {line, character} = d.file.getLineAndCharacterOfPosition(d.start);
    console.log(`${relative(RAIZ, d.file.fileName)}:${line + 1}:${character + 1} ${ERRORES.get(d.code)}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  }
  console.log(`${g.nombre}: ${g.archivos.length} ficheros, ${fallos.length} fallos`);
  total += fallos.length;
}
process.exit(total ? 1 : 0);
