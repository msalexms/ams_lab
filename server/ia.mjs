// IA: «Añadir con IA» — a partir de una foto y/o un texto, el modelo propone la pieza (y su ficha si el tipo es nuevo).
// Nada se guarda en el inventario sin que el usuario confirme la propuesta (tabla ia_tareas, docs/modelo-datos.md).
//
// Proveedor: OpenCode Go, llamado como indica su documentación para aplicaciones («These AI SDK packages are for
// applications calling Go directly»): AI SDK v7 con el paquete que el propio catálogo de Go asigna a cada modelo
// (GET https://opencode.ai/inference/go/v1/models → api.<tipo>.sdk.aisdk). Soportados: chat-completions
// (@ai-sdk/openai-compatible) y messages (@ai-sdk/anthropic).
//
// Guardarraíles:
//   1. se ofrecen todos los modelos de chat del catálogo, cada uno con lo que sabe hacer: «vision» (entiende fotos) y
//      «estructurada» (salida con formato fijo). A uno sin fotos no se le manda la foto (hace falta texto); a uno sin
//      formato fijo se le pide JSON en el texto y se aprovecha con rescatar() (falla más: se avisa al elegirlo);
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
import {fichaUniforme, datosUniformes, guiaEstilo, separarPines} from './formato.mjs';
import {vocabularios} from './uniformar.mjs';

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
    if (!api || m.type !== 'chat' || /free|contributor/.test(m.id)) return null;
    return {id: m.id, nombre: m.name || m.id, descripcion: txt(m.description, 200), api, base_url: rebase(m.api[api].base_url),
      vision, estructurada: m.capabilities?.structured_output === true, // lo que sabe hacer: la web lo avisa al elegirlo
      precio: {entrada: m.cost?.text?.input?.price ?? null, salida: m.cost?.text?.output?.price ?? null},
      // modelos que «piensan» antes de responder: el esfuerzo más bajo que admiten (el catálogo los da de menos a más)
      razona: m.capabilities?.reasoning?.supported === true, esfuerzos: arr(m.capabilities?.reasoning?.effort).map(String),
      max_salida: Number(m.limit?.output) || null};
  }).filter(Boolean).sort((a, b) => (b.vision + b.estructurada) - (a.vision + a.estructurada)
    || (a.precio.entrada ?? 99) - (b.precio.entrada ?? 99) || a.nombre.localeCompare(b.nombre));
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
    return createOpenAICompatible({name: 'opencode-go', baseURL: m.base_url, apiKey: clave, supportsStructuredOutputs: m.estructurada, fetch: fetchPropio})(m.id);
  return createAnthropic({baseURL: m.base_url, apiKey: clave, fetch: fetchPropio})(m.id);
}

// límite de respuesta y razonamiento de cada llamada. Los modelos que razonan gastan tokens pensando antes de escribir
// la ficha: con el límite justo, se quedaban sin sitio y devolvían una respuesta vacía («No output generated»). A esos se
// les pide el esfuerzo de razonamiento más bajo que admiten y se les da más margen.
// Cuánto razona (Ajustes → IA, tabla ajustes «ia_razonar»): poco (por defecto), medio o mucho.
//   · API chat-completions: el nivel de esfuerzo del catálogo (poco = el más bajo, medio = el de en medio, mucho = el máximo).
//   · API messages (tipo Claude): poco = sin «pensamiento» (lo más barato); medio y mucho = pensamiento con presupuesto.
// Más razonamiento: más margen de respuesta y más tiempo de espera.
export const NIVELES_RAZONAR = ['poco', 'medio', 'mucho'];
export const nivelRazonar = (db) => {
  const v = db.prepare("SELECT valor FROM ajustes WHERE clave = 'ia_razonar'").get()?.valor;
  return NIVELES_RAZONAR.includes(v) ? v : 'poco';
};
export function esfuerzoPara(m, nivel) {
  const l = arr(m.esfuerzos);
  if (!m.razona || !l.length) return null;
  if (nivel === 'mucho') return l[l.length - 1];
  if (nivel === 'medio') return l.includes('medium') ? 'medium' : l[Math.floor((l.length - 1) / 2)];
  return l[0];
}
const PRESUPUESTO = {medio: 4000, mucho: 16000}; // tokens de pensamiento (API messages)
const ESPERA = {poco: ESPERA_MS, medio: 240_000, mucho: 360_000};
function opcionesLlamada(m, nivel = 'poco') {
  const tope = !m.razona ? 6000 : {poco: 24000, medio: 32000, mucho: 64000}[nivel];
  const o = {maxOutputTokens: m.max_salida ? Math.min(tope, m.max_salida) : tope, abortSignal: AbortSignal.timeout(ESPERA[nivel] || ESPERA_MS)};
  const esfuerzo = esfuerzoPara(m, nivel);
  if (m.api === 'chat-completions' && esfuerzo) o.providerOptions = {openaiCompatible: {reasoningEffort: esfuerzo}};
  // tipo Claude: si el catálogo le da niveles de esfuerzo, piensa «adaptativo» y lo regula el esfuerzo (los Claude nuevos no
  // admiten el pensamiento con presupuesto: el SDK lo cambiaba solo, avisando en cada llamada); si no, con presupuesto de tokens
  if (m.api === 'messages' && m.razona && PRESUPUESTO[nivel])
    o.providerOptions = {anthropic: esfuerzo ? {thinking: {type: 'adaptive'}, effort: esfuerzo}
      : {thinking: {type: 'enabled', budgetTokens: Math.min(PRESUPUESTO[nivel], Math.floor(o.maxOutputTokens / 2))}}};
  return o;
}
// con pensamiento, algunos modelos tipo Claude rechazan la salida con formato fijo (400): se repite en «poco»
const rechazaPensar = (e, m, nivel) => nivel !== 'poco' && m.api === 'messages' && APICallError.isInstance(e?.lastError ?? e) && (e?.lastError ?? e).statusCode === 400;
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
// un modelo sin formato fijo respondió, pero no con el JSON pedido (lleva el texto y el uso, como NoObjectGeneratedError)
export class SinFormato extends Error { constructor(text, usage) { super('La respuesta no es el JSON pedido'); this.text = text; this.usage = usage; } }
const reintentable = (e) => NoObjectGeneratedError.isInstance(e) || e instanceof SinFormato || e instanceof SinRespuesta || NoOutputGeneratedError.isInstance(e);

// una llamada al modelo que devuelve un objeto. Con salida estructurada, el SDK valida el esquema. Sin ella, se le pide
// JSON dentro del texto (con el esquema escrito en las instrucciones) y se saca de ahí: quien llama lo limpia.
const formaJson = (schema) => { try { return JSON.stringify(z.toJSONSchema(schema)); } catch { return ''; } };
async function llamar(m, clave, sesion, {system, messages, schema, name, description}, nivel) {
  const base = {model: crearModelo(m, clave, sesion), messages, ...opcionesLlamada(m, nivel), maxRetries: 1};
  if (m.estructurada) {
    const r = await generateText({...base, system, output: Output.object({schema, name, description})});
    return {salida: salidaDe(r), uso: r.totalUsage ?? r.usage};
  }
  const forma = formaJson(schema);
  const r = await generateText({...base, system: `${system}\n\nResponde SOLO con un objeto JSON válido, sin texto alrededor ni \`\`\`.${forma ? `\nTiene que cumplir este esquema JSON:\n${forma}` : ''}`});
  const uso = r.totalUsage ?? r.usage;
  if (!String(r.text || '').trim()) throw new SinRespuesta(r);
  const salida = extraerJson(r.text);
  if (!salida || typeof salida !== 'object') throw new SinFormato(r.text, uso);
  return {salida, uso};
}
const anotarSinRespuesta = (m, e, intento) => console.warn(`[ia] ${m.id}: sin respuesta (intento ${intento}; fin: ${e.fin ?? '?'}; `
  + `razonamiento: ${e.razonamiento ?? '?'} tokens; texto: ${(e.texto || '').length} caracteres)`);

// errores en español y sin detalles internos
function explicar(e) {
  if (e?.lastError) e = e.lastError; // RetryError del SDK («Failed after N attempts»): interesa el último error real
  if (NoObjectGeneratedError.isInstance(e) || e instanceof SinFormato) return 'El modelo no devolvió una respuesta con el formato correcto (2 intentos). Prueba otra vez u otro modelo.';
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
    estilo: vocabularios(db).estilo, // cómo están escritos ya las interfaces y los nombres de datos (guía de estilo)
  };
}

// las dudas llevan las respuestas posibles para que el usuario elija con un toque (y siempre puede escribir otra)
const GUIA_OPCIONES = `- En cada duda, "opciones": si la respuesta es una de pocas posibilidades, de 2 a 4 respuestas cortas para elegir
  con un toque («Sí, soldados» · «Solo los agujeros»; «ABX00027» · «ABX00032»). Vacío si la respuesta es libre
  (lo que pone una serigrafía que no se lee). El usuario siempre puede escribir otra respuesta.`;

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
- UN pin por entrada: nunca varios juntos («GPIO 16 · 17») ni rangos («GPIO 32–39»). Si un pin sirve para dos cosas,
  es una sola entrada: su uso principal en "uso" y lo demás en "nota" («También: UART2 RX», «Solo entrada»,
  «En alto al arrancar»). "nota" vacía si no hay nada que añadir.
- "voltaje" corto («3,3–5 V», «5 V · señal a 3,3 V»). "cantidad": las unidades que se ven, o null.
- NO INVENTES. Si no estás seguro de un pinout, una tensión o un dato, déjalo vacío y pregúntalo en "dudas":
  un pinout o una tensión inventados pueden quemar una placa.
- "dudas": como mucho 5, cada una con su "pregunta" corta que el usuario pueda contestar mirando la pieza
  («¿Tiene 3 o 4 pines?», «¿Qué pone en la serigrafía?»). Nada de dudas que no cambien la ficha.
${GUIA_OPCIONES}
- Si el usuario ya ha revisado tu propuesta y te contesta, rehaz la propuesta COMPLETA: respeta lo que él ha
  corregido y lo que te ha respondido, y quita de "dudas" lo que ya esté resuelto.
- Textos cortos y llanos, sin emojis.

Funciones de pin: ${ctx.funciones.map((f) => `${f.id} = ${f.nombre}`).join(' · ')}
Categorías: ${ctx.categorias.map((c) => `${c.id} = ${c.nombre}`).join(' · ')}
Tipos que ya existen (id | nombre | categoría | alias):
${ctx.tipos.map((t) => `${t.id} | ${t.nombre} | ${t.categoria}${t.alias ? ` | ${t.alias}` : ''}`).join('\n')}

${guiaEstilo(ctx.estilo)}`;
}

const DUDA = z.object({pregunta: z.string(), opciones: z.array(z.string()).describe('2–4 respuestas posibles para elegir, o vacío si es libre')});

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
      pines: z.array(z.object({pin: z.string().describe('UN solo pin'), uso: z.string(), funcion: z.enum(ctx.funciones.map((f) => f.id)), nota: z.string().describe('Algo más de ese pin, o vacío')})),
      datos: z.array(dato), ojo: z.string().describe('Advertencia para no romper nada, o vacío'),
    }).nullable(),
    datos_pieza: z.array(dato),
    cantidad: z.number().nullable(),
    dudas: z.array(DUDA),
    confianza: z.enum(['alta', 'media', 'baja']),
  });
}

// ---------- validación (respuesta del modelo y propuesta corregida por el usuario pasan por aquí) ----------
export function normalizar(db, p) {
  if (!p || typeof p !== 'object') throw new Error('La propuesta no es un objeto');
  const cats = new Set(db.prepare('SELECT id FROM categorias').all().map((r) => r.id));
  const funcs = new Set(db.prepare('SELECT id FROM funciones_pin').all().map((r) => r.id));
  // cada duda es un texto (las de la app y las de modelos sin formato fijo) o {pregunta, opciones}; las respuestas
  // posibles quedan aparte, por pregunta (opciones[pregunta] = [...]), para que «dudas» siga siendo una lista de textos
  const opciones = {};
  const previas = p.opciones && typeof p.opciones === 'object' && !Array.isArray(p.opciones) ? p.opciones : {};
  const dudas = arr(p.dudas).map((d) => {
    const pregunta = txt(typeof d === 'object' && d ? d.pregunta ?? d.duda : d, 300);
    const ops = [...new Set(arr(typeof d === 'object' && d ? d.opciones : previas[pregunta]).map((o) => txt(o, 80)).filter(Boolean))].slice(0, 4);
    if (pregunta && ops.length >= 2) opciones[pregunta] = ops;
    return pregunta;
  }).filter(Boolean).slice(0, 12);
  const vocab = vocabularios(db);
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
      // un pin por fila: si el modelo junta varios, se separan; si repite uno, el segundo uso pasa a su nota
      pines: separarPines(arr(t.pines).map((x) => (Array.isArray(x) ? x : [x?.pin, x?.uso, x?.funcion, x?.nota]))
        .map(([pin, uso, fn, nota]) => [txt(pin, 60), txt(uso, 60), funcs.has(String(fn)) ? String(fn) : 'otro', txt(nota, 200)]).filter(([pin]) => pin)).slice(0, 120),
      datos: paresDe(t.datos), ojo: txt(t.ojo ?? t.advertencias, 400),
    };
    nuevo = fichaUniforme(nuevo, vocab.tipo); // la forma de escribir la pone la app (formato.mjs)
  }
  const cant = Number(p.cantidad);
  return {
    nombre: txt(p.nombre, 200) || nuevo?.nombre || '', tipo_existente: existente, tipo_nuevo: nuevo,
    datos_pieza: datosUniformes(paresDe(p.datos_pieza), vocab.pieza),
    cantidad: p.cantidad !== null && p.cantidad !== '' && Number.isFinite(cant) && cant >= 0 ? Math.min(99999, Math.round(cant)) : null,
    dudas, opciones, confianza: ['alta', 'media', 'baja'].includes(p.confianza) ? p.confianza : 'baja',
  };
}

// ---------- llamadas ----------
// el modelo de la tarea: el elegido para esa pieza en concreto (si lo hay) o el de la configuración
async function modeloElegido(db, idTarea = null) {
  const c = config(db);
  if (!c.clave) throw new Error('Falta la clave de OpenCode Go: ponla en Ajustes → IA.');
  const id = idTarea || c.modelo;
  const m = (await modelos()).find((x) => x.id === id);
  if (!m) throw new Error(`El modelo «${id}» no está en el catálogo de OpenCode Go: elige otro en la configuración.`);
  return {m, clave: c.clave};
}
// para validar el modelo que pide la web para una pieza concreta
export const modeloValido = async (id) => (await modelos()).some((x) => x.id === id);
// lo que sabe hacer el modelo que se va a usar (el pedido o el de siempre); null si no se puede saber (sin catálogo)
export async function infoModelo(db, id = null) {
  try { return (await modelos()).find((x) => x.id === (id || config(db).modelo)) || null; } catch { return null; }
}
export const MODELO_RECOMENDADO = MODELO_DEF;

// una propuesta interna ([pin, uso, función], [dato, valor]) con la forma del esquema, para dársela al modelo como
// «su» respuesta anterior en una vuelta de revisión
const aSalida = (p) => ({
  nombre: p.nombre, tipo_existente: p.tipo_existente,
  tipo_nuevo: p.tipo_nuevo ? {...p.tipo_nuevo, pines: arr(p.tipo_nuevo.pines).map(([pin, uso, funcion, nota]) => ({pin, uso, funcion, nota: nota || ''})),
    datos: arr(p.tipo_nuevo.datos).map(([dato, valor]) => ({dato, valor}))} : null,
  datos_pieza: arr(p.datos_pieza).map(([dato, valor]) => ({dato, valor})), cantidad: p.cantidad,
  dudas: arr(p.dudas).map((d) => ({pregunta: d, opciones: arr(p.opciones?.[d])})), confianza: p.confianza,
});
const textoRonda = (r) => ['He revisado tu propuesta (la de arriba ya lleva mis correcciones).',
  ...(r.fotos?.length ? [`Te mando ${r.fotos.length === 1 ? 'una foto más' : `${r.fotos.length} fotos más`} de la pieza.`] : []),
  // una respuesta puede llevar su foto: se le dice cuál es (x.fotos: su número dentro de las de este mensaje)
  ...(r.respuestas.length ? ['Respuestas a tus dudas:', ...r.respuestas.map((x) => `- «${x.duda}» → ${x.respuesta || 'te lo enseño en la foto'}${
    x.fotos?.length && r.fotos?.length ? ` (mira la foto ${x.fotos.join(' y ')} de este mensaje)` : ''}`)] : []),
  ...(r.extra ? [`Además: ${r.extra}`] : []),
  'Rehaz la propuesta completa con esto en cuenta.'].join('\n');

// coste aproximado de la consulta con los precios del catálogo (dólares por millón de tokens)
function coste(m, uso) {
  const e = Number(uso?.inputTokens) || 0, s = Number(uso?.outputTokens) || 0;
  if (!e && !s) return null;
  const dolares = (e * (m.precio.entrada ?? 0) + s * (m.precio.salida ?? 0)) / 1e6;
  return {tokens_entrada: e, tokens_salida: s, dolares: Math.round(dolares * 1e6) / 1e6};
}

// una foto como parte del mensaje
const parteFoto = (f) => ({type: 'file', mediaType: 'image/jpeg', data: {type: 'data', data: f}});

async function proponer(db, entrada, foto, sesion, mas = {}) {
  const {m, clave} = await modeloElegido(db, entrada.modelo);
  const ctx = contexto(db);
  const extras = m.vision ? arr(mas.extra) : [];
  const contenido = [{type: 'text', text: entrada.texto || `Identifica la pieza de ${extras.length ? `las ${extras.length + 1} fotos (son la misma pieza)` : 'la foto'}.`}];
  if (foto && m.vision) contenido.push(parteFoto(foto), ...extras.map(parteFoto));
  else if (!entrada.texto) throw new Error(`${m.nombre} no ve fotos: escribe qué es la pieza o elige otro modelo.`);
  // vueltas de revisión: la propuesta (ya corregida por el usuario) como respuesta del modelo + las respuestas del usuario
  const mensajes = [{role: 'user', content: contenido}];
  arr(entrada.rondas).forEach((r, i) => {
    mensajes.push({role: 'assistant', content: JSON.stringify(aSalida(r.propuesta))});
    const suyas = m.vision ? arr(arr(mas.rondas)[i]) : []; // las fotos que el usuario añadió al contestar
    mensajes.push({role: 'user', content: suyas.length ? [{type: 'text', text: textoRonda(r)}, ...suyas.map(parteFoto)] : textoRonda({...r, fotos: []})});
  });
  let error, nivel = nivelRazonar(db);
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const r = await llamar(m, clave, sesion, {system: instrucciones(ctx), messages: mensajes, schema: esquema(ctx), name: 'pieza',
        description: 'Propuesta para dar de alta una pieza de electrónica'}, nivel);
      // sin formato fijo, la respuesta pasa por el rescate (envoltorios, campos que faltan: cada arreglo queda como duda)
      const propuesta = m.estructurada ? normalizar(db, r.salida) : rescatarObjeto(db, ctx, r.salida);
      if (!propuesta) throw new SinFormato(JSON.stringify(r.salida), r.uso);
      return {propuesta: {...propuesta, coste: coste(m, r.uso)}, modelo: m.id};
    } catch (e) {
      error = e;
      if (rechazaPensar(e, m, nivel)) { console.warn(`[ia] ${m.id}: no admite razonar «${nivel}» con formato fijo; se repite en «poco»`); nivel = 'poco'; continue; }
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
export const rescatar = (db, ctx, texto) => rescatarObjeto(db, ctx, extraerJson(texto));
function rescatarObjeto(db, ctx, p) {
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
    return r.error.issues.filter((i) => i.path[0] !== 'dudas').map((i) => {
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
  if (!m) throw new Error('Ese modelo no está en el catálogo de OpenCode Go.');
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
function instruccionesRevision(ctx, conPieza, conTipo = true) {
  return `Eres el asistente de un almacén personal de componentes de electrónica. Te paso ${conTipo ? 'la FICHA de un tipo de componente' : ''}
${conPieza ? `${conTipo ? 'y ' : ''}los datos de UNA pieza concreta${conTipo ? ' de ese tipo' : ' (todavía sin tipo)'} ` : ''}tal como están guardados, y quizá una foto y lo que el usuario quiere que revises.
Devuelve ${conTipo ? 'la ficha' : ''}${conPieza ? `${conTipo ? ' y ' : ''}la pieza` : ''} COMPLETA y corregida. Todo en español de España.

Reglas:
- Corrige errores y completa lo que falte, pero NO cambies lo que ya está bien ni reescribas por estilo: cada cambio
  tiene que tener un motivo y aparecer en "motivos" (campo y motivo en una frase).
- Si el usuario pide algo concreto, céntrate en eso.
- Pines: "pin" es el nombre serigrafiado; "uso" en 2–4 palabras; la función tiene que ser uno de estos ids:
  ${ctx.funciones.map((f) => `${f.id} = ${f.nombre}`).join(' · ')}.
  UN pin por entrada (nunca «GPIO 16 · 17» ni «GPIO 32–39»). Si un pin sirve para dos cosas, es una sola entrada: su
  uso principal en "uso" y lo demás en "nota" («También: UART2 RX», «Solo entrada»); "nota" vacía si no hay nada.
  Si la ficha guardada tiene varios pines en una fila, sepáralos.
- "datos" del tipo: lo que es igual en todas las piezas del tipo. ${conPieza ? '"datos_pieza": lo propio de esta pieza.' : ''}
  Clave corta y valor concreto; no repitas lo que ya dicen los pines. Nada de «no aplica» ni «desconocido».${conPieza ? `
- "notas" son las notas PERSONALES del usuario sobre su pieza, escritas por él. No las reescribas ni pongas en ellas
  descripciones de la pieza o de la foto. Solo puedes quitar lo que esta revisión deja resuelto (una duda como
  «confírmalo»), manteniendo el resto con sus palabras; si no queda nada útil, déjalas vacías. Lo que averigües va
  a la ficha o a "datos_pieza", no a las notas.` : ''}
- Escribe como una hoja de datos: nunca hables de «la foto» ni de lo que se ve en ella en los textos que se guardan.${conPieza ? `
- Nombre de la pieza: si no la identifica bien (falta el modelo o la variante, o es erróneo), corrígelo: corto y concreto.
- Tipo de la pieza (pieza.tipo_existente / pieza.tipo_nuevo): si el tipo que tiene es el correcto, repite su id en
  tipo_existente y deja tipo_nuevo a null. Si es de OTRO tipo de la lista (o no tiene ninguno), pon ese id en
  tipo_existente. Si no encaja ninguno, pon tipo_existente a null y describe el tipo nuevo en tipo_nuevo con su ficha
  completa (mismas reglas que la ficha: no inventes pines ni tensiones). Si cambias el tipo, deja la ficha del tipo
  actual tal cual: no es la de esta pieza.
- Tipos que ya existen (id = nombre): ${ctx.tipos.map((t) => `${t.id} = ${t.nombre}`).join(' · ')}` : ''}
- En "motivos", "campo" es uno de: ficha.nombre, ficha.categoria, ficha.resumen, ficha.voltaje, ficha.interfaz,
  ficha.alias, ficha.pines, ficha.datos, ficha.ojo${conPieza ? ', pieza.nombre, pieza.tipo, pieza.notas, pieza.datos' : ''}.
- NO INVENTES: si no estás seguro de un pinout, una tensión o un dato, déjalo como está y pregúntalo en "dudas"
  (preguntas cortas que el usuario pueda contestar). Un pinout o una tensión inventados pueden quemar una placa.
${GUIA_OPCIONES}
- Categorías: ${ctx.categorias.map((c) => `${c.id} = ${c.nombre}`).join(' · ')}
- Textos cortos y llanos, sin emojis.
- Un texto que ya dice lo correcto no se cambia por escribirlo de otra manera (mayúsculas, puntuación, sinónimos, orden).

${guiaEstilo(ctx.estilo)}`;
}

function esquemaRevision(ctx, conPieza, conTipo = true) {
  const dato = z.object({dato: z.string(), valor: z.string()});
  const ficha = z.object({
    nombre: z.string(), categoria: z.enum(ctx.categorias.map((c) => c.id)), resumen: z.string(), voltaje: z.string(),
    interfaz: z.array(z.string()), alias: z.array(z.string()),
    pines: z.array(z.object({pin: z.string().describe('UN solo pin'), uso: z.string(), funcion: z.enum(ctx.funciones.map((f) => f.id)), nota: z.string().describe('Algo más de ese pin, o vacío')})),
    datos: z.array(dato), ojo: z.string(),
  });
  const forma = {
    motivos: z.array(z.object({campo: z.string(), motivo: z.string()})),
    dudas: z.array(DUDA),
    confianza: z.enum(['alta', 'media', 'baja']),
  };
  if (conTipo) forma.tipo = ficha;
  if (conPieza) forma.pieza = z.object({nombre: z.string(), notas: z.string(), datos_pieza: z.array(dato),
    tipo_existente: (ctx.tipos.length ? z.enum(ctx.tipos.map((t) => t.id)) : z.string()).nullable().describe('id del tipo correcto de la lista, o null'),
    tipo_nuevo: ficha.nullable().describe('ficha del tipo nuevo si no encaja ninguno, o null')});
  return z.object(forma);
}

// la ficha y la pieza en la forma del esquema (pines y datos como objetos), para dárselas al modelo
const fichaSalida = (f) => ({nombre: f.nombre, categoria: f.categoria, resumen: f.resumen, voltaje: f.voltaje, interfaz: f.interfaz, alias: f.alias,
  pines: f.pines.map(([pin, uso, funcion, nota]) => ({pin, uso, funcion, nota: nota || ''})), datos: f.datos.map(([dato, valor]) => ({dato, valor})), ojo: f.ojo});

// pide la revisión y devuelve {propuesta: {objetivo, actual, nueva, cambios, motivos, dudas, confianza, coste}, modelo}
async function proponerRevision(db, entrada, foto, sesion, mas = {}) {
  const {m, clave} = await modeloElegido(db, entrada.modelo);
  const {diferencias, estadoActual} = await import('./revision.mjs');
  const obj = entrada.objetivo;
  const actual = estadoActual(db, obj);
  if (!actual.tipo && !actual.pieza) throw new Error('Lo que había que corregir ya no existe');
  const conPieza = !!actual.pieza, conTipo = !!actual.tipo;
  const ctx = contexto(db);
  const datosTexto = JSON.stringify({ficha: actual.tipo ? fichaSalida(actual.tipo) : null,
    pieza: conPieza ? {nombre: actual.pieza.nombre, tipo_actual: actual.pieza.tipo_id || null, notas: actual.pieza.notas,
      datos_pieza: actual.pieza.datos_pieza.map(([dato, valor]) => ({dato, valor}))} : undefined});
  // vueltas anteriores: lo que preguntó el modelo y lo que contestó el usuario (para rehacer las correcciones con eso)
  let antes = (foto && m.vision ? 1 + arr(mas.extra).length : 0); // fotos que van delante de las de cada vuelta
  const vueltas = arr(entrada.rondas).map((r) => { const base = antes; antes += m.vision ? arr(r.fotos).length : 0; return [...arr(r.respuestas).map((x) =>
    `- Preguntaste «${x.duda}» → ${x.respuesta || 'te lo enseño en una foto'}${x.fotos?.length && m.vision ? ` (es la foto nº ${x.fotos.map((n) => base + n).join(' y ')} de las que te mando)` : ''}`),
    ...(r.extra ? [`- Además: ${r.extra}`] : []), ...(r.fotos?.length && m.vision ? [`- Te mando ${r.fotos.length === 1 ? 'una foto más' : `${r.fotos.length} fotos más`}.`] : [])].join('\n'); }).filter(Boolean);
  const respuestas = vueltas.length ? `Respuestas a tus dudas de antes (tenlas en cuenta y no vuelvas a preguntarlas):\n${vueltas.join('\n')}\n\n` : '';
  const contenido = [{type: 'text', text: `${entrada.texto ? `Lo que quiero que revises: ${entrada.texto}\n\n` : 'Revisa la ficha entera.\n\n'}${respuestas}Lo que hay guardado:\n${datosTexto}`}];
  // la foto (y las otras que mandó el usuario al pedirla), y después las que añadió al contestar las dudas, en orden
  if (foto && m.vision) contenido.push(parteFoto(foto), ...arr(mas.extra).map(parteFoto));
  if (m.vision) contenido.push(...arr(mas.rondas).flat().map(parteFoto));
  let error, nivel = nivelRazonar(db);
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const r = await llamar(m, clave, sesion, {system: instruccionesRevision(ctx, conPieza, conTipo), messages: [{role: 'user', content: contenido}],
        schema: esquemaRevision(ctx, conPieza, conTipo), name: 'revision', description: 'Ficha corregida'}, nivel);
      const o = r.salida;
      if (!o.tipo && !o.pieza) throw new SinFormato(JSON.stringify(o), r.uso); // sin formato fijo: ni ficha ni pieza
      // la ficha propuesta pasa por la misma limpieza que un alta (categorías y funciones válidas, longitudes, «no aplica»…)
      const limpia = normalizar(db, {nombre: o.tipo?.nombre || 'x', tipo_nuevo: o.tipo || null, datos_pieza: o.pieza?.datos_pieza, dudas: o.dudas, confianza: o.confianza});
      // tipo de la pieza: a otro que ya existe, o uno nuevo (que se crea al aplicar); null = se queda como está
      let tipoPieza = null;
      if (conPieza) {
        const tp = normalizar(db, {nombre: 'x', tipo_existente: o.pieza?.tipo_existente || null, tipo_nuevo: o.pieza?.tipo_existente ? null : o.pieza?.tipo_nuevo || null});
        limpia.dudas.push(...tp.dudas.filter((d) => !limpia.dudas.includes(d)));
        if (tp.tipo_existente && tp.tipo_existente !== (actual.pieza.tipo_id || null)) tipoPieza = {existente: tp.tipo_existente};
        else if (!tp.tipo_existente && tp.tipo_nuevo) tipoPieza = {nuevo: tp.tipo_nuevo};
      }
      const nueva = {
        tipo: actual.tipo && o.tipo && limpia.tipo_nuevo ? {...actual.tipo, ...limpia.tipo_nuevo} : actual.tipo,
        pieza: conPieza ? {nombre: txt(o.pieza?.nombre, 200) || actual.pieza.nombre, notas: String(o.pieza?.notas ?? actual.pieza.notas).slice(0, 2000),
          datos_pieza: limpia.datos_pieza, tipo: tipoPieza} : undefined,
      };
      const categorias = Object.fromEntries(ctx.categorias.map((c) => [c.id, c.nombre]));
      const funciones = Object.fromEntries(ctx.funciones.map((f) => [f.id, f.nombre]));
      return {
        modelo: m.id,
        propuesta: {
          objetivo: obj, cambios: diferencias(actual, nueva, {categorias, funciones, tipos: Object.fromEntries(ctx.tipos.map((t) => [t.id, t.nombre]))}),
          motivos: arr(o.motivos).map((x) => ({campo: txt(x.campo, 60), motivo: txt(x.motivo, 300)})).filter((x) => x.motivo).slice(0, 20),
          dudas: limpia.dudas, opciones: limpia.opciones, confianza: limpia.confianza, coste: coste(m, r.uso),
        },
      };
    } catch (e) {
      error = e;
      if (rechazaPensar(e, m, nivel)) { console.warn(`[ia] ${m.id}: no admite razonar «${nivel}» con formato fijo; se repite en «poco»`); nivel = 'poco'; continue; }
      if (!reintentable(e)) break;
      if (e instanceof SinRespuesta) { anotarSinRespuesta(m, e, intento); continue; }
      console.warn(`[ia] ${m.id}: revisión con formato no válido (intento ${intento}): ${txt(e.cause?.message || e.message, 300)}`);
      console.warn(`[ia] ${m.id}: texto devuelto: ${txt(e.text, 800) || '(vacío)'}`);
    }
  }
  throw new Error(explicar(error));
}

// ---------- foto con varias piezas: el modelo dice qué piezas hay y dónde está cada una ----------
// Solo las separa (nombre aproximado y recuadro). La ficha de cada una sale después, con su propio recorte, por el
// camino de siempre («alta»): así cada pieza se identifica de cerca y el usuario confirma una a una o todas juntas.
export const MAX_DETECTADAS = 40;
const INSTRUCCIONES_DETECTAR = `Eres el asistente de un almacén personal de componentes de electrónica. El usuario te enseña UNA foto con VARIAS
piezas (módulos, sensores, placas, pasivos, cables, tornillería…) para darlas de alta. Di qué piezas hay y dónde está cada una.
Todo en español de España.

Reglas:
- Una entrada por cada pieza distinta. Piezas iguales que están juntas (un montón de resistencias iguales, una tira de
  pines) son UNA entrada con su "cantidad". Dos piezas iguales separadas en la foto: una entrada con cantidad 2 y el
  recuadro de la que mejor se vea.
- "nombre": lo que se pueda decir con seguridad mirando la foto («Módulo ultrasonidos HC-SR04», «Placa azul de 4 pines
  sin identificar»). No inventes modelos: si no se lee, descríbela.
- "descripcion": una frase con lo que se ve y ayude a identificarla después (serigrafía, color, número de pines, conector).
- Recuadro de la pieza en milésimas de la imagen (enteros de 0 a 1000): "x" e "y" son la esquina de arriba a la
  izquierda, "ancho" y "alto" su tamaño. Ajustado a la pieza entera, con sus pines.
- No cuentes el fondo, la mesa, las manos ni las sombras. Como mucho ${MAX_DETECTADAS} piezas: si hay más, las más claras.
- "dudas": como mucho 3 frases cortas si algo de la foto impide separarlas bien (piezas tapadas, foto movida).
- Textos cortos y llanos, sin emojis.`;
const esquemaDetectar = z.object({
  piezas: z.array(z.object({nombre: z.string(), descripcion: z.string(), cantidad: z.number().nullable(),
    x: z.number(), y: z.number(), ancho: z.number(), alto: z.number()})),
  dudas: z.array(z.string()),
});
// limpia lo que devuelve el modelo: recuadros dentro de la imagen (en milésimas), nombres con tope, sin entradas vacías
export function normalizarDeteccion(o) {
  const lista = arr(Array.isArray(o) ? o : o?.piezas).filter((p) => p && typeof p === 'object');
  // algunos modelos dan fracciones (0–1) aunque se les pidan milésimas
  const nums = lista.flatMap((p) => [p.x, p.y, p.ancho, p.alto].map(Number)).filter(Number.isFinite);
  const escala = nums.length && Math.max(...nums) <= 1 ? 1000 : 1;
  const piezas = lista.map((p) => {
    const nombre = txt(p.nombre, 200);
    if (!nombre) return null;
    const [x, y, an, al] = [p.x, p.y, p.ancho ?? p.width, p.alto ?? p.height].map((v) => Math.round(Number(v) * escala));
    const x0 = Math.min(1000, Math.max(0, x)), y0 = Math.min(1000, Math.max(0, y));
    const ancho = Math.min(1000 - x0, an), alto = Math.min(1000 - y0, al);
    const cant = Number(p.cantidad);
    return {nombre, descripcion: txt(p.descripcion, 300),
      cantidad: p.cantidad != null && Number.isFinite(cant) && cant >= 1 ? Math.min(99999, Math.round(cant)) : null,
      caja: [x0, y0, ancho, alto].every(Number.isFinite) && ancho >= 10 && alto >= 10 ? {x: x0, y: y0, ancho, alto} : null}; // sin recuadro: la foto entera
  }).filter(Boolean).slice(0, MAX_DETECTADAS);
  return {piezas, dudas: arr(o?.dudas).map((d) => txt(d, 300)).filter(Boolean).slice(0, 5)};
}
async function detectar(db, entrada, foto, sesion) {
  const {m, clave} = await modeloElegido(db, entrada.modelo);
  if (!m.vision) throw new Error(`${m.nombre} no ve fotos: para separar las piezas de una foto elige un modelo que las entienda.`);
  if (!foto) throw new Error('Falta la foto');
  const contenido = [{type: 'text', text: entrada.texto ? `Lo que sé de estas piezas: ${entrada.texto}` : 'Separa las piezas de la foto.'},
    {type: 'file', mediaType: 'image/jpeg', data: {type: 'data', data: foto}}];
  let error, nivel = nivelRazonar(db);
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const r = await llamar(m, clave, sesion, {system: INSTRUCCIONES_DETECTAR, messages: [{role: 'user', content: contenido}], schema: esquemaDetectar,
        name: 'piezas', description: 'Las piezas que hay en la foto y dónde está cada una'}, nivel);
      const d = normalizarDeteccion(r.salida);
      if (!d.piezas.length) throw new Error('El modelo no ha encontrado piezas en la foto. Prueba con otra foto (más cerca y con luz) o con otro modelo.');
      return {propuesta: {...d, coste: coste(m, r.uso)}, modelo: m.id};
    } catch (e) {
      error = e;
      if (rechazaPensar(e, m, nivel)) { nivel = 'poco'; continue; }
      if (!reintentable(e)) break;
      if (e instanceof SinRespuesta) { anotarSinRespuesta(m, e, intento); continue; }
      console.warn(`[ia] ${m.id}: detección con formato no válido (intento ${intento}): ${txt(e.cause?.message || e.message, 300)}`);
      const d = normalizarDeteccion(extraerJson(e.text)); // rescate: casi lo pedido
      if (d.piezas.length) return {propuesta: {...d, coste: coste(m, e.usage)}, modelo: m.id};
    }
  }
  throw new Error(explicar(error));
}

// ejecuta una tarea ya creada (estado 'pendiente'): alta, revisión o detección; deja 'propuesta' o 'error'. No lanza excepciones.
export async function ejecutarAlta(db, fotosDir, id) {
  const t = db.prepare('SELECT * FROM ia_tareas WHERE id = ?').get(id);
  const entrada = JSON.parse(t.entrada);
  try {
    const foto = entrada.foto ? await readFile(`${fotosDir}/${entrada.foto}`) : null;
    // las otras fotos del principio y las de cada respuesta (si alguna ya no está, se sigue sin ella)
    const leer = (lista) => Promise.all(arr(lista).map((n) => readFile(`${fotosDir}/${n}`).catch(() => null))).then((l) => l.filter(Boolean));
    const mas = {extra: await leer(entrada.fotos_extra), rondas: await Promise.all(arr(entrada.rondas).map((r) => leer(r.fotos)))};
    const {propuesta, modelo} = t.clase === 'detectar' ? await detectar(db, entrada, foto, `ams-lab-tarea-${id}`)
      : t.clase === 'revisar' ? await proponerRevision(db, entrada, foto, `ams-lab-tarea-${id}`, mas)
      : await proponer(db, entrada, foto, `ams-lab-tarea-${id}`, mas);
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
