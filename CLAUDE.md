# ams_lab — almacén digital de electrónica (personal)

Aplicación web **personal y privada** (homelab, red local / Tailscale) con el inventario, el glosario y los proyectos de los componentes electrónicos del usuario. NO es amstech.dev ni se publica.
Prioridad: **utilidad, que funcione y comodidad (sobre todo en el móvil)** antes que lo bonito.
**Diseño «hoja de datos» (elegido por el usuario el 03/11/2026, opción B):** papel claro de día y grafito de noche con el mismo formato; letra sans para leer y monoespaciada solo en el logo `[AMS]` y los pines; líneas finas, esquinas casi rectas. **Nada de pastillas redondeadas, emojis ni estética «Matrix»/neón**: estados y datos como texto plano en columnas.

## Quién hace qué (decisión del usuario, 03/11/2026)
- **El usuario** da de alta las piezas, cambia el stock y **sube sus fotos** desde la web (móvil). Si una pieza tiene foto se muestra; si no, solo el nombre. Nada de recuadros ni de clasificar fotos de bandejas.
- **Claude** mantiene el glosario (fichas de cada tipo), propone proyectos con lo que hay en stock y mejora la aplicación.

## Estructura
- `server/index.mjs` — servidor en Node 24 sin frameworks; dependencias de npm solo para la IA (`ai`, `@ai-sdk/*`, `zod`): sirve `public/`, la API (`/api/...`), las fotos (`/fotos/...`) y `/salud` (healthcheck de Docker). **Sin contraseña** (decisión del usuario, 06/11/2026): solo red local / Tailscale. Al arrancar aplica el catálogo de `seed/`. `server/db.mjs` — esquema SQLite (`node:sqlite`). `server/copias.mjs` — copia diaria (`VACUUM INTO` + fotos nuevas) en `data/copias/` o `AMS_LAB_COPIAS`; `npm run copia` hace una ya.
- `data/lab.db` + `data/fotos/` — **los datos reales del usuario** (no van a git; copia de seguridad = copiar `data/`). Nunca borrar ni sobrescribir sin preguntar.
- `seed/*.json` — referencia (`referencia.json`) y catálogo (`glosario.json`, `proyectos.json`); `componentes.json` solo se usa al crear una base de datos nueva.
- `public/` — la web (`index.html`, `app.js`, `style.css`); la foto se reduce en el móvil a 1600 px JPEG antes de subirla. `public/sw.js` — modo sin conexión (solo con HTTPS/localhost): red primero para la web y `/api/datos`, fotos guardadas al verlas. Si cambias la lista de ficheros que precarga, sube `WEB` (`ams-web-vN`).
- `public/img/tipos/<tipo>.svg` — dibujos de referencia de cada tipo (solo en la ficha del glosario), generados por `scripts/dibujos.mjs` (`npm run dibujos`). Recreaciones propias, nunca imágenes de internet.
- `Dockerfile` + `docker-compose.yml` + `docker-entrypoint.sh` — despliegue en el homelab (`./data` como volumen; la app corre como `node`). Ficheros en LF (`.gitattributes`).
- Git: rama `main`; `data/` y `entrada/` no van al repositorio.

## Modelo de datos v5 (leer docs/modelo-datos.md)
- **La base de datos es la fuente de verdad** (decisión del usuario, 06/11/2026, para que la IA pueda clasificar y reorganizar). Categorías y tipos llevan `origen` (`seed` | `ia` | `usuario`); `seed/` crea lo que falta y solo actualiza lo que sigue siendo `seed`: **nunca pisa** lo creado o cambiado por la IA o por el usuario. Quien cambie un tipo o una categoría tiene que poner su `origen`.
- **Referencia** (categorías, funciones de pin con su **color**, dificultades) y **catálogo** (tipos, pines, alias, interfaces, datos extra, proyectos): las fichas de origen `seed` se editan en `seed/` y se aplican con `npm run catalogo` (o al arrancar). Los pines se editan en `scripts/pines.mjs` (`npm run pines` = escribir seed + catalogo); uso de 2–4 palabras; función = id de `funciones_pin`. Una ficha con origen `ia` o `usuario` ya no la cambia `seed/`.
- `tipos.revisado = 0`: ficha escrita por la IA sin comprobar. Datos extra clave → valor en `tipo_datos` (iguales para todo el tipo) y `componente_datos` (de cada pieza). Llamadas al modelo en `ia_tareas` (propuesta → el usuario confirma → aplicada).
- **Ajustes** (`server/catalogo.mjs`, 09/11/2026): archivar (`tipos.archivado`), fusionar y borrar tipos; renombrar, ordenar, añadir y borrar categorías; renombrar, juntar y borrar sitios; copias. Lo borrado o fusionado va a `catalogo_quitados` (con su `reemplazo`) para que `seed/` no lo resucite y los proyectos se redirijan. Un tipo con piezas o proyectos no se borra (se archiva o se fusiona). Borrar una pieza se puede deshacer 2 minutos.
- **Inventario** (componentes, sus datos, ubicaciones, historial): solo lo cambia la aplicación; el historial lo escriben *triggers*.
- **IA** (`server/ia.mjs`, decisión del usuario 06/11/2026: OpenCode Go con el AI SDK v7, como indica la doc de Go para aplicaciones; el `@opencode/sdk` NO sirve: aloja un agente de código). «Añadir con IA» crea una tarea, el modelo propone con **salida estructurada** (y si no la cumple del todo, `rescatar()` la aprovecha anotando cada corrección como duda) (esquema zod con enums de la base de datos; si no cumple, un reintento) y `normalizar()` limpia; **el usuario confirma** antes de guardar (con vista previa de la ficha); puede contestar las dudas y el modelo rehace la propuesta con sus respuestas y correcciones (vueltas en `ia_tareas.entrada.rondas`, máx. 5); las fichas nuevas van con `origen = 'ia'`, `revisado = 0`. Nunca aplicar propuestas sin confirmación. Solo se ofrecen modelos que el catálogo `GET https://opencode.ai/inference/go/v1/models` marca con `image/jpeg` y `structured_output` (APIs `chat-completions` y `messages`). Clave y modelo desde la web (tabla `ia_config`, la API nunca devuelve la clave); `IA_CLAVE`/`IA_MODELO` solo como respaldo. Para probar sin gastar cuota: `IA_BASE` apuntando a un servidor simulado.
- **Nada de configuración permanente en la web** (decisión del usuario, 03/11/2026): colores, categorías, dificultades… siempre en tablas, y la web los lee de `/api/datos`.
- Los mismos colores de función de pin para todos los dispositivos.
- Cambios de esquema: subir `VERSION` en `server/db.mjs` con su migración paso a paso (`abrir()` ya hace la copia `VACUUM INTO` previa, `lab-antes-…`). Probar siempre la migración sobre una copia de `data/lab.db`, nunca sobre el original.

## Cómo trabajar
- Arrancar: `npm start` (o `npm run dev`, que reinicia al cambiar el servidor). Desde el móvil, la URL «móvil →» que imprime (misma Wi-Fi).
- Leer el inventario real: `GET /api/datos` o `node -e` con `node:sqlite` sobre `data/lab.db` (para copiarla, `VACUUM INTO`: con `cp` sale incompleta por el modo WAL).
- **Añadir o mejorar fichas del glosario o proyectos**: editar `seed/*.json` (o `scripts/pines.mjs`) y `npm run catalogo`. Proponer proyectos solo con lo que hay en stock (o diciendo qué falta).
- Nunca tocar `componentes` sin que el usuario lo pida: es su inventario.
- Pruebas: si creas piezas de prueba, bórralas después (también sus filas de `historial` y fotos).
