# Architecture Overview

This SPA has a thin entry that boots global UI once, and modular features/routes for page content.

- Entry: `src/client/app.js` imports and calls `boot()` from `src/client/boot.js`. It is the only client entry bundled to `dist/app.js`.
- Boot: `src/client/boot.js` wires global behaviors once (router link interception, wiki link handler, search preview, command palette, modals, left/right drawers, tabs) and registers routes. It then renders the initial route.

Client modules
- `src/client/lib/`: core helpers
  - `dom.js`: DOM query helpers and HTML escaping
  - `http.js`: fetch JSON/text helper
  - `router.js`: lightweight SPA router + link interceptor
  - `state.js`: UI state store persisted via `/api/user/state`
  - `pageStore.js`: transient per-page editing state (blocks, edit mode)
  - `ui.js`: UI affordances (breadcrumb, actions availability)
- `src/client/features/`: global and cross-cutting features
  - `searchPreview.js`, `searchResults.js`
  - `commandPalette.js`
  - `modals.js`
  - `rightPanel.js`, `backlinks.js`, `nav.js`, `wikiLinks.js`
- `src/client/blocks/`: block rendering and editing (read-only and edit modes)
- `src/client/routes/`: route renderers for top-level pages (dashboard, tags, session, pages/system)

Routing rules
- Global listeners are installed only once in `boot()` (link interception, wiki links, search preview, command palette, modals, Escape-to-close).
- Route modules only render into the `#outlet` and bind local controls for that view.

Build
- Bundler copies `src/client/index.html` and bundles `src/client/app.js` to `dist/` via `scripts/build.js`.
- The server serves `dist/` assets when present, or falls back to `public/` during development.

Storage locations
- Pages and blocks: `./data/vault/vault.sqlite` (or `/data/vault/vault.sqlite` in Docker). Slugs follow Swedish mapping (Å/Ä→A, Ö→O) and are unique.
- UI state: `./data/user/state.json`.
- Optional user styles: `./data/user/custom.css`.

