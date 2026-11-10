# [AMS] lab

Almacén digital personal de componentes electrónicos: inventario con stock y fotos, glosario y proyectos.

- `npm start` → http://localhost:4321 · desde el móvil, la dirección «móvil →» que sale en la consola (misma Wi-Fi)
- Sin contraseña: pensada solo para la red de casa (o Tailscale). No la publiques en internet tal cual.
- Copia de seguridad: automática cada día (ver abajo), `npm run copia` para hacer una ya, y desde **Ajustes → Datos** se descarga una copia completa (`.tar.gz` con la base de datos y las fotos) o se restaura una

## Ajustes

Pestaña **Ajustes**: IA (modelo y clave), **categorías** (renombrar, ordenar, añadir, borrar moviendo sus tipos), **tipos** (archivar, fusionar duplicados, borrar los que no usa nada; filtros «sin comprobar», «de la IA», «sin piezas», «archivados»), **sitios** (renombrar, juntar, borrar), **datos** (descargar una copia completa, restaurar desde un archivo o desde una copia del servidor, «hacer copia ahora») y tema. Lo que se borra del catálogo no vuelve al actualizar la imagen. Al borrar una pieza sale «Deshacer» unos segundos.

## Uso diario

- **Pieza** = lo que tienes en el cajón: cantidad, sitio, foto, notas y sus datos propios («Valor» → «220 Ω»). **Ficha del tipo** = la hoja de datos común a todas las piezas iguales (pines, tensión, resumen, «Ojo», datos del tipo); está en el Glosario y, si la cambias, cambia para todas. La ficha de una pieza enseña arriba «Esta pieza» y debajo «Ficha del tipo».
- Dos avisos distintos: **«pendiente»** es una marca tuya en una pieza («quiero mirar algo de esta pieza»; se quita con «Hecho: quitar la marca»). **«Sin comprobar»** sale en una ficha del tipo que escribió o cambió la IA; se quita con «Ya la he comprobado» (o al guardarla con «Editar ficha»).

- **Ficha de una pieza** (y del tipo): arriba lo que se consulta con la pieza en la mano —cuántas, dónde, el tipo, los avisos («Ojo», «sin comprobar», «pendiente») y los pines—; las acciones en una fila (Editar, Foto, Corregir con IA y un menú «⋯» con lo que se usa poco); lo demás (resumen, datos del tipo, notas, proyectos) plegado.
- **Letra** (Ajustes → Letra): JetBrains Mono (por defecto), «mixta» (mono en nombres, pines y datos; sin serifa en los párrafos), IBM Plex Mono, la monoespaciada del sistema, IBM Plex Sans o la del sistema; cada una se ve con una muestra y se guarda en el servidor. Las letras van dentro de la app (licencia SIL OFL), así que salen iguales en todos los dispositivos.
- **Inventario** en lista o en **cuadrícula con las fotos** (se recuerda en la tabla `ajustes`, `vista_inventario`).
- **Buscar** (arriba, tecla `/`): en una lista la filtra y avisa si hay coincidencias en otras secciones; desde cualquier otro sitio, o con Intro, busca en todo (piezas, tipos —también por pines, alias, interfaces y datos— y proyectos).
- **Editar ficha** de un tipo a mano: nombre, categoría, resumen, tensión, interfaces, alias, «Ojo» y las **tablas de pines y datos** (añadir, ordenar arrastrando por el asa ⠿, quitar). Al guardar pasa a ser tuya (`origen = 'usuario'`, comprobada) y `seed/` ya no la toca. Si la ficha cambió mientras la editabas (la IA u otra pestaña), no se pisa: hay que recargar.
- **Datos de cada pieza** («Valor» → «220 Ω») en su formulario, también como tabla. El **tipo** se elige escribiendo (busca por nombre, alias, interfaz o categoría).
- **Móvil**: barra de abajo (Inventario, Glosario, «+», Proyectos, Ajustes); el «+» abre el menú de añadir. Se esconde mientras escribes. En el iPhone queda mejor como app: Safari → Compartir → «Añadir a pantalla de inicio» (sin las barras de Safari).
- **Fotos encuadradas**: al hacer o elegir una foto sale un recuadro 4:3 (el formato de las tarjetas); mueve, acerca o gira la foto para que la pieza quepa dentro. «Sin recortar» la sube entera.

## Añadir con IA

Botón «Añadir con IA»: foto y/o texto de una pieza → el modelo propone nombre, tipo (o una ficha nueva con pines y datos) → **tú lo revisas y guardas**. Nada entra en el inventario sin confirmar; las fichas nuevas quedan «sin comprobar» hasta que pulses «Ya la he comprobado».

- Proveedor: OpenCode Go, con el AI SDK (el paquete que indica el catálogo de Go para cada modelo). **La clave y el modelo se ponen en la web**: «Añadir con IA» → Configuración. Solo salen los modelos que entienden fotos y devuelven datos con formato fijo, con su precio; al guardar se comprueba la clave con una llamada mínima.
- La clave se guarda en la base de datos (la web solo enseña sus 4 últimos caracteres) y viaja en las copias de seguridad. `IA_CLAVE` / `IA_MODELO` (o un `.env` en local) solo se usan si en la web no hay nada.
- Formato garantizado: el modelo responde con un esquema cerrado (categorías, funciones de pin y tipos existentes salen de la base de datos); si no lo cumple se reintenta una vez y si no, error.
- Antes de guardar: **vista previa** de cómo quedará la ficha, y puedes **contestar las dudas** del modelo para que rehaga la propuesta (hasta 5 vueltas; cada una cuenta como una consulta). Se ve el coste aproximado de cada consulta.
- **Cuánto razona** (Ajustes → IA): poco (por defecto, rápido y barato), medio o mucho (acierta más en piezas difíciles, pero tarda y cuesta más). La pantalla dice qué significa cada nivel con el modelo elegido.
- **Modelo**: el de siempre se cambia con un toque en Configuración (sin volver a poner la clave), y al analizar se puede elegir otro solo para esa pieza. Cada modelo muestra lo que cuesta por pieza: la media real de tus consultas o una estimación.
- **Móvil**: el botón «+» ofrece «Foto con IA» (abre la cámara y la analiza al momento), «Elegir foto con IA» o «A mano». Mientras el modelo piensa se ve qué pasa, cuántos segundos lleva y el esqueleto de la ficha.
- **Corregir con IA**: en la ficha de cada pieza y de cada tipo; si el modelo pregunta algo, lo contestas ahí mismo y rehace los cambios («Responder y repensar»). Dices qué corregir (opcional, también con foto; si no pones ninguna, la IA mira la que ya tiene la pieza) y el modelo propone cambios; ves **solo los cambios** (antes tachado, después en claro) y marcas cuáles aplicar; la pestaña «Vista previa» enseña cómo quedaría la ficha con solo los marcados. Si la ficha cambió mientras tanto, no se pisa nada.
- Cada consulta se guarda en la tabla `ia_tareas`: si cierras la pestaña mientras piensa, la propuesta te espera en «Añadir con IA».

## Docker (homelab)

```sh
docker compose up -d --build          # construye la imagen ams-lab:latest y arranca → http://<servidor>:4321
docker compose logs -f                # ver qué hace
docker compose exec ams-lab npm run copia
```

- Los datos viven en `./data` (base de datos + fotos). Al arrancar, la app aplica el catálogo de `seed/`: actualizar el glosario o los proyectos = reconstruir la imagen (`docker compose up -d --build`).
- Una instalación nueva empieza con un **catálogo básico** (18 tipos comunes con sus pines y 4 proyectos) y **6 piezas de ejemplo** («(ejemplo)» en el nombre): bórralas cuando añadas las tuyas. Para llevarte tu inventario a otra máquina, descarga una copia completa y restáurala allí.
- Sin `docker compose`: `docker build -t ams-lab .` y `docker run -d --name ams-lab --init -p 4321:4321 -v ./data:/data ams-lab`
- Llevar la imagen a otra máquina sin el código: `docker save ams-lab:latest -o ams-lab.tar` → copiar → `docker load -i ams-lab.tar`. Si el servidor es ARM (Raspberry Pi): `docker buildx build --platform linux/arm64 -t ams-lab .`
- La app corre como el usuario `node` del contenedor; al arrancar deja `./data` a su nombre (uid 1000).

## Copias de seguridad

Cada día (al arrancar y luego cada hora comprueba si falta) se guarda `copias/lab-AAAA-MM-DD.db` (copia completa con `VACUUM INTO`) y las fotos nuevas en `copias/fotos/` (las fotos nunca se borran de la copia). Se guardan las 14 últimas.

- `AMS_LAB_COPIAS=/ruta` cambia la carpeta (por defecto `data/copias`). **Mejor en otro disco**: en `docker-compose.yml` descomenta el volumen `/copias`.
- `AMS_LAB_COPIAS_MAX=30` cambia cuántas se guardan (`0` = ninguna).
- **Descargar** (Ajustes → Datos → «Descargar copia completa», `GET /api/copia/exportar`): un `.tar.gz` con `lab.db`, las fotos y `manifiesto.json`. Lleva la clave de la IA: guárdalo en un sitio seguro.
- **Restaurar** (Ajustes → Datos): sube ese `.tar.gz` o un `.db` suelto, o elige una copia del servidor. Primero se comprueba (que sea SQLite, de esta app, de una versión que esta app entiende y sin daños) y se ve qué contiene frente a lo de ahora; nada cambia hasta confirmar. Al restaurar se guarda antes el estado actual como `copias/lab-antes-restaurar-<fecha>.db` (con sus fotos en `copias/fotos/`), se pone la base de datos de la copia (migrándola si es antigua) y se añaden sus fotos sin borrar ni pisar ninguna. No hace falta reiniciar.
- A mano (con la app parada): copia la que quieras a `data/lab.db` (borrando `lab.db-wal` y `lab.db-shm`) y las fotos de `copias/fotos/` a `data/fotos/`.

## Sin conexión (móvil)

La web guarda en el móvil la última copia del inventario, el glosario y los proyectos, y las fotos que ya has visto. Sin red se puede consultar todo (sale «Sin conexión · datos del …»), pero no guardar cambios.

Los navegadores solo lo permiten con **HTTPS** (o en `localhost`): con `http://192.168.x.x` no funciona. Lo más fácil, con Tailscale en el servidor:

```sh
tailscale serve --bg 4321             # → https://<servidor>.<tu-tailnet>.ts.net
```

Abre esa dirección en el móvil y, si quieres, «Añadir a pantalla de inicio».

Detalles para Claude: `CLAUDE.md`.
