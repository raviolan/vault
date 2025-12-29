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
  const k = (e.key || '').toLowerCase();
  // Bold/Italic: Ctrl/Cmd + key (no Alt/Shift)
  const biCmd = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
  if (biCmd && k === 'b') {
    e.preventDefault();
    toggleWrapSelection(inputEl, '**');
    return true;
  }
  if (biCmd && k === 'i') {
    e.preventDefault();
    toggleWrapSelection(inputEl, '*');
    return true;
  }
  // Link: Cmd + Option + K (no Ctrl/Shift)
  const linkCmd = !!e.metaKey && !!e.altKey && !e.ctrlKey && !e.shiftKey;
  if (linkCmd && k === 'k') {
    e.preventDefault();
    insertMarkdownLink(inputEl);
    return true;
  }
  return false;
}

export function insertMarkdownLink(inputEl) {
  if (!inputEl) return;
  const tag = (inputEl.tagName || '').toUpperCase();
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return;
  const url = window.prompt('Link URL:');
  if (!url) return;
  const start = inputEl.selectionStart ?? 0;
  const end = inputEl.selectionEnd ?? start;
  const val = String(inputEl.value || '');
  const before = val.slice(0, start);
  const sel = val.slice(start, end);
  const after = val.slice(end);
  let newVal, newStart, newEnd;
  if (sel && sel.length) {
    const label = sel;
    const md = `[${label}](${url})`;
    newVal = before + md + after;
    // Keep selection on label portion inside the brackets
    newStart = before.length + 1; // after '['
    newEnd = newStart + label.length;
  } else {
    const md = `[](${url})`;
    newVal = before + md + after;
    // Place caret inside the brackets to type label
    newStart = before.length + 1; // inside []
    newEnd = newStart;
  }
  inputEl.value = newVal;
  try { inputEl.setSelectionRange(newStart, newEnd); } catch {}
  // Trigger input event so autosave/patching runs
  try { inputEl.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
}
