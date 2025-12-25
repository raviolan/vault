// Simple autosize utility for edit-mode textareas only.
// Usage: bindAutosizeTextarea(el) returns an unbind function.
// It sets height to content on init and on input/paste.
export function autosizeTextarea(el) {
  if (!el) return;
  const prevOverflow = el.style.overflowY;
  el.style.overflowY = 'hidden';
  el.style.height = 'auto';
  // Use rAF to avoid layout thrash in rapid sequences
  requestAnimationFrame(() => {
    try {
      el.style.height = `${el.scrollHeight}px`;
    } finally {
      el.style.overflowY = prevOverflow || 'hidden';
    }
  });
}

export function bindAutosizeTextarea(el) {
  if (!el) return () => {};
  const handler = () => autosizeTextarea(el);
  el.addEventListener('input', handler);
  el.addEventListener('paste', handler);
  // Initialize once mounted into DOM
  handler();
  return () => {
    try { el.removeEventListener('input', handler); } catch {}
    try { el.removeEventListener('paste', handler); } catch {}
  };
}

