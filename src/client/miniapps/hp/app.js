import { getAppState, setAppState } from '../../miniapps/state.js';
import { buildWikiTextNodes } from '../../features/wikiLinks.js';
import { fetchJson } from '../../lib/http.js';
import { renderBlocksReadOnly } from '../../blocks/readOnly.js';
import { parseMaybeJson } from '../../blocks/tree.js';
// Ensure sheet store listeners (BroadcastChannel/storage) are active in this tab
import { getPageSheet } from '../../lib/pageSheetStore.js';
import { getOpen5eResource, normalizeO5eType } from '../../features/open5eCore.js';

const APP_ID = 'hp';

function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

function sum(arr) { return arr.reduce((n, x) => n + (Number(x?.dmg) || 0), 0); }

function formatInt(n) { const v = Math.max(0, Math.floor(Number(n) || 0)); return v; }

export const HpTrackerApp = {
  id: APP_ID,
  title: 'HP Tracker',
  surfaces: ['rightPanel'],
  mount(rootEl, ctx) {
    const mountEl = (ctx?.mountEl) || (rootEl || document).querySelector('#rightNotepadMount');
    if (!mountEl) return () => {};

    // Ensure mount can scroll when used in split/overlay areas
    try { mountEl.style.overflow = 'auto'; mountEl.style.minHeight = '0'; } catch {}

    let state = (() => {
      const raw = getAppState(APP_ID, { enemies: [], xpDivide: 0, npcs: [] });
      if (raw && typeof raw === 'object') {
        const enemies = Array.isArray(raw.enemies) ? raw.enemies.slice() : [];
        const xpDivide = Number.isFinite(raw.xpDivide) ? raw.xpDivide : 0;
        const npcs = Array.isArray(raw.npcs) ? raw.npcs.slice() : [];
        return { enemies, xpDivide, npcs };
      }
      return { enemies: [], xpDivide: 0, npcs: [] };
    })();
    const persist = debounce(() => setAppState(APP_ID, state), 250);

    // Root container
    const root = document.createElement('div');
    root.className = 'hpTracker';

    // Top bar
    const bar = document.createElement('div');
    bar.className = 'hpTrackerBar';
    const title = document.createElement('div');
    title.textContent = 'HP Tracker';
    const addBtn = document.createElement('button');
    addBtn.className = 'chip';
    addBtn.type = 'button';
    addBtn.textContent = '+ Enemy';
    const addNpcBtn = document.createElement('button');
    addNpcBtn.className = 'chip';
    addNpcBtn.type = 'button';
    addNpcBtn.textContent = '+ NPC';
    bar.appendChild(title);
    const btns = document.createElement('div');
    btns.style.display = 'flex';
    btns.style.gap = '8px';
    btns.appendChild(addBtn);
    btns.appendChild(addNpcBtn);
    bar.appendChild(btns);
    root.appendChild(bar);

    const npcList = document.createElement('div');
    npcList.className = 'hpEnemyList';
    root.appendChild(npcList);
    const list = document.createElement('div');
    list.className = 'hpEnemyList';
    root.appendChild(list);
    const totalsHost = document.createElement('div');
    totalsHost.className = 'hpTotalsHost';
    root.appendChild(totalsHost);

    // ---------- NPC helpers
    const NPC_SHEET_ROOT = '__npc_sheet__';

    function getNpcSheetBlocks(all) {
      const allBlocks = Array.isArray(all) ? all : [];
      if (!allBlocks.length) return [];
      const children = new Map();
      for (const b of allBlocks) {
        const pid = (b.parentId == null ? null : String(b.parentId));
        const arr = children.get(pid) || [];
        arr.push(b);
        children.set(pid, arr);
      }
      const roots = children.get(NPC_SHEET_ROOT) || [];
      if (!roots.length) return [];
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
      return npcSheetBlocks;
    }

    function extractStatFromBlocks(blocks, label) {
      const want = String(label || '').toLowerCase();
      const synonyms = want === 'hp' ? ['hp', 'hit points'] : (want === 'ac' ? ['ac', 'armor class'] : [want]);

      // 1) Paragraph text like "HP: 27" or "AC 15"
      for (const b of (blocks || [])) {
        if (String(b.type) !== 'paragraph') continue;
        const content = parseMaybeJson(b.contentJson) || {};
        const props = parseMaybeJson(b.propsJson) || {};
        const textRaw = (typeof props.html === 'string' && props.html.trim())
          ? (() => { const d = document.createElement('div'); d.innerHTML = String(props.html); return d.textContent || ''; })()
          : String(content.text || '');
        const s = String(textRaw || '').toLowerCase();
        if (!s) continue;
        for (const lab of synonyms) {
          const re = new RegExp(`\\b${lab.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*:?[\\s]*(-?\\d+)`);
          const m = s.match(re);
          if (m && m[1] != null) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n)) return n;
          }
        }
      }

      // 2) Table with a header cell 'HP' / 'Hit Points' / 'AC'
      for (const b of (blocks || [])) {
        if (String(b.type) !== 'table') continue;
        const props = parseMaybeJson(b.propsJson) || {};
        const table = (props && typeof props.table === 'object') ? props.table : { columns: [], rows: [], hasHeader: false };
        const cols = Array.isArray(table.columns) ? table.columns : [];
        const rows = Array.isArray(table.rows) ? table.rows : [];
        // Option A: header by column name
        let colIdx = -1;
        for (let i = 0; i < cols.length; i++) {
          const nm = String(cols[i]?.name || '').trim().toLowerCase();
          if (synonyms.includes(nm)) { colIdx = i; break; }
        }
        if (colIdx >= 0) {
          for (const r of rows) {
            const cell = (r?.cells && r.cells[colIdx]) ? String(r.cells[colIdx]) : '';
            const n = parseInt(cell, 10);
            if (Number.isFinite(n)) return n;
          }
        }
        // Option B: two-column table with label in first col
        if (cols.length >= 2) {
          for (const r of rows) {
            const a = String(r?.cells?.[0] || '').trim().toLowerCase();
            const bval = String(r?.cells?.[1] || '').trim();
            if (!a) continue;
            if (synonyms.includes(a)) {
              const n = parseInt(bval, 10);
              if (Number.isFinite(n)) return n;
            }
          }
        }
      }
      return null;
    }

    async function pickNpcPage() {
      // Lightweight modal similar to command palette, filtered to NPCs
      const wrapId = 'npcPickWrap';
      if (document.getElementById(wrapId)) document.getElementById(wrapId).remove();
      const wrap = document.createElement('div');
      wrap.id = wrapId;
      wrap.style.display = '';
      wrap.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1500;" data-role="overlay"></div>
        <div style="position:fixed;z-index:1501;top:12%;left:50%;transform:translateX(-50%);width:680px;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:10px;box-shadow:0 16px 36px rgba(0,0,0,0.45);">
          <div style="padding:8px 10px;border-bottom:1px solid #374151"><input id="npcPickInput" placeholder="Search NPCs…" style="width:100%;background:#0f172a;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:8px 10px;outline:none"/></div>
          <div id="npcPickList" style="max-height:360px;overflow:auto;padding:8px 6px"></div>
        </div>`;
      document.body.appendChild(wrap);
      const overlay = wrap.querySelector('[data-role="overlay"]');
      const input = wrap.querySelector('#npcPickInput');
      const list = wrap.querySelector('#npcPickList');
      let items = [];
      let active = -1;
      let timer;
      function render() {
        list.innerHTML = items.map((it, idx) => `<div class="search-item${idx===active?' active':''}" data-id="${it.id}" style="padding:8px 10px;border-radius:6px;cursor:pointer;">${it.title}</div>`).join('');
        list.querySelectorAll('.search-item').forEach((el, idx) => {
          el.addEventListener('mouseenter', () => { active = idx; render(); });
          el.addEventListener('mousedown', (e) => e.preventDefault());
          el.addEventListener('click', async () => { const id = el.getAttribute('data-id'); if (id) { cleanup(); const page = await fetchJson(`/api/pages/${encodeURIComponent(id)}`); await addNpcFromPage(page); } });
        });
      }
      async function search(q) {
        const res = await fetchJson(`/api/search?q=${encodeURIComponent(q)}`);
        const raw = res?.results || [];
        // Pre-filter: likely candidates (npc or anything; refine by sheet)
        const base = raw.slice(0, 30);
        const enriched = [];
        for (const it of base) {
          if (it?.type === 'npc') { enriched.push(it); continue; }
          try {
            const sheet = await getPageSheet(it.id);
            const src = sheet?.open5eSource || null;
            if (src && normalizeO5eType(src.type) === 'monster') { enriched.push(it); }
          } catch {}
        }
        items = enriched;
        active = items.length ? 0 : -1;
        render();
      }
      function cleanup() { try { document.body.removeChild(wrap); } catch {} }
      overlay.addEventListener('click', cleanup);
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
        if (e.key === 'Enter') { e.preventDefault(); const it = items[active]; if (it) { cleanup(); const page = await fetchJson(`/api/pages/${encodeURIComponent(it.id)}`); await addNpcFromPage(page); } }
        if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { active=(active+1)%items.length; render(); } }
        if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { active=(active-1+items.length)%items.length; render(); } }
      });
      input.addEventListener('input', () => { clearTimeout(timer); const q=input.value.trim(); if (!q){items=[];active=-1;render();return;} timer=setTimeout(()=>void search(q), 150); });
      setTimeout(() => input.focus(), 0);
    }

    function ensureNpcDefaults(n) {
      return {
        id: n.id || crypto.randomUUID(),
        kind: 'npc',
        pageId: String(n.pageId || ''),
        pageSlug: typeof n.pageSlug === 'string' ? n.pageSlug : '',
        title: String(n.title || ''),
        ac: Number.isFinite(n.ac) ? n.ac : 0,
        hpMax: Number.isFinite(n.hpMax) ? n.hpMax : 0,
        hp: Number.isFinite(n.hp) ? n.hp : (Number.isFinite(n.hpMax) ? n.hpMax : 0),
        xpReward: Number.isFinite(n.xpReward) ? n.xpReward : 0,
        avatarUrl: String(n.avatarUrl || ''),
        // Damage log for pulled NPCs (same shape as enemies)
        log: Array.isArray(n.log) ? n.log.map(l => ({ id: l.id || crypto.randomUUID(), who: l.who || '', dmg: Number(l.dmg) || 0, ts: l.ts || Date.now() })) : [],
      };
    }

    async function addNpcFromPage(page) {
      if (!page || !page.id) return;
      const avatarUrl = (page?.media?.profile?.url) ? String(page.media.profile.url) : '';
      let ac = 0, hpMax = 0;
      let hasAc = false, hasHpMax = false;
      try {
        const sheet = await getPageSheet(page.id);
        const src = sheet?.open5eSource || null;
        if (src && normalizeO5eType(src.type) === 'monster' && src.slug) {
          try {
            const data = await getOpen5eResource('monster', src.slug, { ttlMs: 6 * 60 * 60 * 1000 });
            if (data) {
              const acVal = (data.armor_class != null ? data.armor_class : data.ac);
              const hpVal = (data.hit_points != null ? data.hit_points : data.hp);
              if (acVal != null) { ac = Number(acVal) || 0; hasAc = true; }
              if (hpVal != null) { hpMax = Number(hpVal) || 0; hasHpMax = true; }
              if (Number.isFinite(Number(data.xp))) {
                // stash xp reward in a temp field on page for later use when building entry
                page.__o5eXp = Math.max(0, Math.floor(Number(data.xp) || 0));
              }
            }
          } catch {}
        }
        if (sheet && (sheet.ac ?? null) !== null) { ac = Number(sheet.ac) || 0; hasAc = true; }
        if (sheet && (sheet.hpMax ?? null) !== null) { hpMax = Number(sheet.hpMax) || 0; hasHpMax = true; }
      } catch {}
      if (!hasAc || !hasHpMax) {
        const allBlocks = Array.isArray(page.blocks) ? page.blocks : [];
        const sheetBlocks = getNpcSheetBlocks(allBlocks);
        if (!hasAc) ac = extractStatFromBlocks(sheetBlocks, 'ac') ?? 0;
        if (!hasHpMax) hpMax = extractStatFromBlocks(sheetBlocks, 'hp') ?? 0;
      }
      const hp = hpMax;
      const entry = ensureNpcDefaults({ pageId: page.id, pageSlug: String(page.slug || ''), title: page.title || 'Untitled', ac, hpMax, hp, avatarUrl, xpReward: Number.isFinite(Number(page.__o5eXp)) ? Number(page.__o5eXp) : undefined });
      state.npcs = (state.npcs || []).slice();
      state.npcs.push(entry);
      persist();
      renderList();
    }

    function removeNpc(id) {
      state.npcs = (state.npcs || []).filter(x => x.id !== id);
      persist();
      renderList();
    }

    function setNpcHp(id, next) {
      const n = state.npcs.find(x => x.id === id);
      if (!n) return;
      n.hp = Math.max(0, Math.floor(Number(next) || 0));
      persist();
    }

    // NPC log helpers
    function addNpcLogEntry(npcId, who, dmg) {
      const npc = (state.npcs || []).find(x => x.id === npcId);
      if (!npc) return;
      const amt = Math.max(0, Math.floor(Number(dmg) || 0));
      if (!amt) return;
      npc.log = Array.isArray(npc.log) ? npc.log.slice() : [];
      npc.log.push({ id: crypto.randomUUID(), who: String(who || '').trim(), dmg: amt, ts: Date.now() });
      persist();
      renderList();
    }
    function removeNpcLogEntry(npcId, entryId) {
      const npc = (state.npcs || []).find(x => x.id === npcId);
      if (!npc) return;
      npc.log = (Array.isArray(npc.log) ? npc.log : []).filter(l => l.id !== entryId);
      persist();
      renderList();
    }

    function renderNpcCard(n) {
      n = ensureNpcDefaults(n);
      const card = document.createElement('div');
      card.className = 'hpEnemy hpNpcCard';
      card.dataset.id = n.id;
      card.dataset.pageId = String(n.pageId || '');
      // Ensure a reliable attribute for selectors
      try { card.setAttribute('data-page-id', String(n.pageId || '')); } catch {}
      if (n.pageSlug) card.dataset.pageSlug = String(n.pageSlug);

      const header = document.createElement('div');
      header.className = 'hpEnemyHeader';
      const identity = document.createElement('div');
      identity.style.display = 'flex';
      identity.style.alignItems = 'center';
      identity.style.gap = '8px';
      if (n.avatarUrl) {
        const img = document.createElement('img');
        img.src = n.avatarUrl;
        img.alt = '';
        img.style.width = '36px';
        img.style.height = '36px';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '999px';
        identity.appendChild(img);
      }
      const name = document.createElement('div');
      name.textContent = n.title || 'Untitled';
      identity.appendChild(name);
      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '8px';
      const acWrap = document.createElement('div');
      acWrap.className = 'partyAcCircle hpCardAc';
      acWrap.title = 'Armor Class';
      acWrap.innerHTML = `<div class="partyAcLabel">AC</div><div class="partyAcVal">${String(Number.isFinite(n.ac) ? n.ac : 0)}</div>`;
      const xpMeta = document.createElement('span');
      xpMeta.className = 'meta hpNpcXp';
      xpMeta.title = 'XP Reward';
      // Prefer state-driven XP value when available
      try { xpMeta.textContent = n.xpReward ? `XP ${Math.max(0, Math.floor(Number(n.xpReward) || 0))}` : ''; } catch { xpMeta.textContent = ''; }
      const removeBtn = document.createElement('button');
      removeBtn.className = 'chip';
      removeBtn.type = 'button';
      removeBtn.title = 'Remove';
      removeBtn.textContent = '×';
      right.appendChild(acWrap);
      right.appendChild(xpMeta);
      // Scope AC badge text sizing to HP tracker only
      try {
        const _lab = acWrap.querySelector('.partyAcLabel');
        if (_lab) _lab.classList.add('hpCardAcLabel');
        const _val = acWrap.querySelector('.partyAcVal');
        if (_val) _val.classList.add('hpCardAcValue');
      } catch {}
      right.appendChild(removeBtn);
      header.appendChild(identity);
      header.appendChild(right);
      card.appendChild(header);

      // Damage/Target/Remaining + progress + log UI (for pulled NPCs)
      // Target is current HP (n.hp)
      const npcTotal = sum(n.log || []);
      const npcTarget = Math.max(0, Math.floor(Number(n.hp) || 0));
      const npcDown = npcTarget > 0 && npcTotal >= npcTarget;

      const npcStats = document.createElement('div');
      npcStats.className = 'hpEnemyStats';
      const npcDmgText = document.createElement('span');
      const npcRemainText = document.createElement('span');
      const npcRemaining = Math.max(0, npcTarget - npcTotal);
      const npcOverkill = Math.max(0, npcTotal - npcTarget);
      npcDmgText.textContent = `Damage ${npcTotal} / Target ${npcTarget}`;
      npcRemainText.textContent = npcTarget > 0 ? (npcRemaining > 0 ? `Remaining ${npcRemaining}` : `Overkill +${npcOverkill}`) : 'Remaining —';
      npcStats.appendChild(npcDmgText);
      npcStats.appendChild(npcRemainText);
      card.appendChild(npcStats);

      const npcProg = document.createElement('progress');
      npcProg.max = Math.max(1, npcTarget);
      npcProg.value = Math.min(npcTotal, npcProg.max);
      npcProg.style.width = '100%';
      card.appendChild(npcProg);

      const npcForm = document.createElement('form');
      npcForm.className = 'hpForm';
      const npcWhoInput = document.createElement('input');
      npcWhoInput.type = 'text';
      npcWhoInput.placeholder = 'who';
      const npcDmgInput = document.createElement('input');
      npcDmgInput.type = 'number';
      npcDmgInput.step = '1';
      npcDmgInput.min = '0';
      npcDmgInput.inputMode = 'numeric';
      npcDmgInput.placeholder = 'damage';
      const npcAdd = document.createElement('button');
      npcAdd.className = 'chip';
      npcAdd.type = 'submit';
      npcAdd.textContent = 'Add';
      npcForm.appendChild(npcWhoInput);
      npcForm.appendChild(npcDmgInput);
      npcForm.appendChild(npcAdd);
      card.appendChild(npcForm);
      // Commit NPC damage entries on submit (persist + rerender like enemies)
      npcForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        addNpcLogEntry(n.id, npcWhoInput.value, npcDmgInput.value);
        try { npcDmgInput.value = ''; npcDmgInput.focus(); } catch {}
      });

      const npcLogEl = document.createElement('div');
      npcLogEl.className = 'hpLog';
      for (const entry of (n.log || [])) {
        const row = document.createElement('div');
        row.className = 'hpLogRow';
        row.dataset.id = entry.id;
        const left = document.createElement('div');
        const who = String(entry.who || '').trim();
        left.textContent = who ? `${who} – ${entry.dmg}` : String(entry.dmg);
        const right = document.createElement('div');
        const del = document.createElement('button');
        del.className = 'chip';
        del.title = 'Remove';
        del.type = 'button';
        del.textContent = '×';
        right.appendChild(del);
        row.appendChild(left);
        row.appendChild(right);
        npcLogEl.appendChild(row);
        del.addEventListener('click', () => removeNpcLogEntry(n.id, entry.id));
      }
      card.appendChild(npcLogEl);

      // HP row (editable current HP with reset)
      const hpRow = document.createElement('div');
      hpRow.className = 'hpEnemyStats';
      const left = document.createElement('span');
      left.textContent = `HP`;
      const rightHp = document.createElement('div');
      rightHp.style.display = 'flex';
      rightHp.style.alignItems = 'center';
      rightHp.style.gap = '8px';
      const hpInp = document.createElement('input');
      hpInp.type = 'number';
      hpInp.min = '0';
      hpInp.step = '1';
      hpInp.inputMode = 'numeric';
      hpInp.style.width = '80px';
      hpInp.value = String(Math.max(0, Math.floor(Number(n.hp) || 0)));
      const maxText = document.createElement('span');
      maxText.className = 'meta';
      maxText.classList.add('hpNpcMaxText');
      maxText.textContent = `/ ${Math.max(0, Math.floor(Number(n.hpMax) || 0))}`;
      const resetBtn = document.createElement('button');
      resetBtn.className = 'chip';
      resetBtn.type = 'button';
      resetBtn.textContent = 'Reset';
      rightHp.appendChild(hpInp);
      rightHp.appendChild(maxText);
      rightHp.appendChild(resetBtn);
      const statsWrap = document.createElement('div');
      statsWrap.style.display = 'flex';
      statsWrap.style.alignItems = 'center';
      statsWrap.style.justifyContent = 'space-between';
      statsWrap.style.gap = '8px';
      statsWrap.appendChild(left);
      statsWrap.appendChild(rightHp);
      card.appendChild(statsWrap);

      // Body: render NPC sheet blocks read-only
      const body = document.createElement('div');
      body.className = 'hpNpcBody';
      body.innerHTML = '<div class="meta">Loading NPC sheet…</div>';
      card.appendChild(body);

      // Wire up actions
      removeBtn.addEventListener('click', () => removeNpc(n.id));
      hpInp.addEventListener('input', () => {
        const v = Math.max(0, Math.floor(Number(hpInp.value) || 0));
        setNpcHp(n.id, v);
        // Update NPC log summary/progress to reflect new target (current HP)
        const t = Math.max(0, v);
        const total = sum(n.log || []);
        const rem = Math.max(0, t - total);
        const over = Math.max(0, total - t);
        try {
          npcDmgText.textContent = `Damage ${total} / Target ${t}`;
          npcRemainText.textContent = t > 0 ? (rem > 0 ? `Remaining ${rem}` : `Overkill +${over}`) : 'Remaining —';
          npcProg.max = Math.max(1, t);
          npcProg.value = Math.min(total, npcProg.max);
        } catch {}
      });
      resetBtn.addEventListener('click', () => { setNpcHp(n.id, n.hpMax); hpInp.value = String(Math.max(0, Math.floor(Number(n.hpMax) || 0))); });

      // Click-to-open (safe area only)
      const isInteractive = (el) => {
        if (!el || el === card) return false;
        const tag = (el.tagName || '').toLowerCase();
        if (['input','textarea','select','button','a','label','summary','details'].includes(tag)) return true;
        if (el.hasAttribute && (el.hasAttribute('contenteditable') || el.getAttribute?.('role') === 'button')) return true;
        // Avoid clicks inside the embedded sheet area
        if (el.closest && (el.closest('.hpNpcBody') || el.closest('.noCardNav'))) return true;
        return false;
      };
      card.addEventListener('click', (e) => {
        // Only handle primary button clicks without modifier keys
        if (e.button !== 0 || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        // Ignore when clicking on interactive controls
        let cur = e.target;
        while (cur && cur !== card) {
          if (isInteractive(cur)) return;
          cur = cur.parentElement;
        }
        const slug = String(n.pageSlug || '').trim();
        const href = slug ? `/p/${encodeURIComponent(slug)}?tab=sheet` : `/page/${encodeURIComponent(String(n.pageId || ''))}?tab=sheet`;
        try { window.open(href, '_blank', 'noopener'); } catch {}
      });

      // Lazy-load current page to refresh AC/HPMax/XP and render sheet
      (async () => {
        try {
          const page = await fetchJson(`/api/pages/${encodeURIComponent(n.pageId)}`);
          // Persist slug if available and missing
          if (!n.pageSlug && page?.slug) { n.pageSlug = String(page.slug); persist(); try { card.dataset.pageSlug = n.pageSlug; } catch {} }
          const avatarUrl = (page?.media?.profile?.url) ? String(page.media.profile.url) : '';
          if (avatarUrl && !n.avatarUrl) {
            try {
              const img = identity.querySelector('img');
              if (!img) {
                const image = document.createElement('img');
                image.src = avatarUrl; image.alt=''; image.style.width='36px'; image.style.height='36px'; image.style.objectFit='cover'; image.style.borderRadius='999px';
                identity.insertBefore(image, name);
              }
            } catch {}
          }
          // Canonical sheet data
          let sheetData = {};
          try { sheetData = await getPageSheet(n.pageId); } catch { sheetData = {}; }
          const acValEl = acWrap.querySelector('.partyAcVal');
          if (acValEl) acValEl.textContent = String((sheetData.ac ?? '') === null ? '—' : (sheetData.ac ?? '—'));
          // Update state with AC when available
          if ((sheetData.ac ?? '') !== null) { const nextAc = Number(sheetData.ac) || 0; if (nextAc !== n.ac) { n.ac = nextAc; persist(); } }
          const hpMaxVal = (sheetData.hpMax ?? '') === null ? null : Number(sheetData.hpMax);
          if (Number.isFinite(hpMaxVal) && hpMaxVal !== n.hpMax) {
            n.hpMax = Math.max(0, Math.floor(Number(hpMaxVal) || 0));
            maxText.textContent = `/ ${n.hpMax}`;
            persist();
          }
          const xpVal = (sheetData.xpReward ?? '') === null ? '' : String(sheetData.xpReward ?? '');
          // Persist xpReward to state and reflect in UI
          const nextXp = Math.max(0, Math.floor(Number(xpVal) || 0));
          if (Number.isFinite(nextXp) && nextXp !== n.xpReward) { n.xpReward = nextXp; persist(); }
          try { xpMeta.textContent = nextXp ? `XP ${nextXp}` : ''; } catch {}
          // Render NPC sheet blocks read-only as before
          const blocks = Array.isArray(page.blocks) ? page.blocks : [];
          const npcSheetBlocks = getNpcSheetBlocks(blocks);
          body.innerHTML = '';
          renderBlocksReadOnly(body, npcSheetBlocks);
        } catch {
          body.innerHTML = '<div class="meta">Failed to load NPC sheet.</div>';
        }
      })();

      return card;
    }

    function ensureEnemyDefaults(e) {
      return {
        id: e.id || crypto.randomUUID(),
        label: typeof e.label === 'string' ? e.label : '',
        target: Number.isFinite(e.target) ? e.target : 0,
        xp: Number.isFinite(e.xp) ? e.xp : 0,
        log: Array.isArray(e.log) ? e.log.map(l => ({ id: l.id || crypto.randomUUID(), who: l.who || '', dmg: Number(l.dmg) || 0, ts: l.ts || Date.now() })) : [],
      };
    }

    function addEnemy() {
      state.enemies = (state.enemies || []).slice();
      state.enemies.push({ id: crypto.randomUUID(), label: '', target: 0, log: [] });
      persist();
      renderList();
    }

    function removeEnemy(id) {
      state.enemies = (state.enemies || []).filter(e => e.id !== id);
      persist();
      renderList();
    }

    function addLogEntry(enemyId, who, dmg) {
      const e = state.enemies.find(x => x.id === enemyId);
      if (!e) return;
      const amt = Math.max(0, Math.floor(Number(dmg) || 0));
      if (!amt) return;
      e.log = (e.log || []).slice();
      e.log.push({ id: crypto.randomUUID(), who: String(who || '').trim(), dmg: amt, ts: Date.now() });
      persist();
      renderList();
    }

    function removeLogEntry(enemyId, entryId) {
      const e = state.enemies.find(x => x.id === enemyId);
      if (!e) return;
      e.log = (e.log || []).filter(l => l.id !== entryId);
      persist();
      renderList();
    }

    function updateEnemyLabel(enemyId, next) {
      const e = state.enemies.find(x => x.id === enemyId);
      if (!e) return;
      e.label = String(next || '');
      persist();
    }

    function updateEnemyTarget(enemyId, next) {
      const e = state.enemies.find(x => x.id === enemyId);
      if (!e) return;
      e.target = Math.max(0, Math.floor(Number(next) || 0));
      persist();
    }

    function updateEnemyXp(enemyId, next) {
      const e = state.enemies.find(x => x.id === enemyId);
      if (!e) return;
      e.xp = Math.max(0, Math.floor(Number(next) || 0));
      persist();
    }

    function renderEnemyCard(e) {
      e = ensureEnemyDefaults(e);
      const total = sum(e.log || []);
      const target = Math.max(0, Math.floor(Number(e.target) || 0));
      const down = target > 0 && total >= target;

      const card = document.createElement('div');
      card.className = 'hpEnemy' + (down ? ' hpEnemy--down' : '');
      card.dataset.id = e.id;

      // Header with remove and DOWN badge
      const header = document.createElement('div');
      header.className = 'hpEnemyHeader';
      const labelWrap = document.createElement('div');
      const removeBtn = document.createElement('button');
      removeBtn.className = 'chip';
      removeBtn.type = 'button';
      removeBtn.title = 'Remove enemy';
      removeBtn.textContent = '×';
      header.appendChild(labelWrap);
      const badge = document.createElement('span');
      badge.className = 'hpBadge';
      badge.textContent = 'DOWN';
      if (down) header.appendChild(badge);
      header.appendChild(removeBtn);
      card.appendChild(header);

      // Label + Target inputs
      const inputs = document.createElement('div');
      inputs.className = 'hpEnemyInputs';
      const label = document.createElement('input');
      label.type = 'text';
      label.placeholder = 'Enemy name or [[wikilink]]';
      label.value = e.label || '';
      const targetInput = document.createElement('input');
      targetInput.type = 'number';
      targetInput.min = '0';
      targetInput.step = '1';
      targetInput.inputMode = 'numeric';
      targetInput.value = String(target);
      inputs.appendChild(label);
      inputs.appendChild(targetInput);
      card.appendChild(inputs);

      // XP row (small input below total HP)
      const xpRow = document.createElement('div');
      xpRow.className = 'hpEnemyXP';
      const xpLabel = document.createElement('label');
      xpLabel.textContent = 'XP';
      xpLabel.className = 'meta';
      xpLabel.setAttribute('for', `xp-${e.id}`);
      const xpInput = document.createElement('input');
      xpInput.id = `xp-${e.id}`;
      xpInput.type = 'number';
      xpInput.min = '0';
      xpInput.step = '1';
      xpInput.inputMode = 'numeric';
      xpInput.placeholder = 'XP';
      xpInput.value = String(Math.max(0, Math.floor(Number(e.xp) || 0)));
      xpRow.appendChild(xpLabel);
      xpRow.appendChild(xpInput);
      card.appendChild(xpRow);

      // Preview line for label (wikilink-aware)
      const preview = document.createElement('div');
      preview.className = 'hpEnemyPreview';
      try {
        const frag = buildWikiTextNodes(e.label || '');
        preview.innerHTML = '';
        preview.appendChild(frag);
      } catch { preview.textContent = e.label || ''; }
      card.appendChild(preview);

      // Stats line
      const stats = document.createElement('div');
      stats.className = 'hpEnemyStats';
      const dmgText = document.createElement('span');
      const remainText = document.createElement('span');
      const remaining = Math.max(0, target - total);
      const overkill = Math.max(0, total - target);
      dmgText.textContent = `Damage ${total} / Target ${target}`;
      remainText.textContent = target > 0 ? (remaining > 0 ? `Remaining ${remaining}` : `Overkill +${overkill}`) : 'Remaining —';
      stats.appendChild(dmgText);
      stats.appendChild(remainText);
      card.appendChild(stats);

      // Progress element
      const prog = document.createElement('progress');
      prog.max = Math.max(1, target);
      prog.value = Math.min(total, prog.max);
      prog.style.width = '100%';
      card.appendChild(prog);

      // Damage entry form
      const form = document.createElement('form');
      form.className = 'hpForm';
      const whoInput = document.createElement('input');
      whoInput.type = 'text';
      whoInput.placeholder = 'who';
      const dmgInput = document.createElement('input');
      dmgInput.type = 'number';
      dmgInput.step = '1';
      dmgInput.min = '0';
      dmgInput.inputMode = 'numeric';
      dmgInput.placeholder = 'damage';
      const add = document.createElement('button');
      add.className = 'chip';
      add.type = 'submit';
      add.textContent = 'Add';
      form.appendChild(whoInput);
      form.appendChild(dmgInput);
      form.appendChild(add);
      card.appendChild(form);

      // Log list
      const logEl = document.createElement('div');
      logEl.className = 'hpLog';
      for (const entry of (e.log || [])) {
        const row = document.createElement('div');
        row.className = 'hpLogRow';
        row.dataset.id = entry.id;
        const left = document.createElement('div');
        const who = String(entry.who || '').trim();
        left.textContent = who ? `${who} – ${entry.dmg}` : String(entry.dmg);
        const right = document.createElement('div');
        const del = document.createElement('button');
        del.className = 'chip';
        del.title = 'Remove';
        del.type = 'button';
        del.textContent = '×';
        right.appendChild(del);
        row.appendChild(left);
        row.appendChild(right);
        logEl.appendChild(row);
        del.addEventListener('click', () => removeLogEntry(e.id, entry.id));
      }
      card.appendChild(logEl);

      // Wiring: inputs update state and local UI widgets in-place
      removeBtn.addEventListener('click', () => removeEnemy(e.id));
      label.addEventListener('input', () => {
        updateEnemyLabel(e.id, label.value);
        try { preview.innerHTML = ''; preview.appendChild(buildWikiTextNodes(label.value || '')); } catch {}
      });
      targetInput.addEventListener('input', () => {
        const v = formatInt(targetInput.value);
        updateEnemyTarget(e.id, v);
        const newTotal = sum(e.log || []);
        const rem = Math.max(0, v - newTotal);
        const over = Math.max(0, newTotal - v);
        dmgText.textContent = `Damage ${newTotal} / Target ${v}`;
        remainText.textContent = v > 0 ? (rem > 0 ? `Remaining ${rem}` : `Overkill +${over}`) : 'Remaining —';
        prog.max = Math.max(1, v);
        prog.value = Math.min(newTotal, prog.max);
        if (v > 0 && newTotal >= v) {
          if (!card.classList.contains('hpEnemy--down')) card.classList.add('hpEnemy--down');
          if (!badge.isConnected) header.insertBefore(badge, removeBtn);
        } else {
          card.classList.remove('hpEnemy--down');
          if (badge.isConnected) header.removeChild(badge);
        }
      });
      xpInput.addEventListener('input', () => {
        const v = formatInt(xpInput.value);
        updateEnemyXp(e.id, v);
      });
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        addLogEntry(e.id, whoInput.value, dmgInput.value);
        dmgInput.value = '';
        try { dmgInput.focus(); } catch {}
      });

      return card;
    }

    // Helper: all combatants (enemies + pulled NPCs)
    const allCombatants = () => [
      ...(state.enemies || []),
      ...(state.npcs || []),
    ];

    function computeTotalsByWho() {
      const map = new Map(); // key: lowercased who, value: { who,label,total }
      // Aggregate logs across enemies and pulled NPCs
      for (const c of allCombatants()) {
        const logArr = Array.isArray(c?.log) ? c.log : [];
        for (const entry of logArr) {
          const raw = String(entry?.who || '').trim();
          if (!raw) continue;
          const key = raw.toLowerCase();
          const cur = map.get(key) || { who: raw, total: 0 };
          cur.total += Math.max(0, Math.floor(Number(entry?.dmg) || 0));
          if (!map.has(key)) map.set(key, cur);
        }
      }
      return Array.from(map.values()).sort((a, b) => b.total - a.total || a.who.localeCompare(b.who));
    }

    function computeTotalXp() {
      let n = 0;
      // Enemies XP
      for (const e of (state.enemies || [])) n += Math.max(0, Math.floor(Number(e?.xp) || 0));
      // Pulled NPCs XP reward
      for (const npc of (state.npcs || [])) n += Math.max(0, Math.floor(Number(npc?.xpReward) || 0));
      return n;
    }

    function renderTotalsCard() {
      const card = document.createElement('div');
      card.className = 'hpEnemy';
      const header = document.createElement('div');
      header.className = 'hpEnemyHeader';
      const title = document.createElement('div');
      title.textContent = 'Totals by Attacker';
      header.appendChild(title);
      card.appendChild(header);

      const rows = document.createElement('div');
      rows.className = 'hpLog';
      const totals = computeTotalsByWho();
      if (!totals.length) {
        const p = document.createElement('p');
        p.className = 'meta';
        p.textContent = 'No damage entries yet.';
        card.appendChild(p);
      } else {
        for (const t of totals) {
          const row = document.createElement('div');
          row.className = 'hpLogRow';
          const left = document.createElement('div');
          left.textContent = `${t.who}`;
          const right = document.createElement('div');
          right.textContent = `${t.total}`;
          row.appendChild(left);
          row.appendChild(right);
          rows.appendChild(row);
        }
        card.appendChild(rows);
      }
      return card;
    }

    function renderXpSummaryCard() {
      const card = document.createElement('div');
      card.className = 'hpEnemy';
      const header = document.createElement('div');
      header.className = 'hpEnemyHeader';
      const title = document.createElement('div');
      title.textContent = 'Total XP';
      header.appendChild(title);
      card.appendChild(header);

      const total = computeTotalXp();
      const stats = document.createElement('div');
      stats.className = 'hpEnemyStats';
      const left = document.createElement('span');
      left.textContent = `Total ${total} XP`;
      const right = document.createElement('span');
      right.textContent = '';
      stats.appendChild(left);
      stats.appendChild(right);
      card.appendChild(stats);

      const row = document.createElement('div');
      row.className = 'hpEnemyXP';
      const lab = document.createElement('label');
      lab.textContent = 'Divide by';
      lab.className = 'meta';
      lab.setAttribute('for', `xpDivide`);
      const inp = document.createElement('input');
      inp.id = 'xpDivide';
      inp.type = 'number';
      inp.min = '0';
      inp.step = '1';
      inp.inputMode = 'numeric';
      inp.placeholder = 'Party size';
      inp.value = String(Math.max(0, Math.floor(Number(state.xpDivide) || 0)));
      row.appendChild(lab);
      row.appendChild(inp);
      card.appendChild(row);

      const per = document.createElement('div');
      per.className = 'hpEnemyStats';
      const perLabel = document.createElement('span');
      perLabel.textContent = 'Each';
      const perVal = document.createElement('span');
      const divBy = Math.max(0, Math.floor(Number(state.xpDivide) || 0));
      perVal.textContent = divBy > 0 ? `${Math.floor(total / divBy)} XP` : '—';
      per.appendChild(perLabel);
      per.appendChild(perVal);
      card.appendChild(per);

      inp.addEventListener('input', () => {
        const v = formatInt(inp.value);
        state.xpDivide = v;
        persist();
        try { perVal.textContent = v > 0 ? `${Math.floor(computeTotalXp() / v)} XP` : '—'; } catch {}
      });

      return card;
    }

    function renderList() {
      // NPCs first
      npcList.innerHTML = '';
      const npcs = Array.isArray(state.npcs) ? state.npcs : [];
      for (const n of npcs) npcList.appendChild(renderNpcCard(n));
      // Enemies below
      list.innerHTML = '';
      const arr = Array.isArray(state.enemies) ? state.enemies : [];
      for (const e of arr) list.appendChild(renderEnemyCard(e));
      // Summary card with totals by attacker across enemies + pulled NPCs (render outside the enemy list)
      totalsHost.innerHTML = '';
      totalsHost.appendChild(renderXpSummaryCard());
      totalsHost.appendChild(renderTotalsCard());
    }

    addBtn.addEventListener('click', addEnemy);
    addNpcBtn.addEventListener('click', () => void pickNpcPage());
    renderList();
    mountEl.innerHTML = '';
    mountEl.appendChild(root);

    // Live sync updates from sheet edits elsewhere
    const onSheetUpdated = (ev) => {
      try {
        const pageId = String(ev?.detail?.pageId || '');
        const sheet = (ev?.detail?.sheet && typeof ev.detail.sheet === 'object') ? ev.detail.sheet : {};
        if (!pageId) return;
        // Temporary debug log (remove after confirm)
        try { console.debug('[hp] sheet-updated', pageId, sheet); } catch {}
        let changed = false;
        const npcs = Array.isArray(state.npcs) ? state.npcs : [];
        for (const n of npcs) {
          if (String(n.pageId || '') !== pageId) continue;
          // Update AC
          const nextAc = Number(sheet.ac) || 0;
          if (nextAc !== (Number.isFinite(n.ac) ? n.ac : 0)) { n.ac = nextAc; changed = true; }
          // Update HP Max; if current HP equals previous max, move current HP to the new max
          const prevHpMax = Number.isFinite(n.hpMax) ? n.hpMax : 0;
          const nextHpMax = Math.max(0, Math.floor(Number(sheet.hpMax) || 0));
          if (nextHpMax !== prevHpMax) {
            n.hpMax = nextHpMax;
            const curHp = Math.max(0, Math.floor(Number(n.hp) || 0));
            if (curHp === prevHpMax) {
              n.hp = nextHpMax;
            }
            changed = true;
          }
          // Update XP Reward if present (NPC only)
          const nextXp = Math.max(0, Math.floor(Number(sheet.xpReward) || 0));
          if (nextXp !== (Number.isFinite(n.xpReward) ? n.xpReward : 0)) { n.xpReward = nextXp; changed = true; }
          // Patch visible DOM for this NPC card without full remount
          try {
            const sel = `[data-page-id="${CSS.escape(String(pageId))}"]`;
            const cards = root.querySelectorAll(sel);
            cards.forEach((card) => {
              // AC badge value
              try { const acValEl = card.querySelector('.hpCardAc .partyAcVal'); if (acValEl) acValEl.textContent = String(n.ac); } catch {}
              // Max text
              try { const maxText = card.querySelector('.hpNpcMaxText'); if (maxText) maxText.textContent = `/ ${n.hpMax}`; } catch {}
              // XP meta
              try { const xpMeta = card.querySelector('.hpNpcXp'); if (xpMeta) xpMeta.textContent = n.xpReward ? `XP ${n.xpReward}` : ''; } catch {}
              // If hp changed due to rule above, update input and trigger input handler to refresh stats/progress
              try {
                const hpInp = card.querySelector('input[type="number"]');
                const desired = String(Math.max(0, Math.floor(Number(n.hp) || 0)));
                if (hpInp && hpInp.value !== desired) {
                  hpInp.value = desired;
                  hpInp.dispatchEvent(new Event('input', { bubbles: true }));
                }
              } catch {}
            });
          } catch {}
        }
        if (changed) { persist(); }
      } catch {}
    };
    try { window.addEventListener('vault:page-sheet-updated', onSheetUpdated); } catch {}

    // Persist initial shape to namespace
    setAppState(APP_ID, state);

    return () => {
      try { addBtn.removeEventListener('click', addEnemy); } catch {}
      try { addNpcBtn.removeEventListener('click', () => void pickNpcPage()); } catch {}
      try { window.removeEventListener('vault:page-sheet-updated', onSheetUpdated); } catch {}
      try { mountEl.innerHTML = ''; } catch {}
    };
  },
  unmount() {},
};
