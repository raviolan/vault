import { $, $$ } from '../lib/dom.js';
import { getState, updateState } from '../lib/state.js';
import { fetchJson } from '../lib/http.js';
import { createMiniAppHost } from '../miniapps/host.js';
import { registerMany } from '../miniapps/registry.js';
import { NotepadApp } from '../miniapps/notepad/app.js';
import { TodoApp } from '../miniapps/todo/app.js';
import { ConditionsApp } from '../miniapps/conditions/app.js';
import { HpTrackerApp } from '../miniapps/hp/app.js';
import { getAppState, setAppState, getUserState, patchUserState } from '../miniapps/state.js';
import { initRightPanelSplit } from './rightPanelSplit.js';

export function bindRightPanel() {
  const toggle = $('#rightDrawerToggle');
  const drawer = $('#rightDrawer');
  const pinBtn = $('#rightDrawerPin');
  if (!toggle || !drawer) return;

  // Register built-in mini apps once, keeping order stable
  registerMany([NotepadApp, TodoApp, ConditionsApp, HpTrackerApp]);

  // init from state
  const s = getState();
  if (s.rightPanelOpen) drawer.removeAttribute('hidden');
  else drawer.setAttribute('hidden', '');
  toggle.setAttribute('aria-expanded', String(!!s.rightPanelOpen));
  // Label the toggle according to open state (collapsed case handled in panelControls)
  try { toggle.textContent = s.rightPanelOpen ? 'Close' : 'Open Tools'; } catch {}
  if (pinBtn) pinBtn.setAttribute('aria-pressed', String(!!s.rightPanelPinned));

  toggle.addEventListener('click', () => {
    const isHidden = drawer.hasAttribute('hidden');
    if (isHidden) {
      drawer.removeAttribute('hidden');
      toggle.setAttribute('aria-expanded', 'true');
      try { toggle.textContent = 'Close'; } catch {}
      updateState({ rightPanelOpen: true });
    } else {
      drawer.setAttribute('hidden', '');
      toggle.setAttribute('aria-expanded', 'false');
      try { toggle.textContent = 'Open Tools'; } catch {}
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
  const closeBtn = document.getElementById('rightDrawerClose');
  const toggleTopBtn = document.getElementById('rightToggleTopApp');
  const toggleHpBtn = document.getElementById('rightToggleHpApp');
  const splitToggle = document.getElementById('rightSplitToggle');
  const splitPicker = document.getElementById('rightSplitPicker');
  const splitTopSelect = document.getElementById('rightSplitTopSelect');
  const splitBottomSelect = document.getElementById('rightSplitBottomSelect');
  const splitSwapBtn = document.getElementById('rightSplitSwap');
  const modeSelect = document.getElementById('rightPanelModeSelect');
  const singleSelect = document.getElementById('rightPanelSingleSelect');
  const singleGroup = document.getElementById('rightSingleGroup');
  const splitGroup = document.getElementById('rightSplitGroup');
  const controlsDetails = document.getElementById('rightPanelControls');

  // Collapsible controls: restore persisted open/closed state
  try {
    const us = getUserState ? getUserState() : {};
    if (controlsDetails) {
      const open = !!(us && typeof us.rightPanelControlsOpen === 'boolean' && us.rightPanelControlsOpen);
      // default collapsed
      controlsDetails.open = open;
      controlsDetails.addEventListener('toggle', () => {
        try { patchUserState({ rightPanelControlsOpen: !!controlsDetails.open }); } catch {}
      });
    }
  } catch {}
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

  const conditionsHost = createMiniAppHost({
    surfaceId: 'rightPanelConditions',
    rootEl: drawer,
    getCtx: () => ({
      pageId: (location.pathname.match(/^\/page\/([^/]+)$/) || [null, null])[1] || null,
      userState: { getUserState, patchUserState, getAppState, setAppState },
    }),
  });

  // Split-mode Conditions hosts (mount into top/bottom mounts)
  const conditionsTopHost = createMiniAppHost({
    surfaceId: 'rightPanelConditionsTop',
    rootEl: drawer,
    getCtx: () => ({
      pageId: (location.pathname.match(/^\/page\/([^/]+)$/) || [null, null])[1] || null,
      userState: { getUserState, patchUserState, getAppState, setAppState },
      mountEl: document.getElementById('rightNotepadMount'),
    }),
  });
  const conditionsBottomHost = createMiniAppHost({
    surfaceId: 'rightPanelConditionsBottom',
    rootEl: drawer,
    getCtx: () => ({
      pageId: (location.pathname.match(/^\/page\/([^/]+)$/) || [null, null])[1] || null,
      userState: { getUserState, patchUserState, getAppState, setAppState },
      mountEl: document.getElementById('rightTodoMount'),
    }),
  });

  // HP Tracker split hosts (mount into top/bottom mounts)
  const hpTopHost = createMiniAppHost({
    surfaceId: 'rightPanelHpTop',
    rootEl: drawer,
    getCtx: () => ({
      pageId: (location.pathname.match(/^\/page\/([^/]+)$/) || [null, null])[1] || null,
      userState: { getUserState, patchUserState, getAppState, setAppState },
      mountEl: document.getElementById('rightNotepadMount'),
    }),
  });
  const hpBottomHost = createMiniAppHost({
    surfaceId: 'rightPanelHpBottom',
    rootEl: drawer,
    getCtx: () => ({
      pageId: (location.pathname.match(/^\/page\/([^/]+)$/) || [null, null])[1] || null,
      userState: { getUserState, patchUserState, getAppState, setAppState },
      mountEl: document.getElementById('rightTodoMount'),
    }),
  });

  const drawerContent = drawer; // use attribute on this element to signal split mode

  function updateToggleTopButtonLabel() {
    if (!toggleTopBtn) return;
    try {
      const st = getState() || {};
      const split = !!st.rightPanelSplitActive;
      const cur = split ? (st.rightSplitTopApp || 'notepad') : (st.rightPanelTab || 'notepad');
      const isCond = cur === 'conditions';
      toggleTopBtn.textContent = isCond ? '⇄ Notes' : '⇄ Cond';
      toggleTopBtn.setAttribute('title', 'Toggle top app (Conditions)');
    } catch {}
  }

  function toggleTopApp() {
    const st = getState() || {};
    const split = !!st.rightPanelSplitActive;
    if (split) {
      const cur = st.rightSplitTopApp || 'notepad';
      if (cur !== 'conditions') {
        updateState({ rightPrevTopApp: cur, rightSplitTopApp: 'conditions' });
      } else {
        const back = st.rightPrevTopApp || 'notepad';
        updateState({ rightSplitTopApp: back });
      }
      showSplit();
    } else {
      const cur = st.rightPanelTab || 'notepad';
      if (cur !== 'conditions') {
        updateState({ rightPrevSingleApp: cur, rightPanelTab: 'conditions', rightPanelLastSingleTab: 'conditions' });
        show('conditions');
      } else {
        const back = st.rightPrevSingleApp || 'notepad';
        updateState({ rightPanelTab: back, rightPanelLastSingleTab: back });
        show(back);
      }
    }
    updateToggleTopButtonLabel();
  }

  toggleTopBtn?.addEventListener('click', toggleTopApp);

  function toggleHpApp() {
    const st = getState() || {};
    const split = !!st.rightPanelSplitActive;
    if (split) {
      const cur = st.rightSplitTopApp || 'notepad';
      if (cur !== 'hp') {
        updateState({ rightPrevTopAppHp: cur, rightSplitTopApp: 'hp' });
      } else {
        const back = st.rightPrevTopAppHp || 'notepad';
        updateState({ rightSplitTopApp: back });
      }
      showSplit();
    } else {
      const curOverlay = st.rightNotepadOverlayApp || null;
      const next = curOverlay === 'hp' ? null : 'hp';
      updateState({ rightPanelTab: 'notepad', rightPanelLastSingleTab: 'notepad', rightNotepadOverlayApp: next });
      show('notepad');
    }
    updateToggleHpButtonLabel();
  }

  toggleHpBtn?.addEventListener('click', toggleHpApp);

  function setPanelHeadersDefault() {
    const np = drawer.querySelector(".right-panel[data-panel='notepad'] h3.meta");
    const tp = drawer.querySelector(".right-panel[data-panel='todo'] h3.meta");
    if (np) np.textContent = 'Notepad';
    if (tp) tp.textContent = 'To-Do';
  }

  function readSplitConfig() {
    const st = getState() || {};
    let top = st.rightSplitTopApp || 'notepad';
    let bottom = st.rightSplitBottomApp || 'todo';
    const ALLOWED = new Set(['notepad', 'todo', 'conditions', 'hp']);
    if (!ALLOWED.has(top)) top = 'notepad';
    if (!ALLOWED.has(bottom)) bottom = 'todo';
    if (top === bottom) {
      const ORDER = ['notepad','todo','conditions','hp'];
      const next = ORDER.find(x => x !== top) || 'todo';
      if (bottom === top) bottom = next;
    }
    if (top !== st.rightSplitTopApp || bottom !== st.rightSplitBottomApp) {
      updateState({ rightSplitTopApp: top, rightSplitBottomApp: bottom });
    }
    return { top, bottom };
  }

  function applySplitUI({ top, bottom }) {
    if (splitPicker) splitPicker.hidden = false;
    if (splitToggle) splitToggle.setAttribute('aria-pressed', 'true');
    if (splitTopSelect) splitTopSelect.value = top;
    if (splitBottomSelect) splitBottomSelect.value = bottom;
    if (modeSelect) modeSelect.value = 'split';
    if (singleGroup) singleGroup.style.display = 'none';
    if (splitGroup) splitGroup.style.display = 'flex';
    drawerContent.setAttribute('data-notes-split', 'true');
  }

  function mountSplitApps({ top, bottom }) {
    // Show only notepad and todo panels; hide others
    for (const p of panels) {
      const name = p.getAttribute('data-panel');
      if (name === 'notepad' || name === 'todo') p.hidden = false; else p.hidden = true;
    }
    // Update headers
    const npH = drawer.querySelector(".right-panel[data-panel='notepad'] h3.meta");
    const tdH = drawer.querySelector(".right-panel[data-panel='todo'] h3.meta");
    const labelFor = (v) => v === 'notepad' ? 'Notepad' : (v === 'todo' ? 'To-Do' : (v === 'conditions' ? 'Conditions' : (v === 'hp' ? 'HP' : String(v))));
    if (npH) npH.textContent = labelFor(top);
    if (tdH) tdH.textContent = labelFor(bottom);

    const textarea = drawer.querySelector('#notepad');
    const topMount = drawer.querySelector('#rightNotepadMount');
    const todoNative = drawer.querySelector('#todoNative');
    const bottomMount = drawer.querySelector('#rightTodoMount');
    const todoSlot = drawer.querySelector('#rightTodoSlot');
    const notepadSlot = drawer.querySelector('#rightNotepadSlot');

    // Reset visibility and unmount apps first
    if (topMount) topMount.hidden = true;
    if (bottomMount) bottomMount.hidden = true;
    if (textarea) textarea.hidden = true;
    if (todoNative) todoNative.hidden = true;
    notepadHost.show(null);
    todoHost.show(null);
    conditionsTopHost.show(null);
    conditionsBottomHost.show(null);
    hpTopHost.show(null);
    hpBottomHost.show(null);

    // Top slot
    if (top === 'notepad') {
      if (textarea && notepadSlot && textarea.parentElement !== notepadSlot) notepadSlot.appendChild(textarea);
      if (textarea) textarea.hidden = false;
      notepadHost.show('notepad');
    } else if (top === 'todo') {
      if (todoNative && topMount && todoNative.parentElement !== topMount) topMount.appendChild(todoNative);
      if (topMount) topMount.hidden = false;
      if (todoNative) todoNative.hidden = false;
      todoHost.show('todo');
    } else if (top === 'conditions') {
      if (topMount) topMount.hidden = false;
      conditionsTopHost.show('conditions');
    } else if (top === 'hp') {
      if (topMount) topMount.hidden = false;
      hpTopHost.show('hp');
    }
    // Bottom slot
    if (bottom === 'notepad') {
      if (textarea && bottomMount && textarea.parentElement !== bottomMount) bottomMount.appendChild(textarea);
      if (bottomMount) bottomMount.hidden = false;
      if (textarea) textarea.hidden = false;
      notepadHost.show('notepad');
    } else if (bottom === 'todo') {
      if (todoNative && todoSlot && todoNative.parentElement !== todoSlot) todoSlot.insertBefore(todoNative, todoSlot.firstChild);
      if (todoNative) todoNative.hidden = false;
      todoHost.show('todo');
    } else if (bottom === 'conditions') {
      if (bottomMount) bottomMount.hidden = false;
      conditionsBottomHost.show('conditions');
    } else if (bottom === 'hp') {
      if (bottomMount) bottomMount.hidden = false;
      hpBottomHost.show('hp');
    }

    // Split mode uses the split hosts; ensure single-tab Conditions is unmounted
    conditionsHost.show(null);

    // Ensure split behavior is initialized once
    try { initRightPanelSplit({ getUserState, patchUserState }); } catch {}
  }

  function showSplit() {
    const cfg = readSplitConfig();
    applySplitUI(cfg);
    mountSplitApps(cfg);
    updateToggleTopButtonLabel();
    updateToggleHpButtonLabel();
  }

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
    // Ensure other hosts are unmounted in split view
    conditionsHost.show(null);
    // Ensure split behavior is initialized once
    try { initRightPanelSplit({ getUserState, patchUserState }); } catch {}
    // Optional focus
    if (focus === 'notepad') {
      setTimeout(() => document.getElementById('notepad')?.focus(), 0);
    } else if (focus === 'todo') {
      setTimeout(() => document.getElementById('todoInput')?.focus(), 0);
    }
  };

  function applyNotepadOverlay() {
    const st = getState() || {};
    const split = !!st.rightPanelSplitActive;
    const overlay = st.rightNotepadOverlayApp || null;
    if (split) return;
    const panel = (drawer.querySelector(".right-panel[data-panel='notepad']"));
    if (!panel || panel.hidden) return;
    const textarea = drawer.querySelector('#notepad');
    const topMount = drawer.querySelector('#rightNotepadMount');
    if (!textarea || !topMount) return;
    if (overlay === 'hp') {
      textarea.hidden = true;
      topMount.hidden = false;
      hpTopHost.show('hp');
    } else {
      textarea.hidden = false;
      topMount.hidden = true;
      hpTopHost.show(null);
    }
  }

  function updateToggleHpButtonLabel() {
    if (!toggleHpBtn) return;
    try {
      const st = getState() || {};
      const split = !!st.rightPanelSplitActive;
      if (split) {
        const cur = st.rightSplitTopApp || 'notepad';
        toggleHpBtn.textContent = cur === 'hp' ? '⇄ Notes' : '⇄ HP';
      } else {
        const overlay = st.rightNotepadOverlayApp || null;
        toggleHpBtn.textContent = overlay === 'hp' ? '⇄ Notes' : '⇄ HP';
      }
      toggleHpBtn.setAttribute('title', 'Toggle top app (HP Tracker)');
    } catch {}
  }

  const show = (name) => {
    // Notes tabs map to split view when split toggle is active
    if (name === 'notepad' || name === 'todo') {
      if ((getState() || {}).rightPanelSplitActive) { showSplit(); return; }
      // Single-note view
      drawerContent.removeAttribute('data-notes-split');
      setPanelHeadersDefault();
      for (const p of panels) p.hidden = p.getAttribute('data-panel') !== name;
      notepadHost.show(name === 'notepad' ? 'notepad' : null);
      todoHost.show(name === 'todo' ? 'todo' : null);
      conditionsHost.show(null);
      if (name === 'notepad') {
        applyNotepadOverlay();
      } else {
        try { hpTopHost.show(null); const topMount = drawer.querySelector('#rightNotepadMount'); if (topMount) topMount.hidden = true; } catch {}
      }
      updateToggleTopButtonLabel();
      updateToggleHpButtonLabel();
      return;
    }
    // Non-note tabs: hide both note panels, unmount hosts, show selected panel
    drawerContent.removeAttribute('data-notes-split');
    for (const p of panels) p.hidden = p.getAttribute('data-panel') !== name;
    setPanelHeadersDefault();
    notepadHost.show(null);
    todoHost.show(null);
    conditionsHost.show(null);
    conditionsTopHost.show(null);
    conditionsBottomHost.show(null);
    hpTopHost.show(null);
    hpBottomHost.show(null);
    if (name === 'conditions') conditionsHost.show('conditions');
    if (name === 'settings') renderSettingsPanel();
    updateToggleTopButtonLabel();
    updateToggleHpButtonLabel();
  };
  // initialize active tab
  let initial = s.rightPanelTab || 'notepad';
  if ((initial === 'notepad' && hidden.has('notepad')) || (initial === 'todo' && hidden.has('todo'))) {
    // fallback to first visible tab in current order
    const order = ['notepad', 'conditions', 'todo', 'backlinks', 'settings'];
    initial = order.find(t => !((t === 'notepad' && hidden.has('notepad')) || (t === 'todo' && hidden.has('todo')))) || 'backlinks';
    updateState({ rightPanelTab: initial });
  }
  // Setup picker initial state and show correct view
  if (modeSelect) modeSelect.value = s.rightPanelSplitActive ? 'split' : 'single';
  if (singleSelect) singleSelect.value = s.rightPanelTab || 'notepad';
  if (singleGroup) singleGroup.style.display = s.rightPanelSplitActive ? 'none' : 'flex';
  if (splitGroup) splitGroup.style.display = s.rightPanelSplitActive ? 'flex' : 'none';
  if (s.rightPanelSplitActive) {
    showSplit();
  } else {
    splitPicker && (splitPicker.hidden = false);
    splitToggle && splitToggle.setAttribute('aria-pressed', 'false');
    show(initial);
  }
  updateToggleTopButtonLabel();
  tabs.forEach(btn => btn.addEventListener('click', () => {
    const t = btn.getAttribute('data-tab');
    if ((getState() || {}).rightPanelSplitActive) {
      updateState({ rightPanelSplitActive: false, rightPanelLastSingleTab: t, rightPanelTab: t });
      setPanelHeadersDefault();
      if (modeSelect) modeSelect.value = 'single';
      if (singleGroup) singleGroup.style.display = 'flex';
      if (splitGroup) splitGroup.style.display = 'none';
    }
    show(t);
    updateState({ rightPanelTab: t });
    if (t === 'settings') renderSettingsPanel();
  }));

  // Notepad and To-Do now mount via mini app hosts (supports split mode)

  // Split toggle behavior (deprecated UI, kept hidden); still supported
  splitToggle?.addEventListener('click', () => {
    const st = getState();
    const active = !!st.rightPanelSplitActive;
    if (!active) {
      if (modeSelect) modeSelect.value = 'split';
      updateState({ rightPanelSplitActive: true, rightPanelLastSingleTab: st.rightPanelTab || 'notepad' });
      if (singleGroup) singleGroup.style.display = 'none';
      if (splitGroup) splitGroup.style.display = 'flex';
      showSplit();
    } else {
      const back = st.rightPanelLastSingleTab || 'notepad';
      if (modeSelect) modeSelect.value = 'single';
      updateState({ rightPanelSplitActive: false, rightPanelTab: back });
      drawerContent.removeAttribute('data-notes-split');
      setPanelHeadersDefault();
      if (singleGroup) singleGroup.style.display = 'flex';
      if (splitGroup) splitGroup.style.display = 'none';
      show(back);
    }
  });

  // Split picker events
  splitTopSelect?.addEventListener('change', () => {
    let top = splitTopSelect.value;
    let bottom = getState().rightSplitBottomApp || 'todo';
    if (top === bottom) {
      const ORDER = ['notepad','todo','conditions','hp'];
      bottom = ORDER.find(x => x !== top) || 'todo';
    }
    updateState({ rightSplitTopApp: top, rightSplitBottomApp: bottom });
    showSplit();
  });
  splitBottomSelect?.addEventListener('change', () => {
    let bottom = splitBottomSelect.value;
    let top = getState().rightSplitTopApp || 'notepad';
    if (top === bottom) {
      const ORDER = ['notepad','todo','conditions','hp'];
      top = ORDER.find(x => x !== bottom) || 'notepad';
    }
    updateState({ rightSplitTopApp: top, rightSplitBottomApp: bottom });
    showSplit();
  });
  splitSwapBtn?.addEventListener('click', () => {
    const cfg = readSplitConfig();
    let newTop = cfg.bottom;
    let newBottom = cfg.top;
    if (newTop === newBottom) {
      const ORDER = ['notepad','todo','conditions','hp'];
      newBottom = ORDER.find(x => x !== newTop) || 'todo';
    }
    updateState({ rightSplitTopApp: newTop, rightSplitBottomApp: newBottom });
    showSplit();
  });

  // Legacy close button no longer present; listener retained for compatibility

  // Mode & Single selection
  modeSelect?.addEventListener('change', () => {
    const mode = modeSelect.value === 'split' ? 'split' : 'single';
    if (mode === 'split') {
      const st = getState();
      updateState({ rightPanelSplitActive: true, rightPanelLastSingleTab: st.rightPanelTab || 'notepad' });
      if (singleGroup) singleGroup.style.display = 'none';
      if (splitGroup) splitGroup.style.display = 'flex';
      showSplit();
    } else {
      const st = getState();
      const back = st.rightPanelLastSingleTab || st.rightPanelTab || 'notepad';
      updateState({ rightPanelSplitActive: false, rightPanelTab: back });
      drawerContent.removeAttribute('data-notes-split');
      setPanelHeadersDefault();
      if (singleGroup) singleGroup.style.display = 'flex';
      if (splitGroup) splitGroup.style.display = 'none';
      show(back);
    }
  });
  singleSelect?.addEventListener('change', () => {
    const val = singleSelect.value || 'notepad';
    updateState({ rightPanelTab: val, rightPanelLastSingleTab: val });
    show(val);
    if (val === 'settings') renderSettingsPanel();
  });
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
