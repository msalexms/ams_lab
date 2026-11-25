# Changelog

Each version that lands on `main` is published automatically: the Docker image gets its version tag and a GitHub
release is created from the matching section below. To ship a new version, bump `version` in `package.json`
(`npm version <x.y.z> --no-git-tag-version`), add its section here and merge.

## 0.1.0-beta.1

First public beta of CircuitBin.

- **Inventory** — parts with photos (or the drawing of their type), quantity, location and per-part data; list or
  grid view, categories, search across parts, pins and notes, bulk edit and delete with undo.
- **Glossary** — one datasheet per component type with color-coded pinouts (one pin per row, with notes), interfaces,
  extra data and a “Heads up” box; edit by hand or with AI.
- **Projects** — stock-matched recipes (material, wiring, steps) plus your own status, task board, build log and files.
- **Optional AI** (OpenCode Go) — add a part from photos, split a photo with many parts, fix existing datasheets;
  nothing is saved until you confirm it.
- **Data hygiene** — consistent formatting of units and interfaces, archive, merge and delete types and categories,
  full change history.
- **Backups** — daily SQLite snapshots, full `.tar.gz` export and restore with a safety copy first.
- **Offline PWA**, English and Spanish UI, light and dark themes.
- Docker image for `linux/amd64` and `linux/arm64`.

Known limits: no user accounts or authentication (run it on your LAN or behind Tailscale/an authenticated proxy).
