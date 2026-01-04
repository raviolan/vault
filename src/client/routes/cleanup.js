/**
 * Cleanup Route (/cleanup)
 *
 * Purpose: Safe, audit-first tool to scan vault content for issues:
 * - Unresolved [[Title]] links
 * - Broken/malformed tokens
 * - Orphan pages (not in any user section tree AND no inbound links)
 * - Duplicate title candidates
 * - Open5e duplicates
 *
 * Safety and scope:
 * - Read-only by default; computes reports from canonical sources (pages API, blocks content, page sheet JSON).
 * - Provides only two minimal actions:
 *   1) Navigate to page
 *   2) Convert ONE [[Title]] occurrence to plain text (exact token -> label only), persisted via block PATCH.
 * - No bulk destructive ops; no refactors; no touching comments; no impact on editor hierarchy/reorder.
 * - Results cached to localStorage for fast subsequent loads; explicit “Run scan” to recompute.
 */

import { escapeHtml, $ } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';
import { canonicalPageHref } from '../lib/pageUrl.js';
import { getPageSheet } from '../lib/pageSheetStore.js';
import { normalizeO5eType } from '../features/open5eCore.js';

const LS_SCAN_KEY = 'vault:cleanupScanV1';
const LS_LOG_KEY = 'vault:cleanupLogV1';

function nowIso() { return new Date().toISOString(); }

// Always open cleanup links in a new tab/window
function openHrefNewTab(href) { try { window.open(href, '_blank', 'noopener'); } catch {} }

function loadScanCache() {
  try { const raw = localStorage.getItem(LS_SCAN_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function saveScanCache(payload) {
  try { localStorage.setItem(LS_SCAN_KEY, JSON.stringify(payload || {})); } catch {}
}
function appendCleanupLog(entry) {
  try {
    const arr = (() => { try { return JSON.parse(localStorage.getItem(LS_LOG_KEY) || '[]'); } catch { return []; } })();
    arr.push(entry);
    localStorage.setItem(LS_LOG_KEY, JSON.stringify(arr));
  } catch {}
}

// --------- Core scan helpers (read-only)

// Extract plain text candidates from a text string for unresolved [[Title]] and broken token variants.
// Returns detailed occurrences for unresolved, broken, and inbound page-id links.
function scanTextForTokens(text, { pageId, blockId, blockType, field }) {
  const s = String(text || '');
  const unresolved = []; // { title, pageId, blockId, blockType, snippet, fullSnippet, token, field, matchIndex, contextBefore, contextAfter }
  const broken = []; // { kind, pageId, blockId, blockType, snippet, fullSnippet, token }
  const inboundIds = []; // pageId uuids referenced by id links in this string

  if (!s) return { unresolved, broken, inboundIds };

  // A) Find [[...]] tokens; distinguish id-based vs legacy [[Title]]
  const re = /\[\[([^\]]*?)\]\]/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const inner = m[1] || '';
    const full = m[0] || '';
    // Detect nested [[ inside label
    if (/\[\[/.test(inner)) {
      broken.push({ kind: 'nested', pageId, blockId, blockType: blockType || null, snippet: makeSnippet(s, m.index, full.length), fullSnippet: makeLineSnippet(s, m.index, full.length), token: full });
      continue;
    }
    // [[page:<uuid>|...]] valid
    const mId = inner.match(/^\s*page:([0-9a-fA-F-]{36})\|[\s\S]*$/);
    if (mId) {
      inboundIds.push(mId[1]);
      continue;
    }
    // Looks like a page: token but invalid UUID
    const looksId = inner.toLowerCase().startsWith('page:');
    if (looksId) {
      broken.push({ kind: 'invalidUUID', pageId, blockId, blockType: blockType || null, snippet: makeSnippet(s, m.index, full.length), fullSnippet: makeLineSnippet(s, m.index, full.length), token: full });
      continue;
    }
    // Legacy unresolved [[Title]]
    const title = inner.trim();
    if (title) {
      const ctxBefore = s.slice(Math.max(0, m.index - 20), m.index);
      const ctxAfter = s.slice(m.index + full.length, m.index + full.length + 20);
      unresolved.push({
        title,
        pageId,
        blockId,
        blockType: blockType || null,
        snippet: makeSnippet(s, m.index, full.length),
        fullSnippet: makeLineSnippet(s, m.index, full.length),
        token: full,
        field: field || null,
        matchIndex: m.index,
        contextBefore: ctxBefore,
        contextAfter: ctxAfter,
      });
    }
  }
  // B) Missing closing token: any '[[' with no following ']]'
  const idx = s.indexOf('[[');
  if (idx >= 0) {
    // If there exists a '[[' not followed by a matching ']]' after it, flag once
    let j = idx;
    let foundBroken = false;
    while (j >= 0 && j < s.length) {
      const nextClose = s.indexOf(']]', j + 2);
      if (nextClose < 0) { foundBroken = true; break; }
      const nextOpen = s.indexOf('[[', j + 2);
      if (nextOpen >= 0 && nextOpen < nextClose) { j = nextOpen; continue; }
      // We found a well-formed pair; search past it
      j = s.indexOf('[[', nextClose + 2);
      if (j < 0) break;
    }
    if (foundBroken) {
      const sn = makeSnippet(s, idx, Math.min(40, s.length - idx));
      broken.push({ kind: 'unclosed', pageId, blockId, blockType: blockType || null, snippet: sn, fullSnippet: makeLineSnippet(s, idx, Math.min(40, s.length - idx)), token: s.slice(idx) });
    }
  }
  return { unresolved, broken, inboundIds };
}

function makeSnippet(s, start, len) {
  const before = Math.max(0, start - 24);
  const after = Math.min(s.length, start + len + 24);
  return s.slice(before, after);
}

function makeLineSnippet(s, start, len) {
  const left = s.lastIndexOf('\n', Math.max(0, start - 1));
  const right = s.indexOf('\n', start + (len || 0));
  return s.slice(left >= 0 ? left + 1 : 0, right >= 0 ? right : s.length);
}

function normalizeTitleKey(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const it of arr) {
    const k = keyFn(it);
    const a = m.get(k) || [];
    a.push(it);
    m.set(k, a);
  }
  return m;
}

async function fetchPageWithBlocks(pageId) {
  return fetchJson(`/api/pages/${encodeURIComponent(pageId)}`);
}

async function limitedMap(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = null; console.error(e); }
    }
  }
  const n = Math.max(1, Math.min(limit || 4, items.length || 0));
  await Promise.all(new Array(n).fill(0).map(() => worker()));
  return out;
}

async function runScan() {
  const pages = await fetchJson('/api/pages');
  const pageMap = new Map(pages.map(p => [p.id, p]));

  // Build set of pageIds present in user-defined sections (tree)
  const st = await fetchJson('/api/user/state');
  const userSections = Array.isArray(st?.sections?.items) ? st.sections.items : [];
  const inTree = new Set();
  for (const sec of userSections) {
    const arr = Array.isArray(sec?.pageIds) ? sec.pageIds : [];
    for (const id of arr) inTree.add(id);
  }

  // Scan each page's blocks
  const allUnresolved = [];
  const allBroken = [];
  const inboundCounts = Object.create(null); // pageId -> count
  const blockCounts = Object.create(null); // pageId -> number of blocks

  await limitedMap(pages, 4, async (p) => {
    const data = await fetchPageWithBlocks(p.id);
    const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
    blockCounts[p.id] = blocks.length || 0;
    for (const b of blocks) {
      const content = safeParse(b?.contentJson);
      const props = safeParse(b?.propsJson);
      if (content?.text) {
        const { unresolved, broken, inboundIds } = scanTextForTokens(String(content.text), { pageId: p.id, blockId: b.id, blockType: b?.type || null, field: 'text' });
        if (unresolved.length) allUnresolved.push(...unresolved);
        if (broken.length) allBroken.push(...broken);
        for (const targetId of inboundIds) inboundCounts[targetId] = (inboundCounts[targetId] || 0) + 1;
      }
      if (props?.html) {
        const { unresolved, broken, inboundIds } = scanTextForTokens(String(props.html), { pageId: p.id, blockId: b.id, blockType: b?.type || null, field: 'html' });
        if (unresolved.length) allUnresolved.push(...unresolved);
        if (broken.length) allBroken.push(...broken);
        for (const targetId of inboundIds) inboundCounts[targetId] = (inboundCounts[targetId] || 0) + 1;
      }
    }
  });

  // Group unresolved by title
  const byTitle = groupBy(allUnresolved, (u) => normalizeTitleKey(u.title));
  const unresolvedGroups = [];
  for (const [key, occ] of byTitle.entries()) {
    const titleRaw = occ[0]?.title || key;
    // Candidates: pages with exact title match (case-insensitive)
    const candidates = pages.filter(pg => normalizeTitleKey(pg.title) === key).map(pg => ({ id: pg.id, title: pg.title }));
    unresolvedGroups.push({ key, title: titleRaw, count: occ.length, occurrences: occ, candidates });
  }
  unresolvedGroups.sort((a,b) => b.count - a.count || a.title.localeCompare(b.title));

  // Orphans: not in user tree AND no inbound links
  const orphans = [];
  for (const p of pages) {
    const inbound = Number(inboundCounts[p.id] || 0);
    const inAnyTree = inTree.has(p.id);
    if (!inAnyTree && inbound === 0) {
      orphans.push({ id: p.id, title: p.title, type: p.type, slug: p.slug || null, updatedAt: p.updatedAt || p.createdAt || '', blockCount: blockCounts[p.id] || 0 });
    }
  }
  orphans.sort((a,b) => (b.blockCount - a.blockCount) || a.title.localeCompare(b.title));

  // Duplicates by normalized title
  const titleGroupsMap = groupBy(pages, (pg) => normalizeTitleKey(pg.title));
  const dupTitles = [];
  for (const [k, list] of titleGroupsMap.entries()) {
    if (list.length >= 2) {
      const items = list.map(pg => ({ id: pg.id, title: pg.title, inbound: Number(inboundCounts[pg.id] || 0), type: pg.type, slug: pg.slug || null }));
      dupTitles.push({ key: k, size: items.length, items });
    }
  }
  dupTitles.sort((a,b) => b.size - a.size || a.key.localeCompare(b.key));

  // Open5e duplicates via page sheet metadata
  const o5eGroups = new Map(); // key "type:slug" -> [{pageId,title}]
  await limitedMap(pages, 4, async (p) => {
    try {
      const sheet = await getPageSheet(p.id);
      const src = sheet?.open5eSource || null;
      if (!src || !src.type || !src.slug) return;
      const key = `${normalizeO5eType(src.type)}:${String(src.slug)}`;
      const arr = o5eGroups.get(key) || [];
      arr.push({ id: p.id, title: p.title, type: normalizeO5eType(src.type), slug: src.slug, pageSlug: p.slug || null });
      o5eGroups.set(key, arr);
    } catch {}
  });
  const o5eDups = [];
  for (const [key, list] of o5eGroups.entries()) {
    if (list.length >= 2) o5eDups.push({ key, size: list.length, items: list });
  }
  o5eDups.sort((a,b) => b.size - a.size || a.key.localeCompare(b.key));

  return {
    ts: Date.now(),
    pagesCount: pages.length,
    // Enrich occurrences with pageTitle for display only
    unresolvedGroups: unresolvedGroups.map(g => ({
      ...g,
      occurrences: g.occurrences.map(o => ({ ...o, pageTitle: pageMap.get(o.pageId)?.title || '' }))
    })),
    brokenTokens: allBroken.map(o => ({ ...o, pageTitle: pageMap.get(o.pageId)?.title || '' })),
    orphans,
    duplicateTitles: dupTitles,
    open5eDuplicates: o5eDups,
  };
}

function safeParse(x) { if (!x) return {}; if (typeof x === 'object') return x; try { return JSON.parse(String(x)); } catch { return {}; } }

// ------- UI

function highlightSnippetHtml(snippet, token) {
  const escSnippet = escapeHtml(String(snippet || ''));
  const escToken = escapeHtml(String(token || ''));
  if (!escToken) return escSnippet;
  const idx = escSnippet.indexOf(escToken);
  if (idx < 0) return escSnippet;
  return escSnippet.slice(0, idx) + '<mark>' + escToken + '</mark>' + escSnippet.slice(idx + escToken.length);
}

export async function render(container) {
  container.innerHTML = `
    <section>
      <style>
        /* Cleanup route-local styles */
        .cl-header { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .cl-stamp { margin-left:auto; white-space:nowrap; }
        .cl-summary { display:flex; gap:10px; flex-wrap:wrap; margin:8px 0; }
        .cl-summary .card { padding:8px 10px; min-width:120px; }
        .tool-tabs .chip.active { background: var(--accent); color:#fff; border-color:transparent; }
        .cl-grid { display:grid; grid-template-columns: 340px 1fr; gap:12px; align-items:start; }
        @media (max-width: 900px) { .cl-grid { grid-template-columns: 1fr; } }
        .cl-left { border:1px solid var(--border); border-radius: var(--radius-4); background: var(--panel); overflow: hidden; }
        .cl-list { display:flex; flex-direction:column; max-height:70vh; overflow:auto; }
        .cl-list-item { display:flex; gap:8px; align-items:center; padding:8px 10px; border-bottom:1px solid var(--border); cursor:pointer; }
        .cl-list-item:last-child { border-bottom:none; }
        .cl-list-item.active { background: color-mix(in srgb, var(--accent) 12%, var(--panel)); }
        .cl-list-title { font-weight:600; flex:1 1 auto; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cl-count { color: var(--muted); font-size:12px; }
        .cl-details { display:flex; flex-direction:column; gap:8px; }
        .cl-table { border:1px solid var(--border); border-radius: var(--radius-4); overflow:hidden; }
        .cl-row { display:grid; grid-template-columns: 1fr 220px 240px; gap:10px; align-items:center; padding:8px 10px; border-bottom:1px solid var(--border); }
        .cl-row:last-child { border-bottom:none; }
        .cl-row.header { background: var(--panel); color: var(--muted); font-size:12px; }
        .cl-snippet { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cl-source { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color: var(--muted); }
        .cl-actions { display:flex; gap:6px; justify-content:flex-end; }
        @media (max-width: 900px) { .cl-row { grid-template-columns: 1fr; } .cl-actions { justify-content:flex-start; } }
        .cl-meta-row { display:flex; gap:10px; align-items:center; }
        .cl-meta-row .spacer { margin-left:auto; }
        .cl-link { color: var(--muted); }
        .cl-explainer { font-size: 13px; color: var(--muted); }
        .cl-explainer .title { font-weight: 600; color: var(--text); margin-bottom: 2px; }
        .cl-snippet mark { background: color-mix(in srgb, var(--accent) 28%, transparent); color: inherit; padding: 0 2px; border-radius: 2px; }
        /* Expanded occurrence panel */
        .cl-expand { border-bottom:1px solid var(--border); padding:10px; display:flex; flex-direction:column; gap:8px; background: color-mix(in srgb, var(--panel) 60%, transparent); }
        .cl-expand-snippet { font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace); white-space:pre-wrap; background: var(--bg); border:1px solid var(--border); border-radius: var(--radius-4); padding:8px; }
        .cl-expand-snippet mark { background: color-mix(in srgb, var(--accent) 28%, transparent); color: inherit; padding: 0 2px; border-radius: 2px; }
        .cl-expand-meta { display:flex; gap:14px; flex-wrap:wrap; color: var(--muted); }
        .cl-expand-actions { display:flex; gap:8px; flex-wrap:wrap; }
      </style>
      <h1>Cleanup</h1>
      <div class="tool-tabs cl-header" style="margin: 6px 0;">
        <button class="chip" id="clRun">Run scan</button>
        <button class="chip" id="clRefresh">Refresh</button>
        <div class="meta cl-stamp" id="clStamp">Last scan: never</div>
      </div>
      <div id="clSummary" class="summary-cards cl-summary"></div>
      <div class="tool-tabs" style="margin: 8px 0; gap:8px; align-items:center; flex-wrap:wrap;">
        <button class="chip" data-tab="unresolved">Unresolved [[Title]]</button>
        <button class="chip" data-tab="broken">Broken tokens</button>
        <button class="chip" data-tab="orphans">Orphan pages</button>
        <button class="chip" data-tab="dups">Duplicate titles</button>
        <button class="chip" data-tab="o5e">Open5e duplicates</button>
      </div>
      <div id="clBody"></div>
    </section>
  `;

  const btnRun = $('#clRun');
  const btnRefresh = $('#clRefresh');
  const stampEl = $('#clStamp');
  const sumEl = $('#clSummary');
  const bodyEl = $('#clBody');

  let activeTab = 'unresolved';
  let results = null;
  let selectedKey = null; // unresolved group key
  const expandedKeys = new Set(); // unresolved group -> expanded occurrences
  const expandedOcc = new Set(); // per-occurrence expanded: `${pageId}:${blockId}:${token}`
  let pageTitleById = null; // Map of pageId -> title (for display-only)

  function applyStamp(ts) {
    const text = ts ? new Date(ts).toLocaleString() : 'never';
    stampEl.textContent = `Last scan: ${text}`;
  }

  function renderSummary() {
    if (!results) { sumEl.innerHTML = ''; return; }
    const cards = [
      { label: 'Unresolved', value: results.unresolvedGroups?.reduce((n,g)=>n+(g?.count||0),0) || 0 },
      { label: 'Broken tokens', value: results.brokenTokens?.length || 0 },
      { label: 'Orphans', value: results.orphans?.length || 0 },
      { label: 'Dup titles', value: results.duplicateTitles?.length || 0 },
      { label: 'Open5e dup', value: results.open5eDuplicates?.length || 0 },
    ];
    sumEl.innerHTML = cards.map(c => `
      <div class="card">
        <div style="font-size:12px; color: var(--muted);">${escapeHtml(c.label)}</div>
        <div style="font-size:22px;">${c.value}</div>
      </div>
    `).join('');
  }

  function pageHref(p) { return canonicalPageHref(p); }

  function renderBody() {
    if (!results) { bodyEl.innerHTML = '<div class="meta">No results yet. Click Run scan.</div>'; return; }
    if (activeTab === 'unresolved') renderUnresolved();
    else if (activeTab === 'broken') renderBroken();
    else if (activeTab === 'orphans') renderOrphans();
    else if (activeTab === 'dups') renderDupTitles();
    else if (activeTab === 'o5e') renderO5eDups();
    syncTabs();
  }

  function renderExplainer(kind) {
    if (kind === 'unresolved') {
      return `
        <div class="card cl-explainer" style="padding:8px 10px; margin-bottom:8px;">
          <div class="title">What this means</div>
          <div>These are legacy title-links written as [[Title]] (NOT [[page:uuid|Label]]). They don’t resolve to a specific page.</div>
          <div class="meta" style="margin-top:4px;">Examples: [[Fireball]], [[Longsword Attack]]. Why it matters: ambiguous or broken navigation.</div>
        </div>`;
    }
    if (kind === 'broken') {
      return `
        <div class="card cl-explainer" style="padding:8px 10px; margin-bottom:8px;">
          <div class="title">What this means</div>
          <div>Broken or malformed tokens:</div>
          <div class="meta">• nested: token inside token • invalidUUID: [[page:...]] with invalid UUID • unclosed: [[ without closing ]]</div>
        </div>`;
    }
    if (kind === 'orphans') {
      return `
        <div class="card cl-explainer" style="padding:8px 10px; margin-bottom:8px;">
          <div class="title">What this means</div>
          <div>Orphan pages are not in the section tree and have no inbound links.</div>
        </div>`;
    }
    if (kind === 'dups') {
      return `
        <div class="card cl-explainer" style="padding:8px 10px; margin-bottom:8px;">
          <div class="title">What this means</div>
          <div>Multiple pages share the same normalized title (case/whitespace).</div>
        </div>`;
    }
    if (kind === 'o5e') {
      return `
        <div class="card cl-explainer" style="padding:8px 10px; margin-bottom:8px;">
          <div class="title">What this means</div>
          <div>Multiple pages share the same Open5e {type, slug}.</div>
        </div>`;
    }
    return '';
  }

  function occKey(o) {
    return `${o.pageId}:${o.blockId}:${o.token}`;
  }

  function pageHrefAtBlock({ id, slug, title }, blockId) {
    try {
      const base = pageHref({ id, slug, title });
      const sep = base.includes('?') ? '&' : '?';
      return `${base}${sep}block=${encodeURIComponent(blockId)}`;
    } catch {
      return pageHref({ id, slug, title });
    }
  }

  function renderUnresolved() {
    const groups = results.unresolvedGroups || [];
    // Default selection: first group
    if (!selectedKey && groups.length) selectedKey = groups[0].key;

    const totalOcc = groups.reduce((n,g)=>n+(g?.count||0),0);
    const left = `
      <div class="cl-left">
        <div class="cl-meta-row" style="padding:8px 10px; border-bottom:1px solid var(--border);">
          <div class="meta">${groups.length} titles · ${totalOcc} occurrences</div>
        </div>
        <div class="cl-list">
          ${groups.map(g => `
            <div class="cl-list-item ${g.key===selectedKey?'active':''}" data-key="${escapeHtml(g.key)}">
              <div class="cl-list-title" title="${escapeHtml(g.title)}">${escapeHtml(g.title)}</div>
              <div class="cl-count" title="Occurrences">${g.count}</div>
              <div class="cl-count" title="Candidates">${g.candidates?.length||0}</div>
            </div>
          `).join('')}
        </div>
      </div>`;

    const sel = groups.find(g => g.key === selectedKey) || null;
    const details = sel ? renderUnresolvedDetails(sel) : `<div class="meta">Select a group</div>`;

    bodyEl.innerHTML = `${renderExplainer('unresolved')}<div class="cl-grid">${left}<div class="cl-details">${details}</div></div>`;
    // Wire selection and actions
    bodyEl.querySelectorAll('.cl-list-item').forEach(row => row.addEventListener('click', () => {
      selectedKey = row.getAttribute('data-key');
      renderUnresolved();
    }));
    wireOccurrenceActions();
  }

  function getPageTitle(id) {
    if (!pageTitleById) return '';
    return pageTitleById.get(id) || '';
  }

  function renderUnresolvedDetails(g) {
    const expanded = expandedKeys.has(g.key);
    const occ = (g.occurrences || []);
    const shown = expanded ? occ : occ.slice(0, 20);
    const toggle = occ.length > 20 ? (
      expanded
        ? `<button class="chip" data-collapse="1">Collapse</button>`
        : `<button class="chip" data-expand="1">Show all (${occ.length})</button>`
    ) : '';

    const candidates = (g.candidates?.length)
      ? `<div class="meta">Candidates: ${g.candidates.map(c => `<a href="${pageHref({ id:c.id, slug:null, title:c.title })}" data-link target="_blank" rel="noopener">${escapeHtml(c.title)}</a>`).join(', ')}</div>`
      : '';

    // Top pages affected (top 3 by occurrence count)
    const byPage = new Map();
    for (const o of occ) byPage.set(o.pageId, (byPage.get(o.pageId) || 0) + 1);
    const topPages = Array.from(byPage.entries()).sort((a,b)=>b[1]-a[1]).slice(0,3)
      .map(([pid,cnt]) => `${escapeHtml(getPageTitle(pid) || pid)} (${cnt})`).join(', ');

    const head = `
      <div style="display:flex; gap:10px; align-items:center;">
        <div style="font-weight:600;">${escapeHtml(g.title)}</div>
        <span class="meta">${g.count} occurrence${g.count!==1?'s':''}</span>
        <span class="meta" style="margin-left:auto;">${g.candidates?.length||0} candidate page${(g.candidates?.length||0)!==1?'s':''}</span>
      </div>`;
    const headMeta = topPages ? `<div class="meta">Top pages affected: ${topPages}</div>` : '';

    // Bulk action bar (only for groups with >=5 occurrences)
    const allowBulk = (g.count || 0) >= 5;
    const unambig = (g.candidates?.length === 1);
    const bulkTargetSelect = (!unambig && Array.isArray(g.candidates) && g.candidates.length > 1)
      ? `<select class="cl-bulk-target" data-group="${escapeHtml(g.key)}">
            <option value="">— Choose target page —</option>
            ${g.candidates.map(c => `<option value="${escapeHtml(c.id)}" data-title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</option>`).join('')}
         </select>`
      : '';
    const chosenTargetTitle = unambig ? (g.candidates[0]?.title || '') : '';
    const bulkBar = allowBulk ? `
      <div class="card" style="padding:8px 10px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;" data-bulk-group="${escapeHtml(g.key)}">
        <div style="font-weight:600;">Bulk actions</div>
        ${unambig ? '' : bulkTargetSelect}
        <button class="chip cl-bulk-fix" data-group="${escapeHtml(g.key)}" ${unambig ? '' : 'disabled'} title="${unambig ? '' : 'Choose a target page to resolve to'}">
          Fix all ${g.count} occurrences → Page ‘${escapeHtml(chosenTargetTitle || g.title)}’
        </button>
        <button class="chip cl-bulk-plain" data-group="${escapeHtml(g.key)}">Convert all ${g.count} occurrences to plain text</button>
        <span class="meta cl-bulk-status" data-group="${escapeHtml(g.key)}" style="margin-left:auto;"></span>
      </div>
    ` : '';

    const table = `
      <div class="cl-table">
        <div class="cl-row header">
          <div>Snippet</div>
          <div>Source page</div>
          <div>Actions</div>
        </div>
        ${shown.map(o => renderOccurrenceRow2(o, g)).join('')}
      </div>`;

    const controls = `
      <div style="display:flex; gap:8px; align-items:center;">
        ${toggle}
      </div>`;

    // Wrap details
    const wrap = `
      <div class="card" style="padding:8px 10px;">
        ${head}
        ${headMeta}
        <div style="margin-top:6px; display:flex; flex-direction:column; gap:6px;">
          ${bulkBar}
          ${table}
          ${candidates}
          ${controls}
        </div>
      </div>`;

    // After rendering, wire toggles
    setTimeout(() => {
      const root = bodyEl.querySelector('.cl-details');
      root?.querySelector('[data-expand]')?.addEventListener('click', () => { expandedKeys.add(g.key); renderUnresolved(); });
      root?.querySelector('[data-collapse]')?.addEventListener('click', () => { expandedKeys.delete(g.key); renderUnresolved(); });
      // Wire bulk controls for this group
      wireBulkGroupActions(g);
    }, 0);

    return wrap;
  }

  function renderOccurrenceRow2(o, group) {
    const href = pageHref({ id: o.pageId, slug: null, title: o.pageTitle || getPageTitle(o.pageId) || '' });
    const highlighted = highlightSnippetHtml(String(o.snippet || ''), String(o.token || ''));
    const snippet = highlighted.replace(/\n/g, ' ');
    const pageTitle = escapeHtml(o.pageTitle || getPageTitle(o.pageId) || '');
    const pageInfo = pageTitle ? `${pageTitle} ` : '';
    const pageMuted = escapeHtml(String(o.pageId || ''));
    const blockInfo = escapeHtml(String(o.blockId || ''));
    const blockType = o.blockType ? ` <span class="meta">${escapeHtml(String(o.blockType))}</span>` : '';
    const tooltip = escapeHtml(String(o.fullSnippet || o.snippet || o.token || ''));
    const key = occKey(o);
    const isOpen = expandedOcc.has(key);
    const unambig = (group?.candidates?.length === 1);
    const cand = unambig ? group.candidates[0] : null;
    const label = group?.title || extractLegacyLabel(o.token) || '';
    const hrefAtBlock = pageHrefAtBlock({ id: o.pageId, slug: null, title: o.pageTitle || getPageTitle(o.pageId) || '' }, o.blockId);
    return `
      <div class="cl-row" data-ockey="${escapeHtml(key)}">
        <div class="cl-snippet meta" title="${tooltip}">${snippet}</div>
        <div class="cl-source" title="${pageInfo}(${pageMuted}) · block ${blockInfo}">Page: ${pageInfo}<span class="meta">(${pageMuted})</span> • Block: <span class="meta">${blockInfo}</span>${blockType}</div>
        <div class="cl-actions">
          <button class="chip cl-details-toggle" data-ockey="${escapeHtml(key)}">${isOpen ? 'Hide details' : 'Details'}</button>
          <a class="chip" href="${href}" data-link target="_blank" rel="noopener">Open page</a>
          <button class="chip cl-to-plain" data-page="${escapeHtml(o.pageId)}" data-block="${escapeHtml(o.blockId)}" data-token="${escapeHtml(o.token)}" data-snippet="${tooltip}">Convert to plain text</button>
        </div>
      </div>
      ${isOpen ? `
        <div class="cl-expand" data-ockey="${escapeHtml(key)}">
          <div class="cl-expand-snippet">${highlightSnippetHtml(String(o.snippet || ''), String(o.token || '')).replace(/\n/g, '\n')}</div>
          <div class="cl-expand-meta">
            <div><strong>Page:</strong> ${pageInfo}<span class="meta">(${pageMuted})</span></div>
            <div><strong>Block:</strong> <span class="meta">${blockInfo}</span>${blockType}</div>
          </div>
          <div class="cl-expand-actions">
            <a class="chip" href="${href}" data-link target="_blank" rel="noopener">Open page</a>
            <a class="chip" href="${hrefAtBlock}" data-link target="_blank" rel="noopener">Open page at block</a>
            ${unambig ? `
              <button class="chip cl-resolve" data-page="${escapeHtml(o.pageId)}" data-block="${escapeHtml(o.blockId)}" data-token="${escapeHtml(o.token)}" data-target="${escapeHtml(cand.id)}" data-label="${escapeHtml(label)}" data-target-title="${escapeHtml(cand.title)}" data-field="${escapeHtml(String(o.field || ''))}" data-idx="${String(o.matchIndex ?? '')}" data-before="${escapeHtml(String(o.contextBefore || ''))}" data-after="${escapeHtml(String(o.contextAfter || ''))}" data-title="${escapeHtml(String(o.title || label || ''))}">Fix link → "${escapeHtml(cand.title)}"</button>
              <button class="chip cl-copy-fix" data-target="${escapeHtml(cand.id)}" data-label="${escapeHtml(label)}">Copy quick fix</button>
            ` : `
              <button class="chip" disabled title="Ambiguous; open page to resolve manually">Resolve → [[page:…|${escapeHtml(label)}]]</button>
            `}
            <button class="chip cl-to-plain" data-page="${escapeHtml(o.pageId)}" data-block="${escapeHtml(o.blockId)}" data-token="${escapeHtml(o.token)}" data-snippet="${tooltip}">Convert to plain text</button>
          </div>
        </div>
      ` : ''}
    `;
  }

  function wireOccurrenceActions() {
    bodyEl.querySelectorAll('a[data-link]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); openHrefNewTab(a.getAttribute('href')); }));
    bodyEl.querySelectorAll('.cl-details-toggle').forEach(btn => btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-ockey');
      if (!key) return;
      if (expandedOcc.has(key)) expandedOcc.delete(key); else expandedOcc.add(key);
      renderUnresolved();
    }));
    bodyEl.querySelectorAll('.cl-to-plain').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const pageId = btn.getAttribute('data-page');
        const blockId = btn.getAttribute('data-block');
        const token = btn.getAttribute('data-token');
        const sn = btn.getAttribute('data-snippet') || '';
        const label = extractLegacyLabel(token) || '';
        const ok = window.confirm(`Convert this one occurrence of [[${label || 'Title'}]] to plain text?\n\nSnippet: ${sn}`);
        if (!ok) return;
        await convertOneLegacyToken({ pageId, blockId, token });
        alert('Converted to plain text.');
      } catch (e) {
        console.error(e);
        alert('Failed to convert: ' + (e?.message || e));
      } finally { btn.disabled = false; }
    }));
    bodyEl.querySelectorAll('.cl-resolve').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const pageId = btn.getAttribute('data-page');
        const blockId = btn.getAttribute('data-block');
        const token = btn.getAttribute('data-token');
        const targetId = btn.getAttribute('data-target');
        const label = btn.getAttribute('data-label') || '';
        const targetTitle = btn.getAttribute('data-target-title') || '';
        const field = btn.getAttribute('data-field') || '';
        const matchIndex = Number(btn.getAttribute('data-idx') || '-1');
        const contextBefore = btn.getAttribute('data-before') || '';
        const contextAfter = btn.getAttribute('data-after') || '';
        const occTitle = btn.getAttribute('data-title') || label || '';
        if (!pageId || !blockId || !token || !targetId) throw new Error('Missing parameters');
        const confirmMsg = `Make this a real internal link?\n\n` +
          `This will turn the broken [[${label || 'Title'}]] into a clickable link to the page "${targetTitle}".\n` +
          `Only this one occurrence in this block will be changed.\n\n` +
          `Before: [[${label || 'Title'}]]\n` +
          `After: ${label || 'Title'} (links to "${targetTitle}")\n\n` +
          `Technical details:\n` +
          `[[page:${targetId}|${label}]]`;
        const ok = window.confirm(confirmMsg);
        if (!ok) return;
        await resolveOneLegacyTokenToPage({ pageId, blockId, token, targetPageId: targetId, label, field, matchIndex, contextBefore, contextAfter, title: occTitle });
        alert(`✅ Linked this occurrence to page "${targetTitle}".`);
        // Remove just this occurrence in-place from results, so UI updates without rescan
        try {
          const titleKey = normalizeTitleKey(occTitle || label || '');
          const g = (results?.unresolvedGroups || []).find(x => x.key === titleKey);
          if (g) {
            let idx = (g.occurrences || []).findIndex(o => o.pageId === pageId && o.blockId === blockId && (String(o.field||'') === String(field||'') ) && (Number(o.matchIndex||-1) === Number(matchIndex||-1)));
            if (idx < 0) {
              // Fallback for older cached results without metadata: match by pageId/blockId/token
              idx = (g.occurrences || []).findIndex(o => o.pageId === pageId && o.blockId === blockId && String(o.token||'') === String(token||''));
            }
            if (idx >= 0) {
              g.occurrences.splice(idx, 1);
              g.count = Math.max(0, (g.count||0) - 1);
              if (g.count === 0 || g.occurrences.length === 0) {
                const gi = (results.unresolvedGroups || []).findIndex(x => x.key === titleKey);
                if (gi >= 0) results.unresolvedGroups.splice(gi, 1);
                if (selectedKey === titleKey) selectedKey = (results.unresolvedGroups[0]?.key) || null;
              }
              renderUnresolved();
            }
          }
        } catch {}
      } catch (e) {
        console.error(e);
        if (e && (e.message === 'STALE_SCAN' || e.code === 'STALE_SCAN')) {
          try {
            const pages = await fetchJson('/api/pages');
          } catch {}
          const href = pageHrefAtBlock({ id: btn.getAttribute('data-page'), slug: null, title: '' }, btn.getAttribute('data-block'));
          const msg = 'This scan result is out of date — the text in this block has changed. Please Run scan again.\n\nOK: Open page at block\nCancel: Re-run scan now';
          const choice = window.confirm(msg);
          if (choice) { openHrefNewTab(href); }
          else { try { await doRunScan(); } catch {} }
        } else {
          alert('Failed to resolve: ' + (e?.message || e));
        }
      } finally { btn.disabled = false; }
    }));
    bodyEl.querySelectorAll('.cl-copy-fix').forEach(btn => btn.addEventListener('click', async () => {
      const targetId = btn.getAttribute('data-target');
      const label = btn.getAttribute('data-label') || '';
      const text = `[[page:${targetId}|${label}]]`;
      try {
        if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(text); alert('Copied quick fix.'); }
        else { window.prompt('Copy quick fix:', text); }
      } catch {
        window.prompt('Copy quick fix:', text);
      }
    }));
  }

  function wireBulkGroupActions(group) {
    const key = group.key;
    // CSS.escape is supported in modern browsers; fallback minimal
    const selKey = (window.CSS && CSS.escape) ? CSS.escape(key) : key.replace(/[^\w-]/g, '_');
    const bulkRoot = bodyEl.querySelector(`[data-bulk-group="${selKey}"]`);
    if (!bulkRoot) return;
    const fixBtn = bulkRoot.querySelector('.cl-bulk-fix');
    const plainBtn = bulkRoot.querySelector('.cl-bulk-plain');
    const statusEl = bulkRoot.querySelector('.cl-bulk-status');
    const targetSel = bulkRoot.querySelector('.cl-bulk-target');

    if (targetSel && fixBtn) {
      targetSel.addEventListener('change', () => {
        const val = targetSel.value || '';
        if (val) {
          fixBtn.removeAttribute('disabled');
          const title = targetSel.options[targetSel.selectedIndex]?.getAttribute('data-title') || '';
          if (title) fixBtn.textContent = `Fix all ${group.count} occurrences → Page ‘${title}’`;
        } else {
          fixBtn.setAttribute('disabled', '');
          fixBtn.textContent = `Fix all ${group.count} occurrences → Page ‘${group.title}’`;
        }
      });
    }

    if (fixBtn) fixBtn.addEventListener('click', async () => {
      fixBtn.disabled = true; if (plainBtn) plainBtn.disabled = true;
      try {
        const candidates = Array.isArray(group.candidates) ? group.candidates : [];
        let targetPageId = '';
        let targetTitle = '';
        if (candidates.length === 1) { targetPageId = candidates[0].id; targetTitle = candidates[0].title; }
        else if (targetSel && targetSel.value) {
          targetPageId = targetSel.value;
          targetTitle = targetSel.options[targetSel.selectedIndex]?.getAttribute('data-title') || '';
        }
        if (!targetPageId) { alert('Choose a target page to resolve to.'); return; }
        await resolveGroupAll({ groupKey: key, targetPageId, targetTitle }, { statusEl });
      } catch (e) {
        console.error(e); alert('Bulk resolve failed: ' + (e?.message || e));
      } finally { fixBtn.disabled = false; if (plainBtn) plainBtn.disabled = false; }
    });

    if (plainBtn) plainBtn.addEventListener('click', async () => {
      if (fixBtn) fixBtn.disabled = true; plainBtn.disabled = true;
      try {
        await convertGroupAllToPlain({ groupKey: key }, { statusEl });
      } catch (e) {
        console.error(e); alert('Bulk convert failed: ' + (e?.message || e));
      } finally { if (fixBtn) fixBtn.disabled = false; plainBtn.disabled = false; }
    });
  }

  // ------- Bulk operations (within route render for state access)
  async function resolveGroupAll({ groupKey, targetPageId, targetTitle }, { statusEl } = {}) {
    const g = (results?.unresolvedGroups || []).find(x => x.key === groupKey);
    if (!g) throw new Error('Group not found');
    const occ = Array.isArray(g.occurrences) ? g.occurrences : [];
    if (!occ.length) { alert('Nothing to fix in this group.'); return; }

    statusEl && (statusEl.textContent = `Dry run…`);
    const plan = await dryRunVerify(occ, () => `[[page:${targetPageId}|…]]`);

    const willFix = plan.filter(p => p.status === 'ok');
    const already = plan.filter(p => p.status === 'skip');
    const failed = plan.filter(p => p.status === 'fail');

    const total = occ.length;
    const will = willFix.length;
    const alr = already.length;
    const fal = failed.length;
    const examples = summarizePages(willFix, 5);
    const label = g.title || '';
    const before = `[[${label}]]`;
    const after = `[[page:${targetPageId}|${label}]]`;
    let msg = `About to link ${will} of ${total} occurrences across ${examples.pages} page(s).\n\n` +
      `Before → After (example):\n${before} → ${after}\n\n` +
      `Counts:\n` +
      `• willFix: ${will}\n` +
      `• alreadyFixedOrMissing: ${alr}\n` +
      `• failed: ${fal}\n` +
      `${examples.list ? `\nExample pages: ${examples.list}` : ''}`;
    if (total >= 20) {
      const typed = window.prompt(msg + `\n\nType FIX to proceed:`);
      if (typed !== 'FIX') { statusEl && (statusEl.textContent = 'Cancelled'); return; }
    } else {
      const ok = window.confirm(msg + `\n\nProceed?`);
      if (!ok) { statusEl && (statusEl.textContent = 'Cancelled'); return; }
    }

    let done = 0, success = 0, fail = 0;
    const succeededKeys = [];
    statusEl && (statusEl.textContent = `Fixing ${done} / ${will}…`);
    const tasks = willFix.map(p => async () => {
      try {
        await resolveOneLegacyTokenToPage({
          pageId: p.item.pageId,
          blockId: p.item.blockId,
          token: p.item.token,
          targetPageId,
          label: p.item.title || extractLegacyLabel(p.item.token) || '',
          field: p.item.field || '',
          matchIndex: p.item.matchIndex,
          contextBefore: p.item.contextBefore,
          contextAfter: p.item.contextAfter,
          title: p.item.title,
        });
        success++;
        succeededKeys.push(`${p.item.pageId}:${p.item.blockId}:${p.item.field}:${p.item.matchIndex}`);
      } catch (e) { console.error(e); fail++; }
      finally { done++; statusEl && (statusEl.textContent = `Fixing ${done} / ${will}…`); }
    });

    await runWithConcurrency(tasks, 4);

    const okSet = new Set(succeededKeys);
    g.occurrences = (g.occurrences || []).filter(o => !okSet.has(`${o.pageId}:${o.blockId}:${o.field}:${o.matchIndex}`));
    g.count = g.occurrences.length;
    if (g.count === 0) {
      const gi = results.unresolvedGroups.findIndex(x => x.key === g.key);
      if (gi >= 0) results.unresolvedGroups.splice(gi, 1);
      if (selectedKey === g.key) selectedKey = results.unresolvedGroups[0]?.key || null;
    }
    renderSummary();
    renderUnresolved();

    alert(`Bulk resolve complete.\n\nLinked: ${success}\nFailed: ${fail}\nSkipped: ${alr}`);
    statusEl && (statusEl.textContent = '');
  }

  async function convertGroupAllToPlain({ groupKey }, { statusEl } = {}) {
    const g = (results?.unresolvedGroups || []).find(x => x.key === groupKey);
    if (!g) throw new Error('Group not found');
    const occ = Array.isArray(g.occurrences) ? g.occurrences : [];
    if (!occ.length) { alert('Nothing to convert in this group.'); return; }

    statusEl && (statusEl.textContent = `Dry run…`);
    const plan = await dryRunVerify(occ, () => ``);
    const willFix = plan.filter(p => p.status === 'ok');
    const already = plan.filter(p => p.status === 'skip');
    const failed = plan.filter(p => p.status === 'fail');
    const total = occ.length;
    const will = willFix.length;
    const alr = already.length;
    const fal = failed.length;
    const examples = summarizePages(willFix, 5);
    const label = g.title || '';
    const before = `[[${label}]]`;
    const after = `${label}`;
    let msg = `About to convert ${will} of ${total} occurrences to plain text across ${examples.pages} page(s).\n\n` +
      `Before → After (example):\n${before} → ${after}\n\n` +
      `Counts:\n` +
      `• willChange: ${will}\n` +
      `• alreadyMissing: ${alr}\n` +
      `• failed: ${fal}\n` +
      `${examples.list ? `\nExample pages: ${examples.list}` : ''}`;
    const ok = window.confirm(msg + `\n\nProceed?`);
    if (!ok) { statusEl && (statusEl.textContent = 'Cancelled'); return; }

    let done = 0, success = 0, fail = 0;
    const succeededKeys = [];
    statusEl && (statusEl.textContent = `Converting ${done} / ${will}…`);

    const tasks = willFix.map(p => async () => {
      try {
        await convertOneLegacyToken({ pageId: p.item.pageId, blockId: p.item.blockId, token: p.item.token });
        success++;
        succeededKeys.push(`${p.item.pageId}:${p.item.blockId}:${p.item.field}:${p.item.matchIndex}`);
      } catch (e) { console.error(e); fail++; }
      finally { done++; statusEl && (statusEl.textContent = `Converting ${done} / ${will}…`); }
    });

    await runWithConcurrency(tasks, 4);

    const okSet = new Set(succeededKeys);
    g.occurrences = (g.occurrences || []).filter(o => !okSet.has(`${o.pageId}:${o.blockId}:${o.field}:${o.matchIndex}`));
    g.count = g.occurrences.length;
    if (g.count === 0) {
      const gi = results.unresolvedGroups.findIndex(x => x.key === g.key);
      if (gi >= 0) results.unresolvedGroups.splice(gi, 1);
      if (selectedKey === g.key) selectedKey = results.unresolvedGroups[0]?.key || null;
    }
    renderSummary();
    renderUnresolved();

    alert(`Bulk convert complete.\n\nConverted: ${success}\nFailed: ${fail}\nSkipped: ${alr}`);
    statusEl && (statusEl.textContent = '');
  }

  // Dry run verifier: checks whether each occurrence token is still present using field + index + context + regex fallback
  async function dryRunVerify(occurrences, makeReplacementPreview) {
    const items = Array.isArray(occurrences) ? occurrences : [];
    const out = [];
    await limitedMap(items, 4, async (o) => {
      try {
        const page = await fetchJson(`/api/pages/${encodeURIComponent(o.pageId)}`);
        const blk = (Array.isArray(page?.blocks) ? page.blocks : []).find(b => b.id === o.blockId);
        if (!blk) { out.push({ item: o, status: 'fail', reason: 'Block not found' }); return; }
        const content = safeParse(blk.contentJson);
        const props = safeParse(blk.propsJson);
        const field = String(o.field || '');
        const matchIndex = Number(o.matchIndex);
        const before = String(o.contextBefore || '');
        const after = String(o.contextAfter || '');
        const title = String(o.title || extractLegacyLabel(o.token) || '');

        const textSrc = String(content?.text || '');
        const htmlSrc = String(props?.html || '');

        const foundText = findOccurrence(textSrc, o.token, matchIndex, before, after, title);
        const foundHtml = findOccurrence(htmlSrc, o.token, matchIndex, before, after, title);

        const present = (field === 'text') ? (foundText.found || (!foundText.tried && foundHtml.found)) : (field === 'html') ? (foundHtml.found || (!foundHtml.tried && foundText.found)) : (foundText.found || foundHtml.found);

        if (present) {
          out.push({ item: o, status: 'ok', preview: makeReplacementPreview(o) });
        } else {
          const missing = !(textSrc.includes(o.token) || htmlSrc.includes(o.token));
          out.push({ item: o, status: missing ? 'skip' : 'fail', reason: missing ? 'Missing token' : 'Mismatch' });
        }
      } catch (e) {
        out.push({ item: o, status: 'fail', reason: e?.message || String(e) });
      }
    });
    return out;
  }

  function summarizePages(planItems, limit) {
    const byPage = new Map();
    for (const p of planItems) byPage.set(p.item.pageId, (byPage.get(p.item.pageId) || 0) + 1);
    const entries = Array.from(byPage.entries()).sort((a,b)=>b[1]-a[1]);
    return {
      pages: byPage.size,
      list: entries.slice(0, limit || 5).map(([pid,cnt]) => `${escapeHtml(getPageTitle(pid) || pid)} (${cnt})`).join(', '),
    };
  }

  function runWithConcurrency(taskFns, limit) {
    const tasks = Array.isArray(taskFns) ? taskFns : [];
    const n = Math.max(1, Math.min(limit || 4, tasks.length || 0));
    let i = 0;
    async function worker() { while (true) { const idx = i++; if (idx >= tasks.length) return; await tasks[idx](); } }
    return Promise.all(new Array(n).fill(0).map(() => worker()));
  }

  function findOccurrence(src, token, matchIndex, before, after, title) {
    const out = { tried: false, found: false };
    if (!src) return out;
    out.tried = true;
    if (typeof matchIndex === 'number' && matchIndex >= 0 && src.slice(matchIndex, matchIndex + token.length) === token) { out.found = true; return out; }
    let j = -1;
    while (true) {
      j = src.indexOf(token, j + 1);
      if (j < 0) break;
      const pre = src.slice(Math.max(0, j - String(before||'').length), j);
      const post = src.slice(j + token.length, j + token.length + String(after||'').length);
      const okPre = before ? pre.endsWith(before) : true;
      const okPost = after ? post.startsWith(after) : true;
      if (okPre && okPost) { out.found = true; return out; }
    }
    const t = String(title || '').trim();
    if (t) {
      try {
        const re = new RegExp("\\[\\[\\s*" + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\s*\\]\\]", 'g');
        let m;
        while ((m = re.exec(src)) !== null) { out.found = true; return out; }
      } catch {}
    }
    return out;
  }

  function syncTabs() {
    container.querySelectorAll('[data-tab]').forEach(btn => {
      const tab = btn.getAttribute('data-tab') || '';
      if (tab === activeTab) btn.classList.add('active'); else btn.classList.remove('active');
    });
  }

  function renderBroken() {
    const list = results.brokenTokens || [];
    bodyEl.innerHTML = `
      ${renderExplainer('broken')}
      <div class="meta" style="margin:6px 0;">${list.length} issues</div>
      <div class="table" role="table">
        <div class="table-row header" role="row" style="display:flex; gap:10px; padding:6px 0; border-bottom:1px solid var(--border); font-size:12px; color: var(--muted);">
          <div style="width:140px;">Kind</div>
          <div style="flex:1;">Snippet</div>
          <div style="width:120px;">Actions</div>
        </div>
        ${list.map(it => `
          <div class="table-row" role="row" style="display:flex; gap:10px; align-items:center; padding:6px 0; border-bottom:1px solid var(--border);">
            <div style="width:140px;">${escapeHtml(it.kind)}</div>
            <div style="flex:1; min-width:0;" class="meta" title="${escapeHtml(String(it.fullSnippet || it.token || ''))}">${highlightSnippetHtml(String(it.snippet||''), String(it.token||'')).replace(/\n/g,' ')}</div>
            <div style="width:120px;"><a class="chip" href="${pageHref({ id: it.pageId, slug: null, title: it.pageTitle || '' })}" data-link target="_blank" rel="noopener">Open page</a></div>
          </div>
        `).join('')}
      </div>
    `;
    bodyEl.querySelectorAll('a[data-link]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); openHrefNewTab(a.getAttribute('href')); }));
  }

  function renderOrphans() {
    const list = results.orphans || [];
    bodyEl.innerHTML = `
      ${renderExplainer('orphans')}
      <div class="meta" style="margin:6px 0;">${list.length} pages</div>
      <div class="table" role="table">
        <div class="table-row header" role="row" style="display:flex; gap:10px; padding:6px 0; border-bottom:1px solid var(--border); font-size:12px; color: var(--muted);">
          <div style="flex:2;">Title</div>
          <div style="width:90px;">Type</div>
          <div style="width:110px;">Blocks</div>
          <div style="width:200px;">Updated</div>
          <div style="width:120px;">Actions</div>
        </div>
        ${list.map(p => `
          <div class="table-row" role="row" style="display:flex; gap:10px; align-items:center; padding:6px 0; border-bottom:1px solid var(--border);">
            <div style="flex:2; min-width:0;">${escapeHtml(p.title)} <span class="meta" style="margin-left:6px;">${escapeHtml(p.id)}</span></div>
            <div style="width:90px;" class="meta">${escapeHtml(p.type || '')}</div>
            <div style="width:110px;" class="meta">${p.blockCount}</div>
            <div style="width:200px;" class="meta">${escapeHtml(p.updatedAt || '')}</div>
            <div style="width:120px;"><a class="chip" href="${pageHref({ id: p.id, slug: p.slug || null, title: p.title })}" data-link target="_blank" rel="noopener">Open page</a></div>
          </div>
        `).join('')}
      </div>
    `;
    bodyEl.querySelectorAll('a[data-link]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); openHrefNewTab(a.getAttribute('href')); }));
  }

  function renderDupTitles() {
    const groups = results.duplicateTitles || [];
    bodyEl.innerHTML = `
      ${renderExplainer('dups')}
      <div class="meta" style="margin:6px 0;">${groups.length} groups</div>
      ${groups.map(g => `
        <div class="card" style="padding:8px 10px; margin:8px 0;">
          <div style="font-weight:600;">${escapeHtml(g.key)}</div>
          <div class="meta">${g.size} pages</div>
          <div class="cl-table" style="margin-top:6px;">
            <div class="cl-row header">
              <div>Title</div>
              <div>Type • Inbound</div>
              <div>Actions</div>
            </div>
            ${g.items.map(it => `
              <div class="cl-row">
                <div class="cl-snippet" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</div>
                <div class="cl-source">${escapeHtml(it.type || '')} • inbound ${it.inbound}</div>
                <div class="cl-actions"><a class="chip" href="${pageHref({ id: it.id, slug: it.slug || null, title: it.title })}" data-link target="_blank" rel="noopener">Open page</a></div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    `;
    bodyEl.querySelectorAll('a[data-link]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); openHrefNewTab(a.getAttribute('href')); }));
  }

  function renderO5eDups() {
    const groups = results.open5eDuplicates || [];
    bodyEl.innerHTML = `
      ${renderExplainer('o5e')}
      <div class="meta" style="margin:6px 0;">${groups.length} groups</div>
      ${groups.map(g => `
        <div class="card" style="padding:8px 10px; margin:8px 0;">
          <div style="font-weight:600;">${escapeHtml(g.key)}</div>
          <div class="meta">${g.size} pages</div>
          <div class="cl-table" style="margin-top:6px;">
            <div class="cl-row header">
              <div>Title</div>
              <div>Type</div>
              <div>Actions</div>
            </div>
            ${g.items.map(it => `
              <div class="cl-row">
                <div class="cl-snippet" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</div>
                <div class="cl-source">${escapeHtml(it.type)}</div>
                <div class="cl-actions"><a class="chip" href="${pageHref({ id: it.id, slug: it.pageSlug || null, title: it.title })}" data-link target="_blank" rel="noopener">Open page</a></div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    `;
    bodyEl.querySelectorAll('a[data-link]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); openHrefNewTab(a.getAttribute('href')); }));
  }

  // Wire tab buttons
  container.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => {
    activeTab = btn.getAttribute('data-tab') || 'unresolved';
    renderBody();
  }));

  async function doRunScan() {
    btnRun.disabled = true; btnRefresh.disabled = true; stampEl.textContent = 'Scanning…';
    try {
      const r = await runScan();
      results = r;
      saveScanCache({ ts: r.ts, results: r });
      applyStamp(r.ts);
      renderSummary();
      renderBody();
    } catch (e) {
      console.error(e);
      alert('Scan failed: ' + (e?.message || e));
      applyStamp(null);
    } finally { btnRun.disabled = false; btnRefresh.disabled = false; }
  }
  btnRun?.addEventListener('click', () => void doRunScan());
  btnRefresh?.addEventListener('click', () => void doRunScan());

  // Load from cache on first render
  try {
    const cached = loadScanCache();
    if (cached && cached.results) {
      results = cached.results;
      applyStamp(cached.ts || cached.results.ts || null);
      renderSummary();
      renderBody();
    }
  } catch {}

  // Lazy fetch page titles for display-only enrichment
  (async () => {
    try {
      const pages = await fetchJson('/api/pages');
      pageTitleById = new Map((Array.isArray(pages) ? pages : []).map(p => [p.id, p.title]));
      // If unresolved is active, re-render to include titles
      if (activeTab === 'unresolved' && results) renderUnresolved();
    } catch {}
  })();
}

// ------- Minimal safe action

async function convertOneLegacyToken({ pageId, blockId, token }) {
  // Fetch fresh block content to avoid stale edits
  const page = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}`);
  const blk = (Array.isArray(page?.blocks) ? page.blocks : []).find(b => b.id === blockId);
  if (!blk) throw new Error('Block not found');
  const content = safeParse(blk.contentJson);
  const props = safeParse(blk.propsJson);
  const label = extractLegacyLabel(token);
  if (!label) throw new Error('Invalid token');
  let changed = false;
  let newText = String(content?.text || '');
  const i = newText.indexOf(token);
  if (i >= 0) {
    newText = newText.slice(0, i) + label + newText.slice(i + token.length);
    changed = true;
  }
  let newHtml = null;
  try {
    const html = String(props?.html || '');
    if (html && html.includes(token)) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
      let tn, replaced = false;
      while ((tn = walker.nextNode())) {
        if (replaced) break;
        const s = tn.nodeValue || '';
        const j = s.indexOf(token);
        if (j >= 0) { tn.nodeValue = s.slice(0, j) + label + s.slice(j + token.length); replaced = true; }
      }
      newHtml = tmp.innerHTML;
      if (replaced) changed = true;
    }
  } catch {}
  if (!changed) throw new Error('Token not found in block');
  const patch = { content: { ...(content || {}), text: newText } };
  if (newHtml != null) patch.props = { ...(props || {}), html: newHtml };
  // Persist via API (single-block patch only)
  await fetchJson(`/api/blocks/${encodeURIComponent(blockId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  // Log for reversibility (localStorage-based)
  appendCleanupLog({ ts: Date.now(), action: 'convertToPlainText', pageId, blockId, before: { text: content?.text || '', html: props?.html || '' }, after: { text: newText, html: newHtml != null ? newHtml : (props?.html || '') } });
}

function extractLegacyLabel(token) {
  const m = String(token || '').match(/^\s*\[\[([^\]]*?)\]\]\s*$/);
  return m ? (m[1] || '').trim() : '';
}

// ------- Safe resolve action (single occurrence)

async function resolveOneLegacyTokenToPage({ pageId, blockId, token, targetPageId, label, field, matchIndex, contextBefore, contextAfter, title }) {
  // Fetch fresh block content to avoid stale edits
  const page = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}`);
  const blk = (Array.isArray(page?.blocks) ? page.blocks : []).find(b => b.id === blockId);
  if (!blk) throw new Error('Block not found');
  const content = safeParse(blk.contentJson);
  const props = safeParse(blk.propsJson);
  const replacement = `[[page:${targetPageId}|${label || extractLegacyLabel(token) || ''}]]`;
  let changed = false;
  let newText = String(content?.text || '');
  let newHtml = null;

  function escapeRegex(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function replaceAtIndex(src, idx, oldToken, repl) {
    if (idx >= 0 && src.slice(idx, idx + oldToken.length) === oldToken) {
      return src.slice(0, idx) + repl + src.slice(idx + oldToken.length);
    }
    return null;
  }

  function replaceByContext(src, oldToken, repl, approxIdx, before, after) {
    // Try to find an occurrence whose surrounding context matches
    let bestIdx = -1;
    let bestDist = Infinity;
    let j = -1;
    while (true) {
      j = src.indexOf(oldToken, j + 1);
      if (j < 0) break;
      const pre = src.slice(Math.max(0, j - String(before||'').length), j);
      const post = src.slice(j + oldToken.length, j + oldToken.length + String(after||'').length);
      const okPre = before ? pre.endsWith(before) : true;
      const okPost = after ? post.startsWith(after) : true;
      if (okPre && okPost) {
        const d = (typeof approxIdx === 'number' && approxIdx >= 0) ? Math.abs(j - approxIdx) : 0;
        if (d < bestDist) { bestDist = d; bestIdx = j; }
      }
    }
    if (bestIdx >= 0) return src.slice(0, bestIdx) + repl + src.slice(bestIdx + oldToken.length);
    return null;
  }

  function replaceByTitleRegex(src, titleStr, repl, approxIdx) {
    const t = String(titleStr || extractLegacyLabel(token) || '').trim();
    if (!t) return null;
    const re = new RegExp("\\\\[\\\\[\\s*" + escapeRegex(t) + "\\s*\\\\]\\\\]", 'g');
    let m, best = null;
    while ((m = re.exec(src)) !== null) {
      const idx = m.index;
      const dist = (typeof approxIdx === 'number' && approxIdx >= 0) ? Math.abs(idx - approxIdx) : 0;
      if (!best || dist < best.dist) best = { idx, len: m[0].length, dist };
    }
    if (best) {
      return src.slice(0, best.idx) + repl + src.slice(best.idx + best.len);
    }
    return null;
  }

  async function attempt(fieldSel) {
    if (fieldSel === 'text') {
      const src = String(content?.text || '');
      let out = null;
      // 1) index-based
      out = replaceAtIndex(src, Number(matchIndex), token, replacement);
      // 2) context-based
      if (out == null) out = replaceByContext(src, token, replacement, Number(matchIndex), contextBefore, contextAfter);
      // 3) tolerant by title
      if (out == null) out = replaceByTitleRegex(src, title, replacement, Number(matchIndex));
      if (out != null && out !== src) { newText = out; changed = true; return true; }
      return false;
    }
    if (fieldSel === 'html') {
      const src = String(props?.html || '');
      if (!src) return false;
      let out = null;
      // 1) index-based
      out = replaceAtIndex(src, Number(matchIndex), token, replacement);
      // 2) context-based
      if (out == null) out = replaceByContext(src, token, replacement, Number(matchIndex), contextBefore, contextAfter);
      // 3) tolerant by title
      if (out == null) out = replaceByTitleRegex(src, title, replacement, Number(matchIndex));
      if (out != null && out !== src) { newHtml = out; changed = true; return true; }
      return false;
    }
    return false;
  }

  // Primary: use provided field deterministically
  let tried = false;
  if (field === 'text' || field === 'html') {
    tried = true;
    await attempt(field);
  }

  // Fallbacks: try the other field and finally the old naive path
  if (!changed && field === 'text') { await attempt('html'); }
  if (!changed && field === 'html') { await attempt('text'); }

  if (!changed) {
    // Final naive attempt to keep previous behavior as a last resort
    let i = newText.indexOf(token);
    if (i >= 0) {
      newText = newText.slice(0, i) + replacement + newText.slice(i + token.length);
      changed = true;
    }
    try {
      const html = String(props?.html || '');
      if (!changed && html && html.includes(token)) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
        let tn, replaced = false;
        while ((tn = walker.nextNode())) {
          if (replaced) break;
          const s = tn.nodeValue || '';
          const j = s.indexOf(token);
          if (j >= 0) { tn.nodeValue = s.slice(0, j) + replacement + s.slice(j + token.length); replaced = true; }
        }
        newHtml = tmp.innerHTML;
        if (replaced) changed = true;
      }
    } catch {}
  }

  if (!changed) {
    const err = new Error('STALE_SCAN');
    err.code = 'STALE_SCAN';
    throw err;
  }
  const patch = { content: { ...(content || {}), text: newText } };
  if (newHtml != null) patch.props = { ...(props || {}), html: newHtml };
  await fetchJson(`/api/blocks/${encodeURIComponent(blockId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  appendCleanupLog({ ts: Date.now(), action: 'resolveToInternalPage', pageId, blockId, targetPageId, before: { text: content?.text || '', html: props?.html || '' }, after: { text: newText, html: newHtml != null ? newHtml : (props?.html || '') } });
}
