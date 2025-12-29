import { fetchJson } from '../../lib/http.js';
import { getState, updateState, saveStateNow } from '../../lib/state.js';
import { navigate } from '../../lib/router.js';

const APP_ID = 'partyDrawer';

let mountRoot = null;
let cleanupFns = [];
const pageCache = new Map(); // id -> { page, sheet, ts }

function getPartyState() {
  const st = getState() || {};
  const block = st.partyDrawerV1 || {};
  return {
    open: !!block.open,
    pinnedPageIds: Array.isArray(block.pinnedPageIds) ? block.pinnedPageIds : [],
  };
}

function setPartyState(next) {
  const cur = getPartyState();
  updateState({ partyDrawerV1: { ...cur, ...next } });
}

export function togglePartyDrawer(forceOpen = null) {
  const cur = getPartyState();
  const open = (forceOpen === null) ? !cur.open : !!forceOpen;
  setPartyState({ open });
  render();
}

export function setPartyPinned(pageId, pinned) {
  const cur = getPartyState();
  const id = String(pageId);
  const set = new Set(cur.pinnedPageIds.map(String));
  if (pinned) set.add(id); else set.delete(id);
  const pinnedPageIds = Array.from(set);
  setPartyState({ pinnedPageIds });
  render();
}

async function ensureCached(id) {
  const key = String(id);
  let entry = pageCache.get(key);
  if (!entry || !entry.page) {
    try {
      const page = await fetchJson(`/api/pages/${encodeURIComponent(key)}`);
      entry = { page, sheet: null, ts: 0 };
      pageCache.set(key, entry);
    } catch { /* ignore */ }
  }
  return entry || null;
}

async function loadSheet(id) {
  try {
    const resp = await fetchJson(`/api/pages/${encodeURIComponent(id)}/sheet`);
    return resp?.sheet || {};
  } catch {
    return {};
  }
}

function shortText(s, n = 120) {
  const str = String(s || '');
  if (str.length <= n) return str;
  return str.slice(0, n - 1) + '…';
}

function isEditableTarget(el) {
  if (!el) return false;
  const t = el.tagName?.toLowerCase?.() || '';
  if (t === 'input' || t === 'textarea') return true;
  if (el.isContentEditable) return true;
  return false;
}

function bindHotkey() {
  const onKey = (e) => {
    if (!e.altKey || e.metaKey || e.ctrlKey) return;
    const code = String(e.code || '');
    const key = String(e.key || '').toLowerCase();
    if (!(code === 'KeyH' || key === 'h')) return;
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
    togglePartyDrawer();
  };
  document.addEventListener('keydown', onKey);
  cleanupFns.push(() => document.removeEventListener('keydown', onKey));
}

async function renderCards(host, pinned) {
  if (!host) return;
  host.innerHTML = '<div class="meta">Loading…</div>';
  const cards = [];
  // Fetch basics immediately (cache), fetch sheets (fresh when open)
  for (const id of pinned) { // keep order
    const entry = await ensureCached(id);
    let page = entry?.page || { id, title: 'Unknown', type: '' };
    let sheet = await loadSheet(id);
    if (entry) { entry.sheet = sheet; entry.ts = Date.now(); }
    const href = page.slug ? `/p/${encodeURIComponent(page.slug)}` : `/page/${encodeURIComponent(page.id)}`;
    const badge = (page.type || '').toUpperCase();
    const stats = [
      ['AC', sheet.ac],
      ['PP', sheet.passivePerception],
      ['PI', sheet.passiveInsight],
      ['PV', sheet.passiveInvestigation],
    ].map(([k, v]) => `${k}: ${v ?? '—'}`).join(' \u00A0|\u00A0 ');
    const notes = shortText(sheet.notes || '', 240);
    const avatarUrl = (page?.media?.profile?.url) ? String(page.media.profile.url) : '';
    cards.push(`
      <div class="partyCard" data-pid="${String(page.id)}">
        <div class="partyCardTop">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;">
            ${avatarUrl ? `<img class="partyAvatar" src="${avatarUrl}" alt="" />` : ''}
            <div class="partyCardName" data-href="${href}">${page.title ? String(page.title) : 'Untitled'}</div>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            ${badge ? `<span class="chip" title="${badge}">${badge}</span>` : ''}
            <button class="chip partyUnpinBtn" title="Remove">×</button>
          </div>
        </div>
        <div class="partyStats">${stats}</div>
        ${notes ? `<div class="partyNotesPreview">${notes.replace(/</g, '&lt;')}</div>` : ''}
      </div>
    `);
  }
  if (!pinned.length) {
    host.innerHTML = '<div class="meta">Pin characters from Characters to see them here.</div>';
  } else {
    host.innerHTML = cards.join('');
  }
}

function render() {
  if (!mountRoot) return;
  const st = getPartyState();
  // Height control via CSS variable with drag handle
  const rootEl = document.createElement('div');
  rootEl.className = `partyDrawerWrap ${st.open ? 'is-open' : ''}`;
  rootEl.id = 'partyDrawer';
  rootEl.innerHTML = `
      <button class="partyDrawerTab chip" id="partyDrawerTabBtn" type="button">${st.open ? 'Close' : 'Party'}</button>
      <div class="partyDrawerPanel">
        <div class="partyResizeHandle" role="separator" aria-orientation="horizontal" tabindex="0"></div>
        <div class="partyDrawerHeader">
          <div style="display:flex;gap:10px;align-items:center;">
            <strong>Party</strong>
            <span class="meta">${String(st.pinnedPageIds.length)}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="chip" id="partyClearBtn" ${st.pinnedPageIds.length ? '' : 'disabled'}>Clear</button>
          </div>
        </div>
        <div class="partyCards" id="partyCards"></div>
      </div>
    `;
  mountRoot.innerHTML = '';
  mountRoot.appendChild(rootEl);
  
  const tabBtn = mountRoot.querySelector('#partyDrawerTabBtn');
  tabBtn?.addEventListener('click', () => togglePartyDrawer());
  const clearBtn = mountRoot.querySelector('#partyClearBtn');
  clearBtn?.addEventListener('click', async () => {
    setPartyState({ pinnedPageIds: [] });
    await saveStateNow().catch(() => {});
    render();
  });
  const cardsHost = mountRoot.querySelector('#partyCards');
  if (st.open) {
    void renderCards(cardsHost, st.pinnedPageIds);
  } else {
    // When closed, avoid extra work; render minimal placeholder
    if (cardsHost) cardsHost.innerHTML = '';
  }
  // Delegated handlers for card interactions
  mountRoot.querySelector('#partyDrawer')?.addEventListener('click', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    const unpinBtn = el.closest('.partyUnpinBtn');
    if (unpinBtn) {
      e.preventDefault();
      const card = el.closest('.partyCard');
      const pid = card?.getAttribute('data-pid');
      if (pid) setPartyPinned(pid, false);
      return;
    }
    const nameEl = el.closest('.partyCardName');
    if (nameEl) {
      e.preventDefault();
      const href = nameEl.getAttribute('data-href');
      if (href) navigate(href);
      return;
    }
  });

  // Resize handler (drag up/down to change height)
  const handle = mountRoot.querySelector('.partyResizeHandle');
  const wrap = mountRoot.querySelector('#partyDrawer');
  if (handle && wrap) {
    const startDrag = (clientY) => {
      const vh = window.innerHeight || document.documentElement.clientHeight || 800;
      const onMove = (y) => {
        const fromBottom = Math.max(0, vh - y);
        const min = Math.round(vh * 0.25);
        const max = Math.round(vh * 0.85);
        const clamped = Math.max(min, Math.min(max, fromBottom));
        const pct = (clamped / vh) * 100;
        try { wrap.style.setProperty('--party-drawer-h', String(pct) + 'vh'); } catch {}
      };
      const onMouseMove = (ev) => { ev.preventDefault(); onMove(ev.clientY); };
      const onTouchMove = (ev) => { if (ev.touches && ev.touches[0]) onMove(ev.touches[0].clientY); };
      const stop = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', stop);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', stop);
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', stop);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', stop);
      cleanupFns.push(stop);
    };
    handle.addEventListener('mousedown', (e) => { e.preventDefault(); startDrag(e.clientY); });
    handle.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.touches && e.touches[0]; if (t) startDrag(t.clientY); }, { passive: false });
  }
}

export const PartyDrawerApp = {
  id: APP_ID,
  title: 'Party Drawer',
  surfaces: ['global'],
  mount(rootEl /*, ctx */) {
    mountRoot = rootEl || document;
    bindHotkey();
    render();
    return () => {
      cleanupFns.forEach(fn => { try { fn(); } catch {} });
      cleanupFns = [];
      mountRoot = null;
    };
  },
  unmount() {},
};
