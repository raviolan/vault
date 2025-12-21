export function focusBlockInput(blockId) {
  const el = document.querySelector(`[data-block-id="${CSS.escape(blockId)}"] .block-input`);
  el?.focus();
  if (el && el.tagName === 'TEXTAREA') {
    el.selectionStart = el.selectionEnd = el.value.length;
  }
}

