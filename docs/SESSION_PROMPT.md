# Session Prompt

Use this prompt at the start of each new implementation session for this project.

## Copy/Paste Prompt

You are working in the `DM Vault` codebase.

Before making any changes, read these files first:

- `docs/FEATURE_PLAN.md`
- `docs/ARCHITECTURE.md`

Then follow these rules for the entire session:

1. Treat `docs/FEATURE_PLAN.md` as the source of truth for scope, order, reuse, and non-goals.
2. Work on the highest-priority unfinished item in the ordered list unless I explicitly redirect you.
3. Before building anything, check whether the feature or part of it already exists in code, docs, routes, UI, migrations, or user state.
4. If something similar already exists, extend, consolidate, or finish it instead of building a second version.
5. Reuse and extend existing systems before building anything new.
6. Do not create parallel UI systems, duplicate APIs, duplicate database structures, or alternate flows that solve the same problem.
7. Keep performance in mind from the start. Avoid solutions that are fine only for small vaults.
8. Keep files small and focused. If a file is already large, split responsibilities instead of adding more logic into it.
9. Do not touch the high-risk search architecture yet unless I explicitly ask for that work.
10. Do not rewrite unrelated systems while implementing a feature.
11. Before editing, inspect the relevant existing modules and explain what will be reused, what will be changed, what will be left alone, and what existing work already covers part of the task.
12. After changes, verify behavior with the lightest useful checks available.

Implementation priorities, in order:

1. Archive
2. Simplified navigation by default
3. Contextual tool toggles
4. Health / quality dashboard
5. Upgraded backlinks
6. Merged search + command surface
7. Timeline
8. Stronger search relevance

Additional guardrails:

- Archive must stay in the main page model, not a separate storage path.
- Navigation should evolve from the current nav system, not replace it.
- Tool toggles must evolve the existing right panel and mini-app system.
- Health / quality dashboard should build on `Tag Inspector` and `Cleanup`.
- Backlinks should be upgraded from the current backlinks system, not replaced with a brand new relation system on day one.
- Search + command must eventually become one surface, but do not begin that work unless it is the active priority.
- Timeline needs careful data modeling; avoid casual storage decisions.

Session checklist:

- Read the plan and architecture docs.
- Check `git status` before editing.
- Search the codebase for existing implementations, partial implementations, abandoned attempts, and overlapping UI/API paths.
- Identify the relevant existing modules.
- Identify what is already done, what is partial, and what is actually missing.
- State the intended reuse path.
- Make the smallest coherent change that moves the active feature forward.
- Avoid scope creep.
- Verify the result.
- Summarize what changed and what remains.

If there is any conflict between your instincts and `docs/FEATURE_PLAN.md`, follow the markdown plan unless I explicitly override it.

## Session Start Short Form

If a shorter version is needed, use this:

Read `docs/FEATURE_PLAN.md` and `docs/ARCHITECTURE.md` first. Follow `FEATURE_PLAN.md` as the source of truth. Work on the highest-priority unfinished feature unless I say otherwise. Reuse existing systems before adding new ones. Keep files small, performance-conscious, and easy to debug. Do not create duplicate UI or API paths. Do not touch the high-risk search architecture yet unless explicitly asked.
