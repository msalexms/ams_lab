// IA: «Añadir con IA» — a partir de una foto y/o un texto, el modelo propone la pieza (y su ficha si el tipo es nuevo).
// Nada se guarda en el inventario sin que el usuario confirme la propuesta (tabla ia_tareas, docs/modelo-datos.md).
//
// Proveedor: OpenCode Go, llamado como indica su documentación para aplicaciones («These AI SDK packages are for
// applications calling Go directly»): AI SDK v7 con el paquete que el propio catálogo de Go asigna a cada modelo
// (GET https://opencode.ai/inference/go/v1/models → api.<tipo>.sdk.aisdk). Soportados: chat-completions
// (@ai-sdk/openai-compatible) y messages (@ai-sdk/anthropic).
//
// Guardarraíles:
//   1. solo se ofrecen modelos que el catálogo marca con imagen de entrada y salida estructurada;
//   2. salida estructurada con un esquema cerrado (zod): categorías, funciones de pin y tipos existentes son enums
//      sacados de la base de datos; si la respuesta no cumple el esquema, el SDK la rechaza y se reintenta una vez;
//   3. normalizar() recorta longitudes y limpia lo que llega (también lo que corrige el usuario antes de guardar);
//   4. la clave y el modelo se validan (formato, modelo en el catálogo y una llamada de prueba) antes de guardarse.
//
// Configuración: desde la web (tabla ia_config). Si no hay nada, variables de entorno IA_CLAVE / IA_MODELO.
//   IA_BASE  solo para pruebas: sustituye https://opencode.ai/inference/go (catálogo y llamadas) por un servidor simulado.
import {readFile} from 'node:fs/promises';
import {generateText, Output, NoObjectGeneratedError, NoOutputGeneratedError, APICallError} from 'ai';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {createAnthropic} from '@ai-sdk/anthropic';
import {z} from 'zod';

const GO = 'https://opencode.ai/inference/go';
const BASE = (process.env.IA_BASE || GO).replace(/\/$/, '');
const UA = 'ams-lab/1.0 (inventario de electronica; ai-sdk)'; // OpenCode pide que los clientes se identifiquen con su nombre
const MODELO_DEF = 'claude-haiku-5-5';
const ESPERA_MS = 150_000;
const APIS = ['chat-completions', 'messages'];
const CLAVE_OK = /^[\x21-\x7e]{16,300}$/; // imprimible, sin espacios (la tabla ia_config tiene la misma regla)

const txt = (v, max = 500) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
// [clave, valor] desde {clave: valor}, [[clave, valor]], [{dato, valor}] o ["clave: valor"]
// valores que no aportan nada («no aplica», «desconocido»…): se descartan
const VACIO = /^(no aplica|n\/?a|no procede|desconocid[oa]s?|sin datos|ninguno|ninguna|-+|—|\?+)(?=$|[\s(.,;:])/i;
export const paresDe = (v) => (Array.isArray(v) ? v : Object.entries(v || {}))
  .map((p) => (typeof p === 'string' ? p.split(/:\s*/, 2) : Array.isArray(p) ? p : [p?.dato ?? p?.clave, p?.valor]))
  .map(([k, val]) => [txt(k, 60), txt(val, 200)]).filter(([k, val]) => k && val && !VACIO.test(val)).slice(0, 30);

// ---------- configuración ----------
export function config(db) {
  const f = db.prepare('SELECT clave, modelo FROM ia_config WHERE id = 1').get() || {};
  return {
    clave: f.clave || process.env.IA_CLAVE || '',
    modelo: f.modelo || process.env.IA_MODELO || MODELO_DEF,
    origen: f.clave ? 'web' : process.env.IA_CLAVE ? 'entorno' : null,
  };
}
// lo que puede ver la web: nunca la clave entera
export function estado(db) {
  const c = config(db);
  return {activa: !!c.clave, modelo: c.modelo, clave: c.clave ? `…${c.clave.slice(-4)}` : null, origen_clave: c.origen};
}

// ---------- catálogo de modelos (público, sin clave) ----------
let cache = {t: 0, lista: null};
const rebase = (u) => String(u).replace(GO, BASE);
export async function modelos({forzar = false} = {}) {
  if (!forzar && cache.lista && Date.now() - cache.t < 3600_000) return cache.lista;
  let j;
  try {
    const r = await fetch(`${BASE}/v1/models`, {headers: {'user-agent': UA}, signal: AbortSignal.timeout(15_000)});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    j = await r.json();
  } catch (e) {
    if (cache.lista) return cache.lista; // sin red: la última lista buena
    throw new Error(`No se pudo leer el catálogo de modelos de OpenCode Go (${e.message})`);
  }
  const lista = arr(j.data).map((m) => {
    const api = APIS.find((k) => m.api?.[k]?.base_url);
    const vision = arr(m.modalities?.input).includes('image/jpeg');
    // fuera: los gratuitos (solo funcionan dentro de OpenCode) y los «contributor» (entrenan con lo que les mandas)
    if (!api || !vision || m.capabilities?.structured_output !== true || m.type !== 'chat' || /free|contributor/.test(m.id)) return null;
    return {id: m.id, nombre: m.name || m.id, descripcion: txt(m.description, 200), api, base_url: rebase(m.api[api].base_url),
      precio: {entrada: m.cost?.text?.input?.price ?? null, salida: m.cost?.text?.output?.price ?? null},
      // modelos que «piensan» antes de responder: el esfuerzo más bajo que admiten (el catálogo los da de menos a más)
      razona: m.capabilities?.reasoning?.supported === true, esfuerzo: arr(m.capabilities?.reasoning?.effort)[0] || null,
      max_salida: Number(m.limit?.output) || null};
  }).filter(Boolean).sort((a, b) => (a.precio.entrada ?? 99) - (b.precio.entrada ?? 99) || a.nombre.localeCompare(b.nombre));
  cache = {t: Date.now(), lista};
  return lista;
}

// el modelo del AI SDK con el paquete que indica el catálogo; fetch propio para que vayan nuestras cabeceras
// (el SDK pone su propio user-agent y OpenCode pide el del cliente, más un id de sesión estable)
function crearModelo(m, clave, sesion) {
  const fetchPropio = (url, init = {}) => {
    const h = new Headers(init.headers);
    h.set('user-agent', UA);
    h.set('x-opencode-session', sesion);
    if (m.api === 'messages') h.set('authorization', `Bearer ${clave}`); // además del x-api-key de Anthropic
    return fetch(url, {...init, headers: h});
  };
  if (m.api === 'chat-completions')
    return createOpenAICompatible({name: 'opencode-go', baseURL: m.base_url, apiKey: clave, supportsStructuredOutputs: true, fetch: fetchPropio})(m.id);
  return createAnthropic({baseURL: m.base_url, apiKey: clave, fetch: fetchPropio})(m.id);
}

// límite de respuesta y razonamiento de cada llamada. Los modelos que razonan gastan tokens pensando antes de escribir
// la ficha: con el límite justo, se quedaban sin sitio y devolvían una respuesta vacía («No output generated»). A esos se
// les pide el esfuerzo de razonamiento más bajo que admiten y se les da más margen.
function opcionesLlamada(m) {
  const tope = m.razona ? 24000 : 6000;
  const o = {maxOutputTokens: m.max_salida ? Math.min(tope, m.max_salida) : tope};
  if (m.razona && m.esfuerzo && m.api === 'chat-completions') o.providerOptions = {openaiCompatible: {reasoningEffort: m.esfuerzo}};
  return o;
}
// el modelo respondió pero sin contenido (se le acabó el sitio pensando, o cortó): se reintenta una vez
export class SinRespuesta extends Error {
  constructor(r) {
    super('sin respuesta');
    this.fin = r?.finishReason || r?.finalStep?.finishReason || '?';
    this.razonamiento = r?.usage?.reasoningTokens ?? r?.usage?.outputTokenDetails?.reasoningTokens ?? null;
    this.texto = r?.text || '';
  }
}
// lee la salida estructurada; si el modelo no dio ninguna, SinRespuesta (con el motivo, para el registro)
function salidaDe(r) {
  try { return r.output; } catch (e) { if (NoOutputGeneratedError.isInstance(e)) throw new SinRespuesta(r); throw e; }
}
const reintentable = (e) => NoObjectGeneratedError.isInstance(e) || e instanceof SinRespuesta || NoOutputGeneratedError.isInstance(e);
const anotarSinRespuesta = (m, e, intento) => console.warn(`[ia] ${m.id}: sin respuesta (intento ${intento}; fin: ${e.fin ?? '?'}; `
  + `razonamiento: ${e.razonamiento ?? '?'} tokens; texto: ${(e.texto || '').length} caracteres)`);

// errores en español y sin detalles internos
function explicar(e) {
  if (e?.lastError) e = e.lastError; // RetryError del SDK («Failed after N attempts»): interesa el último error real
  if (NoObjectGeneratedError.isInstance(e)) return 'El modelo no devolvió una ficha con el formato correcto (2 intentos). Prueba otra vez u otro modelo.';
  if (e instanceof SinRespuesta || NoOutputGeneratedError.isInstance(e)) return e.fin === 'length'
    ? 'El modelo se quedó sin espacio pensando y no llegó a escribir la respuesta (2 intentos). Prueba otra vez o elige otro modelo en Ajustes → IA.'
    : 'El modelo terminó sin dar ninguna respuesta (2 intentos). Prueba otra vez o elige otro modelo en Ajustes → IA.';
  if (APICallError.isInstance(e)) {
    if (e.statusCode === 401 || e.statusCode === 403) return 'OpenCode Go rechaza la clave (o no da acceso a ese modelo). Revísala en la configuración.';
    if (e.statusCode === 429) return 'Has llegado al límite de uso de OpenCode Go por ahora. Prueba más tarde.';
    if (e.statusCode === 400) return `OpenCode Go no acepta la petición para este modelo: ${txt(e.responseBody || e.message, 200)}`;
    return `OpenCode Go respondió ${e.statusCode ?? 'con un error'}: ${txt(e.message, 200)}`;
  }
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'El modelo ha tardado demasiado.';
  return txt(e?.message || String(e), 300);
}

// ---------- contexto, instrucciones y esquema ----------
function contexto(db) {
  return {
    categorias: db.prepare('SELECT id, nombre FROM categorias ORDER BY orden').all(),
    funciones: db.prepare('SELECT id, nombre FROM funciones_pin ORDER BY orden').all(),
    tipos: db.prepare(`SELECT t.id, t.nombre, t.categoria_id AS categoria, group_concat(a.alias, ' / ') AS alias
      FROM tipos t LEFT JOIN tipo_alias a ON a.tipo_id = t.id WHERE t.archivado = 0 GROUP BY t.id ORDER BY t.categoria_id, t.nombre`).all(),
  };
}

function instrucciones(ctx) {
  return `Eres el asistente de un almacén personal de componentes de electrónica (ESP32, sensores, módulos, pasivos, tornillería…).
El usuario te enseña UNA pieza (foto y/o texto). Identifícala y propón cómo darla de alta. Todo en español de España.

Reglas:
- Si la pieza encaja en un tipo de la lista, pon su id en "tipo_existente" y "tipo_nuevo" a null. Crea un tipo nuevo solo si ninguno encaja.
- "nombre": la pieza concreta como se ve (p. ej. «Módulo relé 1 canal 5 V (SRD-05VDC)»). El "nombre" del tipo nuevo es genérico («Relé de 5 V»).
- "datos" del tipo: lo que es igual en todas las piezas de ese tipo (corriente máxima, dirección I2C, rango de medida…).
  "datos_pieza": lo que cambia de una pieza a otra del mismo tipo (valor de una resistencia, longitud de un cable, color…).
  Solo datos útiles y conocidos: nada de «no aplica», «desconocido» ni notas sobre cómo la has identificado.
- Pines en el orden del conector si se ve; "pin" es el nombre serigrafiado (VCC, DATA, GND…); si solo hay números,
  «1 (VCC)». "uso" en 2–4 palabras. Piezas sin pines (tornillos, cables, herramientas): pines vacíos.
- "voltaje" corto («3,3–5 V», «5 V · señal a 3,3 V»). "cantidad": las unidades que se ven, o null.
- NO INVENTES. Si no estás seguro de un pinout, una tensión o un dato, déjalo vacío y pregúntalo en "dudas":
  un pinout o una tensión inventados pueden quemar una placa.
- "dudas": como mucho 5, escritas como PREGUNTAS cortas que el usuario pueda contestar mirando la pieza
  («¿Tiene 3 o 4 pines?», «¿Qué pone en la serigrafía?»). Nada de dudas que no cambien la ficha.
- Si el usuario ya ha revisado tu propuesta y te contesta, rehaz la propuesta COMPLETA: respeta lo que él ha
  corregido y lo que te ha respondido, y quita de "dudas" lo que ya esté resuelto.
- Textos cortos y llanos, sin emojis.

Funciones de pin: ${ctx.funciones.map((f) => `${f.id} = ${f.nombre}`).join(' · ')}
Categorías: ${ctx.categorias.map((c) => `${c.id} = ${c.nombre}`).join(' · ')}
Tipos que ya existen (id | nombre | categoría | alias):
${ctx.tipos.map((t) => `${t.id} | ${t.nombre} | ${t.categoria}${t.alias ? ` | ${t.alias}` : ''}`).join('\n')}`;
}

// esquema cerrado: lo que no esté en la base de datos no se puede devolver. Sin límites de longitud en el esquema
// (algunos proveedores los rechazan en modo estricto): las longitudes las corta normalizar().
function esquema(ctx) {
  const dato = z.object({dato: z.string(), valor: z.string()});
  return z.object({
    nombre: z.string().describe('Nombre concreto de la pieza'),
    tipo_existente: z.enum(ctx.tipos.map((t) => t.id)).nullable().describe('id de un tipo de la lista, o null'),
    tipo_nuevo: z.object({
      nombre: z.string(), categoria: z.enum(ctx.categorias.map((c) => c.id)), resumen: z.string(), voltaje: z.string(),
      interfaz: z.array(z.string()), alias: z.array(z.string()),
      pines: z.array(z.object({pin: z.string(), uso: z.string(), funcion: z.enum(ctx.funciones.map((f) => f.id))})),
      datos: z.array(dato), ojo: z.string().describe('Advertencia para no romper nada, o vacío'),
    }).nullable(),
    datos_pieza: z.array(dato),
    cantidad: z.number().nullable(),
    dudas: z.array(z.string()),
    confianza: z.enum(['alta', 'media', 'baja']),
  });
}

// ---------- validación (respuesta del modelo y propuesta corregida por el usuario pasan por aquí) ----------
export function normalizar(db, p) {
  if (!p || typeof p !== 'object') throw new Error('La propuesta no es un objeto');
  const cats = new Set(db.prepare('SELECT id FROM categorias').all().map((r) => r.id));
  const funcs = new Set(db.prepare('SELECT id FROM funciones_pin').all().map((r) => r.id));
  const dudas = arr(p.dudas).map((d) => txt(d, 300)).filter(Boolean).slice(0, 12);
  let existente = p.tipo_existente ? String(p.tipo_existente) : null;
  if (existente && !db.prepare('SELECT 1 FROM tipos WHERE id = ? AND archivado = 0').get(existente)) { // archivados: ocultos
    dudas.push(`El tipo «${existente}» no existe.`);
    existente = null;
  }
  let nuevo = null;
  if (!existente && p.tipo_nuevo && typeof p.tipo_nuevo === 'object' && txt(p.tipo_nuevo.nombre)) {
    const t = p.tipo_nuevo;
    let categoria = String(t.categoria || '');
    if (!cats.has(categoria)) { if (categoria) dudas.push(`Categoría «${categoria}» desconocida: puesta en «otro».`); categoria = 'otro'; }
    nuevo = {
      nombre: txt(t.nombre, 120), categoria, resumen: txt(t.resumen, 400), voltaje: txt(t.voltaje, 120),
      interfaz: arr(t.interfaz).map((i) => txt(i, 40)).filter(Boolean).slice(0, 12),
      alias: arr(t.alias).map((a) => txt(a, 80)).filter(Boolean).slice(0, 10),
      pines: arr(t.pines).map((x) => (Array.isArray(x) ? x : [x?.pin, x?.uso, x?.funcion]))
        .map(([pin, uso, fn]) => [txt(pin, 60), txt(uso, 60), funcs.has(String(fn)) ? String(fn) : 'otro']).filter(([pin]) => pin).slice(0, 60),
      datos: paresDe(t.datos), ojo: txt(t.ojo ?? t.advertencias, 400),
    };
  }
  const cant = Number(p.cantidad);
  return {
    nombre: txt(p.nombre, 200) || nuevo?.nombre || '', tipo_existente: existente, tipo_nuevo: nuevo,
    datos_pieza: paresDe(p.datos_pieza),
    cantidad: p.cantidad !== null && p.cantidad !== '' && Number.isFinite(cant) && cant >= 0 ? Math.min(99999, Math.round(cant)) : null,
    dudas, confianza: ['alta', 'media', 'baja'].includes(p.confianza) ? p.confianza : 'baja',
  };
}

// ---------- llamadas ----------
// el modelo de la tarea: el elegido para esa pieza en concreto (si lo hay) o el de la configuración
async function modeloElegido(db, idTarea = null) {
  const c = config(db);
  if (!c.clave) throw new Error('Falta la clave de OpenCode Go: ponla en Ajustes → IA.');
  const id = idTarea || c.modelo;
  const m = (await modelos()).find((x) => x.id === id);
  if (!m) throw new Error(`El modelo «${id}» no está en el catálogo de OpenCode Go con fotos y salida estructurada: elige otro en la configuración.`);
  return {m, clave: c.clave};
}
// para validar el modelo que pide la web para una pieza concreta
export const modeloValido = async (id) => (await modelos()).some((x) => x.id === id);
export const MODELO_RECOMENDADO = MODELO_DEF;

// una propuesta interna ([pin, uso, función], [dato, valor]) con la forma del esquema, para dársela al modelo como
// «su» respuesta anterior en una vuelta de revisión
const aSalida = (p) => ({
  nombre: p.nombre, tipo_existente: p.tipo_existente,
  tipo_nuevo: p.tipo_nuevo ? {...p.tipo_nuevo, pines: arr(p.tipo_nuevo.pines).map(([pin, uso, funcion]) => ({pin, uso, funcion})),
    datos: arr(p.tipo_nuevo.datos).map(([dato, valor]) => ({dato, valor}))} : null,
  datos_pieza: arr(p.datos_pieza).map(([dato, valor]) => ({dato, valor})), cantidad: p.cantidad, dudas: p.dudas, confianza: p.confianza,
});
const textoRonda = (r) => ['He revisado tu propuesta (la de arriba ya lleva mis correcciones).',
  ...(r.respuestas.length ? ['Respuestas a tus dudas:', ...r.respuestas.map((x) => `- «${x.duda}» → ${x.respuesta}`)] : []),
  ...(r.extra ? [`Además: ${r.extra}`] : []),
  'Rehaz la propuesta completa con esto en cuenta.'].join('\n');

// coste aproximado de la consulta con los precios del catálogo (dólares por millón de tokens)
function coste(m, uso) {
  const e = Number(uso?.inputTokens) || 0, s = Number(uso?.outputTokens) || 0;
  if (!e && !s) return null;
  const dolares = (e * (m.precio.entrada ?? 0) + s * (m.precio.salida ?? 0)) / 1e6;
  return {tokens_entrada: e, tokens_salida: s, dolares: Math.round(dolares * 1e6) / 1e6};
}

async function proponer(db, entrada, foto, sesion) {
  const {m, clave} = await modeloElegido(db, entrada.modelo);
  const ctx = contexto(db);
  const contenido = [{type: 'text', text: entrada.texto || 'Identifica la pieza de la foto.'}];
  if (foto) contenido.push({type: 'file', mediaType: 'image/jpeg', data: {type: 'data', data: foto}});
  // vueltas de revisión: la propuesta (ya corregida por el usuario) como respuesta del modelo + las respuestas del usuario
  const mensajes = [{role: 'user', content: contenido}];
  for (const r of arr(entrada.rondas)) {
    mensajes.push({role: 'assistant', content: JSON.stringify(aSalida(r.propuesta))});
    mensajes.push({role: 'user', content: textoRonda(r)});
  }
  let error;
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const r = await generateText({
        model: crearModelo(m, clave, sesion), system: instrucciones(ctx), messages: mensajes,
        output: Output.object({schema: esquema(ctx), name: 'pieza', description: 'Propuesta para dar de alta una pieza de electrónica'}),
        ...opcionesLlamada(m), maxRetries: 1, abortSignal: AbortSignal.timeout(ESPERA_MS),
      });
      return {propuesta: {...normalizar(db, salidaDe(r)), coste: coste(m, r.totalUsage ?? r.usage)}, modelo: m.id};
    } catch (e) {
      error = e;
      if (!reintentable(e)) break; // solo se reintenta si el formato no era correcto o no hubo respuesta
      if (e instanceof SinRespuesta) { anotarSinRespuesta(m, e, intento); continue; }
      // diagnóstico: qué devolvió el modelo y por qué no valía (sin la foto ni la clave)
      console.warn(`[ia] ${m.id}: formato no válido (intento ${intento}): ${txt(e.cause?.message || e.message, 400)}`);
      console.warn(`[ia] ${m.id}: texto devuelto: ${txt(e.text, 800) || '(vacío)'}`);
      // rescate: muchos modelos devuelven casi lo pedido (sin un campo, envuelto, con ```json…)
      const rescatada = rescatar(db, ctx, e.text);
      if (rescatada) {
        console.warn(`[ia] ${m.id}: propuesta rescatada (${rescatada.dudas.length} dudas)`);
        return {propuesta: {...rescatada, coste: coste(m, e.usage)}, modelo: m.id};
      }
    }
  }
  throw new Error(explicar(error));
}

// saca el JSON de un texto aunque venga con ```json … ``` o con texto alrededor; null si no hay
export function extraerJson(texto) {
  const s = String(texto || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

// segunda barrera: si la respuesta no cumple el esquema estricto pero es aprovechable, se normaliza y cada corrección
// queda como «duda» para que el usuario la vea al revisar. Solo se rechaza si no hay ni un nombre.
export function rescatar(db, ctx, texto) {
  let p = extraerJson(texto);
  if (!p || typeof p !== 'object') return null;
  // envoltorios típicos: {"pieza": {...}}, {"data": {...}}, {"properties": {...}}
  for (let i = 0; i < 2 && !('nombre' in p); i++) {
    const hijos = Object.values(p).filter((v) => v && typeof v === 'object' && !Array.isArray(v));
    if (hijos.length !== 1) break;
    p = hijos[0];
  }
  // qué campos no cumplían, con nombres que entiende el usuario
  const NOMBRES = {nombre: 'nombre', tipo_existente: 'tipo', tipo_nuevo: 'ficha del tipo', categoria: 'categoría', resumen: 'resumen',
    voltaje: 'tensión', interfaz: 'interfaces', alias: 'otros nombres', pines: 'pines', funcion: 'función de un pin', datos: 'datos del tipo',
    ojo: 'advertencia', datos_pieza: 'datos de la pieza', cantidad: 'cantidad', dudas: 'dudas', confianza: 'confianza'};
  const problemas = (() => {
    const r = esquema(ctx).safeParse(p);
    if (r.success) return [];
    return r.error.issues.map((i) => {
      const claves = i.path.filter((x) => typeof x === 'string');
      return NOMBRES[claves[claves.length - 1]] || NOMBRES[claves[0]] || 'formato general';
    });
  })();
  let propuesta;
  try { propuesta = normalizar(db, p); } catch { return null; }
  if (!propuesta.nombre) return null;
  if (problemas.length) propuesta.dudas.push(`El modelo no rellenó bien algunos campos y se han corregido solos; compruébalos: ${[...new Set(problemas)].slice(0, 6).join(', ')}.`);
  return propuesta;
}

// comprueba una clave y un modelo con una llamada mínima (unos pocos tokens) antes de guardarlos
export async function probar(clave, modeloId) {
  if (!CLAVE_OK.test(clave || '')) throw new Error('La clave no tiene buen formato (16–300 caracteres, sin espacios).');
  const m = (await modelos()).find((x) => x.id === modeloId);
  if (!m) throw new Error('Ese modelo no está en el catálogo de OpenCode Go con fotos y salida estructurada.');
  try {
    await generateText({model: crearModelo(m, clave, 'ams-lab-prueba'), prompt: 'Responde solo: ok', maxOutputTokens: 200, maxRetries: 0,
      abortSignal: AbortSignal.timeout(60_000)});
  } catch (e) { throw new Error(explicar(e)); }
  return m;
}

// guarda la configuración que llega de la web; si cambia la clave o el modelo, primero se prueban juntos
export async function guardarConfig(db, {clave, modelo, quitarClave} = {}) {
  const actual = db.prepare('SELECT clave, modelo FROM ia_config WHERE id = 1').get();
  if (quitarClave) {
    db.prepare("UPDATE ia_config SET clave = NULL, actualizado = datetime('now') WHERE id = 1").run();
    return estado(db);
  }
  const nuevaClave = clave ? String(clave).trim() : null;
  const claveFinal = nuevaClave || config(db).clave;
  const modeloFinal = modelo ? String(modelo) : config(db).modelo;
  if (!claveFinal) {
    // sin clave todavía: solo se puede elegir el modelo (que tiene que estar en el catálogo)
    if (!(await modelos()).some((x) => x.id === modeloFinal)) throw new Error('Ese modelo no está en el catálogo.');
    db.prepare("UPDATE ia_config SET modelo = ?, actualizado = datetime('now') WHERE id = 1").run(modeloFinal);
    return estado(db);
  }
  await probar(claveFinal, modeloFinal);
  db.prepare("UPDATE ia_config SET clave = ?, modelo = ?, actualizado = datetime('now') WHERE id = 1")
    .run(nuevaClave || actual.clave, modeloFinal);
  return estado(db);
}

// ---------- «Corregir con IA»: el modelo corrige una ficha existente (y la pieza, si se revisa desde una pieza) ----------
function instruccionesRevision(ctx, conPieza) {
  return `Eres el asistente de un almacén personal de componentes de electrónica. Te paso la FICHA de un tipo de componente
${conPieza ? 'y los datos de UNA pieza concreta de ese tipo ' : ''}tal como están guardados, y quizá una foto y lo que el usuario quiere que revises.
Devuelve la ficha${conPieza ? ' y la pieza' : ''} COMPLETA y corregida. Todo en español de España.

Reglas:
- Corrige errores y completa lo que falte, pero NO cambies lo que ya está bien ni reescribas por estilo: cada cambio
  tiene que tener un motivo y aparecer en "motivos" (campo y motivo en una frase).
- Si el usuario pide algo concreto, céntrate en eso.
- Pines: "pin" es el nombre serigrafiado; "uso" en 2–4 palabras; la función tiene que ser uno de estos ids:
  ${ctx.funciones.map((f) => `${f.id} = ${f.nombre}`).join(' · ')}.
- "datos" del tipo: lo que es igual en todas las piezas del tipo. ${conPieza ? '"datos_pieza": lo propio de esta pieza.' : ''}
  Clave corta y valor concreto; no repitas lo que ya dicen los pines. Nada de «no aplica» ni «desconocido».${conPieza ? `
- "notas" son las notas PERSONALES del usuario sobre su pieza, escritas por él. No las reescribas ni pongas en ellas
  descripciones de la pieza o de la foto. Solo puedes quitar lo que esta revisión deja resuelto (una duda como
  «confírmalo»), manteniendo el resto con sus palabras; si no queda nada útil, déjalas vacías. Lo que averigües va
  a la ficha o a "datos_pieza", no a las notas.` : ''}
- Escribe como una hoja de datos: nunca hables de «la foto» ni de lo que se ve en ella en los textos que se guardan.
- En "motivos", "campo" es uno de: ficha.nombre, ficha.categoria, ficha.resumen, ficha.voltaje, ficha.interfaz,
  ficha.alias, ficha.pines, ficha.datos, ficha.ojo${conPieza ? ', pieza.nombre, pieza.notas, pieza.datos' : ''}.
- NO INVENTES: si no estás seguro de un pinout, una tensión o un dato, déjalo como está y pregúntalo en "dudas"
  (preguntas cortas que el usuario pueda contestar). Un pinout o una tensión inventados pueden quemar una placa.
- Categorías: ${ctx.categorias.map((c) => `${c.id} = ${c.nombre}`).join(' · ')}
- Textos cortos y llanos, sin emojis.`;
}

function esquemaRevision(ctx, conPieza) {
  const dato = z.object({dato: z.string(), valor: z.string()});
  const forma = {
    tipo: z.object({
      nombre: z.string(), categoria: z.enum(ctx.categorias.map((c) => c.id)), resumen: z.string(), voltaje: z.string(),
      interfaz: z.array(z.string()), alias: z.array(z.string()),
      pines: z.array(z.object({pin: z.string(), uso: z.string(), funcion: z.enum(ctx.funciones.map((f) => f.id))})),
      datos: z.array(dato), ojo: z.string(),
    }),
    motivos: z.array(z.object({campo: z.string(), motivo: z.string()})),
    dudas: z.array(z.string()),
    confianza: z.enum(['alta', 'media', 'baja']),
  };
  if (conPieza) forma.pieza = z.object({nombre: z.string(), notas: z.string(), datos_pieza: z.array(dato)});
  return z.object(forma);
}

// la ficha y la pieza en la forma del esquema (pines y datos como objetos), para dárselas al modelo
const fichaSalida = (f) => ({nombre: f.nombre, categoria: f.categoria, resumen: f.resumen, voltaje: f.voltaje, interfaz: f.interfaz, alias: f.alias,
  pines: f.pines.map(([pin, uso, funcion]) => ({pin, uso, funcion})), datos: f.datos.map(([dato, valor]) => ({dato, valor})), ojo: f.ojo});

// pide la revisión y devuelve {propuesta: {objetivo, actual, nueva, cambios, motivos, dudas, confianza, coste}, modelo}
async function proponerRevision(db, entrada, foto, sesion) {
  const {m, clave} = await modeloElegido(db, entrada.modelo);
  const {diferencias, estadoActual} = await import('./revision.mjs');
  const obj = entrada.objetivo;
  const actual = estadoActual(db, obj);
  if (!actual.tipo && !actual.pieza) throw new Error('Lo que había que corregir ya no existe');
  const conPieza = !!actual.pieza;
  const ctx = contexto(db);
  const datosTexto = JSON.stringify({ficha: actual.tipo ? fichaSalida(actual.tipo) : null,
    pieza: conPieza ? {nombre: actual.pieza.nombre, notas: actual.pieza.notas, datos_pieza: actual.pieza.datos_pieza.map(([dato, valor]) => ({dato, valor}))} : undefined});
  const contenido = [{type: 'text', text: `${entrada.texto ? `Lo que quiero que revises: ${entrada.texto}\n\n` : 'Revisa la ficha entera.\n\n'}Lo que hay guardado:\n${datosTexto}`}];
  if (foto) contenido.push({type: 'file', mediaType: 'image/jpeg', data: {type: 'data', data: foto}});
  let error;
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const r = await generateText({
        model: crearModelo(m, clave, sesion), system: instruccionesRevision(ctx, conPieza), messages: [{role: 'user', content: contenido}],
        output: Output.object({schema: esquemaRevision(ctx, conPieza), name: 'revision', description: 'Ficha corregida'}),
        ...opcionesLlamada(m), maxRetries: 1, abortSignal: AbortSignal.timeout(ESPERA_MS),
      });
      const o = salidaDe(r);
      // la ficha propuesta pasa por la misma limpieza que un alta (categorías y funciones válidas, longitudes, «no aplica»…)
      const limpia = normalizar(db, {nombre: o.tipo.nombre, tipo_nuevo: o.tipo, datos_pieza: o.pieza?.datos_pieza, dudas: o.dudas, confianza: o.confianza});
      const nueva = {
        tipo: actual.tipo && limpia.tipo_nuevo ? {...actual.tipo, ...limpia.tipo_nuevo} : actual.tipo,
        pieza: conPieza ? {nombre: txt(o.pieza?.nombre, 200) || actual.pieza.nombre, notas: String(o.pieza?.notas ?? actual.pieza.notas).slice(0, 2000), datos_pieza: limpia.datos_pieza} : undefined,
      };
      const categorias = Object.fromEntries(ctx.categorias.map((c) => [c.id, c.nombre]));
      const funciones = Object.fromEntries(ctx.funciones.map((f) => [f.id, f.nombre]));
      return {
        modelo: m.id,
        propuesta: {
          objetivo: obj, cambios: diferencias(actual, nueva, {categorias, funciones}),
          motivos: arr(o.motivos).map((x) => ({campo: txt(x.campo, 60), motivo: txt(x.motivo, 300)})).filter((x) => x.motivo).slice(0, 20),
          dudas: limpia.dudas, confianza: limpia.confianza, coste: coste(m, r.totalUsage ?? r.usage),
        },
      };
    } catch (e) {
      error = e;
      if (!reintentable(e)) break;
      if (e instanceof SinRespuesta) { anotarSinRespuesta(m, e, intento); continue; }
      console.warn(`[ia] ${m.id}: revisión con formato no válido (intento ${intento}): ${txt(e.cause?.message || e.message, 300)}`);
      console.warn(`[ia] ${m.id}: texto devuelto: ${txt(e.text, 800) || '(vacío)'}`);
    }
  }
  throw new Error(explicar(error));
}

// ejecuta una tarea ya creada (estado 'pendiente'): alta o revisión; deja 'propuesta' o 'error'. No lanza excepciones.
export async function ejecutarAlta(db, fotosDir, id) {
  const t = db.prepare('SELECT * FROM ia_tareas WHERE id = ?').get(id);
  const entrada = JSON.parse(t.entrada);
  try {
    const foto = entrada.foto ? await readFile(`${fotosDir}/${entrada.foto}`) : null;
    const {propuesta, modelo} = t.clase === 'revisar'
      ? await proponerRevision(db, entrada, foto, `ams-lab-tarea-${id}`)
      : await proponer(db, entrada, foto, `ams-lab-tarea-${id}`);
    db.prepare("UPDATE ia_tareas SET estado = 'propuesta', propuesta = ?, modelo = ?, error = NULL WHERE id = ? AND estado = 'pendiente'")
      .run(JSON.stringify(propuesta), modelo, id);
  } catch (e) {
    console.error(`[ia] tarea ${id}:`, e.message);
    db.prepare("UPDATE ia_tareas SET estado = 'error', error = ?, modelo = ? WHERE id = ? AND estado = 'pendiente'")
      .run(txt(e.message, 500), entrada.modelo || config(db).modelo, id);
  }
}

// al arrancar: una tarea que quedó 'pendiente' es que el servidor se reinició a mitad
export function cerrarInterrumpidas(db) {
  db.prepare("UPDATE ia_tareas SET estado = 'error', error = 'Interrumpida: el servidor se reinició mientras el modelo pensaba' WHERE estado = 'pendiente'").run();
}
