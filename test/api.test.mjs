// La API de verdad: arranca server/index.mjs con una base de datos nueva en una carpeta temporal y un puerto libre
// (la IA apunta a una dirección cerrada: ninguna prueba llama a un modelo)
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

let dir, srv, base;
const puertoLibre = () => new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => ok(port)); }); });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'circuitbin-'));
  const port = await puertoLibre();
  base = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, [fileURLToPath(new URL('../server/index.mjs', import.meta.url))], {
    env: {...process.env, CIRCUITBIN_DATA: dir, AMS_LAB_DATA: dir, PORT: String(port), IA_BASE: 'http://127.0.0.1:9', IA_CLAVE: '', IA_MODELO: ''},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  srv.stdout.on('data', (d) => (salida += d));
  srv.stderr.on('data', (d) => (salida += d));
  for (let i = 0; i < 100; i++) { // hasta 10 s
    try { if ((await fetch(`${base}/salud`)).ok) return; } catch {}
    if (srv.exitCode != null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`el servidor no arranca:\n${salida}`);
});
after(async () => {
  if (srv && srv.exitCode == null) { const fin = new Promise((r) => srv.once('exit', r)); srv.kill(); await fin; }
  rmSync(dir, {recursive: true, force: true, maxRetries: 5});
});

// petición: devuelve {status, body} (body = JSON si lo es)
async function pedir(metodo, ruta, cuerpo, cabeceras = {}) {
  const r = await fetch(base + ruta, {method: metodo, headers: {'content-type': 'application/json', ...cabeceras},
    body: cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)});
  const texto = await r.text();
  let body = texto;
  try { body = JSON.parse(texto); } catch {}
  return {status: r.status, body};
}
const ok = async (metodo, ruta, cuerpo, esperado = 200) => {
  const r = await pedir(metodo, ruta, cuerpo);
  assert.equal(r.status, esperado, `${metodo} ${ruta} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

test('salud, datos y la página con su import map', async () => {
  assert.equal((await pedir('GET', '/salud')).body, 'ok');
  const d = await ok('GET', '/api/datos');
  assert.ok(Array.isArray(d.componentes) && d.componentes.length > 0);
  assert.ok(Object.keys(d.tipos).length > 0);
  const html = (await pedir('GET', '/')).body;
  assert.match(html, /<script type="importmap">/);
  assert.match(html, /js\/app\.js\?v=[0-9a-f]{10}/);
  assert.equal((await fetch(`${base}/js/base.js`)).status, 200);
});

test('una pieza: alta, cantidad, edición, historial, borrar y deshacer', async () => {
  const c = await ok('POST', '/api/componentes', {nombre: 'Pieza de prueba', cantidad: 2, ubicacion: 'Caja de pruebas'}, 201);
  assert.equal(c.cantidad, 2);
  assert.equal((await ok('POST', `/api/componentes/${c.id}/ajuste`, {delta: 3})).cantidad, 5);
  assert.equal((await ok('POST', `/api/componentes/${c.id}/ajuste`, {delta: -9})).cantidad, 0, 'nunca baja de 0');
  assert.equal((await ok('PATCH', `/api/componentes/${c.id}`, {notas: 'apuntes', revisar: true})).notas, 'apuntes');

  const hist = await ok('GET', '/api/auditoria');
  const deEsta = (hist.filas || hist).filter((f) => f.objeto === 'pieza' && String(f.objeto_id ?? f.id_objeto ?? f.objetoId) === String(c.id));
  assert.ok(deEsta.length >= 3, `el historial apunta los cambios (${deEsta.length})`);

  const borrada = await ok('DELETE', `/api/componentes/${c.id}`);
  assert.ok(borrada.deshacer);
  assert.ok(!(await ok('GET', '/api/datos')).componentes.some((x) => x.id === c.id));
  const vuelta = await ok('POST', '/api/componentes/restaurar', {token: borrada.deshacer});
  assert.equal((await ok('GET', '/api/datos')).componentes.find((x) => x.id === vuelta.id)?.nombre, 'Pieza de prueba');
  assert.equal((await pedir('POST', '/api/componentes/restaurar', {token: borrada.deshacer})).status >= 400, true, 'un token solo vale una vez');
});

test('un proyecto: crear, estado, tareas y borrar', async () => {
  const p = await ok('POST', '/api/proyectos', {nombre: 'Proyecto de prueba'}, 201);
  assert.equal((await ok('PATCH', `/api/proyectos/${p.id}`, {estado: 'en_marcha'})).estado, 'en_marcha');
  const conTarea = await ok('POST', `/api/proyectos/${p.id}/tareas`, {texto: 'Soldar'}, 201);
  const tarea = conTarea.tareas.find((x) => x.texto === 'Soldar');
  assert.ok(tarea);
  assert.equal((await ok('PATCH', `/api/proyectos/${p.id}/tareas/${tarea.id}`, {columna: 'hecho'})).tareas.find((x) => x.id === tarea.id).columna, 'hecho');
  await ok('DELETE', `/api/proyectos/${p.id}`);
  assert.equal((await pedir('GET', `/api/proyectos/${p.id}`)).status, 404);
});

test('ajustes: solo valores válidos', async () => {
  assert.equal((await pedir('PUT', '/api/ajustes/tema', {valor: 'rosa'})).status, 400);
  assert.equal((await pedir('PUT', '/api/ajustes/inventado', {valor: 'x'})).status, 404);
  assert.deepEqual(await ok('PUT', '/api/ajustes/tema', {valor: 'noche'}), {clave: 'tema', valor: 'noche'});
});

test('errores: ruta desconocida, método que no toca, JSON roto, dirección rota y datos que faltan', async () => {
  assert.deepEqual(await pedir('GET', '/api/nada'), {status: 404, body: {error: 'Ruta no encontrada'}});
  const id = (await ok('GET', '/api/datos')).componentes[0].id;
  assert.equal((await pedir('GET', `/api/componentes/${id}`)).status, 404, 'GET de una pieza no es una ruta');
  assert.equal((await pedir('PUT', '/api/componentes', {nombre: 'x'})).status, 404);
  assert.equal((await pedir('POST', '/api/componentes', '{roto')).status, 400);
  assert.equal((await pedir('POST', '/api/componentes', {cantidad: 1})).status, 400, 'sin nombre');
  assert.equal((await pedir('POST', '/api/componentes', {nombre: 'x', tipo: 'no-existe'})).status, 400);
  assert.equal((await pedir('PATCH', '/api/componentes/999999', {notas: 'x'})).status, 404);
  assert.equal((await pedir('GET', '/api/%E0%A4%A')).status, 400);
  assert.equal((await pedir('GET', '/../server/index.mjs')).status === 200, false);
});

test('la IA sin clave avisa en vez de llamar a nadie', async () => {
  const r = await pedir('POST', '/api/ia/alta', {texto: 'un LED rojo'});
  assert.equal(r.status, 503, JSON.stringify(r.body)); // servicio no disponible: falta la clave
  assert.match(r.body.error, /clave/);
  assert.equal((await ok('GET', '/api/ia/config')).activa, false);
});
