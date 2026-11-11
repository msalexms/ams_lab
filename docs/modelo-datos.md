# Modelo de datos (v8) — `data/lab.db`

SQLite (`node:sqlite`). Esquema y migraciones en `server/db.mjs`; versión en `PRAGMA user_version`.

```mermaid
erDiagram
  categorias ||--o{ tipos : clasifica
  tipos ||--o{ tipo_pines : tiene
  funciones_pin ||--o{ tipo_pines : colorea
  tipos ||--o{ tipo_alias : "se llama también"
  tipos ||--o{ tipo_interfaces : usa
  tipos |o--o{ componentes : "es de tipo"
  ubicaciones |o--o{ componentes : guarda
  componentes |o--o{ historial : registra
  dificultades ||--o{ proyectos : nivel
  proyectos ||--o{ proyecto_material : necesita
  proyecto_material ||--|{ material_opciones : "vale cualquiera de"
  tipos ||--o{ material_opciones : ""
  proyectos ||--o{ proyecto_conexiones : cablea
  proyectos ||--o{ proyecto_pasos : sigue
  proyectos ||--o{ proyecto_notas : "bitácora"
  proyectos ||--o{ proyecto_tareas : "tablero"
  proyectos ||--o{ proyecto_archivos : "diagramas"
  tipos ||--o{ tipo_datos : "ficha extendida"
  componentes ||--o{ componente_datos : "datos de la pieza"
  componentes |o--o{ ia_tareas : "creada por"

  categorias { text id PK; text nombre UK; int orden; text origen "seed|ia|usuario" }
  funciones_pin { text id PK; text nombre UK; text color_claro "#RRGGBB"; text color_oscuro "#RRGGBB"; int tachado; int orden }
  ajustes { text clave PK; text valor }
  dificultades { int nivel PK; text nombre UK }
  tipos { text id PK; text nombre; text categoria_id FK; text resumen; text voltaje; text usos; text conexion; text advertencias; text origen "seed|ia|usuario"; int revisado; int archivado }
  tipo_datos { text tipo_id PK,FK; text clave PK; int orden; text valor }
  componente_datos { int componente_id PK,FK; text clave PK; int orden; text valor }
  catalogo_quitados { text clase PK "tipo|categoria"; text id PK; text reemplazo; text fecha }
  ia_config { int id PK "siempre 1"; text clave "nunca sale por la API"; text modelo; text actualizado }
  ia_tareas { int id PK; text clase "alta|revisar|reorganizar"; text estado "pendiente|propuesta|aplicada|descartada|error"; text entrada "JSON"; text propuesta "JSON"; int componente_id FK; text modelo; text error; text creada; text actualizada }
  tipo_pines { text tipo_id PK,FK; int orden PK; text pin "uno solo"; text uso; text funcion_id FK; text nota }
  tipo_alias { text tipo_id PK,FK; text alias PK }
  tipo_interfaces { text tipo_id PK,FK; int orden PK; text interfaz }
  ubicaciones { int id PK; text nombre UK }
  componentes { int id PK; text nombre; text tipo_id FK; int cantidad "NULL=sin contar"; int varios; int ubicacion_id FK; text notas; int revisar; text foto UK; text creado; text actualizado }
  historial { int id PK; int componente_id FK; text componente_nombre; text accion "alta|stock|baja"; text antes; text despues; text fecha }
  auditoria { int id PK; text fecha; text quien "usuario|ia|sistema"; text accion; text objeto; text objeto_id; text nombre; text resumen; text detalle "JSON"; text modelo }
  proyectos { text id PK; text nombre; int dificultad FK; text tiempo; text resumen; text origen "seed|ia|usuario"; text estado "idea|en_marcha|pausa|terminado" }
  proyecto_material { int id PK; text proyecto_id FK; int orden; int cantidad; int opcional; text nota }
  material_opciones { int material_id PK,FK; text tipo_id PK,FK }
  proyecto_conexiones { text proyecto_id PK,FK; int orden PK; text desde; text hasta; text nota }
  proyecto_pasos { text proyecto_id PK,FK; int orden PK; text texto }
  proyecto_notas { int id PK; text proyecto_id FK; text texto; text foto UK; text fecha }
  proyecto_tareas { int id PK; text proyecto_id FK; text texto; text columna "hacer|curso|hecho"; int orden; text creada }
  proyecto_archivos { int id PK; text proyecto_id FK; text fichero UK; text nombre; text tipo; int bytes; text fecha }
```

## Tres capas
| Capa | Tablas | Quién la cambia |
|---|---|---|
| **Referencia** (configuración) | `categorias`, `funciones_pin` (nombre + **color claro y de noche** + tachado), `dificultades`; `ajustes` (tema: auto, claro, noche; vista_inventario: lista, cuadricula; ia_razonar: poco (por defecto), medio, mucho; fuente: jetbrains (por defecto), mixta, plex-mono, mono-sistema, plex-sans, sistema — el valor por defecto viene de seed, el elegido no se pisa; los valores válidos los comprueba el servidor) | `seed/referencia.json`; las categorías también la IA o el usuario |
| **Catálogo** | `tipos`, `tipo_pines`, `tipo_alias`, `tipo_interfaces`, `tipo_datos`, `proyectos` y sus tablas | `seed/glosario.json`, `seed/proyectos.json`; los tipos y los proyectos también la IA o el usuario |
| **Inventario** (datos del usuario) | `componentes`, `componente_datos`, `ubicaciones`, `historial`; de cada proyecto, `proyectos.estado`, `proyecto_notas`, `proyecto_tareas` y `proyecto_archivos` | solo la aplicación |
| **IA** | `ia_tareas` | la aplicación al llamar al modelo |

La web no guarda configuración propia: categorías, funciones de pin con sus colores y dificultades le llegan en `GET /api/datos`.

## Quién manda: la base de datos (desde v3)
- La **base de datos es la fuente de verdad** del catálogo. `seed/` sirve para crear una base nueva y para traer fichas nuevas o corregidas con una imagen nueva.
- Cada categoría y cada tipo tiene `origen`: `seed` (viene de `seed/` y nadie lo ha cambiado), `ia` (creado o cambiado por el modelo) o `usuario` (creado o cambiado desde la web).
- Al arrancar (y con `npm run catalogo`) se aplica `seed/`: crea lo que falta y actualiza solo lo que sigue siendo `seed`. **Nunca pisa** algo con origen `ia` o `usuario`; el arranque dice cuántos tipos ha respetado.
- Quien cambie un tipo o una categoría (la IA, la web) debe poner su `origen`; si no, el siguiente arranque lo devuelve a lo que diga `seed/`.
- `revisado = 0`: ficha escrita por la IA que nadie ha comprobado (la web lo dirá en texto). Las fichas de `seed` y las del usuario nacen revisadas.
- `funciones_pin` y `dificultades` siguen siendo solo de `seed/` (colores iguales para todos los dispositivos).

## Borrar, archivar y fusionar (v5, desde Ajustes)
- **Archivar** un tipo (`archivado = 1`): no sale en el glosario, ni al elegir tipo, ni se lo ofrece la IA; sus piezas y proyectos siguen igual. Se recupera cuando quieras.
- **Fusionar** A en B: las piezas y los proyectos de A pasan a B y A desaparece. Si B no es de `seed`, se lleva el nombre y los alias de A.
- **Borrar** un tipo: solo si ninguna pieza ni ningún proyecto lo usa.
- **Categorías**: renombrar, reordenar (pasan a origen `usuario`), añadir y borrar moviendo antes sus tipos a otra. `otro` no se borra: es la de reserva.
- **`catalogo_quitados`** apunta lo borrado o fusionado y **por qué se sustituyó** (`reemplazo`): `seed/` no lo vuelve a crear, los proyectos de `seed/` que lo usaban se redirigen al reemplazo, y los tipos de `seed/` cuya categoría se borró van a la que recibió sus tipos. Los ids nuevos nunca reutilizan uno quitado.
- **Sitios** (`ubicaciones`): renombrar; si el nombre ya existe (sin mirar mayúsculas), se juntan. Borrar deja sus piezas sin sitio.
- **Piezas**: al borrar una, el servidor la guarda 2 minutos para «Deshacer» (la foto espera como `papelera-…` y se borra al vencer o al arrancar).

## «Corregir con IA» (v6; antes «Revisar con IA»)
Desde una pieza (revisa la pieza y la ficha de su tipo) o desde un tipo. La tarea (`clase = 'revisar'`) guarda en `entrada.objetivo` qué se revisa (`tipo_id`, `componente_id`). El modelo devuelve la ficha (y la pieza) **entera y corregida**; el servidor (`server/revision.mjs`) la compara con lo guardado y la propuesta es una lista de **cambios** (`id`, campo, antes, después; pines y datos emparejados por su nombre; el orden y las mayúsculas de los pines son un cambio aparte, «Orden de los pines», que se aplica después de los demás; en los textos, un cambio solo de mayúsculas también cuenta). Al aplicar los marcados se comprueba que lo de «antes» sigue igual: si la ficha cambió entretanto, no se aplica nada (409). Los cambios en la ficha la dejan con `origen = 'ia'` y `revisado = 0`.

## Varias piezas y cambio de tipo con la IA (11/11/2026)
Sin cambio de esquema. Una corrección hecha desde una pieza puede proponer el cambio `pieza.tipo`: `{existente: id}` o `{nuevo: ficha}`; al aplicarlo se comprueba que la pieza sigue con el tipo de antes (si no, 409) y, si es nuevo, se crea la ficha (`origen = 'ia'`, `revisado = 0`) con un id libre. Las correcciones en lote son tareas `revisar` normales con `entrada.lote` en común.

## Historial de cambios (`auditoria`, v7)
Lo escribe el servidor (`server/auditoria.mjs`) cada vez que algo cambia, y se ve en Ajustes → Historial y en el desplegable «Historial» de cada pieza y de cada ficha (el de una pieza incluye también los cambios de la ficha de su tipo).
- `quien`: `usuario` (desde la web), `ia` (cambios de la IA que el usuario confirmó; `modelo` dice con cuál) o `sistema`.
- `accion`: `pieza.alta|editar|stock|foto|borrar|restaurar`, `tipo.alta|editar|comprobar|archivar|fusionar|borrar`, `categoria.*`, `sitio.*`, `ia.aplicar|alta|descartar|config`, `copia.hacer|exportar|restaurar`, `ajustes.cambiar`.
- `objeto` + `objeto_id`: a qué afecta (puede que ya no exista); `nombre`: cómo se llamaba entonces; `resumen`: la frase que se lee; `detalle`: `{cambios: [{campo, antes, despues}], …}` (más lo que tenía una pieza borrada, el lote de la IA, la copia guardada antes de restaurar…).
- Nunca guarda la clave de la IA. Se quedan las 20 000 últimas (las más antiguas se borran al arrancar). `historial` (stock, con *triggers*) sigue igual.
- API: `GET /api/auditoria?grupo=piezas|fichas|ia|catalogo|sistema&objeto=&id=&tipo=&q=&antes=<id>&limite=` → `{filas, mas}`.

## Registro del servidor y «Cambios pendientes» (sin tablas)
- **Registro** (`server/registro.mjs`): los últimos 1000 mensajes de la consola en memoria (arranque, copias, la IA, cada petición que cambia algo y los errores; las consultas GET normales no). Se pierde al reiniciar; `docker logs` sigue teniendo lo mismo. `GET /api/registro?nivel=todo|avisos|errores&q=&desde=`.
- **Cambios pendientes**: `ia_tareas` en `pendiente`, `propuesta` o `error`, con los lotes juntos. `GET /api/ia/pendientes` (`{lotes, tareas, total}`) y `GET /api/ia/pendientes/cuenta` (para el aviso del Inventario).

## Editar una ficha a mano (fase D)
`GET /api/tipos/:id/ficha` da la ficha entera (formato de `guardarTipo`) y su **huella** (resumen de nombre, categoría, textos, alias, interfaces, pines y datos). `PUT` con la ficha nueva y esa huella: si la de ahora no coincide (la cambió la IA u otra pestaña), 409 y no se guarda nada. Se valida (nombre, categoría existente, función de pin existente, sin pines ni datos repetidos) y se guarda con `origen = 'usuario'`, `revisado = 1`. Los datos de una pieza llegan como `datos: [[clave, valor], …]` en el alta y la edición y se reescriben enteros.

## Copias completas: exportar y restaurar
- Exportar: `.tar.gz` (ustar + gzip) con `manifiesto.json`, `lab.db` (`VACUUM INTO`) y `fotos/*` (`server/respaldo.mjs`).
- Restaurar en dos pasos: **preparar** (`POST /api/copia/preparar` con el archivo, o `POST /api/copias/<nombre>/preparar`) lo deja en `<datos>/restaurar/<token>/` y lo comprueba (cabecera SQLite, `user_version` ≤ la de la app, tablas `componentes` y `tipos`, `integrity_check`); **confirmar** (`POST /api/copia/restaurar {token}`) hace `VACUUM INTO lab-antes-restaurar-<fecha>.db`, cierra la base de datos, pone la nueva, mueve las fotos que falten y la vuelve a abrir (`abrir()` migra si es antigua). Solo hay una restauración preparada a la vez; las que no se confirman se borran al arrancar. No se restaura mientras la IA tiene una tarea pensando.

## Proyectos (desde v8)
- Un proyecto tiene dos partes. La **receta** (nombre, resumen, dificultad, tiempo, material, conexiones y pasos) es catálogo: lleva `origen` como los tipos, `seed/proyectos.json` solo actualiza los que siguen siendo `seed` y, al editarlo desde la web (`PUT /api/proyectos/:id`) o crearlo (`POST /api/proyectos`), queda como `usuario`.
- Lo **del usuario** cuelga de la fila del proyecto: `estado`, la bitácora (`proyecto_notas`, con foto opcional), el tablero (`proyecto_tareas`, tres columnas) y los archivos (`proyecto_archivos`: imágenes o PDF). `seed/` nunca lo toca: `guardarProyecto()` actualiza la fila (no la borra) y solo reescribe material, conexiones y pasos.
- Las fotos de las notas y los archivos están en `data/fotos` con el prefijo `p-`; entran en las copias diarias y en la copia completa como las fotos de las piezas.
- Borrar un proyecto borra también su bitácora, su tablero y sus archivos (y los ficheros), y lo apunta en `catalogo_quitados` (clase `proyecto`) para que `seed/` no lo vuelva a crear.
- El material no guarda qué pieza concreta se usa: la web lo calcula con el inventario (tus piezas de esos tipos, con su foto y su sitio).
- `GET /api/datos` entrega cada proyecto con su receta y los recuentos (`tareas` por columna, `notas`, `archivos`); el detalle se pide con `GET /api/proyectos/:id`.

## Datos extra (clave → valor)
- `tipo_datos`: lo que es igual en todas las piezas de un tipo (corriente máxima, dirección I2C, frecuencia…). En `seed/glosario.json`, campo `datos` (`{"Clave": "valor"}`).
- `componente_datos`: lo que cambia de una pieza a otra del mismo tipo (el valor de una resistencia, el encapsulado…).
- La API los entrega como listas `[clave, valor]` en `tipos.<id>.datos` y `componentes[].datos`.

## Tareas de la IA (`ia_tareas`)
Clases: `alta` (una pieza nueva), `revisar` (corregir una pieza o una ficha) y `detectar` (v8: separar las piezas de una foto con varias; su `propuesta` es `{piezas: [{nombre, descripcion, cantidad, caja: {x, y, ancho, alto} en milésimas}], dudas}` y, al elegir las piezas, crea un alta por recorte con el mismo `entrada.lote`).

Cada llamada al modelo se guarda: qué se le pidió (`entrada`, JSON), qué propuso (`propuesta`, JSON) y en qué quedó (`estado`). Si el usuario contesta las dudas, cada vuelta se añade a `entrada.rondas` (`{propuesta corregida, respuestas, extra}`, máx. 5) y el modelo rehace la propuesta. Nada se aplica sin pasar por `propuesta` y la confirmación del usuario; así una respuesta lenta o una pestaña cerrada no se pierde ni se paga dos veces.

## Reglas en la base de datos
- `cantidad ≥ 0`; `varios = 1` (muchos) obliga a `cantidad = NULL`; nombres no vacíos; colores `#RRGGBB`; booleanos 0/1.
- Claves foráneas activas: borrar un tipo deja sus piezas «sin tipo» (`SET NULL`); borrar un proyecto borra su material, conexiones, pasos, notas, tareas y archivos (`CASCADE`); renombrar ids se propaga (`ON UPDATE CASCADE`).
- *Triggers*: `actualizado` se pone solo; `historial` registra altas, cambios de stock y bajas, aunque el cambio no venga de la web. El historial completo (`auditoria`) lo escribe el servidor.
- Ubicaciones únicas sin distinguir mayúsculas («Cajita 3» = «cajita 3»).

## Migraciones
- v7 → v8 (11/11/2026): `tipo_pines.nota` (cada fila es un solo pin; lo que comparta con otro uso va en la nota). `proyectos.origen` y `proyectos.estado`; tablas `proyecto_notas`, `proyecto_tareas` y `proyecto_archivos`. `catalogo_quitados` admite la clase `proyecto`, `auditoria` el objeto `proyecto` e `ia_tareas` la clase `detectar`: como SQLite no deja cambiar un CHECK, las tres se rehacen copiando sus filas.
- v1 → v2 (03/11/2026): `funciones_pin.color` pasa a `color_oscuro` y se añade `color_claro`; nueva tabla `ajustes`.
- v2 → v3 (06/11/2026): `origen` en `categorias` y `tipos`, `revisado` en `tipos`; tablas `tipo_datos`, `componente_datos` e `ia_tareas`. Los tipos que no están en `seed/glosario.json` (creados desde la web) quedan con origen `usuario`.
- v6 → v7 (11/11/2026): tabla `auditoria` (historial de cambios). Se rellena con lo que ya se sabía: las altas, cambios de stock y bajas de `historial` y las propuestas de la IA ya aplicadas (con su modelo), por orden de fecha.
- v5 → v6 (09/11/2026): `ia_tareas.clase` admite `revisar` («Revisar con IA»). SQLite no deja cambiar un CHECK: se rehace la tabla copiando las filas, el índice y el trigger.
- v4 → v5 (09/11/2026): `tipos.archivado` y tabla `catalogo_quitados` (lo borrado o fusionado desde Ajustes).
- v3 → v4 (06/11/2026): tabla `ia_config` (una fila): clave y modelo de la IA puestos desde la web. La clave nunca sale por la API (ni en `/api/datos` ni en `/api/exportar`), pero sí está en las copias de seguridad de la base de datos.

`abrir()` mira `PRAGMA user_version`: 0 sin tablas → crea y siembra desde `seed/`; si es más antigua que la actual, **primero hace una copia completa** (`VACUUM INTO`) en la carpeta de copias como `lab-antes-vX-a-vY-<fecha>.db` (fuera de la rotación: no se borra sola) y después migra paso a paso (v0 → v8 directo, v1 → v2 → … → v8).
