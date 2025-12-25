import { $, $$ } from '../lib/dom.js';
import { getState, updateState } from '../lib/state.js';
import { fetchJson } from '../lib/http.js';
import { createMiniAppHost } from '../miniapps/host.js';
import { registerMany } from '../miniapps/registry.js';
import { NotepadApp } from '../miniapps/notepad/app.js';
import { TodoApp } from '../miniapps/todo/app.js';
import { getAppState, setAppState, getUserState, patchUserState } from '../miniapps/state.js';
import { initRightPanelSplit } from './rightPanelSplit.js';

export function bindRightPanel() {
  const toggle = $('#rightDrawerToggle');
  const drawer = $('#rightDrawer');
  const pinBtn = $('#rightDrawerPin');
  if (!toggle || !drawer) return;

  // Register built-in mini apps once, keeping order stable
  registerMany([NotepadApp, TodoApp]);

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
  // Respect mini app visibility settings
  const hidden = new Set(Array.isArray(getState().miniAppsHidden) ? getState().miniAppsHidden : []);
  for (const btn of tabs) {
    const t = btn.getAttribute('data-tab');
    if (t === 'notepad' && hidden.has('notepad')) btn.style.display = 'none';
    if (t === 'todo' && hidden.has('todo')) btn.style.display = 'none';
  }
  for (const p of panels) {
    const name = p.getAttribute('data-panel');
    if (name === 'notepad' && hidden.has('notepad')) p.hidden = true;
    if (name === 'todo' && hidden.has('todo')) p.hidden = true;
  }
  // Two hosts so Notepad and To-Do can co-exist in split mode
  const notepadHost = createMiniAppHost({
    surfaceId: 'rightPanelNotepad',
    rootEl: drawer,
    getCtx: () => ({
      pageId: (location.pathname.match(/^\/page\/([^/]+)$/) || [null, null])[1] || null,
      userState: { getUserState, patchUserState, getAppState, setAppState },
    }),
  });
  const todoHost = createMiniAppHost({
    surfaceId: 'rightPanelTodo',
    rootEl: drawer,
    getCtx: () => ({
      pageId: (location.pathname.match(/^\/page\/([^/]+)$/) || [null, null])[1] || null,
      userState: { getUserState, patchUserState, getAppState, setAppState },
    }),
  });

  const drawerContent = drawer; // use attribute on this element to signal split mode

  const showNotesSplit = ({ focus } = {}) => {
    // Respect app visibility settings
    const notepadHidden = hidden.has('notepad');
    const todoHidden = hidden.has('todo');
    // Toggle panels: show both Notepad and To-Do; hide others
    for (const p of panels) {
      const name = p.getAttribute('data-panel');
      if (name === 'notepad') p.hidden = !!notepadHidden;
      else if (name === 'todo') p.hidden = !!todoHidden;
      else p.hidden = true;
    }
    // Mark split mode for CSS
    if (!notepadHidden && !todoHidden) drawerContent.setAttribute('data-notes-split', 'true');
    else drawerContent.removeAttribute('data-notes-split');
    // Mount both apps
    if (!notepadHidden) notepadHost.show('notepad'); else notepadHost.show(null);
    if (!todoHidden) todoHost.show('todo'); else todoHost.show(null);
    // Ensure split behavior is initialized once
    try { initRightPanelSplit({ getUserState, patchUserState }); } catch {}
    // Optional focus
    if (focus === 'notepad') {
      setTimeout(() => document.getElementById('notepad')?.focus(), 0);
    } else if (focus === 'todo') {
      setTimeout(() => document.getElementById('todoInput')?.focus(), 0);
    }
  };

  const show = (name) => {
    // Notes tabs map to split view
    if (name === 'notepad' || name === 'todo') {
      showNotesSplit({ focus: name });
      return;
    }
    // Non-note tabs: hide both note panels, unmount hosts, show selected panel
    drawerContent.removeAttribute('data-notes-split');
    for (const p of panels) p.hidden = p.getAttribute('data-panel') !== name;
    notepadHost.show(null);
    todoHost.show(null);
    if (name === 'settings') renderSettingsPanel();
  };
  // initialize active tab
  let initial = s.rightPanelTab || 'notepad';
  if ((initial === 'notepad' && hidden.has('notepad')) || (initial === 'todo' && hidden.has('todo'))) {
    // fallback to first visible tab in current order
    const order = ['notepad', 'colors', 'todo', 'backlinks', 'settings'];
    initial = order.find(t => !((t === 'notepad' && hidden.has('notepad')) || (t === 'todo' && hidden.has('todo')))) || 'backlinks';
    updateState({ rightPanelTab: initial });
  }
  show(initial);
  tabs.forEach(btn => btn.addEventListener('click', () => {
    const t = btn.getAttribute('data-tab');
    show(t);
    updateState({ rightPanelTab: t });
    if (t === 'settings') renderSettingsPanel();
  }));

  // Notepad and To-Do now mount via mini app hosts (supports split mode)
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
