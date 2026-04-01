import { escapeHtml } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';
import { canonicalPageHref } from '../lib/pageUrl.js';

function normalizeSelected(initialSelected, { multiple }) {
  if (multiple) return Array.isArray(initialSelected) ? initialSelected.slice() : [];
  return initialSelected && typeof initialSelected === 'object' ? initialSelected : null;
}

function selectedMarkup(item) {
  if (!item) return '';
  return `
    <span class="chip" data-picked-id="${escapeHtml(item.id)}">
      <a href="${canonicalPageHref(item)}" data-link>${escapeHtml(item.title)}</a>
      ${item.type ? `<span class="meta">${escapeHtml(item.type)}</span>` : ''}
      <button type="button" class="linklike" data-remove-picked="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.title)}">×</button>
    </span>
  `;
}

export function mountTimelinePagePicker(container, options = {}) {
  if (!container) return { getValue: () => null, reset: () => {}, setDisabled: () => {} };
  const multiple = !!options.multiple;
  const placeholder = options.placeholder || 'Search pages…';
  const searchLimit = Math.max(1, Math.min(12, Number(options.searchLimit) || 8));
  let selected = normalizeSelected(options.initialSelected, { multiple });
  let results = [];
  let timer = null;
  let searchSeq = 0;

  container.innerHTML = `
    <div class="timeline-picker" style="position:relative; min-width:240px;">
      <input type="search" class="timeline-picker-input" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
      <div class="timeline-picker-selected" style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;"></div>
      <div class="timeline-picker-results hovercard" hidden style="position:absolute; left:0; right:0; top:100%; margin-top:6px; z-index:20; max-height:220px; overflow:auto;"></div>
    </div>
  `;

  const input = container.querySelector('.timeline-picker-input');
  const selectedEl = container.querySelector('.timeline-picker-selected');
  const resultsEl = container.querySelector('.timeline-picker-results');

  function selectedIds() {
    return new Set((multiple ? selected : [selected]).filter(Boolean).map((item) => String(item.id)));
  }

  function renderSelected() {
    const items = multiple ? selected : [selected].filter(Boolean);
    selectedEl.innerHTML = items.map(selectedMarkup).join('');
    selectedEl.querySelectorAll('[data-remove-picked]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        const id = btn.getAttribute('data-remove-picked');
        if (!id) return;
        if (multiple) selected = selected.filter((item) => String(item.id) !== String(id));
        else if (selected && String(selected.id) === String(id)) selected = null;
        renderSelected();
      });
    });
  }

  function closeResults() {
    results = [];
    resultsEl.hidden = true;
    resultsEl.innerHTML = '';
  }

  function choose(item) {
    if (!item?.id) return;
    if (multiple) {
      if (selectedIds().has(String(item.id))) return;
      selected = [...selected, item];
    } else {
      selected = item;
    }
    input.value = '';
    renderSelected();
    closeResults();
  }

  function renderResults() {
    const currentIds = selectedIds();
    const visible = results.filter((item) => !currentIds.has(String(item.id)));
    if (!visible.length) {
      closeResults();
      return;
    }
    resultsEl.hidden = false;
    resultsEl.innerHTML = visible.map((item) => `
      <button type="button" class="timeline-picker-result" data-result-id="${escapeHtml(item.id)}" style="display:block; width:100%; text-align:left; padding:8px 10px; border:0; background:transparent;">
        <div>${escapeHtml(item.title)}</div>
        <div class="meta">${escapeHtml(item.type || '')}</div>
      </button>
    `).join('');
    resultsEl.querySelectorAll('[data-result-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-result-id');
        choose(visible.find((item) => String(item.id) === String(id)));
      });
    });
  }

  async function runSearch(query) {
    const seq = ++searchSeq;
    try {
      const payload = await fetchJson(`/api/search?q=${encodeURIComponent(query)}&limit=${searchLimit}`);
      if (seq !== searchSeq) return;
      results = Array.isArray(payload?.results) ? payload.results : [];
      renderResults();
    } catch {
      if (seq !== searchSeq) return;
      closeResults();
    }
  }

  input.addEventListener('input', () => {
    const value = String(input.value || '').trim();
    clearTimeout(timer);
    if (!value) {
      closeResults();
      return;
    }
    timer = setTimeout(() => { void runSearch(value); }, 120);
  });

  document.addEventListener('click', (event) => {
    if (container.contains(event.target)) return;
    closeResults();
  });

  renderSelected();

  return {
    getValue() {
      return multiple ? selected.slice() : selected;
    },
    reset(nextSelected = multiple ? [] : null) {
      selected = normalizeSelected(nextSelected, { multiple });
      input.value = '';
      renderSelected();
      closeResults();
    },
    setDisabled(disabled) {
      input.disabled = !!disabled;
    },
  };
}
