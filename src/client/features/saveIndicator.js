import { onSaveStatusChange, getSaveStatus } from '../blocks/edit/state.js';

let mounted = false;
let el = null;
let unsubscribe = null;

function ensureContainer() {
  const toolbar = document.querySelector('.top .toolbar');
  return toolbar || null;
}

function renderStatus({ status }) {
  if (!el) return;
  el.setAttribute('data-status', status);
  el.setAttribute('data-state', status); // alias for CSS targeting
  const label = el.querySelector('.label');
  if (!label) return;
  if (status === 'saving') label.textContent = 'Saving…';
  else if (status === 'dirty') label.textContent = 'Unsaved';
  else if (status === 'saved' || status === 'idle') label.textContent = 'Saved';
  else if (status === 'error') label.textContent = 'Error saving';
}

export function mountSaveIndicator() {
  if (mounted) return;
  const toolbar = ensureContainer();
  if (!toolbar) return;

  el = document.createElement('span');
  el.className = 'save-status';
  el.id = 'saveStatus';
  el.innerHTML = '<span class="dot" aria-hidden="true"></span><span class="label">Saved</span>';

  // Prefer to place it after the Edit button if present
  const editBtn = document.getElementById('btnEditPage');
  if (editBtn && editBtn.parentElement === toolbar) {
    editBtn.insertAdjacentElement('afterend', el);
  } else {
    toolbar.appendChild(el);
  }

  // Subscribe to save status events
  unsubscribe = onSaveStatusChange((s) => renderStatus(s));
  // Initialize current state
  renderStatus(getSaveStatus());
  mounted = true;
}

export function unmountSaveIndicator() {
  if (!mounted) return;
  try { if (unsubscribe) unsubscribe(); } catch {}
  unsubscribe = null;
  if (el && el.parentElement) el.parentElement.removeChild(el);
  el = null;
  mounted = false;
}
