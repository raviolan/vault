import { $, $$ } from '../lib/dom.js';
import { getState, updateState } from '../lib/state.js';
import { fetchJson } from '../lib/http.js';
import { createMiniAppHost } from '../miniapps/host.js';
import { registerMany } from '../miniapps/registry.js';
import { NotepadApp } from '../miniapps/notepad/app.js';
import { TodoApp } from '../miniapps/todo/app.js';
import { ConditionsApp } from '../miniapps/conditions/app.js';
import { HpTrackerApp } from '../miniapps/hp/app.js';
import { RandomOccurrencesApp } from '../miniapps/randomOccurrences/app.js';
import { BacklinksApp } from '../miniapps/backlinks/app.js';
import { getAppState, setAppState, getUserState, patchUserState } from '../miniapps/state.js';
import { initRightPanelSplit } from './rightPanelSplit.js';

export function bindRightPanel() {
  const toggle = $('#rightDrawerToggle');
  const drawer = $('#rightDrawer');
  const pinBtn = $('#rightDrawerPin');
  if (!toggle || !drawer) return;

  // Register built-in mini apps once, keeping order stable
  registerMany([NotepadApp, TodoApp, ConditionsApp, HpTrackerApp, RandomOccurrencesApp, BacklinksApp]);

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
  // New explicit top-app buttons
  const btnNotes = document.getElementById('rightTopAppNotes');
  const btnCond  = document.getElementById('rightTopAppConditions');
  const btnHp    = document.getElementById('rightTopAppHp');
  const btnRandom = document.getElementById('rightTopAppRandomOcc');
  const btnBacklinks = document.getElementById('rightTopAppBacklinks');
  const splitPicker = document.getElementById('rightSplitPicker');
  const splitTopSelect = document.getElementById('rightSplitTopSelect');
  const splitBottomSelect = document.getElementById('rightSplitBottomSelect');
  const splitSwapBtn = document.getElementById('rightSplitSwap');
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

  // Random Occurrences single panel host
  const randomHost = createMiniAppHost({
    surfaceId: 'rightPanelRandomOcc',
    rootEl: drawer,
    getCtx: () => ({
      pageId: (location.pathname.match(/^\/page\/([^/]+)$/) || [null, null])[1] || null,
      userState: { getUserState, patchUserState, getAppState, setAppState },
      mountEl: document.getElementById('rightRandomOccMount'),
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

  // Backlinks single panel host
  const backlinksHost = createMiniAppHost({
    surfaceId: 'rightPanelBacklinks',
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

  // Backlinks split hosts (top/bottom mounts)
  const backlinksTopHost = createMiniAppHost({
    surfaceId: 'rightPanelBacklinksTop',
    rootEl: drawer,
    getCtx: () => ({
      pageId: (location.pathname.match(/^\/page\/([^/]+)$/) || [null, null])[1] || null,
      userState: { getUserState, patchUserState, getAppState, setAppState },
      mountEl: document.getElementById('rightNotepadMount'),
    }),
  });
  const backlinksBottomHost = createMiniAppHost({
    surfaceId: 'rightPanelBacklinksBottom',
    rootEl: drawer,
    getCtx: () => ({
      pageId: (location.pathname.match(/^\/page\/([^/]+)$/) || [null, null])[1] || null,
      userState: { getUserState, patchUserState, getAppState, setAppState },
      mountEl: document.getElementById('rightTodoMount'),
    }),
  });

  // Random Occurrences split hosts (top/bottom mounts)
  const randomTopHost = createMiniAppHost({
    surfaceId: 'rightPanelRandomOccTop',
    rootEl: drawer,
    getCtx: () => ({
      pageId: (location.pathname.match(/^\/page\/([^/]+)$/) || [null, null])[1] || null,
      userState: { getUserState, patchUserState, getAppState, setAppState },
      mountEl: document.getElementById('rightNotepadMount'),
    }),
  });
  const randomBottomHost = createMiniAppHost({
    surfaceId: 'rightPanelRandomOccBottom',
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

  // New unified setter for top app choice
  function setTopAppChoice(choice) {
    updateState({ rightPanelSplitActive: true, rightSplitTopApp: choice });
    showSplit();
  }

  // Wire new explicit buttons
  btnNotes && (btnNotes.onclick = () => setTopAppChoice('notepad'));
  btnCond && (btnCond.onclick  = () => setTopAppChoice('conditions'));
  btnHp && (btnHp.onclick    = () => setTopAppChoice('hp'));
  btnRandom && (btnRandom.onclick = () => setTopAppChoice('randomOccurrences'));
  btnBacklinks && (btnBacklinks.onclick = () => setTopAppChoice('backlinks'));

  // Active state styling for buttons
  function updateTopAppButtonsActive() {
    const st = getState() || {};
    const active = st.rightSplitTopApp || 'notepad';
    btnNotes?.classList.toggle('is-active', active === 'notepad');
    btnCond?.classList.toggle('is-active', active === 'conditions');
    btnHp?.classList.toggle('is-active', active === 'hp');
    btnRandom?.classList.toggle('is-active', active === 'randomOccurrences');
    btnBacklinks?.classList.toggle('is-active', active === 'backlinks');
  }

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
    const ALLOWED = new Set(['notepad', 'todo', 'conditions', 'hp', 'randomOccurrences', 'backlinks']);
    if (!ALLOWED.has(top)) top = 'notepad';
    if (!ALLOWED.has(bottom)) bottom = 'todo';
    if (top === bottom) {
      const ORDER = ['notepad','todo','conditions','hp','randomOccurrences','backlinks'];
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
    if (splitTopSelect) splitTopSelect.value = top;
    if (splitBottomSelect) splitBottomSelect.value = bottom;
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
    const labelFor = (v) => (
      v === 'notepad' ? 'Notepad' :
      v === 'todo' ? 'To-Do' :
      v === 'conditions' ? 'Conditions' :
      v === 'hp' ? 'HP' :
      v === 'randomOccurrences' ? 'Random' :
      v === 'backlinks' ? 'Backlinks' : String(v)
    );
    if (npH) npH.textContent = labelFor(top);
    if (tdH) tdH.textContent = labelFor(bottom);

    const textarea = drawer.querySelector('#notepad');
    const topMount = drawer.querySelector('#rightNotepadMount');
    const todoNative = drawer.querySelector('#todoNative');
    const randomNative = drawer.querySelector('#randomOccNative');
    const bottomMount = drawer.querySelector('#rightTodoMount');
    const todoSlot = drawer.querySelector('#rightTodoSlot');
    const notepadSlot = drawer.querySelector('#rightNotepadSlot');

    // Reset visibility and unmount apps first
    if (topMount) topMount.hidden = true;
    if (bottomMount) bottomMount.hidden = true;
    if (textarea) textarea.hidden = true;
    if (todoNative) todoNative.hidden = true;
    if (randomNative) randomNative.hidden = true;
    notepadHost.show(null);
    todoHost.show(null);
    conditionsTopHost.show(null);
    conditionsBottomHost.show(null);
    hpTopHost.show(null);
    hpBottomHost.show(null);
    randomTopHost.show(null);
    randomBottomHost.show(null);
    backlinksTopHost.show(null);
    backlinksBottomHost.show(null);

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
    } else if (top === 'randomOccurrences') {
      if (randomNative && topMount && randomNative.parentElement !== topMount) topMount.appendChild(randomNative);
      if (topMount) topMount.hidden = false;
      if (randomNative) randomNative.hidden = false;
      randomTopHost.show('randomOccurrences');
    } else if (top === 'backlinks') {
      if (topMount) topMount.hidden = false;
      backlinksTopHost.show('backlinks');
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
    } else if (bottom === 'randomOccurrences') {
      if (randomNative && bottomMount && randomNative.parentElement !== bottomMount) bottomMount.appendChild(randomNative);
      if (bottomMount) bottomMount.hidden = false;
      if (randomNative) randomNative.hidden = false;
      randomBottomHost.show('randomOccurrences');
    } else if (bottom === 'backlinks') {
      if (bottomMount) bottomMount.hidden = false;
      backlinksBottomHost.show('backlinks');
    }

    // Split mode uses the split hosts; ensure single-tab Conditions is unmounted
    conditionsHost.show(null);

    // Ensure split behavior is initialized once
    try { initRightPanelSplit({ getUserState, patchUserState }); } catch {}
    // Update button actives after mounts
    updateTopAppButtonsActive();
  }

  function showSplit() {
    const cfg = readSplitConfig();
    applySplitUI(cfg);
    mountSplitApps(cfg);
    updateTopAppButtonsActive();
  }
  updateState({ rightPanelSplitActive: true });
  if (splitGroup) splitGroup.style.display = 'flex';
  showSplit();
  updateTopAppButtonsActive();

  // Split picker events
  splitTopSelect?.addEventListener('change', () => {
    let top = splitTopSelect.value;
    let bottom = getState().rightSplitBottomApp || 'todo';
    if (top === bottom) {
      const ORDER = ['notepad','todo','conditions','hp','randomOccurrences','backlinks'];
      bottom = ORDER.find(x => x !== top) || 'todo';
    }
    updateState({ rightSplitTopApp: top, rightSplitBottomApp: bottom });
    showSplit();
  });
  splitBottomSelect?.addEventListener('change', () => {
    let bottom = splitBottomSelect.value;
    let top = getState().rightSplitTopApp || 'notepad';
    if (top === bottom) {
      const ORDER = ['notepad','todo','conditions','hp','randomOccurrences','backlinks'];
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
      const ORDER = ['notepad','todo','conditions','hp','randomOccurrences','backlinks'];
      newBottom = ORDER.find(x => x !== newTop) || 'todo';
    }
    updateState({ rightSplitTopApp: newTop, rightSplitBottomApp: newBottom });
    showSplit();
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
