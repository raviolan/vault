export function toggleWrapSelection(inputEl, marker) {
  if (!inputEl) return;
  const isTextual = inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT';
  if (!isTextual) return;
  const start = inputEl.selectionStart ?? 0;
  const end = inputEl.selectionEnd ?? 0;
  const val = inputEl.value || '';
  const sel = val.slice(start, end);
  const before = val.slice(0, start);
  const after = val.slice(end);
  const hasBefore = before.endsWith(marker);
  const hasAfter = after.startsWith(marker);
  let newVal, newStart, newEnd;
  if (sel && hasBefore && hasAfter) {
    // Unwrap
    newVal = before.slice(0, before.length - marker.length) + sel + after.slice(marker.length);
    newStart = start - marker.length;
    newEnd = end - marker.length;
  } else {
    // Wrap (even if selection empty)
    newVal = before + marker + sel + marker + after;
    newStart = start + marker.length;
    newEnd = end + marker.length;
  }
  inputEl.value = newVal;
  try { inputEl.setSelectionRange(newStart, newEnd); } catch {}
  // Trigger input event so autosave/patching runs
  const ev = new Event('input', { bubbles: true });
  inputEl.dispatchEvent(ev);
}

export function handleFormatShortcutKeydown(e, inputEl) {
  const isCmd = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
  if (!isCmd) return false;
  const k = (e.key || '').toLowerCase();
  if (k === 'b') {
    e.preventDefault();
    toggleWrapSelection(inputEl, '**');
    return true;
  }
  if (k === 'i') {
    e.preventDefault();
    toggleWrapSelection(inputEl, '*');
    return true;
  }
  return false;
}

