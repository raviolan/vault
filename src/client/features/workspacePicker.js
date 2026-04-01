import { escapeHtml } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';
import { openModal, closeModal } from './modals.js';

let pickerState = {
  onPick: null,
  excludeIds: new Set(),
};

function getElements() {
  const modal = document.getElementById('workspacePagePickerModal');
  if (!modal) return {};
  return {
    modal,
    titleEl: modal.querySelector('.workspace-picker-title-label'),
    input: modal.querySelector('input[name="workspacePageQuery"]'),
    results: modal.querySelector('#workspacePagePickerResults'),
    empty: modal.querySelector('#workspacePagePickerEmpty'),
  };
}

function renderResults(items) {
  const { results, empty } = getElements();
  if (!results || !empty) return;
  const visible = items.filter((item) => item?.id && !pickerState.excludeIds.has(String(item.id)));
  if (!visible.length) {
    results.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  results.innerHTML = visible.map((item) => `
    <button type="button" class="workspace-picker-result" data-page-id="${escapeHtml(item.id)}" style="display:block; width:100%; text-align:left; padding:10px; border:0; background:transparent;">
      <div>${escapeHtml(item.title || 'Untitled')}</div>
      <div class="meta">${escapeHtml(item.type || '')}</div>
    </button>
  `).join('');
  results.querySelectorAll('[data-page-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const picked = visible.find((item) => String(item.id) === String(btn.getAttribute('data-page-id')));
      if (!picked || typeof pickerState.onPick !== 'function') return;
      closeModal('workspacePagePickerModal');
      pickerState.onPick(picked);
    });
  });
}

async function searchPages(query) {
  if (!query) {
    renderResults([]);
    return;
  }
  try {
    const payload = await fetchJson(`/api/search?q=${encodeURIComponent(query)}&limit=12`);
    renderResults(Array.isArray(payload?.results) ? payload.results : []);
  } catch {
    renderResults([]);
  }
}

export function bindWorkspacePicker() {
  const { modal, input } = getElements();
  if (!modal || !input || modal.__workspacePickerBound) return;
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = String(input.value || '').trim();
    timer = window.setTimeout(() => { void searchPages(query); }, 120);
  });
  modal.__workspacePickerBound = true;
}

export function openWorkspacePicker({ title = 'Choose a page', excludePageIds = [], onPick } = {}) {
  const { titleEl, input, results, empty } = getElements();
  pickerState = {
    onPick: typeof onPick === 'function' ? onPick : null,
    excludeIds: new Set((excludePageIds || []).map((id) => String(id))),
  };
  if (titleEl) titleEl.textContent = title;
  if (input) input.value = '';
  if (results) results.innerHTML = '';
  if (empty) empty.hidden = true;
  openModal('workspacePagePickerModal');
  window.setTimeout(() => input?.focus(), 0);
}
