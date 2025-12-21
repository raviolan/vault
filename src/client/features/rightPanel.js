import { $, $$, escapeHtml } from '../lib/dom.js';
import { getState, updateState } from '../lib/state.js';
import { fetchJson } from '../lib/http.js';

export function bindRightPanel() {
  const toggle = $('#rightDrawerToggle');
  const drawer = $('#rightDrawer');
  const pinBtn = $('#rightDrawerPin');
  if (!toggle || !drawer) return;

  // init from state
  const s = getState();
  if (s.rightPanelOpen) drawer.removeAttribute('hidden');
  else drawer.setAttribute('hidden', '');
  toggle.setAttribute('aria-expanded', String(!!s.rightPanelOpen));
  if (pinBtn) pinBtn.setAttribute('aria-pressed', String(!!s.rightPanelPinned));

  toggle.addEventListener('click', () => {
    const isHidden = drawer.hasAttribute('hidden');
    if (isHidden) {
      drawer.removeAttribute('hidden');
      toggle.setAttribute('aria-expanded', 'true');
      updateState({ rightPanelOpen: true });
    } else {
      drawer.setAttribute('hidden', '');
      toggle.setAttribute('aria-expanded', 'false');
      updateState({ rightPanelOpen: false });
    }
  });

  pinBtn?.addEventListener('click', () => {
    const pressed = pinBtn.getAttribute('aria-pressed') === 'true';
    pinBtn.setAttribute('aria-pressed', String(!pressed));
    updateState({ rightPanelPinned: !pressed });
  });

  const tabs = $$('.right-panel-tabs [data-tab]');
  const panels = $$('[data-panel]');
  const show = (name) => {
    for (const p of panels) p.hidden = p.getAttribute('data-panel') !== name;
  };
  // initialize active tab
  show(s.rightPanelTab || 'notepad');
  if ((s.rightPanelTab || 'notepad') === 'settings') renderSettingsPanel();
  tabs.forEach(btn => btn.addEventListener('click', () => {
    const t = btn.getAttribute('data-tab');
    show(t);
    updateState({ rightPanelTab: t });
    if (t === 'settings') renderSettingsPanel();
  }));

  // persistence
  const notepad = $('#notepad');
  const todoInput = $('#todoInput');
  const todoAdd = $('#todoAdd');
  const todoList = $('#todoList');

  // initial values
  notepad && (notepad.value = s.notepadText || '');
  if (todoList) renderTodos(todoList, s.todoItems || []);

  // debounced updates via state store
  let notepadTimer;
  notepad?.addEventListener('input', () => {
    clearTimeout(notepadTimer);
    const val = notepad.value;
    notepadTimer = setTimeout(() => updateState({ notepadText: val }), 300);
  });

  todoAdd?.addEventListener('click', () => {
    const text = (todoInput?.value || '').trim();
    if (!text) return;
    const cur = getState().todoItems || [];
    const next = [...cur, { id: crypto.randomUUID(), text, done: false }];
    todoInput.value = '';
    renderTodos(todoList, next);
    updateState({ todoItems: next });
  });

  function renderTodos(root, todos) {
    if (!root) return;
    root.innerHTML = '';
    for (const t of todos) {
      const li = document.createElement('li');
      li.innerHTML = `
        <label style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" ${t.done ? 'checked' : ''} />
          <span>${escapeHtml(t.text)}</span>
        </label>
        <button class="chip" title="Delete">×</button>
      `;
      const cb = li.querySelector('input');
      const del = li.querySelector('button');
      cb.addEventListener('change', () => {
        t.done = cb.checked;
        updateState({ todoItems: todos });
      });
      del.addEventListener('click', () => {
        const next = (getState().todoItems || []).filter(x => x.id !== t.id);
        renderTodos(root, next);
        updateState({ todoItems: next });
      });
      root.appendChild(li);
    }
  }
}

async function renderSettingsPanel() {
  const root = document.getElementById('settingsPanel');
  if (!root) return;
  root.innerHTML = '<p class="meta">Loading…</p>';
  try {
    const meta = await fetchJson('/api/meta');
    root.innerHTML = `
      <div>
        <div class="meta">Data root</div>
        <pre style="white-space:pre-wrap">${escapeHtml(meta.dataRoot || '')}</pre>
        <div class="meta">DB path</div>
        <pre style="white-space:pre-wrap">${escapeHtml(meta.dbPath || '')}</pre>
      </div>
      <div style=\"margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;\">
        <button id=\"exportVault\" class=\"chip\">Export vault</button>
        <input id=\"importFile\" type=\"file\" accept=\".sqlite,application/octet-stream\" />
        <button id=\"importVault\" class=\"chip\">Import</button>
      </div>
      <p class=\"meta\">Import replaces your current vault. It will reload after import.</p>
    `;
    document.getElementById('exportVault')?.addEventListener('click', () => {
      window.location.href = '/api/export';
    });
    document.getElementById('importVault')?.addEventListener('click', async () => {
      const fileInput = document.getElementById('importFile');
      const f = fileInput?.files?.[0];
      if (!f) return alert('Choose a .sqlite file first');
      try {
        const buf = await f.arrayBuffer();
        const res = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });
        if (!res.ok) throw new Error(await res.text());
        alert('Imported. Reloading…');
        window.location.reload();
      } catch (e) {
        console.error('import failed', e);
        alert('Import failed');
      }
    });
  } catch (e) {
    root.innerHTML = `<p class=\"meta\">Failed to load settings</p>`;
  }
}

