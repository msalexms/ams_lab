// IA: «Añadir con IA» — a partir de una foto y/o un texto, el modelo propone la pieza (y su ficha si el tipo es nuevo).
// Nada se guarda en el inventario sin que el usuario confirme la propuesta (tabla ia_tareas, docs/modelo-datos.md).
//
// Proveedor: OpenCode Go (API compatible con OpenAI, /chat/completions). Configuración solo por variables de entorno:
//   IA_CLAVE   clave de la API de OpenCode Go (sin ella la IA queda desactivada y la web no muestra el botón)
//   IA_MODELO  modelo (por defecto kimi-k3; tiene que entender imágenes para usar fotos)
//   IA_URL     endpoint (por defecto https://opencode.ai/inference/go/openai/v1/chat/completions)
import {readFile} from 'node:fs/promises';

const URL_DEF = 'https://opencode.ai/inference/go/openai/v1/chat/completions';
export const ia = {
  get clave() { return process.env.IA_CLAVE || ''; },
  get modelo() { return process.env.IA_MODELO || 'kimi-k3'; },
  get url() { return process.env.IA_URL || URL_DEF; },
  get activa() { return !!this.clave; },
};
const ESPERA_MS = 150_000; // los modelos con imagen pueden tardar

const txt = (v, max = 500) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
// [clave, valor] desde {clave: valor} o [[clave, valor]] o ["clave: valor"]
export const paresDe = (v) => (Array.isArray(v) ? v : Object.entries(v || {}))
  .map((p) => (typeof p === 'string' ? p.split(/:\s*/, 2) : p))
  .map(([k, val]) => [txt(k, 60), txt(val, 200)]).filter(([k, val]) => k && val).slice(0, 30);

// ---------- contexto que se le da al modelo ----------
function contexto(db) {
  return {
    categorias: db.prepare('SELECT id, nombre FROM categorias ORDER BY orden').all(),
    funciones: db.prepare('SELECT id, nombre FROM funciones_pin ORDER BY orden').all(),
    tipos: db.prepare(`SELECT t.id, t.nombre, t.categoria_id AS categoria, group_concat(a.alias, ' / ') AS alias
      FROM tipos t LEFT JOIN tipo_alias a ON a.tipo_id = t.id GROUP BY t.id ORDER BY t.categoria_id, t.nombre`).all(),
  };
}

function instrucciones(ctx) {
  return `Eres el asistente de un almacén personal de componentes de electrónica (ESP32, sensores, módulos, pasivos, tornillería…).
El usuario te enseña UNA pieza (foto y/o texto). Tienes que identificarla y proponer cómo darla de alta. Todo en español de España.

Responde SOLO con un objeto JSON, sin texto antes ni después y sin bloques de código, con esta forma:
{
  "nombre": "nombre concreto de la pieza, como se ve (p. ej. «Módulo relé de 1 canal 5 V (SRD-05VDC)»)",
  "tipo_existente": "id de un tipo de la lista si es claramente ese tipo, o null",
  "tipo_nuevo": null o {
    "nombre": "nombre genérico del tipo (p. ej. «Relé de 5 V»)",
    "categoria": "id de una categoría de la lista",
    "resumen": "una frase: qué es y para qué sirve",
    "voltaje": "tensión de trabajo, corta (p. ej. «3,3–5 V» o «5 V · señal a 3,3 V»)",
    "interfaz": ["I2C", "SPI", "digital", …],
    "alias": ["otros nombres o referencias del chip"],
    "pines": [["nombre del pin", "uso en 2–4 palabras", "id de función"], …],
    "datos": {"Dato técnico": "valor", …},
    "ojo": "advertencia importante para no romper nada, o vacío"
  },
  "datos_pieza": {"Dato de ESTA pieza": "valor"},
  "cantidad": número de unidades que se ven, o null si no se puede saber,
  "dudas": ["lo que no has podido confirmar"],
  "confianza": "alta" | "media" | "baja"
}

Reglas:
- Si la pieza encaja en un tipo de la lista, usa "tipo_existente" y deja "tipo_nuevo" en null. Crea un tipo nuevo solo si ninguno encaja.
- "datos" del tipo = lo que es igual en todas las piezas de ese tipo (corriente máxima, dirección I2C, frecuencia, rango de medida…).
  "datos_pieza" = lo que cambia de una pieza a otra del mismo tipo (valor de una resistencia, longitud de un cable, color…).
- Pines: en el orden del conector si se ve; la función tiene que ser uno de estos ids: ${ctx.funciones.map((f) => `${f.id} (${f.nombre})`).join(', ')}.
- NO INVENTES. Si no estás seguro de un pinout, una tensión o un dato, déjalo vacío y explícalo en "dudas". Un pinout o una tensión
  inventados pueden quemar una placa. Para piezas sin pines (tornillos, cables, herramientas), "pines": [].
- Textos cortos y llanos. Sin emojis.

Categorías (id: nombre): ${ctx.categorias.map((c) => `${c.id}: ${c.nombre}`).join(' · ')}

Tipos que ya existen (id | nombre | categoría | alias):
${ctx.tipos.map((t) => `${t.id} | ${t.nombre} | ${t.categoria}${t.alias ? ` | ${t.alias}` : ''}`).join('\n')}`;
}

// ---------- validación (la respuesta del modelo y la propuesta que confirma el usuario pasan por aquí) ----------
export function normalizar(db, p) {
  if (!p || typeof p !== 'object') throw new Error('La respuesta no es un objeto JSON');
  const cats = new Set(db.prepare('SELECT id FROM categorias').all().map((r) => r.id));
  const funcs = new Set(db.prepare('SELECT id FROM funciones_pin').all().map((r) => r.id));
  const dudas = arr(p.dudas).map((d) => txt(d, 300)).filter(Boolean).slice(0, 12);
  let existente = p.tipo_existente ? String(p.tipo_existente) : null;
  if (existente && !db.prepare('SELECT 1 FROM tipos WHERE id = ?').get(existente)) {
    dudas.push(`El modelo propuso el tipo «${existente}», que no existe.`);
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
      pines: arr(t.pines).filter(Array.isArray).map(([pin, uso, fn]) => [txt(pin, 60), txt(uso, 60), funcs.has(String(fn)) ? String(fn) : 'otro'])
        .filter(([pin]) => pin).slice(0, 60),
      datos: paresDe(t.datos), ojo: txt(t.ojo ?? t.advertencias, 400),
    };
  }
  const cant = Number(p.cantidad);
  return {
    nombre: txt(p.nombre, 200) || nuevo?.nombre || '', tipo_existente: existente, tipo_nuevo: nuevo,
    datos_pieza: paresDe(p.datos_pieza), cantidad: Number.isFinite(cant) && cant >= 0 ? Math.round(cant) : null,
    dudas, confianza: ['alta', 'media', 'baja'].includes(p.confianza) ? p.confianza : 'baja',
  };
}

// saca el JSON de la respuesta aunque venga con ```json … ``` o con texto alrededor
export function extraerJson(texto) {
  const s = String(texto || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('El modelo no devolvió JSON');
  return JSON.parse(s.slice(a, b + 1));
}

// ---------- llamada al modelo ----------
async function preguntar(sistema, texto, fotoB64, sesion) {
  const contenido = [{type: 'text', text: texto || 'Identifica la pieza de la foto.'}];
  if (fotoB64) contenido.push({type: 'image_url', image_url: {url: `data:image/jpeg;base64,${fotoB64}`}});
  let r;
  try {
    r = await fetch(ia.url, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${ia.clave}`, 'content-type': 'application/json',
        'user-agent': 'ams-lab/1.0', 'x-opencode-session': sesion, // lo piden para clientes que no son OpenCode
      },
      body: JSON.stringify({model: ia.modelo, temperature: 0.2, max_tokens: 4000,
        messages: [{role: 'system', content: sistema}, {role: 'user', content: contenido}]}),
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? 'El modelo ha tardado demasiado' : `No se pudo conectar con el modelo: ${e.message}`);
  }
  const cuerpo = await r.text();
  if (!r.ok) throw new Error(`El modelo respondió ${r.status}: ${cuerpo.slice(0, 300)}`);
  let datos;
  try { datos = JSON.parse(cuerpo); } catch { throw new Error('Respuesta del modelo ilegible'); }
  const msg = datos.choices?.[0]?.message;
  const texto2 = typeof msg?.content === 'string' ? msg.content : arr(msg?.content).map((c) => c.text || '').join('');
  if (!texto2) throw new Error('El modelo devolvió una respuesta vacía');
  return texto2;
}

// ejecuta una tarea de alta ya creada (estado 'pendiente'); deja 'propuesta' o 'error'. No lanza excepciones.
export async function ejecutarAlta(db, fotosDir, id) {
  const t = db.prepare('SELECT * FROM ia_tareas WHERE id = ?').get(id);
  const entrada = JSON.parse(t.entrada);
  try {
    const foto = entrada.foto ? (await readFile(`${fotosDir}/${entrada.foto}`)).toString('base64') : null;
    const respuesta = await preguntar(instrucciones(contexto(db)), entrada.texto, foto, `ams-lab-tarea-${id}`);
    const propuesta = normalizar(db, extraerJson(respuesta));
    db.prepare("UPDATE ia_tareas SET estado = 'propuesta', propuesta = ?, modelo = ?, error = NULL WHERE id = ? AND estado = 'pendiente'")
      .run(JSON.stringify(propuesta), ia.modelo, id);
  } catch (e) {
    console.error(`[ia] tarea ${id}:`, e.message);
    db.prepare("UPDATE ia_tareas SET estado = 'error', error = ?, modelo = ? WHERE id = ? AND estado = 'pendiente'").run(e.message.slice(0, 500), ia.modelo, id);
  }
}

// al arrancar: una tarea que quedó 'pendiente' es que el servidor se reinició a mitad
export function cerrarInterrumpidas(db) {
  db.prepare("UPDATE ia_tareas SET estado = 'error', error = 'Interrumpida: el servidor se reinició mientras el modelo pensaba' WHERE estado = 'pendiente'").run();
}
