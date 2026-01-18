/**
 * Mini App interface documentation (JSDoc only; no TypeScript).
 *
 * A Mini App is a self-contained feature module that renders inside a specific
 * surface (e.g., rightPanel) and manages its own DOM listeners and cleanup.
 *
 * Contract:
 * - id: string (stable key)
 * - title: string (tab label)
 * - surfaces: string[] (e.g., ['rightPanel'])
 * - mount(rootEl: HTMLElement, ctx: object): () => void | void
 *     Attach any DOM and listeners for the app. May return a cleanup function.
 * - unmount(): void (optional)
 *     Cleanup any listeners, timers, etc. If mount returns a cleanup function,
 *     the host will call it; unmount is for internal cleanup if needed.
 * - onContextChange(nextCtx: object): void (optional)
 *     Called when host context changes (e.g., route/page changes).
 * - commands(ctx: object): Array<object> (optional)
 *     Command palette entries; not wired in this iteration.
 */

export const _doc = {};

