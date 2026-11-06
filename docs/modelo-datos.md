# Modelo de datos (v2) — `data/lab.db`

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

  categorias { text id PK; text nombre UK; int orden }
  funciones_pin { text id PK; text nombre UK; text color_claro "#RRGGBB"; text color_oscuro "#RRGGBB"; int tachado; int orden }
  ajustes { text clave PK; text valor }
  dificultades { int nivel PK; text nombre UK }
  tipos { text id PK; text nombre; text categoria_id FK; text resumen; text voltaje; text usos; text conexion; text advertencias }
  tipo_pines { text tipo_id PK,FK; int orden PK; text pin; text uso; text funcion_id FK }
  tipo_alias { text tipo_id PK,FK; text alias PK }
  tipo_interfaces { text tipo_id PK,FK; int orden PK; text interfaz }
  ubicaciones { int id PK; text nombre UK }
  componentes { int id PK; text nombre; text tipo_id FK; int cantidad "NULL=sin contar"; int varios; int ubicacion_id FK; text notas; int revisar; text foto UK; text creado; text actualizado }
  historial { int id PK; int componente_id FK; text componente_nombre; text accion "alta|stock|baja"; text antes; text despues; text fecha }
  proyectos { text id PK; text nombre; int dificultad FK; text tiempo; text resumen }
  proyecto_material { int id PK; text proyecto_id FK; int orden; int cantidad; int opcional; text nota }
  material_opciones { int material_id PK,FK; text tipo_id PK,FK }
  proyecto_conexiones { text proyecto_id PK,FK; int orden PK; text desde; text hasta; text nota }
  proyecto_pasos { text proyecto_id PK,FK; int orden PK; text texto }
```

## Tres capas
| Capa | Tablas | Quién la cambia |
|---|---|---|
| **Referencia** (configuración) | `categorias`, `funciones_pin` (nombre + **color claro y de noche** + tachado), `dificultades`; `ajustes` (tema: auto, claro, noche — el valor por defecto viene de seed, el elegido no se pisa) | `seed/referencia.json` → `npm run catalogo` |
| **Catálogo** | `tipos`, `tipo_pines`, `tipo_alias`, `tipo_interfaces`, `proyectos` y sus tablas | `seed/glosario.json`, `seed/proyectos.json` → `npm run catalogo` |
| **Inventario** (datos del usuario) | `componentes`, `ubicaciones`, `historial` | solo la aplicación |

La web no guarda configuración propia: categorías, funciones de pin con sus colores y dificultades le llegan en `GET /api/datos`.

## Reglas en la base de datos
- `cantidad ≥ 0`; `varios = 1` (muchos) obliga a `cantidad = NULL`; nombres no vacíos; colores `#RRGGBB`; booleanos 0/1.
- Claves foráneas activas: borrar un tipo deja sus piezas «sin tipo» (`SET NULL`); borrar un proyecto borra su material, conexiones y pasos (`CASCADE`); renombrar ids se propaga (`ON UPDATE CASCADE`).
- *Triggers*: `actualizado` se pone solo; `historial` registra altas, cambios de stock y bajas, aunque el cambio no venga de la web.
- Ubicaciones únicas sin distinguir mayúsculas («Cajita 3» = «cajita 3»).

## Migraciones
- v1 → v2 (03/11/2026): `funciones_pin.color` pasa a `color_oscuro` y se añade `color_claro`; nueva tabla `ajustes`.
`abrir()` mira `PRAGMA user_version`: 0 con tablas antiguas → migra desde v0 (fichas y proyectos en JSON) conservando ids, cantidades y fotos; 0 sin tablas → crea y siembra desde `seed/`. Antes de una migración: `VACUUM INTO 'data/copias/…'`.
