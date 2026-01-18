export function setUiMode(mode) {
  try {
    if (!mode) {
      delete document.body.dataset.mode;
    } else if (mode === 'edit') {
      document.body.dataset.mode = 'edit';
    }
  } catch {}
}

