import { fetchJson } from '../lib/http.js';
import { mountSubsectionPicker } from '../features/subsectionPicker.js';
import { navigate } from '../lib/router.js';

// Tag Inspector — maintenance dashboard
export async function render(container, ctx = {}) {
  container.innerHTML = `
    <section>
      <h1>Tag Inspector</h1>
      <div id="tiSummary" class="summary-cards" style="display:flex; gap:10px; flex-wrap:wrap; margin: 8px 0;"></div>

      <div class="tool-tabs" style="margin: 8px 0; gap:8px; align-items:center;">
        <input id="tiFilter" placeholder="Filter tags…" style="flex:1; width: 260px; padding: 6px 8px;" />
        <select id="tiTypeFilter" style="padding:6px 8px;">
          <option value="">All types</option>
          <option value="npc">NPC</option>
          <option value="character">Character</option>
          <option value="location">Location</option>
          <option value="arc">Arc</option>
          <option value="note">Note</option>
          <option value="tool">Tool</option>
        </select>
        <div class="chips" style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="chip" data-filter="all">All</button>
          <button class="chip" data-filter="suspicious">Suspicious</button>
          <button class="chip" data-filter="usedOnce">Used once</button>
          <button class="chip" data-filter="unused">Unused</button>
          <button class="chip" data-filter="pagesWithoutTags">Pages without tags</button>
        </div>
        <select id="tiSort" style="padding:6px 8px; margin-left:auto;">
          <option value="most">Sort: Most used</option>
          <option value="least">Sort: Least used</option>
          <option value="alpha">Sort: A–Z</option>
        </select>
      </div>

      <div id="tiNoTags" class="meta" style="display:none;">No tags yet.</div>
      <div id="tiPagesNoTags" style="display:none;"></div>
      <div id="tiTable"></div>
    </section>
  `;

  // Mount Tools category picker under the title
  try {
    const h1 = container.querySelector('h1');
    if (h1) {
      let row = document.getElementById('tagsSubsectionPickerRow');
      if (!row) {
        row = document.createElement('div');
        row.id = 'tagsSubsectionPickerRow';
        row.className = 'meta';
        row.style.margin = '6px 0';
        h1.after(row);
      }
      row.innerHTML = '';
      mountSubsectionPicker({ hostEl: row, sectionKey: 'tools', itemId: 'tags', labelText: 'Category' });
    }
  } catch {}

  const summaryEl = document.getElementById('tiSummary');
  const tableEl = document.getElementById('tiTable');
  const noTagsEl = document.getElementById('tiNoTags');
  const pagesNoTagsEl = document.getElementById('tiPagesNoTags');
  const inputFilter = document.getElementById('tiFilter');
  const selectSort = document.getElementById('tiSort');
  const selectType = document.getElementById('tiTypeFilter');

  let summary = { totalTags: 0, pagesWithoutTagsCount: 0, suspiciousTagsCount: 0, unusedTagsCount: 0 };
  let rows = [];
  let activeChip = 'all';
  // Accordion state + cache
  let expandedTag = null; // key of expanded row
  const detailCache = new Map(); // key -> detail payload
  const detailLoading = new Set(); // keys currently loading

  async function load() {
    summary = await fetchJson('/api/tag-inspector/summary');
    const t = await fetchJson('/api/tag-inspector/tags');
    rows = Array.isArray(t.tags) ? t.tags : [];
    renderSummary();
    renderMain();
  }

  function renderSummary() {
    const cards = [
      { label: 'Total tags', value: summary.totalTags },
      { label: 'Pages without tags', value: summary.pagesWithoutTagsCount },
      { label: 'Unused tags', value: summary.unusedTagsCount },
      { label: 'Suspicious tags', value: summary.suspiciousTagsCount },
    ];
    summaryEl.innerHTML = cards.map(c => `
      <div class="hovercard" style="padding:8px 10px; min-width:150px;">
        <div style="font-size:12px; color: var(--muted);">${c.label}</div>
        <div style="font-size:22px;">${c.value}</div>
      </div>
    `).join('');
  }

  function applyFilters() {
    const q = (inputFilter.value || '').toLowerCase();
    const typeFilter = selectType.value || '';
    let list = rows.slice();
    if (q) list = list.filter(r => r.tag.toLowerCase().includes(q));
    if (activeChip === 'suspicious') list = list.filter(r => r.flags?.usedOnce || r.flags?.duplicatesStructure || r.flags?.nearDuplicateGroupKey || r.flags?.weirdFormat);
    if (activeChip === 'usedOnce') list = list.filter(r => r.usedOnPagesCount === 1);
    if (activeChip === 'unused') list = list.filter(r => r.usedOnPagesCount === 0);
    if (typeFilter) {
      // two extra chip variants via type filter: only / never
      const mode = selectType.dataset.mode || 'any';
      if (mode === 'only') list = list.filter(r => (r.byTypeCounts?.[typeFilter] || 0) > 0 && r.usedOnPagesCount === (r.byTypeCounts?.[typeFilter] || 0));
      else if (mode === 'never') list = list.filter(r => (r.byTypeCounts?.[typeFilter] || 0) === 0 && r.usedOnPagesCount > 0);
    }
    const sort = selectSort.value;
    if (sort === 'most') list.sort((a,b) => b.usedOnPagesCount - a.usedOnPagesCount || a.tag.localeCompare(b.tag));
    else if (sort === 'least') list.sort((a,b) => a.usedOnPagesCount - b.usedOnPagesCount || a.tag.localeCompare(b.tag));
    else if (sort === 'alpha') list.sort((a,b) => a.tag.localeCompare(b.tag));
    return list;
  }

  function flagIcons(r) {
    // Compact indicator only — no hover UI
    let count = 0;
    if (r.usedOnPagesCount === 1) count++;
    if (r.flags?.duplicatesStructure) count++;
    if (r.flags?.nearDuplicateGroupKey) count++;
    if (r.flags?.weirdFormat) count++;
    if (!count) return '';
    if (count === 1) return `<span class="ti-signal">⚠️</span>`;
    return `<span class="ti-signal">⚠️×${count}</span>`;
  }

  function computeSignalsFromRow(r) {
    const list = [];
    if (!r) return list;
    if (r.usedOnPagesCount === 1) list.push({ label: 'Used only once' });
    if (r.flags?.duplicatesStructure) list.push({ label: 'Probably redundant: duplicates structure (matches a page type)' });
    if (r.flags?.nearDuplicateGroupKey) list.push({ label: 'Possible typo / near-duplicate' });
    if (r.flags?.weirdFormat) list.push({ label: 'Weird formatting' });
    return list;
  }

  function renderMain() {
    const list = applyFilters();
    noTagsEl.style.display = rows.length ? 'none' : '';
    pagesNoTagsEl.style.display = activeChip === 'pagesWithoutTags' ? '' : 'none';
    tableEl.style.display = activeChip === 'pagesWithoutTags' ? 'none' : '';
    if (activeChip === 'pagesWithoutTags') {
      renderPagesWithoutTags();
      return;
    }
    tableEl.innerHTML = `
      <div class="meta" style="margin:6px 0;">${list.length} tags</div>
      <div class="table" role="table">
        <div class="table-row header" role="row" style="display:flex; gap:10px; padding:6px 0; border-bottom:1px solid var(--border); font-size:12px; color: var(--muted);">
          <div style="flex:2;">Tag</div>
          <div style="width:120px;">Used on pages</div>
          <div style="width:140px;">Signals</div>
        </div>
        ${list.map(r => `
          <div class="table-row" role="row" data-key="${r.key}" style="display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid var(--border);">
            <div class="table-cell" role="cell" style="flex:2; min-width:0;">
              <button class="linklike ti-toggle" data-key="${r.key}" title="Show details" style="text-align:left;">${r.tag}</button>
            </div>
            <div class="table-cell" role="cell" style="width:120px;">${r.usedOnPagesCount}</div>
            <div class="table-cell" role="cell" style="width:140px;">${flagIcons(r)}</div>
          </div>
          <div class="table-row ti-detail-row" role="row" data-detail-for="${r.key}" style="display:${expandedTag === r.key ? 'block' : 'none'}; padding: 0 0 10px 0; border-bottom:1px solid var(--border);">
            <div class="table-cell" role="cell" style="width:100%; grid-column: 1 / -1;">
              <div class="ti-details">${expandedTag === r.key ? `<div class="meta">Loading…</div>` : ''}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    // Step 0 diagnostics: verify detail rows exist after render
    try {
      console.debug('detail rows', tableEl.querySelectorAll('.ti-detail-row').length);
      const selKey = window.CSS && CSS.escape ? CSS.escape('npc') : 'npc';
      console.debug('detail row npc', !!tableEl.querySelector(`.ti-detail-row[data-detail-for="${selKey}"]`));
    } catch {}
    // Toggle accordion expansion
    tableEl.querySelectorAll('.ti-toggle').forEach(btn => btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleRow(btn.dataset.key);
    }));
    // If a row is expanded on render, load its details lazily
    if (expandedTag) {
      void ensureDetailLoaded(expandedTag);
    }
  }

  async function loadWhere(rowEl) {
    const key = rowEl.dataset.key;
    const whereEl = rowEl.querySelector('.ti-where');
    if (!whereEl) return;
    whereEl.style.display = '';
    whereEl.innerHTML = `<div class="meta">Loading…</div>`;
    try {
      const d = await fetchJson(`/api/tag-inspector/tag/${encodeURIComponent(key)}`);
      const list = Array.isArray(d.usages) ? d.usages : [];
      const top = list.slice(0, 8);
      whereEl.innerHTML = `
        <div class="meta">Where used (top ${top.length}${list.length > top.length ? ` of ${list.length}` : ''}):</div>
        <ul>
          ${top.map(u => {
            const href = u.pageSlug ? `/p/${encodeURIComponent(u.pageSlug)}` : `/page/${encodeURIComponent(u.pageId)}`;
            const t = u.pageType ? `<span class="meta" style=\"margin-left:6px;\">${u.pageType}</span>` : '';
            return `<li><a href="${href}" data-link>${u.pageTitle}</a> ${t}</li>`;
          }).join('')}
        </ul>
        ${list.length > top.length ? `<button class="chip ti-more" data-key="${key}">Show more…</button>` : ''}
      `;
      whereEl.querySelectorAll('[data-link]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); navigate(a.getAttribute('href')); }));
      whereEl.querySelector('.ti-more')?.addEventListener('click', () => openDetail(key));
    } catch (e) {
      whereEl.innerHTML = `<div class="meta">Failed to load.</div>`;
    }
  }

  async function renderPagesWithoutTags() {
    pagesNoTagsEl.innerHTML = `<div class="meta">Loading pages…</div>`;
    try {
      const d = await fetchJson('/api/tag-inspector/pages-without-tags');
      const list = Array.isArray(d.pages) ? d.pages : [];
      if (!list.length) {
        pagesNoTagsEl.innerHTML = `<div class="meta">All pages have tags. Nice!</div>`;
        return;
      }
      pagesNoTagsEl.innerHTML = `
        <h3 class="meta">Pages without tags (${list.length})</h3>
        <ul>
          ${list.map(p => {
            const href = p.slug ? `/p/${encodeURIComponent(p.slug)}` : `/page/${encodeURIComponent(p.id)}`;
            const t = p.type ? `<span class="meta" style="margin-left:6px;">${p.type}</span>` : '';
            return `<li><a href="${href}" data-link>${p.title}</a> ${t}</li>`;
          }).join('')}
        </ul>
      `;
      pagesNoTagsEl.querySelectorAll('[data-link]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); navigate(a.getAttribute('href')); }));
    } catch (e) {
      pagesNoTagsEl.innerHTML = `<div class="meta">Failed to load.</div>`;
    }
  }

  // Detail modal/actions
  function ensureModal() {
    let m = document.getElementById('tiDetailModal');
    if (m) return m;
    m = document.createElement('div');
    m.className = 'modal';
    m.id = 'tiDetailModal';
    m.style.display = 'none';
    m.innerHTML = `
      <div class="modal-inner" style="background: var(--panel); color: var(--text); max-width: 720px;">
        <div class="modal-header">
          <h2 class="tiDetailTitle">Tag</h2>
          <button class="btn tiClose" data-close>Close</button>
        </div>
        <div class="modal-body" style="overflow-y:auto; max-height:60vh;">
          <div class="tiDetailSummary" style="margin-bottom:8px;"></div>
          <div class="tiActions" style="display:flex; gap:8px; flex-wrap:wrap; margin: 10px 0;">
            <button class="btn" data-act="rename">Rename…</button>
            <button class="btn" data-act="merge">Merge…</button>
            <button class="btn" data-act="delete">Delete…</button>
          </div>
          <div class="tiDetailList"></div>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    m.querySelector('.tiClose')?.addEventListener('click', () => { m.style.display = 'none'; });
    return m;
  }

  async function openDetail(key) {
    try {
      const d = await fetchJson(`/api/tag-inspector/tag/${encodeURIComponent(key)}`);
      const m = ensureModal();
      m.querySelector('.tiDetailTitle').textContent = `#${d.tag}`;
      // Summary by type
      const byType = d.usageSummaryByType || {};
      const parts = Object.keys(byType).sort().map(t => `${byType[t]} ${t}${byType[t] === 1 ? '' : 's'}`);
      m.querySelector('.tiDetailSummary').innerHTML = `Used on ${d.usedOnPagesCount} pages${parts.length ? ` — ${parts.join(', ')}` : ''}`;
      const list = Array.isArray(d.usages) ? d.usages : [];
      m.querySelector('.tiDetailList').innerHTML = `
        <div class="meta">Where used (${list.length})</div>
        <ul>
          ${list.map(u => {
            const href = u.pageSlug ? `/p/${encodeURIComponent(u.pageSlug)}` : `/page/${encodeURIComponent(u.pageId)}`;
            const t = u.pageType ? `<span class="meta" style="margin-left:6px;">${u.pageType}</span>` : '';
            return `<li><a href="${href}" data-link>${u.pageTitle}</a> ${t}</li>`;
          }).join('')}
        </ul>
      `;
      m.querySelectorAll('[data-link]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); navigate(a.getAttribute('href')); }));
      // Actions
      const actionsEl = m.querySelector('.tiActions');
      actionsEl.querySelector('[data-act="rename"]').onclick = () => doRename(d.key, d.tag, d.usedOnPagesCount, list);
      actionsEl.querySelector('[data-act="merge"]').onclick = () => doMerge(d.key, d.tag, d.usedOnPagesCount, list);
      actionsEl.querySelector('[data-act="delete"]').onclick = () => doDelete(d.key, d.tag, d.usedOnPagesCount, list);
      m.style.display = '';
    } catch (e) {
      alert('Failed to load tag: ' + (e?.message || e));
    }
  }

  // Inline accordion detail helpers
  function renderDetailSkeleton() { return `<div class="meta">Loading…</div>`; }

  async function ensureDetailLoaded(key) {
    const selKey = window.CSS && CSS.escape ? CSS.escape(key) : key;
    const detailsRow = tableEl.querySelector(`.ti-detail-row[data-detail-for="${selKey}"]`);
    const detailsEl = detailsRow?.querySelector('.ti-details');
    if (!detailsEl) {
      console.warn('Tag Inspector: detail container not found for', key);
      if (detailsRow) detailsRow.innerHTML = `<div class="meta">Couldn't render details (UI bug).</div>`;
      return;
    }
    const rowInfo = rows.find(r => r.key === key);
    if (detailCache.has(key)) {
      const cached = detailCache.get(key);
      detailsEl.innerHTML = renderDetailContent(cached, rowInfo);
      bindDetailInteractions(detailsEl, key, cached);
      return;
    }
    if (detailLoading.has(key)) return;
    detailLoading.add(key);
    detailsEl.innerHTML = renderDetailSkeleton();
    try {
      const resp = await fetchJson(`/api/tag-inspector/tag/${encodeURIComponent(key)}`);
      const d = resp?.data ?? resp;
      detailCache.set(key, d);
      if (expandedTag === key) {
        detailsEl.innerHTML = renderDetailContent(d, rowInfo);
        bindDetailInteractions(detailsEl, key, d);
      }
    } catch (e) {
      detailsEl.innerHTML = `<div class="meta">Failed to load.</div>`;
    } finally {
      detailLoading.delete(key);
    }
  }

  function renderDetailContent(d, rowInfo) {
    const byType = d?.usageSummaryByType || {};
    const parts = Object.keys(byType).sort().map(t => `${byType[t]} ${t}${byType[t] === 1 ? '' : 's'}`);
    const list = Array.isArray(d?.usages) ? d.usages : [];
    const signals = computeSignalsFromRow(rowInfo);
    return `
      <div class="card ti-detail-card">
        <div class="meta">Used on ${d.usedOnPagesCount} pages${parts.length ? ` — ${parts.join(', ')}` : ''}</div>
        ${signals.length ? `
          <div class="meta" style="margin-top:6px;">Signals</div>
          <ul class="tiSignalsList" style="margin: 6px 0 8px 18px;">
            ${signals.map(s => `<li>⚠️ ${s.label}</li>`).join('')}
          </ul>
        ` : ''}
        <div class="tiActions" style="display:flex; gap:8px; flex-wrap:wrap; margin: 8px 0;">
          <button class="btn tiRename">Rename…</button>
          <button class="btn tiMerge">Merge…</button>
          <button class="btn tiDelete">Delete…</button>
        </div>
        <div class="meta">Where used (${list.length})</div>
        <ul>
          ${list.map(u => {
            const href = u.pageSlug ? `/p/${encodeURIComponent(u.pageSlug)}` : `/page/${encodeURIComponent(u.pageId)}`;
            const t = u.pageType ? `<span class="meta" style="margin-left:6px;">${u.pageType}</span>` : '';
            return `<li><a href="${href}" data-link>${u.pageTitle}</a> ${t}</li>`;
          }).join('')}
        </ul>
      </div>
    `;
  }

  function bindDetailInteractions(detailsEl, key, d) {
    detailsEl.querySelectorAll('a[data-link], .btn').forEach(el => {
      el.addEventListener('click', (e) => e.stopPropagation());
    });
    detailsEl.querySelectorAll('[data-link]').forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigate(a.getAttribute('href'));
    }));
    detailsEl.querySelector('.tiRename')?.addEventListener('click', () => doRename(key, d.tag, d.usedOnPagesCount, d.usages));
    detailsEl.querySelector('.tiMerge')?.addEventListener('click', () => doMerge(key, d.tag, d.usedOnPagesCount, d.usages));
    detailsEl.querySelector('.tiDelete')?.addEventListener('click', () => doDelete(key, d.tag, d.usedOnPagesCount, d.usages));
  }

  function toggleRow(key) {
    expandedTag = (expandedTag === key) ? null : key;
    renderMain();
    if (expandedTag) {
      void ensureDetailLoaded(expandedTag);
    }
  }

  function impactPreviewHtml(count, examples) {
    const ex = (examples || []).slice(0, 5);
    return `<div class="hovercard" style="padding:8px;">
      <div>Will update ${count} pages</div>
      ${ex.length ? `<div class="meta" style="margin-top:6px;">Examples: ${ex.map(e => e.pageTitle).join(', ')}</div>` : ''}
    </div>`;
  }

  async function doRename(key, label, count, examples) {
    const to = prompt(`Rename #${label} →`, label);
    if (!to) return;
    if (!confirm(`Rename #${label} → #${to}?\n\n${stripHtml(impactPreviewHtml(count, examples))}`)) return;
    try {
      await fetchJson('/api/tag-inspector/rename', { method: 'POST', body: JSON.stringify({ from: key, to }) });
      // refresh list and caches
      detailCache.clear();
      expandedTag = null;
      await load();
    } catch (e) { alert('Rename failed: ' + (e?.message || e)); }
  }

  async function doMerge(key, label, count, examples) {
    const to = prompt(`Merge #${label} into →`, label);
    if (!to) return;
    if (!confirm(`Merge #${label} → #${to} (this will remove #${label}).\n\n${stripHtml(impactPreviewHtml(count, examples))}`)) return;
    try {
      await fetchJson('/api/tag-inspector/merge', { method: 'POST', body: JSON.stringify({ from: key, to }) });
      detailCache.clear();
      expandedTag = null;
      await load();
    } catch (e) { alert('Merge failed: ' + (e?.message || e)); }
  }

  async function doDelete(key, label, count, examples) {
    if (!confirm(`Delete #${label} everywhere (cannot be undone).\n\n${stripHtml(impactPreviewHtml(count, examples))}`)) return;
    try {
      await fetchJson('/api/tag-inspector/delete', { method: 'POST', body: JSON.stringify({ tag: key }) });
      detailCache.clear();
      expandedTag = null;
      await load();
    } catch (e) { alert('Delete failed: ' + (e?.message || e)); }
  }

  function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || '').trim();
  }

  // Wire filter chips
  container.querySelectorAll('button.chip[data-filter]')?.forEach(btn => {
    btn.addEventListener('click', async () => {
      const v = btn.getAttribute('data-filter');
      activeChip = v;
      // Reset type mode
      if (v === 'all' || v === 'suspicious' || v === 'usedOnce' || v === 'unused') {
        selectType.dataset.mode = 'any';
      }
      if (v === 'pagesWithoutTags') {
        selectType.value = '';
      }
      expandedTag = null;
      renderMain();
    });
  });

  // Type-only or never toggles via alt-click on type select label
  selectType.addEventListener('change', () => { expandedTag = null; renderMain(); });
  selectSort.addEventListener('change', () => { /* keep open OK */ renderMain(); });
  inputFilter.addEventListener('input', () => { expandedTag = null; renderMain(); });

  // Add small inline toggles for type-only / never
  const typeWrap = selectType.parentElement;
  if (typeWrap) {
    const only = document.createElement('button');
    only.className = 'chip'; only.textContent = 'Only'; only.title = 'Used on [Type] only';
    only.style.marginLeft = '6px';
    only.addEventListener('click', () => { selectType.dataset.mode = 'only'; renderMain(); });
    const never = document.createElement('button');
    never.className = 'chip'; never.textContent = 'Never'; never.title = 'Never used on [Type]';
    never.addEventListener('click', () => { selectType.dataset.mode = 'never'; renderMain(); });
    typeWrap.appendChild(only); typeWrap.appendChild(never);
  }

  // Support deep-linking via ?tag=<name> to auto-expand
  const usp = new URLSearchParams(window.location.search || '');
  const initialTag = usp.get('tag');
  await load();
  if (initialTag) {
    // initialTag may be display; normalize and expand inline
    const k = (rows.find(r => r.tag.toLowerCase() === String(initialTag || '').toLowerCase()) || rows.find(r => r.key === String(initialTag || '').toLowerCase()))?.key;
    if (k) { expandedTag = k; renderMain(); if (expandedTag) void ensureDetailLoaded(expandedTag); }
  }
}
