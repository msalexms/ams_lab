# [AMS] lab

Almacén digital personal de componentes electrónicos: inventario con stock y fotos, glosario y proyectos.

- `npm start` → http://localhost:4321 · desde el móvil, la dirección «móvil →» que sale en la consola (misma Wi-Fi)
- Contraseña opcional: `AMS_LAB_PASS=lo-que-quieras npm start`
- Homelab: copia la carpeta al servidor y `docker compose up -d --build` → http://<servidor>:4321
- Copia de seguridad: la carpeta `data/` (base de datos + fotos), o «exportar» en http://localhost:4321/api/exportar

Detalles para Claude: `CLAUDE.md`.
