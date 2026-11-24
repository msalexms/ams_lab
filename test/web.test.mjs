// La web en módulos (public/js/): que cada import exista en su módulo y que el service worker los guarde todos
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const DIR = new URL('../public/js/', import.meta.url);
const modulos = readdirSync(DIR).filter((f) => f.endsWith('.js'));
const fuente = Object.fromEntries(modulos.map((f) => [f, readFileSync(new URL(f, DIR), 'utf8')]));
const exportados = (src) => new Set([...src.matchAll(/^export (?:async )?(?:function\*?|const|let|class) ([\w$]+)/gm)].map((m) => m[1]));

test('cada nombre importado lo exporta su módulo', () => {
  for (const [f, src] of Object.entries(fuente))
    for (const [, nombres, de] of src.matchAll(/^import \{([^}]*)\} from '\.\/([\w-]+\.js)';$/gm)) {
      assert.ok(fuente[de], `${f} importa de ${de}, que no existe`);
      const hay = exportados(fuente[de]);
      for (const n of nombres.split(',').map((x) => x.trim()).filter(Boolean)) assert.ok(hay.has(n), `${f}: «${n}» no lo exporta ${de}`);
    }
});

test('app.js carga todos los módulos, base el primero', () => {
  const cargados = [...fuente['app.js'].matchAll(/^import '\.\/([\w-]+\.js)';$/gm)].map((m) => m[1]);
  assert.equal(cargados[0], 'base.js');
  assert.deepEqual(new Set(cargados), new Set(modulos.filter((f) => f !== 'app.js')));
});

test('el service worker guarda todos los módulos para usar la web sin conexión', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const lista = JSON.parse(sw.match(/const MODULOS = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
  assert.deepEqual(lista.map((m) => `${m}.js`).sort(), modulos.sort());
});
