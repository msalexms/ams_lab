# ams_lab — almacén digital de electrónica (personal)

Aplicación web **personal y privada** (homelab, red local / Tailscale) con el inventario, el glosario y los proyectos de los componentes electrónicos del usuario. NO es amstech.dev ni se publica.
Prioridad: **utilidad, que funcione y comodidad (sobre todo en el móvil)** antes que lo bonito.
**Diseño «hoja de datos» (elegido por el usuario el 03/11/2026, opción B):** papel claro de día y grafito de noche con el mismo formato; letra sans para leer y monoespaciada solo en el logo `[AMS]` y los pines; líneas finas, esquinas casi rectas. **Nada de pastillas redondeadas, emojis ni estética «Matrix»/neón**: estados y datos como texto plano en columnas.

## Quién hace qué (decisión del usuario, 03/11/2026)
- **El usuario** da de alta las piezas, cambia el stock y **sube sus fotos** desde la web (móvil). Si una pieza tiene foto se muestra; si no, solo el nombre. Nada de recuadros ni de clasificar fotos de bandejas.
- **Claude** mantiene el glosario (fichas de cada tipo), propone proyectos con lo que hay en stock y mejora la aplicación.

## Estructura
- `server/index.mjs` — servidor sin dependencias (Node 24): sirve `public/`, la API (`/api/...`) y las fotos (`/fotos/...`). `server/db.mjs` — esquema SQLite (`node:sqlite`).
- `data/lab.db` + `data/fotos/` — **los datos reales del usuario** (no van a git; copia de seguridad = copiar `data/`). Nunca borrar ni sobrescribir sin preguntar.
- `seed/*.json` — referencia (`referencia.json`) y catálogo (`glosario.json`, `proyectos.json`); `componentes.json` solo se usa al crear una base de datos nueva.
- `public/` — la web (`index.html`, `app.js`, `style.css`); la foto se reduce en el móvil a 1600 px JPEG antes de subirla.
- `public/img/tipos/<tipo>.svg` — dibujos de referencia de cada tipo (solo en la ficha del glosario), generados por `scripts/dibujos.mjs` (`npm run dibujos`). Recreaciones propias, nunca imágenes de internet.
- `Dockerfile` + `docker-compose.yml` — despliegue en el homelab (`./data` como volumen).

## Modelo de datos (leer docs/modelo-datos.md)
- **Referencia** (categorías, funciones de pin con su **color**, dificultades) y **catálogo** (tipos, pines, alias, interfaces, proyectos): vienen de `seed/` y se aplican con `npm run catalogo`. Los pines se editan en `scripts/pines.mjs` (`npm run pines` = escribir seed + catalogo); uso de 2–4 palabras; función = id de `funciones_pin`.
- **Inventario** (componentes, ubicaciones, historial): solo lo cambia la aplicación; el historial lo escriben *triggers*.
- **Nada de configuración permanente en la web** (decisión del usuario, 03/11/2026): colores, categorías, dificultades… siempre en tablas, y la web los lee de `/api/datos`.
- Los mismos colores de función de pin para todos los dispositivos.
- Cambios de esquema: subir `VERSION` en `server/db.mjs` con su migración, y copia con `VACUUM INTO` antes.

## Cómo trabajar
- Arrancar: `npm start` (o `npm run dev`, que reinicia al cambiar el servidor). Desde el móvil, la URL «móvil →» que imprime (misma Wi-Fi).
- Leer el inventario real: `GET /api/datos` o `node -e` con `node:sqlite` sobre `data/lab.db` (para copiarla, `VACUUM INTO`: con `cp` sale incompleta por el modo WAL).
- **Añadir o mejorar fichas del glosario o proyectos**: editar `seed/*.json` (o `scripts/pines.mjs`) y `npm run catalogo`. Proponer proyectos solo con lo que hay en stock (o diciendo qué falta).
- Nunca tocar `componentes` sin que el usuario lo pida: es su inventario.
- Pruebas: si creas piezas de prueba, bórralas después (también sus filas de `historial` y fotos).
