# DM Vault (fresh starter)

This is a clean restart scaffold for your app architecture:

- **Global chrome** (top toolbar, left nav, right panel, footer) is rendered **once** in `index.html`.
- The **main content area** is a single outlet (`#outlet`) that changes via a tiny SPA router.
- **User content** lives in a **persistent Docker volume** (`./data` -> `/data`) so updates never overwrite it.
- No logins required when running on a user's own machine.

## Run (local Docker)

From this folder:

```bash
docker compose up --build
```

Open:

- http://localhost:8080

Your vault data is stored in `./data/`.

## Run locally (no Docker)

- Build: `npm run build` (outputs to `dist/`)
- Start: `npm run start` (serves SPA from `dist/`)

The server serves `dist/index.html` for unknown non-API routes so deep links like `/graph` work.

## UI state persistence

- Saved at `./data/user/state.json` (or `/data/user/state.json` in Docker)
- Set via `GET/PUT /api/user/state`
- To reset UI state, delete that file and restart the server.

## Update safely

If you're distributing as source:

1. Replace the core code (pull a new zip, `git pull`, etc.)
2. Rebuild/restart:

```bash
docker compose up --build -d
```

Because the vault is mounted at `./data`, user content persists.

If you're distributing as a Docker image, users only need:

```bash
docker compose pull && docker compose up -d
```

## User overrides (no touching core files)

Users can create:

- `./data/user/custom.css`

It is auto-loaded via `/user/custom.css` so users can tweak styling without editing the core.

## Data format (initial)

This starter uses a simple, migration-friendly file format:

- `./data/vault/meta.json` (schema version)
- `./data/vault/pages/<id>.json` (one JSON file per page)
- `./data/user/state.json` (notepad + todos)

We can later swap the storage layer to SQLite behind the same API, if desired.

## Next steps (what we build next)

1. **Page editor** (blocks or Markdown) + autosave
2. **Tags + backlinks**
3. **Graph** (routes/module)
4. **Search** (server index or client index)
5. “Mini-apps” as route modules (Tools, Session, etc.)
