# [AMS] lab

Almacén digital personal de componentes electrónicos: inventario con stock y fotos, glosario y proyectos.

- `npm start` → http://localhost:4321 · desde el móvil, la dirección «móvil →» que sale en la consola (misma Wi-Fi)
- Contraseña opcional: `AMS_LAB_PASS=lo-que-quieras npm start`
- Copia de seguridad: automática cada día (ver abajo), `npm run copia` para hacer una ya, o «exportar» en http://localhost:4321/api/exportar (solo datos, sin fotos)

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
