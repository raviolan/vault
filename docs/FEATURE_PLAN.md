# Feature Plan

This document is the planning baseline for the next product pass.

Goals:

- Improve usability without repeating World Anvil's clutter.
- Reuse and evolve existing systems before adding new ones.
- Keep performance strong as the vault grows.
- Keep modules small enough to debug and change safely.
- Preserve current page content, links, and mental model where possible.

This is a plan document only. No code decisions here should force a rewrite.

## Working Principles

- Prefer extension over replacement.
- Keep routes and APIs stable unless there is a clear payoff.
- Add new data structures only when existing page blocks, page sheets, tags, or user state are not sufficient.
- Avoid adding parallel UI systems that solve the same job.
- Make advanced features progressively disclosed, not always visible.
- Optimize for large vaults from the start: search, nav, backlinks, and dashboards must remain fast with thousands of pages.
- Keep files focused. If a feature would push a file into "god module" territory, split it first.

## Hard Constraints

- Do not build a second right-panel system. Evolve the current panel.
- Do not keep both a search dropdown and a separate command palette long term. Merge them.
- Do not build a second quality dashboard from scratch if `Tag Inspector` or `Cleanup` can be extended.
- Do not hide data by moving it into ad hoc files or special folders outside the main page model.
- Do not rewrite the block editor, wiki link syntax, or routing layer as part of these features.
- Do not let `boot.js` or any single feature file absorb too much orchestration logic.

## Existing Systems To Reuse First

Use these as the default starting points:

- Right panel: `src/client/features/rightPanel.js`
- Mini-app host/registry: `src/client/miniapps/host.js`, `src/client/miniapps/registry.js`
- Search preview: `src/client/features/searchPreview.js`
- Search results page: `src/client/features/searchResults.js`
- Command palette: `src/client/features/commandPalette.js`
- Search backend: `server/routes/search.js`, `server/db/search.js`
- Navigation: `src/client/features/nav.js`, `src/client/routes/section.js`
- Backlinks: `src/client/features/backlinks.js`, `src/client/miniapps/backlinks/app.js`, `server/db/backlinks.js`
- Tag Inspector and Cleanup: `src/client/routes/tags.js`, `src/client/routes/cleanup.js`
- Page metadata: `server/routes/pages.js`, `server/db/pages.js`, `page_sheets`

## File Size And Modularity Rules

Soft limits:

- Prefer feature modules under ~300 lines.
- Start splitting once a module approaches ~400 lines and contains more than one responsibility.
- Keep route files focused on rendering and route-specific behavior.
- Move shared logic into small helpers instead of expanding `boot.js`, `nav.js`, or `rightPanel.js` indefinitely.

Preferred split pattern:

- `featureName/index.js` for composition
- `featureName/state.js` for local state helpers
- `featureName/render.js` for DOM rendering
- `featureName/actions.js` for event handlers or commands
- `featureName/api.js` for fetch calls

## Scope

Planned:

- Archive
- Simplified navigation by default
- Contextual tool toggles in the right panel
- Health/quality dashboard
- Upgraded backlinks
- Merged search + command surface
- Timeline
- Stronger search relevance

Not planned in this pass:

- Full visual redesign
- Graph view rewrite
- Block editor rewrite
- New auth or multi-user model
- Import/export overhaul
- Large database migration unrelated to these features

## Feature Plans

### 1. Archive

Goal:

- Hide outdated content from normal workflows without deleting it.

Current reuse target:

- Extend the main page model.
- Keep archived pages addressable by URL and searchable through explicit filters.

Desired behavior:

- Archived pages do not appear in normal nav by default.
- Archived pages are excluded from normal search by default.
- Archived pages remain linkable and recoverable.
- Archive can be browsed as its own section.

Current recommendation:

- Add explicit archive metadata to pages, not a separate storage location.
- Minimum fields: `archived_at`, optional `archive_reason`.

Do not:

- Move archived pages out of the main DB.
- Treat archive as delete-lite with special file handling.

### 2. Simplified Navigation By Default

Goal:

- Make the default left nav calmer and easier to scan.

Current reuse target:

- Evolve `nav.js` and section landing pages instead of introducing a second nav system.

Desired behavior:

- Fewer top-level groups by default.
- Advanced grouping remains available, but not required.
- Archived pages are hidden from the main nav by default.

Likely direction:

- Default buckets: `World`, `People`, `Campaign`, `Tools`, `Archive`.
- Keep user sections and grouping as an advanced organization layer.

Do not:

- Remove existing grouping capabilities.
- Break direct links to section routes.

### 3. Contextual Tool Toggles

Goal:

- Make the right panel useful without looking busy all the time.

Current reuse target:

- Evolve the current right drawer and mini-app registry instead of replacing it.

Desired behavior:

- Show a small set of top-level contexts, not many permanent tool buttons.
- Surface page-relevant tools first.
- Keep split mode possible, but not always exposed.
- Make panel state easier to understand and debug.

Likely direction:

- Replace the current row of multiple tool buttons with a smaller context switcher.
- Keep existing mini-apps, but group them under clearer modes.
- Reduce the number of persistent controls visible in `index.html`.

Do not:

- Introduce another panel container.
- Duplicate mini-app mounting logic.
- Keep legacy and new panel controls alive forever after the migration.

### 4. Health / Quality Dashboard

Goal:

- Give the vault owner a maintenance cockpit.

Current reuse target:

- Expand `Tag Inspector` and possibly `Cleanup`, rather than creating a separate isolated admin app.

Desired behavior:

- Track orphan pages, pages without summaries, unresolved wiki links, weak tags, missing dates, missing backlinks, stale pages, and archive candidates.

Likely direction:

- Keep `Tag Inspector` as one section of a broader content health route.
- Add filters and issue categories instead of spinning up multiple disconnected maintenance pages.

Do not:

- Duplicate audits that already exist in `Cleanup`.
- Mix destructive actions with passive reporting without clear confirmation flows.

### 5. Upgraded Backlinks

Goal:

- Move from plain mentions to a more useful relationship-aware context panel.

Current reuse target:

- Extend current backlinks API and panel before adding new relationship systems.

Desired behavior:

- Show where a page is referenced.
- Show context around each reference.
- Support richer relationship types later without breaking plain backlinks.

Likely direction:

- Phase 1: improve mention backlinks with excerpts, sections, and counts.
- Phase 2: add optional typed relationships on top of backlinks.

Do not:

- Replace wiki links.
- Require typed relations for basic linking to remain useful.

### 6. Merged Search + Command Surface

Goal:

- One fast omnibox for page lookup, actions, and search results.

Current reuse target:

- Merge `searchPreview.js` and `commandPalette.js`.
- Keep `searchResults.js` as the full results route.

Desired behavior:

- `Cmd/Ctrl+K` always opens the same surface.
- Typing returns page results immediately.
- Action commands are mixed in only when useful.
- Enter either opens the selected item or goes to full results.

Likely direction:

- Keep one search input surface in global chrome.
- Support mixed result types: `page`, `action`, `filter`, later `archive`.
- Keep the route `/search?q=...` as the deep-linkable full view.

Do not:

- Maintain two hotkey systems that compete for `Cmd/Ctrl+K`.
- Reimplement search result rendering separately for command and search.

### 7. Timeline

Goal:

- Add campaign and world chronology without overcomplicating pages.

Current reuse target:

- Reuse page metadata and route patterns first.
- Prefer a dedicated timeline model only if page sheets are too limited.

Open design choice:

- Timeline events as a page type vs a dedicated events table.

Current recommendation:

- Start with a dedicated events table if timeline filtering, sorting, and range queries matter from day one.
- If timeline stays lightweight, event pages can be a temporary bridge, but they should not become the long-term query model by accident.

Desired behavior:

- Events have date precision, title, summary, linked pages, and optional tags.
- Timeline can filter by type, arc, location, and archive status.

Do not:

- Store timeline logic only inside freeform page blocks if it needs fast querying.

### 8. Stronger Search Relevance

Goal:

- Search should feel smarter and remain fast as content grows.

Current reuse target:

- Keep the current `/api/search` route shape if possible.
- Replace internal ranking/search implementation behind that API.

Desired behavior:

- Better ranking than plain `LIKE`.
- Title and heading matches rank above body matches.
- Archived content is excluded by default but searchable on demand.
- Results support filters without requiring a second search API.

Current recommendation:

- Move to SQLite FTS for indexed content search.
- Keep existing detail and snippet APIs, but compute ranking from indexed data.

Do not:

- Keep bolting more logic onto raw `LIKE` search once relevance becomes a core feature.
- Scatter search logic across unrelated modules.

## Cross-Feature Architecture Decisions

### Data model

Preferred approach:

- Keep `pages` as the canonical content record.
- Add metadata columns or adjacent tables only when queryability requires them.
- Use `page_sheets` for page-type-specific fields, not as a dumping ground for cross-cutting global features.

Likely additions:

- Archive metadata on pages
- Search index tables or FTS virtual tables
- Possibly timeline event table
- Possibly backlink context materialization if runtime query cost becomes too high

### Routing

Prefer:

- Reuse existing route style and router conventions.
- Add only a few focused top-level routes:
  - `/search`
  - `/archive`
  - `/timeline`
  - `/health`

Avoid:

- Route explosion for every subfeature.

### State

Prefer:

- Use persisted user state only for UI preferences and local panel state.
- Keep content truth in SQLite, not in user state, unless it is clearly a user-specific surface.

Avoid:

- Storing shared feature data in `state.json` just because it is convenient.

## Suggested Delivery Order

1. Archive
2. Simplified nav by default
3. Contextual tool toggles
4. Health / quality dashboard
5. Upgraded backlinks
6. Merge search + command surface
7. Timeline
8. Stronger search relevance

Reason:

- This order prioritizes the lowest-risk, highest-reuse work first.
- It delays cross-cutting search architecture until the rest of the product shape is clearer.
- It keeps the most expensive data-model and indexing decisions near the end.

## Questions To Resolve Before Coding

- Should archive preserve backlinks and search relevance exactly as-is, or should archived links rank lower?
- Is timeline primarily for session chronology, world history, or both?
- Do typed relationships belong inside upgraded backlinks, or as a later separate layer?
- Should the health dashboard live inside the existing tags route, or get a new route with tags as one panel?

## Initial Implementation Strategy

Before any feature coding:

- Identify current duplicate UX surfaces and mark the preferred survivor.
- Decide which existing large files need pre-emptive splitting.
- Keep a migration checklist for DB changes.
- Define performance budgets for:
  - initial nav render
  - search response
  - backlink panel load
  - health dashboard load

## Success Criteria

- Fewer persistent controls on screen by default.
- One clear global search/command experience.
- Search and nav still feel fast on large vaults.
- Archived content is out of the way but never lost.
- Quality dashboard helps maintenance instead of adding noise.
- New code is easier to reason about than the current equivalent.

## Warning: High-Risk Architecture

Do not touch this yet.

Highest-risk area:

- Search architecture

Why it is high risk:

- It is already shared by search preview, full search, command behavior, wiki-link resolution, and other small lookup flows.
- It is a performance-sensitive path that will become more important once archive, health, and richer backlinks exist.
- A rushed change can easily create duplicate search systems or unstable ranking behavior.

What should stay stable for now:

- Keep one search API surface.
- Avoid partial rewrites that leave both old and new search paths active.
- Do not redesign search storage until the surrounding feature work has clarified the final requirements.

Secondary risk:

- Timeline storage model

Reason:

- If event data starts in the wrong place, later filtering and querying will be expensive to fix.
