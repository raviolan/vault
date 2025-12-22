import { $, $$ } from '../lib/dom.js';
import { getState, updateState } from '../lib/state.js';
import { fetchJson } from '../lib/http.js';
import { createMiniAppHost } from '../miniapps/host.js';
import { registerMany } from '../miniapps/registry.js';
import { NotepadApp } from '../miniapps/notepad/app.js';
import { TodoApp } from '../miniapps/todo/app.js';
import { getAppState, setAppState, getUserState, patchUserState } from '../miniapps/state.js';

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
  const host = createMiniAppHost({
    surfaceId: 'rightPanel',
    rootEl: drawer,
    getCtx: () => ({
      // Minimal context for this iteration
      pageId: (location.pathname.match(/^\/page\/([^/]+)$/) || [null, null])[1] || null,
      userState: {
        getUserState,
        patchUserState,
        getAppState,
        setAppState,
      },
    }),
  });
  const show = (name) => {
    for (const p of panels) p.hidden = p.getAttribute('data-panel') !== name;
    // Delegate to mini app host for specific tabs
    if (name === 'notepad') host.show('notepad');
    else if (name === 'todo') host.show('todo');
    else host.show(null); // ensure cleanup if switching away
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

  // Notepad and To-Do now mount via mini app host (no direct listeners here)
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
