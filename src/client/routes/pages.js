import { escapeHtml } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';
import { setBreadcrumb, setPageActionsEnabled } from '../lib/ui.js';
import { renderBlocksReadOnly } from '../blocks/readOnly.js';
import { renderBlocksEdit, refreshBlocksFromServer } from '../blocks/edit.js';
import { setUiMode } from '../lib/uiMode.js';
import { autosizeTextarea } from '../lib/autosizeTextarea.js';
import { isEditingPage, setEditModeForPage, getCurrentPageBlocks, setCurrentPageBlocks } from '../lib/pageStore.js';
import { openDeleteModal } from '../features/modals.js';
import { renderBacklinksPanel } from '../features/backlinks.js';
import { mountSaveIndicator, unmountSaveIndicator } from '../features/saveIndicator.js';
import { renderHeaderMedia } from '../features/headerMedia.js';
import { uploadMedia, updatePosition, deleteMedia } from '../lib/mediaUpload.js';
import { sectionForType, sectionKeyForType } from '../features/nav.js';
import { getNavGroupsForSection, setGroupForPage, addGroup } from '../features/navGroups.js';
import { flushDebouncedPatches } from '../blocks/edit/state.js';
import { getState, updateState, saveStateNow } from '../lib/state.js';
import { addPageToSection, removePageFromSection, normalizeSections } from '../lib/sections.js';
import { canonicalPageHref } from '../lib/pageUrl.js';
import { setActivePage } from '../lib/activePage.js';
import { setDocumentTitle } from '../lib/documentTitle.js';
import { getPageSheet, patchPageSheet, setPageSheetCache } from '../lib/pageSheetStore.js';
import { getOpen5eResource, normalizeO5eType } from '../features/open5eCore.js';

// ---------- Private helpers (pure refactor; no behavior change intended)

function getPageOutletOrNull() {
  return document.getElementById('outlet');
}

function computeSectionLabel(page) {
  const folderTitle = getFolderTitleForPage(page.id);
  return folderTitle || sectionForType(page.type);
}

function renderPageShell(outlet, page, { sectionLabel, includeTagsToolbar }) {
  if (!outlet) return;
  if (includeTagsToolbar) {
    // Exact template from ID-based route (includes #pageTags toolbar)
    outlet.innerHTML = `
    <article class="page page--${escapeHtml(page.type || 'page')}">
      <div id=\"pageHeaderMedia\"></div>
      <div class=\"page-identity\" id=\"pageIdentity\">
        <div class=\"avatar-col\"></div>
        <div class=\"name-col\"> 
          <h1 id=\"pageTitleView\">${escapeHtml(page.title)}</h1>
          <div id=\"pageTags\" class=\"toolbar\"></div>
          <div id=\"pageSheetHeaderFields\"></div>
        </div>
        
      </div>
      <div id=\"pageTabs\" class=\"page-tabs\" hidden>
        <button type=\"button\" class=\"chip page-tab\" data-tab=\"notes\">Notes</button>
        <button type=\"button\" class=\"chip page-tab\" data-tab=\"sheet\">Sheet</button>
      </div>
      <div class=\"page-body\"> 
        <div id=\"pageBlocks\"></div>
        <div id=\"pageSheet\" class=\"page-sheet\" hidden></div>
      </div>
      <p class=\"meta\">Section: ${escapeHtml(sectionLabel || page.type || '')} · Updated: ${escapeHtml(page.updatedAt || page.createdAt || '')}</p>
    </article>
  `;
  } else {
    // Exact template from slug-based route (no #pageTags toolbar)
    outlet.innerHTML = `
    <article class=\"page page--${escapeHtml(page.type || 'page')}\"> 
      <div id=\"pageHeaderMedia\"></div>
      <div class=\"page-identity\" id=\"pageIdentity\"> 
        <div class=\"avatar-col\"></div>
        <div class=\"name-col\"> 
          <h1 id=\"pageTitleView\">${escapeHtml(page.title)}</h1>
          <div id=\"pageSheetHeaderFields\"></div>
        </div>
        
      </div>
      <div id=\"pageTabs\" class=\"page-tabs\" hidden>
        <button type=\"button\" class=\"chip page-tab\" data-tab=\"notes\">Notes</button>
        <button type=\"button\" class=\"chip page-tab\" data-tab=\"sheet\">Sheet</button>
      </div>
      <div class=\"page-body\"> 
        <div id=\"pageBlocks\"></div>
        <div id=\"pageSheet\" class=\"page-sheet\" hidden></div>
      </div>
      <p class=\"meta\">Section: ${escapeHtml(sectionLabel || page.type || '')} · Updated: ${escapeHtml(page.updatedAt || page.createdAt || '')}</p>
    </article>
  `;
  }
}

function initHeaderMedia(outlet, page) {
  let rerenderHeaderMedia = null;
  try {
    const host = document.getElementById('pageHeaderMedia');
    const showProfile = (page.type === 'npc' || page.type === 'character');
    const renderHM = () => {
      const mode = isEditingPage(page.id) ? 'edit' : 'view';
      const article = outlet?.querySelector?.('article.page');
      if (article) {
        if (showProfile && page.media?.profile) article.classList.add('has-profile-media'); else article.classList.remove('has-profile-media');
      }
      renderHeaderMedia(host, {
        mode,
        cover: page.media?.header || null,
        profile: showProfile ? (page.media?.profile || null) : null,
        showProfile,
        async onUploadCover(file) {
          const resp = await uploadMedia({ scope: 'page', pageId: page.id, slot: 'header', file });
          page.media = page.media || {};
          page.media.header = { url: resp.url, posX: resp.posX, posY: resp.posY, zoom: Number(resp.zoom ?? 1) };
          renderHM();
        },
        async onUploadProfile(file) {
          if (!showProfile) return;
          const resp = await uploadMedia({ scope: 'page', pageId: page.id, slot: 'profile', file });
          page.media = page.media || {};
          page.media.profile = { url: resp.url, posX: resp.posX, posY: resp.posY, zoom: Number(resp.zoom ?? 1) };
          renderHM();
        },
        async onRemoveCover() {
          await deleteMedia({ scope: 'page', pageId: page.id, slot: 'header' });
          if (page.media) page.media.header = null;
          renderHM();
        },
        async onRemoveProfile() {
          await deleteMedia({ scope: 'page', pageId: page.id, slot: 'profile' });
          if (page.media) page.media.profile = null;
          renderHM();
        },
        async onSavePosition(slot, x, y, zoom) {
          try {
            await updatePosition({ scope: 'page', pageId: page.id, slot, posX: x, posY: y, ...(Number.isFinite(zoom) ? { zoom } : {}) });
            if (slot === 'header' && page.media?.header) { page.media.header.posX = x; page.media.header.posY = y; if (Number.isFinite(zoom)) page.media.header.zoom = zoom; }
            if (slot === 'profile' && page.media?.profile) { page.media.profile.posX = x; page.media.profile.posY = y; if (Number.isFinite(zoom)) page.media.profile.zoom = zoom; }
            renderHM();
          } catch (e) {
            console.error('[media] failed to save position', e);
          }
        },
      });
      // Reserve identity left column to match avatar width (if present)
      try {
        const identity = document.getElementById('pageIdentity');
        const clip = host?.querySelector?.('.profileWrap');
        const w = clip ? Math.round(clip.getBoundingClientRect().width) : 0;
        const reserve = (showProfile && page.media?.profile && w) ? `${w}px` : '0px';
        if (identity) identity.style.setProperty('--avatar-slot', reserve);
      } catch {}
    };
    rerenderHeaderMedia = renderHM;
    renderHM();
  } catch {}
  return rerenderHeaderMedia;
}

function initCharTabsAndSheet(outlet, page) {
  const isNpc = (page.type === 'npc');
  const isChar = (page.type === 'character' || page.type === 'pc');
  const isCharLike = (isNpc || isChar);
  const tabsEl = document.getElementById('pageTabs');
  const sheetEl = document.getElementById('pageSheet');
  const blocksEl = document.getElementById('pageBlocks');
  const metaEl = outlet?.querySelector?.('p.meta') || null;

  // Sentinel root id for NPC Sheet subtree
  const NPC_SHEET_ROOT = '__npc_sheet__';

  // Split helpers: partition all blocks into (content vs npcSheet) subtrees
  function splitNpcSheetBlocks(all) {
    const allBlocks = Array.isArray(all) ? all : [];
    if (!allBlocks.length) return { contentBlocks: [], npcSheetBlocks: [] };
    const children = new Map();
    for (const b of allBlocks) {
      const pid = (b.parentId == null ? null : String(b.parentId));
      const arr = children.get(pid) || [];
      arr.push(b);
      children.set(pid, arr);
    }
    const roots = children.get(NPC_SHEET_ROOT) || [];
    if (!roots.length) return { contentBlocks: allBlocks, npcSheetBlocks: [] };
    const sheetIds = new Set();
    const stack = roots.slice();
    while (stack.length) {
      const n = stack.pop();
      if (!n || sheetIds.has(n.id)) continue;
      sheetIds.add(n.id);
      const kids = children.get(String(n.id)) || [];
      for (const k of kids) stack.push(k);
    }
    const npcSheetBlocks = allBlocks.filter(b => sheetIds.has(b.id));
    const contentBlocks = allBlocks.filter(b => !sheetIds.has(b.id));
    return { contentBlocks, npcSheetBlocks };
  }

  let sheetCache = null;
  let sheetLoaded = false;
  let saveTimer = null;

  async function loadSheet() {
    if (sheetLoaded && sheetCache) return sheetCache;
    sheetLoaded = true;
    try { sheetCache = await getPageSheet(page.id); } catch { sheetCache = {}; }
    return sheetCache || {};
  }

  let currentTab = null;
  // Ensure only one visible toolbar inside the active editor host (NPC only)
  function enforceActiveEditorToolbar(tab) {
    try {
      if (!isNpc) return; // Do not alter Character/PC behavior
      const all = Array.from(document.querySelectorAll('#editorToolbar'));
      if (!all.length) return;
      // Determine active host for current tab
      const notesRoot = document.getElementById('pageBlocks');
      const sheetRoot = document.getElementById('pageSheet')?.querySelector?.('#npcSheetBlocksHost') || null;
      const notesHost = notesRoot?.closest('[data-editor-host], .page-editor, .page-body, article.page') || notesRoot?.parentElement || null;
      const sheetHost = sheetRoot?.closest('[data-editor-host], .page-sheet, .page-body, article.page') || document.getElementById('pageSheet') || null;
      const activeHost = (tab === 'sheet') ? (sheetHost || document.getElementById('pageSheet')) : (notesHost || notesRoot?.parentElement || null);
      // Hide toolbars not inside the active host
      for (const tb of all) {
        const show = !!(activeHost && activeHost.contains(tb));
        tb.style.display = show ? '' : 'none';
      }
      // If multiple toolbars exist inside the active host, keep the first and remove extras
      if (activeHost) {
        const inHost = all.filter(tb => activeHost.contains(tb));
        for (let i = 1; i < inHost.length; i++) {
          try { inHost[i].remove(); } catch {}
        }
      }
    } catch {}
  }
  function setActiveTab(tab) {
    const st = getState() || {};
    const pages = (st.pageTabsV1?.pages && typeof st.pageTabsV1.pages === 'object') ? st.pageTabsV1.pages : {};
    updateState({ pageTabsV1: { ...(st.pageTabsV1||{}), pages: { ...pages, [page.id]: tab } } });

    for (const b of tabsEl?.querySelectorAll?.('.page-tab') || []) {
      b.classList.toggle('is-active', b.dataset.tab === tab);
    }

    if (isNpc) {
      // Before switching, merge edits from the previous tab back into page.blocks
      try {
        if (currentTab && currentTab !== tab) {
          const edited = getCurrentPageBlocks();
          const full = page.blocks || [];
          const { contentBlocks, npcSheetBlocks } = splitNpcSheetBlocks(full);
          if (currentTab === 'notes') {
            // Merge edited content back, keep prior npc sheet
            page.blocks = [...(Array.isArray(edited) ? edited : []), ...npcSheetBlocks];
          } else if (currentTab === 'sheet') {
            // Merge edited npc sheet back, keep prior content
            page.blocks = [...contentBlocks, ...(Array.isArray(edited) ? edited : [])];
          }
        }
      } catch {}
      currentTab = tab;

      // NPC: Sheet tab is a normal blocks editor bound to NPC sheet subtree

      if (tab === 'notes') {
        if (sheetEl) sheetEl.hidden = true;
        if (blocksEl) blocksEl.style.display = '';
        if (metaEl) metaEl.style.display = '';
        // Show only the toolbar within the active notes editor host
        enforceActiveEditorToolbar('notes');
        try {
          const all = getCurrentPageBlocks();
          // When switching back to notes, ensure current store shows content-only blocks
          const full = (page.blocks || []);
          const { contentBlocks } = splitNpcSheetBlocks(full);
          setCurrentPageBlocks(contentBlocks);
        } catch {}
      } else {
        if (blocksEl) blocksEl.style.display = 'none';
        if (sheetEl) sheetEl.hidden = false;
        if (metaEl) metaEl.style.display = '';
        // Show only the toolbar within the active sheet editor host
        enforceActiveEditorToolbar('sheet');
        void renderNpcSheetBlocks();
      }
      return;
    } else {
      // Character/PC: legacy stat sheet UI remains
      if (tab === 'notes') {
        if (sheetEl) sheetEl.hidden = true;
        if (blocksEl) blocksEl.style.display = '';
        if (metaEl) metaEl.style.display = '';
      } else {
        if (blocksEl) blocksEl.style.display = 'none';
        if (sheetEl) sheetEl.hidden = false;
        if (metaEl) metaEl.style.display = '';
        void renderSheet();
      }
    }
  }

  async function renderNpcSheetBlocks() {
    if (!sheetEl) return;
    // Render normal block editor into the sheet host, using a custom rootParentId
    const editing = isEditingPage(page.id);
    const { stableRender } = await import('../blocks/edit/render.js');
    const full = (page.blocks || []);
    const { npcSheetBlocks } = splitNpcSheetBlocks(full);
    // Ensure store is set to the NPC sheet subset before rendering
    setCurrentPageBlocks(npcSheetBlocks);
    // Find/create a stable host inside the sheet container
    let host = sheetEl.querySelector('#npcSheetBlocksHost');
    if (!host) {
      sheetEl.innerHTML = `<div id="npcSheetBlocksHost"></div>`;
      host = sheetEl.querySelector('#npcSheetBlocksHost');
    }
    if (editing) {
      // Render editor into sheetEl with rootParentId sentinel
      stableRender(host, page, getCurrentPageBlocks(), null, { rootParentId: NPC_SHEET_ROOT });
      // After rendering, enforce single visible toolbar for the sheet host
      enforceActiveEditorToolbar('sheet');
    } else {
      // Render read-only into sheetEl
      try {
        const { renderBlocksReadOnly } = await import('../blocks/readOnly.js');
        host.innerHTML = '';
        renderBlocksReadOnly(host, getCurrentPageBlocks());
      } catch {}
    }
  }

  async function renderSheet() {
    if (!sheetEl) return;
    if (isNpc) { return renderNpcSheetBlocks(); }
    const sheet = await loadSheet();
    const editing = isEditingPage(page.id);

    sheetEl.innerHTML = `
      <div class=\"sheet-grid\"> 
        <label class=\"sheet-field\">
          <span class=\"meta\">AC</span>
          ${editing ? `<input id=\"sheetAc\" type=\"number\" inputmode=\"numeric\" />` : `<div class=\"sheet-val\" id=\"sheetAcView\"></div>`}
        </label>

        <label class=\"sheet-field\">
          <span class=\"meta\">Passive Perception</span>
          ${editing ? `<input id=\"sheetPP\" type=\"number\" inputmode=\"numeric\" />` : `<div class=\"sheet-val\" id=\"sheetPPView\"></div>`}
        </label>

        <label class=\"sheet-field\">
          <span class=\"meta\">Passive Insight</span>
          ${editing ? `<input id=\"sheetPI\" type=\"number\" inputmode=\"numeric\" />` : `<div class=\"sheet-val\" id=\"sheetPIView\"></div>`}
        </label>

        <label class=\"sheet-field\">
          <span class=\"meta\">Passive Investigation</span>
          ${editing ? `<input id=\"sheetPV\" type=\"number\" inputmode=\"numeric\" />` : `<div class=\"sheet-val\" id=\"sheetPVView\"></div>`}
        </label>
      </div>

      <div class=\"sheet-notes\">
        <div class=\"meta\">Notes</div>
        ${editing
          ? `<textarea id=\"sheetNotes\" class=\"sheet-notes-input\" rows=\"6\" placeholder=\"Useful combat notes, tactics, special rules, reminders…\"></textarea>`
          : `<div id=\"sheetNotesView\" class=\"sheet-notes-view\"></div>`
        }
      </div>
    `;

    const setText = (id, v) => { const el = sheetEl.querySelector(id); if (el) el.textContent = (v === null || v === undefined || v === '') ? '—' : String(v); };

    if (!editing) {
      setText('#sheetAcView', sheet.ac);
      setText('#sheetPPView', sheet.passivePerception);
      setText('#sheetPIView', sheet.passiveInsight);
      setText('#sheetPVView', sheet.passiveInvestigation);

      try {
        const view = sheetEl.querySelector('#sheetNotesView');
        if (view) {
          view.innerHTML = '';
          const { buildWikiTextNodes } = await import('../features/wikiLinks.js');
          (buildWikiTextNodes(String(sheet.notes || '')) || []).forEach(n => view.appendChild(n));
        }
      } catch {
        const view = sheetEl.querySelector('#sheetNotesView');
        if (view) view.textContent = String(sheet.notes || '');
      }
      return;
    }

    const ac = sheetEl.querySelector('#sheetAc'); if (ac) ac.value = (sheet.ac ?? '') === null ? '' : String(sheet.ac ?? '');
    const pp = sheetEl.querySelector('#sheetPP'); if (pp) pp.value = (sheet.passivePerception ?? '') === null ? '' : String(sheet.passivePerception ?? '');
    const pi = sheetEl.querySelector('#sheetPI'); if (pi) pi.value = (sheet.passiveInsight ?? '') === null ? '' : String(sheet.passiveInsight ?? '');
    const pv = sheetEl.querySelector('#sheetPV'); if (pv) pv.value = (sheet.passiveInvestigation ?? '') === null ? '' : String(sheet.passiveInvestigation ?? '');
    const notes = sheetEl.querySelector('#sheetNotes'); if (notes) notes.value = String(sheet.notes || '');

    try { const { autosizeTextarea } = await import('../lib/autosizeTextarea.js'); if (notes) autosizeTextarea(notes); } catch {}

    function queueSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        const next = {
          ac: ac ? ac.value : '',
          passivePerception: pp ? pp.value : '',
          passiveInsight: pi ? pi.value : '',
          passiveInvestigation: pv ? pv.value : '',
          notes: notes ? notes.value : ''
        };
        try {
          const sheet = await patchPageSheet(page.id, next);
          sheetCache = sheet || sheetCache;
        } catch (e) {
          console.error('Failed to save sheet', e);
        }
      }, 250);
    }

    for (const el of [ac, pp, pi, pv, notes].filter(Boolean)) {
      el.addEventListener('input', () => {
        sheetCache = sheetCache || {};
        if (el === ac) sheetCache.ac = el.value === '' ? null : Number(el.value);
        if (el === pp) sheetCache.passivePerception = el.value === '' ? null : Number(el.value);
        if (el === pi) sheetCache.passiveInsight = el.value === '' ? null : Number(el.value);
        if (el === pv) sheetCache.passiveInvestigation = el.value === '' ? null : Number(el.value);
        if (el === notes) sheetCache.notes = el.value;
        queueSave();
      });
    }
  }

  if (isCharLike) {
    try {
      const onSheetUpdate = (e) => {
        if (String(e?.detail?.pageId || '') !== String(page.id)) return;
        sheetCache = e.detail.sheet || sheetCache;
        try {
          const st = getState() || {};
          const active = st.pageTabsV1?.pages?.[page.id] || 'notes';
          if (active === 'sheet' && !isNpc) { void renderSheet(); }
        } catch {}
      };
      window.addEventListener('vault:page-sheet-updated', onSheetUpdate);
      // Store for cleanup
      outlet.__onSheetUpdate = onSheetUpdate;
    } catch {}
    
    if (tabsEl) tabsEl.hidden = false;
    tabsEl?.querySelectorAll('.page-tab').forEach(btn => btn.onclick = () => setActiveTab(btn.dataset.tab));
    const st = getState() || {};
    const saved = st.pageTabsV1?.pages?.[page.id];
    let initialTab = (saved === 'sheet' ? 'sheet' : 'notes');
    try {
      // Support deep-link: ?tab=sheet or ?tab=notes (NPC only)
      if (page.type === 'npc') {
        const params = new URLSearchParams(window.location.search || '');
        const qp = (params.get('tab') || '').toLowerCase();
        if (qp === 'sheet' || qp === 'notes') initialTab = qp;
      }
    } catch {}
    setActiveTab(initialTab);
  }

  return { isCharLike, renderSheet };
}

function initSheetHeaderFields(page) {
  const host = document.getElementById('pageSheetHeaderFields');
  if (!host) return () => {};
  const isCharLike = (page.type === 'npc' || page.type === 'character' || page.type === 'pc');
  if (!isCharLike) { host.innerHTML = ''; return () => {}; }

  // Styling: compact row with wrap
  try {
    host.style.display = 'flex';
    host.style.flexWrap = 'wrap';
    host.style.gap = '8px';
    host.style.marginTop = '6px';
    host.style.alignItems = 'center';
  } catch {}

  let debounceTimer = null;
  const saveDebounced = (patch) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { void patchPageSheet(page.id, patch); }, 400);
  };

  async function render() {
    const editing = isEditingPage(page.id);
    let sheet = {};
    try { sheet = await getPageSheet(page.id); } catch { sheet = {}; }

    if (!editing) {
      const ac = (sheet.ac ?? '') === null ? '' : String(sheet.ac ?? '');
      const hpMax = (sheet.hpMax ?? '') === null ? '' : String(sheet.hpMax ?? '');
      const xp = (sheet.xpReward ?? '') === null ? '' : String(sheet.xpReward ?? '');
      const tagline = String(sheet.tagline || '').trim();
      const isNpc = (page.type === 'npc');
      const chip = (label, val) => `<span class="chip" title="${label}">${label}: ${val || '—'}</span>`;
      host.innerHTML = `
        ${tagline ? `<div class="meta" style="opacity:0.9;">${escapeHtml(tagline)}</div>` : ''}
        ${chip('AC', ac)}
        ${chip('HP', hpMax)}
        ${isNpc ? chip('XP', xp) : ''}
      `;
      return;
    }

    // Edit mode
    host.innerHTML = `
      <input id="hdrTagline" type="text" placeholder="Tagline" style="min-width:220px;" />
      <label class="meta">AC <input id="hdrAc" type="number" inputmode="numeric" style="width:90px" /></label>
      <label class="meta">HP <input id="hdrHpMax" type="number" inputmode="numeric" style="width:110px" /></label>
      ${page.type === 'npc' ? `<label class="meta">XP <input id="hdrXp" type="number" inputmode="numeric" style="width:110px" /></label>` : ''}
    `;
    const tag = host.querySelector('#hdrTagline');
    const ac = host.querySelector('#hdrAc');
    const hp = host.querySelector('#hdrHpMax');
    const xp = host.querySelector('#hdrXp');
    if (tag) tag.value = String(sheet.tagline || '');
    if (ac) ac.value = (sheet.ac ?? '') === null ? '' : String(sheet.ac ?? '');
    if (hp) hp.value = (sheet.hpMax ?? '') === null ? '' : String(sheet.hpMax ?? '');
    if (xp) xp.value = (sheet.xpReward ?? '') === null ? '' : String(sheet.xpReward ?? '');

    const onInput = () => {
      const patch = {
        tagline: tag ? tag.value : undefined,
        ac: ac ? ac.value : undefined,
        hpMax: hp ? hp.value : undefined,
        ...(xp ? { xpReward: xp.value } : {}),
      };
      saveDebounced(patch);
    };
    [tag, ac, hp, xp].filter(Boolean).forEach(el => el.addEventListener('input', onInput));
  }

  const onMode = () => void render();
  const onUpdate = (e) => { if (String(e?.detail?.pageId || '') === String(page.id)) void render(); };
  try { window.addEventListener('vault:modechange', onMode); } catch {}
  try { window.addEventListener('vault:page-sheet-updated', onUpdate); } catch {}
  void render();
  return () => {
    try { window.removeEventListener('vault:modechange', onMode); } catch {}
    try { window.removeEventListener('vault:page-sheet-updated', onUpdate); } catch {}
  };
}

function initEditLifecycle({ outlet, page, blocksRoot, isCharLike, renderSheet, rerenderHeaderMedia, cheatHtml }) {
  const applyEditState = async () => {
    const now = isEditingPage(page.id);
    if (now) {
      try { setUiMode('edit'); } catch {}
      enablePageTitleEdit(page);
      // Re-select the correct block subset before rendering editor
      try {
        const st = getState() || {};
        const activeTab = st.pageTabsV1?.pages?.[page.id] || 'notes';
        if (page.type === 'npc') {
          const NPC_SHEET_ROOT = '__npc_sheet__';
          const all = page.blocks || [];
          const children = new Map();
          for (const b of all) { const pid = (b.parentId == null ? null : String(b.parentId)); const arr = children.get(pid) || []; arr.push(b); children.set(pid, arr); }
          const roots = children.get(NPC_SHEET_ROOT) || [];
          const sheetIds = new Set();
          const stack = roots.slice();
          while (stack.length) { const n = stack.pop(); if (!n || sheetIds.has(n.id)) continue; sheetIds.add(n.id); const kids = children.get(String(n.id)) || []; for (const k of kids) stack.push(k); }
          const npcSheetBlocks = all.filter(b => sheetIds.has(b.id));
          const contentBlocks = all.filter(b => !sheetIds.has(b.id));
          setCurrentPageBlocks(activeTab === 'sheet' ? npcSheetBlocks : contentBlocks);
        }
      } catch {}
      renderBlocksEdit(blocksRoot, page, getCurrentPageBlocks());
      try { mountSaveIndicator(); } catch {}
      try { rerenderHeaderMedia?.(); } catch {}
      try { if (isCharLike && (getState()?.pageTabsV1?.pages?.[page.id] === 'sheet')) { await renderSheet(); } } catch {}
    } else {
      try { setUiMode(null); } catch {}
      disablePageTitleEdit(page);
      try { await flushDebouncedPatches(); } catch (e) { console.error('Failed to flush debounced patches', e); }
      try {
        // Merge current edits into page.blocks for NPC pages so view reflects changes immediately
        const st = getState() || {};
        const activeTab = st.pageTabsV1?.pages?.[page.id] || 'notes';
        if (page.type === 'npc') {
          // Split existing full set
          const NPC_SHEET_ROOT = '__npc_sheet__';
          const all = Array.isArray(page.blocks) ? page.blocks.slice() : [];
          const children = new Map();
          for (const b of all) { const pid = (b.parentId == null ? null : String(b.parentId)); const arr = children.get(pid) || []; arr.push(b); children.set(pid, arr); }
          const roots = children.get(NPC_SHEET_ROOT) || [];
          const sheetIds = new Set();
          const stack = roots.slice();
          while (stack.length) { const n = stack.pop(); if (!n || sheetIds.has(n.id)) continue; sheetIds.add(n.id); const kids = children.get(String(n.id)) || []; for (const k of kids) stack.push(k); }
          const npcSheetBlocks = all.filter(b => sheetIds.has(b.id));
          const contentBlocks = all.filter(b => !sheetIds.has(b.id));
          const edited = Array.isArray(getCurrentPageBlocks()) ? getCurrentPageBlocks() : [];
          // Merge back based on active tab
          page.blocks = (activeTab === 'sheet') ? [...contentBlocks, ...edited] : [...edited, ...npcSheetBlocks];
          // Ensure current store subset matches view mode subset
          const nextSubset = (activeTab === 'sheet') ? edited : edited;
          setCurrentPageBlocks(nextSubset);
        } else {
          // Non-NPC: leave as-is; optionally we could refresh later
        }
      } catch {}
      // Render view from the local, merged store immediately
      renderBlocksReadOnly(blocksRoot, getCurrentPageBlocks());
      try { unmountSaveIndicator(); } catch {}
      try { rerenderHeaderMedia?.(); } catch {}
      try { if (isCharLike && (getState()?.pageTabsV1?.pages?.[page.id] === 'sheet')) { await renderSheet(); } } catch {}
      // Optionally refresh in background to update timestamps without clobbering current view
      try { refreshBlocksFromServer(page.id).then((fresh) => { if (fresh && (fresh.updatedAt || fresh.createdAt)) page.updatedAt = fresh.updatedAt || fresh.createdAt; }).catch(() => {}); } catch {}
    }
  };

  // Initial edit-mode UI scaffolding (only when already editing on first render)
  const initialEditing = isEditingPage(page.id);
  if (initialEditing) {
    try {
      const article = outlet.querySelector('article.page');
      const titleEl = article.querySelector('#pageTitleInput');
      const metaEl = article.querySelector('p.meta');
      const tagsEl = article.querySelector('#pageTags');
      const editorWrap = document.createElement('div');
      editorWrap.className = 'page-editor';
      if (titleEl) titleEl.before(editorWrap);
      if (titleEl) editorWrap.appendChild(titleEl);
      const cheat = document.createElement('div');
      cheat.className = 'page-cheatsheet';
      cheat.innerHTML = cheatHtml;
      editorWrap.appendChild(cheat);
      const bodyEl = article.querySelector('#pageBlocks');
      if (tagsEl) editorWrap.appendChild(tagsEl);
      if (bodyEl) editorWrap.appendChild(bodyEl);
      // Move any existing toolbar for #pageBlocks into the new editor host to avoid stray/duplicate toolbars
      try {
        const strayTb = document.querySelector('#editorToolbar[data-for-root="pageBlocks"]');
        if (strayTb && !editorWrap.contains(strayTb)) {
          editorWrap.insertBefore(strayTb, bodyEl || editorWrap.firstChild);
        }
      } catch {}
      const controls = document.createElement('div');
      controls.className = 'editor-add-controls';
      controls.innerHTML = `
        <button type="button" class="chip" id="btnAddBlock">+ Add block (⌥⏎)</button>
        <button type="button" class="chip" id="btnAddSection">+ Section (⌥⇧⏎)</button>
      `;
      editorWrap.appendChild(controls);
      const getFocusedContext = () => {
        const active = document.activeElement;
        const blockEl = active?.closest?.('.block[data-block-id]');
        if (blockEl) {
          const id = blockEl.getAttribute('data-block-id');
          const all = getCurrentPageBlocks();
          const cur = all.find(x => String(x.id) === String(id));
          if (cur) return { parentId: cur.parentId ?? null, sort: Number(cur.sort || 0) };
        }
        const roots = (getCurrentPageBlocks() || []).filter(x => (x.parentId || null) === null).sort((a,b) => a.sort - b.sort);
        const last = roots[roots.length - 1] || null;
        return { parentId: null, sort: last ? Number(last.sort || 0) : -1 };
      };
      const doCreate = async (type) => {
        try {
          const { apiCreateBlock, refreshBlocksFromServer } = await import('../blocks/edit/apiBridge.js');
          const { renderBlocksEdit } = await import('../blocks/edit/render.js');
          const { focusBlockInput } = await import('../blocks/edit/focus.js');
          const ctx = getFocusedContext();
          const payload = (type === 'section')
            ? { type: 'section', parentId: ctx.parentId, sort: ctx.sort + 1, props: { collapsed: false }, content: { title: '' } }
            : { type: 'paragraph', parentId: ctx.parentId, sort: ctx.sort + 1, props: {}, content: { text: '' } };
          const created = await apiCreateBlock(page.id, payload);
          setCurrentPageBlocks([...getCurrentPageBlocks(), created]);
          await refreshBlocksFromServer(page.id);
          renderBlocksEdit(blocksRoot, page, getCurrentPageBlocks());
          focusBlockInput(created.id);
        } catch (e) { console.error('Failed to create block from add-controls', e); }
      };
      const btnAddBlock = controls.querySelector('#btnAddBlock');
      const btnAddSection = controls.querySelector('#btnAddSection');
      if (btnAddBlock) btnAddBlock.addEventListener('click', () => void doCreate('paragraph'));
      if (btnAddSection) btnAddSection.addEventListener('click', () => void doCreate('section'));
      if (metaEl) { metaEl.classList.add('page-edit-meta-footer'); editorWrap.after(metaEl); }
    } catch {}

    // Install autosize-on-resize handler and store for cleanup
    try {
      const autoAll = () => {
        if (document.body.dataset.mode !== 'edit') return;
        document.querySelectorAll('textarea.block-input').forEach((el) => {
          try { autosizeTextarea(el); } catch {}
        });
      };
      requestAnimationFrame(autoAll);
      const onResize = () => autoAll();
      window.addEventListener('resize', onResize);
      outlet.__editResizeHandler = onResize;
    } catch {}
  }

  try { window.addEventListener('vault:modechange', applyEditState); } catch {}
  void applyEditState();

  const cleanupEditLifecycle = () => {
    try { setUiMode(null); } catch {}
    try { unmountSaveIndicator(); } catch {}
    try { window.removeEventListener('vault:modechange', applyEditState); } catch {}
    try { if (outlet.__onSheetUpdate) { window.removeEventListener('vault:page-sheet-updated', outlet.__onSheetUpdate); delete outlet.__onSheetUpdate; } } catch {}
    try {
      if (outlet.__editResizeHandler) {
        window.removeEventListener('resize', outlet.__editResizeHandler);
        delete outlet.__editResizeHandler;
      }
    } catch {}
  };

  return { applyEditState, cleanupEditLifecycle };
}

function initBacklinks(page) {
  void renderBacklinksPanel(page.id);
}

async function renderPageCore(page, { includeTagsToolbar, cheatHtml }) {
  setPageBreadcrumb(page);
  setPageActionsEnabled({ canEdit: true, canDelete: true });

  const outlet = getPageOutletOrNull();
  if (!outlet) return () => {};

  const sectionLabel = computeSectionLabel(page);
  renderPageShell(outlet, page, { sectionLabel, includeTagsToolbar });

  // Update browser tab title with resolved page title
  try {
    const resolved = (String(page?.title || '').trim()) || (String(page?.slug || '').trim()) || 'Untitled';
    setDocumentTitle(resolved);
  } catch {}

  const rerenderHeaderMedia = initHeaderMedia(outlet, page);
  const { isCharLike, renderSheet } = initCharTabsAndSheet(outlet, page);
  const cleanupSheetHeader = initSheetHeaderFields(page);

  const blocksRoot = document.getElementById('pageBlocks');

  // Detect API-managed Open5e page (read-only) and render derived view
  let isApiManaged = false;
  try {
    const sheet = await getPageSheet(page.id);
    const src = sheet?.open5eSource || null;
    if (src && src.readonly && src.type && src.slug) {
      isApiManaged = true;
      // mark for global edit toggle guard
      try { document.body.dataset.apiManaged = '1'; } catch {}
      // Render derived content for supported types
      const t = normalizeO5eType(src.type);
      if (t === 'creature') {
        const data = await getOpen5eResource(t, src.slug, { ttlMs: 6 * 60 * 60 * 1000 });
        // Persist snapshot for offline/consistency (best-effort)
        try {
          const snap = { lastFetchedAt: Math.floor(Date.now()/1000), json: data || null };
          await patchPageSheet(page.id, { open5eSnapshotV1: snap });
        } catch {}
        // Basic statblock rendering to keep within current structure
        const host = blocksRoot;
        if (host) {
          const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
          const parts = [];
          const name = data.name || page.title || '';
          const size = data.size || '';
          const type = data.type || '';
          const alignment = data.alignment || '';
          const cr = data.cr || data.challenge_rating || '';
          const ac = data.armor_class != null ? data.armor_class : data.ac;
          const hp = data.hit_points != null ? data.hit_points : data.hp;
          const speed = typeof data.speed === 'string' ? data.speed : (data.speed_json || data.speed_jsonb || '');
          parts.push(`<div class="hovercard" style="padding:10px;">`);
          parts.push(`<div style="font-size:20px; font-weight:700; margin-bottom:4px;">${esc(name)}</div>`);
          const meta = [size, type, alignment].filter(Boolean).join(' • ');
          parts.push(`<div class="meta" style="margin-bottom:8px;">${esc(meta)}${cr? (meta? ' • ' : '') + `CR ${esc(cr)}` : ''}</div>`);
          const grid = [];
          if (ac != null) grid.push(`<div><strong>AC</strong> ${esc(ac)}</div>`);
          if (hp != null) grid.push(`<div><strong>HP</strong> ${esc(hp)}</div>`);
          if (speed) grid.push(`<div><strong>Speed</strong> ${esc(speed)}</div>`);
          const abil = ['strength','dexterity','constitution','intelligence','wisdom','charisma']
            .map(k => data[k] != null ? data[k] : null);
          if (abil.some(v => v != null)) {
            const [str,dex,con,int,wis,cha] = abil.map(v => v == null ? '—' : String(v));
            grid.push(`<div><strong>STR DEX CON INT WIS CHA</strong> ${esc(`${str} ${dex} ${con} ${int} ${wis} ${cha}`)}</div>`);
          }
          if (grid.length) parts.push(`<div style="display:grid; gap:4px; margin-bottom:8px;">${grid.join('')}</div>`);
          // Traits/actions (basic)
          const desc = (data.desc || data.description || '').trim();
          if (desc) parts.push(`<div style="white-space:pre-wrap;">${esc(desc)}</div>`);
          parts.push(`</div>`);
          host.innerHTML = parts.join('');
        }
      } else if (t === 'spell') {
        const data = await getOpen5eResource(t, src.slug, { ttlMs: 6 * 60 * 60 * 1000 });
        try { const snap = { lastFetchedAt: Math.floor(Date.now()/1000), json: data || null }; await patchPageSheet(page.id, { open5eSnapshotV1: snap }); } catch {}
        const host = blocksRoot;
        if (host) {
          const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
          const parts = [];
          const name = data.name || page.title || '';
          const level = (data.level_int != null ? data.level_int : data.level) ?? '';
          const school = data.school || '';
          const sub = `${level === 0 ? 'Cantrip' : (level !== '' ? `Level ${level}` : '')}${school ? ` • ${school}` : ''}`.trim();
          parts.push(`<div class="hovercard" style="padding:10px;">`);
          parts.push(`<div style="font-size:20px; font-weight:700; margin-bottom:4px;">${esc(name)}</div>`);
          if (sub) parts.push(`<div class="meta" style="margin-bottom:8px;">${esc(sub)}</div>`);
          const rows = [];
          if (data.casting_time || data.castingTime) rows.push(`<div><strong>Casting</strong> ${esc(data.casting_time || data.castingTime)}</div>`);
          if (data.range) rows.push(`<div><strong>Range</strong> ${esc(data.range)}</div>`);
          if (data.duration) rows.push(`<div><strong>Duration</strong> ${esc(data.duration)}${data.concentration ? ' (Concentration)' : ''}</div>`);
          if (data.components) rows.push(`<div><strong>Components</strong> ${esc(data.components)}</div>`);
          if (rows.length) parts.push(`<div style="display:grid; gap:4px; margin-bottom:8px;">${rows.join('')}</div>`);
          const desc = (data.desc || data.description || '').trim();
          if (desc) parts.push(`<div style="white-space:pre-wrap;">${esc(desc)}</div>`);
          const higher = data.higher_level ? String(data.higher_level).trim() : '';
          if (higher) parts.push(`<div style="white-space:pre-wrap; margin-top:8px;"><strong>At Higher Levels:</strong> ${esc(higher)}</div>`);
          parts.push(`</div>`);
          host.innerHTML = parts.join('');
        }
      } else if (t === 'condition') {
        const data = await getOpen5eResource(t, src.slug, { ttlMs: 6 * 60 * 60 * 1000 });
        try { const snap = { lastFetchedAt: Math.floor(Date.now()/1000), json: data || null }; await patchPageSheet(page.id, { open5eSnapshotV1: snap }); } catch {}
        const host = blocksRoot;
        if (host) {
          const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
          const name = data.name || page.title || '';
          const desc = (data.desc || data.description || '').trim();
          host.innerHTML = `<div class="hovercard" style="padding:10px;"><div style="font-size:20px; font-weight:700; margin-bottom:4px;">${esc(name)}</div>${desc ? `<div style=\"white-space:pre-wrap;\">${esc(desc)}</div>` : ''}</div>`;
        }
      } else if (t === 'item' || t === 'weapon' || t === 'armor') {
        const data = await getOpen5eResource(t, src.slug, { ttlMs: 6 * 60 * 60 * 1000 });
        try { const snap = { lastFetchedAt: Math.floor(Date.now()/1000), json: data || null }; await patchPageSheet(page.id, { open5eSnapshotV1: snap }); } catch {}
        const host = blocksRoot;
        if (host) {
          const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
          const name = data.name || page.title || '';
          const cat = data.type || data.category || '';
          const rarity = data.rarity || '';
          const meta = [cat, rarity].filter(Boolean).join(' • ');
          const desc = (data.desc || data.description || '').trim();
          const parts = [`<div class="hovercard" style="padding:10px;">`, `<div style="font-size:20px; font-weight:700; margin-bottom:4px;">${esc(name)}</div>`];
          if (meta) parts.push(`<div class="meta" style="margin-bottom:8px;">${esc(meta)}</div>`);
          if (desc) parts.push(`<div style="white-space:pre-wrap;">${esc(desc)}</div>`);
          parts.push(`</div>`);
          host.innerHTML = parts.join('');
        }
      }
    } else {
      try { delete document.body.dataset.apiManaged; } catch {}
    }
  } catch {}
  // Initialize current blocks respecting NPC sheet split and active tab (supports ?tab for NPC)
  try {
    const st = getState() || {};
    const saved = st.pageTabsV1?.pages?.[page.id];
    let activeTab = (page.type === 'npc') ? (saved === 'sheet' ? 'sheet' : 'notes') : 'notes';
    try {
      if (page.type === 'npc') {
        const params = new URLSearchParams(window.location.search || '');
        const qp = (params.get('tab') || '').toLowerCase();
        if (qp === 'sheet' || qp === 'notes') activeTab = qp;
      }
    } catch {}
    if (page.type === 'npc') {
      const NPC_SHEET_ROOT = '__npc_sheet__';
      const all = page.blocks || [];
      const children = new Map();
      for (const b of all) { const pid = (b.parentId == null ? null : String(b.parentId)); const arr = children.get(pid) || []; arr.push(b); children.set(pid, arr); }
      const roots = children.get(NPC_SHEET_ROOT) || [];
      const sheetIds = new Set();
      const stack = roots.slice();
      while (stack.length) { const n = stack.pop(); if (!n || sheetIds.has(n.id)) continue; sheetIds.add(n.id); const kids = children.get(String(n.id)) || []; for (const k of kids) stack.push(k); }
      const npcSheetBlocks = all.filter(b => sheetIds.has(b.id));
      const contentBlocks = all.filter(b => !sheetIds.has(b.id));
      setCurrentPageBlocks(activeTab === 'sheet' ? npcSheetBlocks : contentBlocks);
    } else {
      setCurrentPageBlocks(page.blocks || []);
    }
  } catch { setCurrentPageBlocks(page.blocks || []); }
  if (isApiManaged) {
    // Read-only derived view; do not mount editor or save indicators
    try { unmountSaveIndicator(); } catch {}
  } else if (isEditingPage(page.id)) {
    setUiMode('edit');
    enablePageTitleEdit(page);
    renderBlocksEdit(blocksRoot, page, getCurrentPageBlocks());
    try { mountSaveIndicator(); } catch {}
  } else {
    setUiMode(null);
    renderBlocksReadOnly(blocksRoot, getCurrentPageBlocks());
    try { unmountSaveIndicator(); } catch {}
  }

  if (includeTagsToolbar) { void renderPageTags(page.id); }

  const btnDelete = document.getElementById('btnDeletePage');
  if (btnDelete) { btnDelete.onclick = () => openDeleteModal(page); }

  const { cleanupEditLifecycle } = initEditLifecycle({
    outlet,
    page,
    blocksRoot,
    isCharLike,
    renderSheet,
    rerenderHeaderMedia,
    cheatHtml,
  });

  initBacklinks(page);

  return () => {
    cleanupEditLifecycle();
  };
}

function getFolderTitleForPage(pageId) {
  const st = getState();
  const { sections } = normalizeSections(st || {});
  for (const sec of (sections || [])) {
    const title = String(sec.title || '').trim();
    const t = title.toLowerCase();
    if (!title) continue;
    if (t === 'enemies') continue;
    if (t === 'favorites') continue;
    const ids = Array.isArray(sec.pageIds) ? sec.pageIds : [];
    if (ids.includes(pageId)) return title;
  }
  return null;
}

function setPageBreadcrumb(page) {
  try {
    const folderTitle = getFolderTitleForPage(page.id);
    if (folderTitle) { setBreadcrumb(`${folderTitle} • ${page.title}`); return; }
    const sectionLabel = sectionForType(page.type);
    const secKey = sectionKeyForType(page.type);
    let groupName = null;
    try {
      const { groups, pageToGroup } = getNavGroupsForSection(secKey);
      const gid = pageToGroup?.[page.id] || null;
      if (gid) groupName = (groups || []).find(g => String(g.id) === String(gid))?.name || null;
    } catch {}
    const parts = [sectionLabel, groupName, page.title].filter(Boolean);
    setBreadcrumb(parts.join(' • '));
  } catch {
    setBreadcrumb(page?.title || '');
  }
}

export async function renderPage({ match }) {
  const id = match[1];
  const page = await fetchJson(`/api/pages/${encodeURIComponent(id)}`);

  // Register active page context for centralized edit handling
  try { setActivePage({ id: page.id, slug: page.slug || null, canEdit: true, kind: 'page' }); } catch {}

  // If this page has a slug, immediately replace URL and render the slug route
  if (page && page.slug) {
    try { history.replaceState({}, '', canonicalPageHref(page)); } catch {}
    // Delegate rendering to slug-based renderer and short-circuit this handler
    return await renderPageBySlug({ match: [null, page.slug] });
  }

  const cleanup = await renderPageCore(page, {
    includeTagsToolbar: true,
    cheatHtml: `
        <div class="meta">Cheat Sheet — #Tags (e.g. #tavern #npc), [[Wikilinks]] (e.g. [[Bent Willow Tavern]]), Ctrl+Enter saves & exits, ⌥⏎ adds block, ⌥⇧⏎ adds section</div>
      `,
  });
  return cleanup;
}

export async function renderPageBySlug({ match }) {
  const slug = match[1];
  const page = await fetchJson(`/api/pages/slug/${encodeURIComponent(slug)}`);

  // Expose current page id for global Edit toggle
  try { setActivePage({ id: page.id, slug: page.slug || null, canEdit: true, kind: 'page' }); } catch {}

  const cleanup = await renderPageCore(page, {
    includeTagsToolbar: false,
    cheatHtml: `<div class="meta">Cheat Sheet — #Tags, [[Wikilinks]], Ctrl+Enter saves & exits, ⌥⏎ adds block, ⌥⇧⏎ adds section</div>`,
  });
  return () => { try { cleanup?.(); } catch {}; };
}

export function enablePageTitleEdit(page) {
  const h1 = document.getElementById('pageTitleView');
  if (!h1) return;
  const input = document.createElement('input');
  input.id = 'pageTitleInput';
  input.className = 'page-title-input';
  input.value = page.title || '';
  h1.replaceWith(input);
  bindPageTitleInput(page, input);

   // Live-update tab title as the user types
   try {
     const fallback = (String(page?.slug || '').trim()) || 'Untitled';
     const onLive = () => {
       const v = String(input.value || '').trim();
       setDocumentTitle(v || fallback);
     };
     input.__vaultLiveTitleHandler = onLive;
     input.addEventListener('input', onLive);
   } catch {}

  // Insert Type control (edit mode only), placed near title
  try {
    const wrap = document.createElement('div');
    wrap.id = 'pageTypeControl';
    wrap.style.margin = '6px 0';
    // Make row layout for Type + Category controls
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '12px';
    wrap.style.flexWrap = 'wrap';
    // Keep label and select simple; do not modify existing hooks/classes
    const label = document.createElement('label');
    label.textContent = 'Section ';
    const sel = document.createElement('select');
    sel.name = 'pageType';
    sel.id = 'pageTypeSelect';
    // Build unified dropdown with Core sections and user Folders
    const buildTypeFolderOptions = () => {
      sel.innerHTML = '';
      // Determine current folder selection
      const st = getState();
      const secs = Array.isArray(st?.sections) ? st.sections : [];
      const curFolder = secs.find(s => (s.pageIds || []).includes(page.id)) || null;
      // Core sections
      const core = [
        { v: 'character', t: 'Characters' },
        { v: 'npc',       t: 'NPCs' },
        { v: 'location',  t: 'World' },
        { v: 'arc',       t: 'Arcs' },
        { v: 'note',      t: 'Campaign' },
        { v: 'tool',      t: 'Tools' },
      ];
      const ogCore = document.createElement('optgroup');
      ogCore.label = 'Core sections';
      const rawType = page.type || 'note';
      const selectedType = (rawType === 'pc') ? 'character' : rawType;
      for (const opt of core) {
        const o = document.createElement('option');
        o.value = opt.v; o.textContent = opt.t;
        if (!curFolder && selectedType === opt.v) o.selected = true;
        ogCore.appendChild(o);
      }
      sel.appendChild(ogCore);
      // Custom sections
      const ogFolders = document.createElement('optgroup');
      ogFolders.label = 'Custom sections';
      const folderList = secs.map(s => ({ id: String(s.id), title: s.title || '', pageIds: Array.isArray(s.pageIds) ? s.pageIds : [] }))
        .sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' }));
      for (const s of folderList) {
        const o = document.createElement('option');
        o.value = `folder:${s.id}`;
        o.textContent = s.title || '';
        if (curFolder && String(curFolder.id) === String(s.id)) o.selected = true;
        ogFolders.appendChild(o);
      }
      sel.appendChild(ogFolders);
    };
    buildTypeFolderOptions();
    label.appendChild(sel);
    wrap.appendChild(label);

    // Category UI
    const secKey = sectionKeyForType(page.type || 'note');
    const { groups, pageToGroup } = getNavGroupsForSection(secKey);
    const currentGid = pageToGroup?.[page.id] || '';
    const gLabel = document.createElement('label');
    gLabel.textContent = 'Category ';
    const gSel = document.createElement('select');
    gSel.id = 'pageGroupSelect';
    gSel.name = 'pageGroup';
    const buildGroupOptions = (gs, selectedId) => {
      gSel.innerHTML = '';
      const o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = 'Ungrouped';
      gSel.appendChild(o0);
      for (const g of (gs || [])) {
        const o = document.createElement('option');
        o.value = String(g.id);
        o.textContent = g.name;
        if (String(g.id) === String(selectedId || '')) o.selected = true;
        gSel.appendChild(o);
      }
    };
    buildGroupOptions(groups, currentGid);
    gLabel.appendChild(gSel);
    wrap.appendChild(gLabel);
    // Optional New… button
    const btnNew = document.createElement('button');
    btnNew.type = 'button';
    btnNew.className = 'chip';
    btnNew.textContent = 'New…';
    wrap.appendChild(btnNew);
    input.after(wrap);

    // Persist Category change immediately
    gSel.addEventListener('change', async () => {
      const key = sectionKeyForType(page.type || 'note');
      const gid = gSel.value || null;
      try {
        await setGroupForPage(key, page.id, gid);
        try { setPageBreadcrumb(page); } catch {}
        try { await import('../features/nav.js').then(m => m.refreshNav()); } catch {}
      } catch (e) {
        console.error('Failed to update category', e);
      }
    });

    // Create new category inline
    btnNew.onclick = async () => {
      const key = sectionKeyForType(page.type || 'note');
      const name = prompt('New category name');
      if (!name) return;
      try {
        const newId = await addGroup(key, name);
        if (!newId) return;
        const { groups: gs } = getNavGroupsForSection(key);
        buildGroupOptions(gs, String(newId));
        await setGroupForPage(key, page.id, newId);
        try { setPageBreadcrumb(page); } catch {}
        try { await import('../features/nav.js').then(m => m.refreshNav()); } catch {}
      } catch (e) {
        console.error('Failed to create category', e);
      }
    };

    sel.addEventListener('change', async () => {
      const val = sel.value;
      // Handle folder selection vs core section type
      if (val && val.startsWith('folder:')) {
        const folderId = val.slice('folder:'.length);
        try {
          // Remove from all folders first, then add to chosen folder
          let st = getState();
          const secs = Array.isArray(st?.sections) ? st.sections.slice() : [];
          for (const s of secs) {
            st = removePageFromSection(st, s.id, page.id);
          }
          if (folderId) {
            st = addPageToSection(st, folderId, page.id);
          }
          updateState(st);
          await saveStateNow();
          try { await import('../features/nav.js').then(m => m.refreshNav()); } catch {}
          // Rebuild options to reflect new selection state
          buildTypeFolderOptions();
          // Update breadcrumb and meta to reflect folder as primary section
          try { setPageBreadcrumb(page); } catch {}
          try {
            const meta = document.querySelector('article.page p.meta');
            if (meta) {
              const updatedAt = String(page.updatedAt || page.createdAt || '');
              const folderTitleNow = getFolderTitleForPage(page.id);
              const sectionLabelNow = folderTitleNow || sectionForType(page.type);
              meta.innerHTML = `Section: ${escapeHtml(sectionLabelNow || page.type)} · Updated: ${escapeHtml(updatedAt)}`;
            }
          } catch {}
        } catch (e) {
          console.error('Failed to move page to folder', e);
        }
        return;
      }

      // Core section selected: remove from folders, then PATCH page.type
      const oldKey = sectionKeyForType(page.type || 'note');
      const newType = val;
      try {
        // Remove page from any folders first
        let st = getState();
        const secs = Array.isArray(st?.sections) ? st.sections.slice() : [];
        for (const s of secs) {
          st = removePageFromSection(st, s.id, page.id);
        }
        updateState(st);
        await saveStateNow();
        try { await import('../features/nav.js').then(m => m.refreshNav()); } catch {}

        const updated = await fetchJson(`/api/pages/${encodeURIComponent(page.id)}`, { method: 'PATCH', body: JSON.stringify({ type: newType }) });
        // Reflect updated type in local page and meta display
        page.type = updated.type || newType;
        const meta = document.querySelector('article.page p.meta');
        if (meta) {
          const updatedAt = (updated.updatedAt || updated.createdAt || '').toString();
          const folderTitleNow = getFolderTitleForPage(page.id);
          const sectionLabel = folderTitleNow || sectionForType(page.type);
          meta.innerHTML = `Section: ${escapeHtml(sectionLabel || page.type)} · Updated: ${escapeHtml(updatedAt)}`;
        }
        // If section changed, clear old mapping and rebuild Category options
        const newKey = sectionKeyForType(page.type || 'note');
        if (oldKey !== newKey) {
          try { await setGroupForPage(oldKey, page.id, null); } catch {}
          const { groups: gs, pageToGroup: ptg } = getNavGroupsForSection(newKey);
          const cur = ptg?.[page.id] || '';
          buildGroupOptions(gs, cur);
        }
        try { setPageBreadcrumb(page); } catch {}
        try { await import('../features/nav.js').then(m => m.refreshNav()); } catch {}
        // Rebuild options to ensure correct core selection now that page.type changed
        buildTypeFolderOptions();
      } catch (e) {
        console.error('Failed to update type', e);
      }
    });
  } catch {}
}

export function disablePageTitleEdit(page) {
  const input = document.getElementById('pageTitleInput');
  if (!input) return;
  // Cleanup live title handler to avoid accumulating listeners
  try { if (input.__vaultLiveTitleHandler) input.removeEventListener('input', input.__vaultLiveTitleHandler); } catch {}
  const h1 = document.createElement('h1');
  h1.id = 'pageTitleView';
  h1.textContent = input.value || page.title || '';
  input.replaceWith(h1);
  // Remove Type control when exiting edit mode
  try {
    const typeCtl = document.getElementById('pageTypeControl');
    if (typeCtl) typeCtl.remove();
  } catch {}
}

function bindPageTitleInput(page, input) {
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    const newTitle = input.value;
    t = setTimeout(async () => {
      try {
        const updated = await fetchJson(`/api/pages/${encodeURIComponent(page.id)}`, { method: 'PATCH', body: JSON.stringify({ title: newTitle }) });
        page.title = updated.title || newTitle;
        setPageBreadcrumb(page);
        await import('../features/nav.js').then(m => m.refreshNav());
      } catch (e) {
        console.error('Failed to update title', e);
      }
    }, 400);
  });
}

async function renderPageTags(pageId) {
  const container = document.getElementById('pageTags');
  if (!container) return;
  let current = [];
  try {
    const { tags } = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}/tags`);
    current = Array.isArray(tags) ? tags.slice() : [];
  } catch {}

  container.innerHTML = `
    <div id="pageTagList" style="display:inline-flex; gap: 6px; flex-wrap: wrap;"></div>
    <input id="pageTagInput" placeholder="Add tag" style="margin-left:8px; padding:4px 6px; width: 160px;" />
  `;

  const listEl = document.getElementById('pageTagList');
  const inputEl = document.getElementById('pageTagInput');

  function renderChips() {
    listEl.innerHTML = current.map((t, idx) => `
      <span class="chip" data-idx="${idx}">${t} <button title="Remove" data-remove="${idx}" class="chip" style="margin-left:4px;">×</button></span>
    `).join('');
    listEl.querySelectorAll('button[data-remove]').forEach(btn => {
      btn.onclick = async () => {
        const i = Number(btn.getAttribute('data-remove'));
        current.splice(i, 1);
        await save();
        renderChips();
      };
    });
  }

  async function save() {
    try {
      const resp = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ tags: current })
      });
      current = Array.isArray(resp.tags) ? resp.tags.slice() : [];
    } catch (e) {
      console.error('Failed to save tags', e);
    }
  }

  inputEl.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const v = inputEl.value.trim();
      if (v) {
        current.push(v);
        inputEl.value = '';
        await save();
        renderChips();
      }
      e.preventDefault();
      return;
    }
    if (e.key === 'Backspace' && !inputEl.value && current.length) {
      current.pop();
      await save();
      renderChips();
      e.preventDefault();
    }
  });

  renderChips();
}

// Save and exit editing: flush debounced block patches, persist title if editing,
// then exit edit mode using the same path as clicking the Done button.
export async function saveAndExitEditing() {
  const btnEdit = document.getElementById('btnEditPage');
  if (!btnEdit) return;
  const isEditing = (btnEdit.textContent || '').trim().toLowerCase() === 'done';
  if (!isEditing) return;

  // Persist current title immediately if title input is active
  const input = document.getElementById('pageTitleInput');
  if (input) {
    const newTitle = input.value;
    // Try to infer page id from current URL (/page/:id or /p/:slug -> PATCH only when id route)
    // We patch title optimistically via existing endpoint if possible; otherwise let debounce finalize later.
    try {
      const m = window.location.pathname.match(/^\/page\/([^/]+)$/);
      if (m) {
        await fetchJson(`/api/pages/${encodeURIComponent(m[1])}`, { method: 'PATCH', body: JSON.stringify({ title: newTitle }) });
      }
    } catch (e) { console.error('Failed immediate title save', e); }
  }

  // Flush debounced block patches if available
  try { await import('../blocks/edit/state.js').then(m => m.flushDebouncedPatches && m.flushDebouncedPatches()); } catch {}

  // Exit edit mode by reusing the existing button handler
  try { btnEdit.click(); } catch {}
}
