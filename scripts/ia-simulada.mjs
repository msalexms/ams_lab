// servidor simulado de OpenCode Go para probar la IA sin gastar cuota: catálogo + chat/completions.
//   npm run ia-simulada   (y en otra terminal)   IA_BASE=http://localhost:4398 IA_CLAVE=<16 caracteres o más> IA_MODELO=simulado-completo npm start
// Úsalo con una copia de los datos (AMS_LAB_DATA=/otra/carpeta), no con tu inventario: las piezas que guardes son inventadas.
// Modelos: «simulado-completo» (fotos y formato fijo), «simulado-sin-fotos» y «simulado-sin-formato» (JSON dentro de texto).
import {createServer} from 'node:http';
const PORT = 4398, base = `http://localhost:${PORT}/v1`;
const modelo = (id, name, vision, estructurada, precio) => ({id, name, type: 'chat', description: `Modelo de pruebas (${name}).`,
  api: {'chat-completions': {base_url: base}}, modalities: {input: vision ? ['text', 'image/jpeg'] : ['text']},
  capabilities: {structured_output: estructurada, reasoning: {supported: false}}, cost: {text: {input: {price: precio}, output: {price: precio * 4}}}, limit: {output: 8000}});
const CATALOGO = {data: [modelo('simulado-completo', 'Simulado completo', true, true, 1), modelo('simulado-sin-fotos', 'Simulado sin fotos', false, true, 0.2),
  modelo('simulado-sin-formato', 'Simulado sin formato', true, false, 0.5)]};

const DETECCION = {piezas: [
  {nombre: 'Módulo ultrasonidos HC-SR04', descripcion: 'Placa azul con dos transductores y 4 pines.', cantidad: 1, x: 60, y: 90, ancho: 380, alto: 300},
  {nombre: 'Placa roja de 3 pines sin identificar', descripcion: 'Serigrafía ilegible, 3 pines en línea.', cantidad: 1, x: 540, y: 110, ancho: 360, alto: 280},
  {nombre: 'Resistencias iguales', descripcion: 'Montón de resistencias de película de carbón.', cantidad: 6, x: 120, y: 560, ancho: 300, alto: 320},
  {nombre: 'Módulo verde con conector', descripcion: 'Placa verde con un conector de tornillo.', cantidad: 2, x: 560, y: 560, ancho: 340, alto: 330}], dudas: []};
// a propósito mal escrito («5v», «i2c», «corriente máxima»): la app tiene que dejarlo con su formato
const relé = {nombre: 'Relé de 5 V (1 canal)', categoria: 'otro', resumen: 'Interruptor controlado por una señal de 5 V.', voltaje: '5v', interfaz: ['1 pin digital', 'i2c (0x20)'], alias: ['SRD-05VDC'],
  pines: [{pin: 'VCC', uso: 'Alimentación 5v', funcion: 'vcc', nota: ''}, {pin: 'GND', uso: 'Masa', funcion: 'gnd', nota: ''}, {pin: 'IN', uso: 'Señal de control', funcion: 'dig', nota: ''}],
  datos: [{dato: 'corriente máxima', valor: '10A'}, {dato: 'Bobina:', valor: '70 ohm'}], ojo: 'No toques los bornes con red conectada.'};
function pieza(texto, conFoto) {
  const t = texto.toLowerCase();
  if (t.includes('hc-sr04')) return {nombre: 'HC-SR04', tipo_existente: 'hc-sr04', tipo_nuevo: null, datos_pieza: [], cantidad: 1, dudas: [], confianza: 'alta'};
  if (t.includes('resistencia')) return {nombre: 'Resistencias de 220 Ω', tipo_existente: 'resistencia', tipo_nuevo: null, datos_pieza: [{dato: 'Valor', valor: '220 Ω'}], cantidad: 6, dudas: [{pregunta: '¿De qué valor son? No se leen bien las bandas.', opciones: ['220 Ω', '330 Ω', '1 kΩ']}], confianza: 'media'};
  return {nombre: `Módulo relé de 5 V${conFoto ? '' : ' (sin foto)'}`, tipo_existente: null, tipo_nuevo: relé, datos_pieza: [], cantidad: t.includes('verde') ? 2 : 1,
    // dos dudas la primera vez; cuando el usuario contesta («Respuestas a tus dudas»), ninguna
    dudas: /Respuestas a tus dudas|Preguntaste/.test(texto) ? [] : [{pregunta: '¿Qué pone en la serigrafía del relé?', opciones: []},
      {pregunta: '¿Cuántos pines tiene el conector?', opciones: ['3 pines', '4 pines', '6 pines']}], confianza: 'media'};
}

createServer((req, res) => {
  const enviar = (code, obj) => { res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET' && req.url === '/v1/models') return enviar(200, CATALOGO);
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return enviar(404, {error: {message: 'no existe'}});
  let cuerpo = '';
  req.on('data', (c) => (cuerpo += c)).on('end', () => {
    const b = JSON.parse(cuerpo);
    const partes = b.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [{type: 'text', text: m.content}]));
    const texto = partes.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
    const conFoto = partes.some((p) => p.type !== 'text');
    const formato = b.response_format?.json_schema?.name || null;
    let salida;
    if (/Responde solo: ok/.test(texto)) salida = 'ok';
    else if (formato === 'piezas' || /VARIAS\s+piezas/.test(texto)) salida = DETECCION;
    else salida = pieza(b.messages.filter((m) => m.role === 'user').map((m) => (Array.isArray(m.content) ? m.content.filter((p) => p.type === 'text').map((p) => p.text).join(' ') : m.content)).join(' '), conFoto);
    // sin formato fijo: el JSON va envuelto en texto y con ```json, como hacen muchos modelos
    const contenido = typeof salida === 'string' ? salida : formato ? JSON.stringify(salida) : `Aquí tienes:\n\`\`\`json\n${JSON.stringify({pieza: salida})}\n\`\`\``;
    const ultimo = b.messages.filter((m) => m.role === 'user').pop();
    console.log(`[simulado] ${b.model} · formato: ${formato || 'texto'} · fotos: ${partes.filter((p) => p.type !== 'text').length}`
      + ` · último mensaje: ${(Array.isArray(ultimo?.content) ? ultimo.content.filter((p) => p.type === 'text').map((p) => p.text).join(' ') : ultimo?.content || '').replace(/\s+/g, ' ').slice(0, 260)}`);
    setTimeout(() => enviar(200, {id: 'x', object: 'chat.completion', created: 1, model: b.model,
      choices: [{index: 0, message: {role: 'assistant', content: contenido}, finish_reason: 'stop'}], usage: {prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500}}), 400);
  });
}).listen(PORT, () => console.log(`[simulado] OpenCode Go de pruebas en http://localhost:${PORT}`));
