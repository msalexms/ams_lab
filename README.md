# [AMS] lab

Almacén digital personal de componentes electrónicos: inventario con stock y fotos, glosario y proyectos.

- `npm start` → http://localhost:4321 · desde el móvil, la dirección «móvil →» que sale en la consola (misma Wi-Fi)
- Sin contraseña: pensada solo para la red de casa (o Tailscale). No la publiques en internet tal cual.
- Copia de seguridad: automática cada día (ver abajo), `npm run copia` para hacer una ya, o «exportar» en http://localhost:4321/api/exportar (solo datos, sin fotos)

## Ajustes

Pestaña **Ajustes**: IA (modelo y clave), **categorías** (renombrar, ordenar, añadir, borrar moviendo sus tipos), **tipos** (archivar, fusionar duplicados, borrar los que no usa nada; filtros «sin comprobar», «de la IA», «sin piezas», «archivados»), **sitios** (renombrar, juntar, borrar), **datos** (copias de seguridad, «hacer copia ahora», exportar) y tema. Lo que se borra del catálogo no vuelve al actualizar la imagen. Al borrar una pieza sale «Deshacer» unos segundos.

## Añadir con IA

Botón «Añadir con IA»: foto y/o texto de una pieza → el modelo propone nombre, tipo (o una ficha nueva con pines y datos) → **tú lo revisas y guardas**. Nada entra en el inventario sin confirmar; las fichas nuevas quedan «sin comprobar» hasta que las marques como revisadas.

- Proveedor: OpenCode Go, con el AI SDK (el paquete que indica el catálogo de Go para cada modelo). **La clave y el modelo se ponen en la web**: «Añadir con IA» → Configuración. Solo salen los modelos que entienden fotos y devuelven datos con formato fijo, con su precio; al guardar se comprueba la clave con una llamada mínima.
- La clave se guarda en la base de datos (la web solo enseña sus 4 últimos caracteres) y viaja en las copias de seguridad. `IA_CLAVE` / `IA_MODELO` (o un `.env` en local) solo se usan si en la web no hay nada.
- Formato garantizado: el modelo responde con un esquema cerrado (categorías, funciones de pin y tipos existentes salen de la base de datos); si no lo cumple se reintenta una vez y si no, error.
- Antes de guardar: **vista previa** de cómo quedará la ficha, y puedes **contestar las dudas** del modelo para que rehaga la propuesta (hasta 5 vueltas; cada una cuenta como una consulta). Se ve el coste aproximado de cada consulta.
- **Modelo**: el de siempre se cambia con un toque en Configuración (sin volver a poner la clave), y al analizar se puede elegir otro solo para esa pieza. Cada modelo muestra lo que cuesta por pieza: la media real de tus consultas o una estimación.
- **Móvil**: el botón «+» ofrece «Foto con IA» (abre la cámara y la analiza al momento), «Elegir foto con IA» o «A mano». Mientras el modelo piensa se ve qué pasa, cuántos segundos lleva y el esqueleto de la ficha.
- **Revisar con IA**: en la ficha de cada pieza y de cada tipo. Dices qué revisar (opcional, también con foto) y el modelo propone cambios; ves **solo los cambios** (antes tachado, después en claro) y marcas cuáles aplicar. Si la ficha cambió mientras tanto, no se pisa nada.
- Cada consulta se guarda en la tabla `ia_tareas`: si cierras la pestaña mientras piensa, la propuesta te espera en «Añadir con IA».

## Docker (homelab)

```sh
docker compose up -d --build          # construye la imagen ams-lab:latest y arranca → http://<servidor>:4321
docker compose logs -f                # ver qué hace
docker compose exec ams-lab npm run copia
```

- Los datos viven en `./data` (base de datos + fotos). Al arrancar, la app aplica el catálogo de `seed/`: actualizar el glosario o los proyectos = reconstruir la imagen (`docker compose up -d --build`).
- Sin `docker compose`: `docker build -t ams-lab .` y `docker run -d --name ams-lab --init -p 4321:4321 -v ./data:/data ams-lab`
- Llevar la imagen a otra máquina sin el código: `docker save ams-lab:latest -o ams-lab.tar` → copiar → `docker load -i ams-lab.tar`. Si el servidor es ARM (Raspberry Pi): `docker buildx build --platform linux/arm64 -t ams-lab .`
- La app corre como el usuario `node` del contenedor; al arrancar deja `./data` a su nombre (uid 1000).

## Copias de seguridad

Cada día (al arrancar y luego cada hora comprueba si falta) se guarda `copias/lab-AAAA-MM-DD.db` (copia completa con `VACUUM INTO`) y las fotos nuevas en `copias/fotos/` (las fotos nunca se borran de la copia). Se guardan las 14 últimas.

- `AMS_LAB_COPIAS=/ruta` cambia la carpeta (por defecto `data/copias`). **Mejor en otro disco**: en `docker-compose.yml` descomenta el volumen `/copias`.
- `AMS_LAB_COPIAS_MAX=30` cambia cuántas se guardan (`0` = ninguna).
- Restaurar: para la app, copia la que quieras a `data/lab.db` (borrando `lab.db-wal` y `lab.db-shm`) y las fotos de `copias/fotos/` a `data/fotos/`.

## Sin conexión (móvil)

La web guarda en el móvil la última copia del inventario, el glosario y los proyectos, y las fotos que ya has visto. Sin red se puede consultar todo (sale «Sin conexión · datos del …»), pero no guardar cambios.

Los navegadores solo lo permiten con **HTTPS** (o en `localhost`): con `http://192.168.x.x` no funciona. Lo más fácil, con Tailscale en el servidor:

```sh
tailscale serve --bg 4321             # → https://<servidor>.<tu-tailnet>.ts.net
```

Abre esa dirección en el móvil y, si quieres, «Añadir a pantalla de inicio».

Detalles para Claude: `CLAUDE.md`.
