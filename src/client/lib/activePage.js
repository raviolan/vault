let active = { id: null, slug: null, canEdit: false, kind: 'page' };

export function setActivePage(next) {
  active = { ...active, ...next };
  try { document.body.dataset.activePageId = active.id || ''; } catch {}
  try { document.body.dataset.activePageCanEdit = active.canEdit ? '1' : '0'; } catch {}
  try { console.debug('[activePage]', active); } catch {}
  // Let boot.js update UI labels/states without tight coupling
  try { if (typeof window.__updateEditButtonState === 'function') window.__updateEditButtonState(); } catch {}
}

export function getActivePage() { return active; }

