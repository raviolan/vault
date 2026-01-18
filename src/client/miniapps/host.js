// Mini App Host: mounts/unmounts exactly one app per surface at a time.
import { get as getById } from './registry.js';

export function createMiniAppHost({ surfaceId, rootEl, getCtx }) {
  let current = null; // { app, cleanup }

  function unmountCurrent() {
    if (current?.cleanup) {
      try { current.cleanup(); } catch {}
    }
    if (current?.app?.unmount) {
      try { current.app.unmount(); } catch {}
    }
    current = null;
  }

  return {
    surfaceId,
    show(appId) {
      // If the appId is falsy or not registered, just unmount any current app
      const nextApp = appId ? getById(appId) : null;
      if (current?.app?.id === nextApp?.id) return; // already shown
      unmountCurrent();
      if (!nextApp) return; // nothing to mount
      const ctx = typeof getCtx === 'function' ? getCtx() : {};
      const cleanup = nextApp.mount(rootEl || document, ctx) || null;
      current = { app: nextApp, cleanup };
    },
    updateContext(nextCtx) {
      if (current?.app?.onContextChange) {
        try { current.app.onContextChange(nextCtx); } catch {}
      }
    },
    destroy() {
      unmountCurrent();
    }
  };
}
