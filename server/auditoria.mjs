// Historial de cambios de toda la aplicación (tabla «auditoria», modelo v7): quién cambió qué y cuándo.
//   · quien: 'usuario' (tú, desde la web), 'ia' (cambios propuestos por la IA y confirmados por ti; con su modelo) o
//     'sistema' (el propio servidor: restaurar una copia, migraciones…).
//   · objeto: pieza, tipo, categoria, sitio, proyecto, ia, copia o ajustes; objeto_id puede apuntar a algo que ya no existe.
//   · detalle: JSON con los cambios campo a campo ({cambios: [{campo, antes, despues}]}) y lo que haga falta.
// Nunca se apunta la clave de la IA. Se guardan como mucho MAX filas (las más antiguas se van al arrancar).
const MAX = 20000;
const corto = (v, max = 300) => {
  const s = Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

// apunta un cambio. No debe romper nunca la operación que lo provoca: si falla, solo avisa en el registro.
export function apuntar(db, {quien = 'usuario', accion, objeto, id = null, nombre = null, resumen, cambios = null, detalle = null, modelo = null}) {
  try {
    const d = {...(detalle || {})};
    if (cambios?.length) d.cambios = cambios.slice(0, 80).map((c) => ({campo: corto(c.campo, 80), antes: corto(c.antes), despues: corto(c.despues)}));
    db.prepare('INSERT INTO auditoria (quien, accion, objeto, objeto_id, nombre, resumen, detalle, modelo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(quien, accion, objeto, id == null ? null : String(id), nombre == null ? null : corto(nombre, 200), corto(resumen, 400),
        Object.keys(d).length ? JSON.stringify(d) : null, modelo);
  } catch (e) {
    console.warn(`[historial] no se pudo apuntar «${accion}»: ${e.message}`);
  }
}

// grupos de la web (Ajustes → Historial) → condición SQL
const GRUPOS = {
  piezas: "objeto = 'pieza'",
  fichas: "objeto = 'tipo'",
  ia: "quien = 'ia' OR objeto = 'ia'",
  catalogo: "objeto IN ('tipo', 'categoria', 'sitio')",
  proyectos: "objeto = 'proyecto'",
  sistema: "objeto IN ('copia', 'ajustes') OR quien = 'sistema'",
};

// lista, de la más nueva a la más antigua. f: {grupo, objeto, id, tipo, q, antes (id: para «cargar más»), limite}
// Con objeto 'pieza' y «tipo», también salen los cambios de la ficha de su tipo (lo que la IA corrigió desde la pieza).
export function listar(db, f = {}) {
  const donde = [], args = [];
  if (GRUPOS[f.grupo]) donde.push(`(${GRUPOS[f.grupo]})`);
  if (f.objeto === 'pieza' && f.id && f.tipo) { donde.push("((objeto = 'pieza' AND objeto_id = ?) OR (objeto = 'tipo' AND objeto_id = ?))"); args.push(String(f.id), String(f.tipo)); }
  else {
    if (f.objeto) { donde.push('objeto = ?'); args.push(String(f.objeto)); }
    if (f.id != null && f.id !== '') { donde.push('objeto_id = ?'); args.push(String(f.id)); }
  }
  if (f.q) { donde.push("(nombre LIKE ? ESCAPE '\\' OR resumen LIKE ? ESCAPE '\\' OR modelo LIKE ? ESCAPE '\\')"); const q = `%${String(f.q).slice(0, 80).replace(/[\\%_]/g, '\\$&')}%`; args.push(q, q, q); }
  if (Number(f.antes) > 0) { donde.push('id < ?'); args.push(Number(f.antes)); }
  const limite = Math.min(200, Math.max(1, Number(f.limite) || 50));
  const filas = db.prepare(`SELECT * FROM auditoria ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...args, limite + 1);
  return {
    filas: filas.slice(0, limite).map((r) => ({...r, detalle: r.detalle ? JSON.parse(r.detalle) : null})),
    mas: filas.length > limite,
  };
}

// al arrancar: deja las MAX más recientes
export function podar(db) {
  try {
    const n = db.prepare('DELETE FROM auditoria WHERE id <= (SELECT id FROM auditoria ORDER BY id DESC LIMIT 1 OFFSET ?)').run(MAX).changes;
    if (n) console.log(`[historial] ${n} entradas antiguas borradas (se guardan las ${MAX} últimas)`);
  } catch {}
}

// ---------- cambios de una pieza, legibles ----------
const cant = (c) => (c.varios ? 'muchas' : c.cantidad == null ? 'sin contar' : String(c.cantidad));
const si = (v) => (v ? 'sí' : 'no');
// a y b: piezas como las entrega la API (comp()). nombresTipo: id → nombre
export function cambiosPieza(a, b, nombresTipo = {}) {
  const out = [];
  const ver = (id) => (id ? nombresTipo[id] || id : 'Sin tipo');
  const poner = (campo, x, y) => { if (String(x ?? '') !== String(y ?? '')) out.push({campo, antes: x ?? '', despues: y ?? ''}); };
  poner('Nombre', a.nombre, b.nombre);
  poner('Tipo', ver(a.tipo), ver(b.tipo));
  poner('Cantidad', cant(a), cant(b));
  poner('Sitio', a.ubicacion || 'Sin sitio', b.ubicacion || 'Sin sitio');
  poner('Notas', a.notas, b.notas);
  poner('Pendiente', si(a.revisar), si(b.revisar));
  const da = new Map((a.datos || []).map(([k, v]) => [k.toLowerCase(), [k, v]])), dbb = new Map((b.datos || []).map(([k, v]) => [k.toLowerCase(), [k, v]]));
  for (const [k, [clave, v]] of dbb) poner(`Dato: ${clave}`, da.get(k)?.[1] ?? '', v);
  for (const [k, [clave, v]] of da) if (!dbb.has(k)) poner(`Dato: ${clave}`, v, '');
  return out;
}
// frase corta: «Cantidad: 3 → 5» si es un solo cambio corto; si no, los campos que cambian
export function resumenCambios(prefijo, cambios) {
  if (!cambios.length) return `${prefijo}: sin cambios`;
  const c = cambios[0];
  if (cambios.length === 1 && String(c.antes).length < 40 && String(c.despues).length < 40)
    return `${c.campo}: ${c.antes === '' ? '—' : c.antes} → ${c.despues === '' ? '—' : c.despues}`;
  return `${prefijo}: ${cambios.map((x) => x.campo.replace(/^Dato: .*/, 'datos')).filter((x, i, l) => l.indexOf(x) === i).join(', ').toLowerCase()}`;
}

// ---------- cambios de una ficha (tipo), legibles ----------
// a y b: fichas en el formato de leerFicha(). categorias: id → nombre
export function cambiosFicha(a, b, categorias = {}) {
  const out = [];
  const poner = (campo, x, y) => { if (String(x ?? '') !== String(y ?? '')) out.push({campo, antes: x ?? '', despues: y ?? ''}); };
  poner('Nombre', a.nombre, b.nombre);
  poner('Categoría', categorias[a.categoria] || a.categoria, categorias[b.categoria] || b.categoria);
  poner('Resumen', a.resumen, b.resumen);
  poner('Tensión', a.voltaje, b.voltaje);
  poner('Ojo', a.ojo, b.ojo);
  poner('Interfaces', (a.interfaz || []).join(', '), (b.interfaz || []).join(', '));
  poner('También se llama', [...(a.alias || [])].sort().join(', '), [...(b.alias || [])].sort().join(', '));
  const pin = (p) => `${p[0]}: ${p[1]} (${p[2]})${p[3] ? ` · ${p[3]}` : ''}`;
  const pa = new Map((a.pines || []).map((p) => [p[0].toLowerCase(), p])), pb = new Map((b.pines || []).map((p) => [p[0].toLowerCase(), p]));
  for (const [k, p] of pb) poner(`Pin ${p[0]}`, pa.has(k) ? pin(pa.get(k)) : '', pin(p));
  for (const [k, p] of pa) if (!pb.has(k)) poner(`Pin ${p[0]}`, pin(p), '');
  if (out.every((c) => !c.campo.startsWith('Pin ')) && (a.pines || []).map((p) => p[0]).join() !== (b.pines || []).map((p) => p[0]).join())
    poner('Orden de los pines', (a.pines || []).map((p) => p[0]).join(', '), (b.pines || []).map((p) => p[0]).join(', '));
  const da = new Map((a.datos || []).map(([k, v]) => [k.toLowerCase(), [k, v]])), dbb = new Map((b.datos || []).map(([k, v]) => [k.toLowerCase(), [k, v]]));
  for (const [k, [clave, v]] of dbb) poner(`Dato: ${clave}`, da.get(k)?.[1] ?? '', v);
  for (const [k, [clave, v]] of da) if (!dbb.has(k)) poner(`Dato: ${clave}`, v, '');
  return out;
}
