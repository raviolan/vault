# Smoke Test

Lightweight end-to-end check to ensure the app’s core flows still work after changes.

How to run
- Terminal A:
  - `npm run build`
  - `npm run start`
- Terminal B:
  - `npm run smoke`
  - Or against a different server: `BASE_URL=http://localhost:8080 npm run smoke`

What it checks
- GET `/` returns HTML and contains a recognizable string ("DM Vault" or "Hembränt").
- GET `/app.js` returns JavaScript (contains `import` or `function`).
- GET `/api/pages` returns a JSON array.
- Creates a page via `POST /api/pages` with a unique `SMOKE_TEST_...` title and verifies it via `GET /api/pages/:id`.
- Creates a paragraph block via `POST /api/pages/:id/blocks` containing a legacy wiki token `[[ÅTEJ]]`.
- Searches via `GET /api/search?q=...` and confirms results include the created page.
- Resolves a legacy wiki link via `POST /api/pages/resolve` for the title `ÅTEJ`, and checks that the returned `page.slug` is URL-safe and reflects the Swedish mapping (contains `atej`).
- (Optional) If available, loads `GET /api/pages/:id/backlinks` and asserts response shape.
- Deletes the created smoke page, and if the resolve step created a new `ÅTEJ` page, deletes that too.

Notes
- The smoke test performs its own cleanup and should not leave any `SMOKE_TEST_...` pages in your vault.
- It does not introduce any new dependencies and can run against any `npm run start` server.

