import { navigate } from '../lib/router.js';
import { fetchJson } from '../lib/http.js';
import { parseMaybeJson } from '../blocks/tree.js';
import { apiPatchBlock } from '../blocks/api.js';
import { getCurrentPageBlocks, updateCurrentBlocks } from '../lib/pageStore.js';
import { refreshNav } from './nav.js';
import { openModal, closeModal } from './modals.js';
import { renderBlocksReadOnly } from '../blocks/readOnly.js';

// Inline rendering helpers: escape via text nodes; then add wiki links, hashtags, bold/italic.
// Avoid formatting inside inline code spans delimited by backticks.
export function buildWikiTextNodes(text, blockIdForLegacyReplace = null) {
  const frag = document.createDocumentFragment();
  const re = /\[\[(?:page:([0-9a-fA-F-]{36})\|([^\]]*?)|([^\]]+))\]\]/g; // [[page:<uuid>|Label]] or [[Title]]
  let lastIndex = 0;
  let m;

  const appendFormatted = (s) => {
    if (!s) return;
    // Split by inline code spans and avoid formatting inside those
    const parts = s.split(/(`[^`]*`)/g);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('`') && part.endsWith('`')) {
        // keep as-is
        frag.appendChild(document.createTextNode(part));
      } else {
        appendExternalLinksThenStyle(part, frag);
      }
    }
  };

  while ((m = re.exec(text)) !== null) {
    const before = text.slice(lastIndex, m.index);
    if (before) appendFormatted(before);
    const [full, idPart, labelPart, legacyTitle] = m;
    if (idPart) {
      const id = idPart;
      const label = (labelPart || '').trim();
      const a = document.createElement('a');
      a.href = `/page/${encodeURIComponent(id)}`;
      a.setAttribute('data-link', '');
      a.className = 'wikilink idlink';
      a.setAttribute('data-wiki', 'id');
      a.setAttribute('data-page-id', id);
      a.textContent = label || id;
      frag.appendChild(a);
    } else {
      const title = (legacyTitle || '').trim();
      const token = m[0];
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'wikilink legacy';
      a.setAttribute('data-wiki', 'title');
      a.setAttribute('data-wiki-title', title);
      if (blockIdForLegacyReplace) a.setAttribute('data-src-block', blockIdForLegacyReplace);
      a.setAttribute('data-token', token);
      a.textContent = title;
      frag.appendChild(a);
    }
    lastIndex = re.lastIndex;
  }
  const rest = text.slice(lastIndex);
  if (rest) appendFormatted(rest);
  return frag;
}

function appendExternalLinksThenStyle(text, outFrag) {
  if (!text) return;
  // Recognize markdown links [label](url) where url is http(s) or mailto
  // and bare links: http(s)://... or mailto:...
  const re = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\))|((https?:\/\/[^\s]+)|(mailto:[^\s]+))/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before) appendBoldItalicAndHashtags(before, outFrag);
    let label = '';
    let url = '';
    const isMarkdown = !!m[1];
    if (isMarkdown) {
      label = m[2] || '';
      url = m[3] || '';
    } else {
      url = (m[5] || m[6] || '').trim();
      // Trim common trailing punctuation for bare URLs
      while (/[\]\),.!?:]$/.test(url)) url = url.slice(0, -1);
      label = url;
    }
    const a = document.createElement('a');
    a.className = 'extlink';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    outFrag.appendChild(a);
    last = re.lastIndex;
  }
  const rest = text.slice(last);
  if (rest) appendBoldItalicAndHashtags(rest, outFrag);
}

function appendBoldItalicAndHashtags(text, outFrag) {
  // First split by bold markers
  const boldParts = text.split('**');
  for (let i = 0; i < boldParts.length; i++) {
    const part = boldParts[i];
    if (i % 2 === 1) {
      // inside bold
      const strong = document.createElement('strong');
      appendItalicAndHashtags(part, strong);
      outFrag.appendChild(strong);
    } else {
      appendItalicAndHashtags(part, outFrag);
    }
  }
}

function appendItalicAndHashtags(text, target) {
  // Split by single * (avoid consuming bold which we've already split out)
  const parts = text.split('*');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      const em = document.createElement('em');
      appendHashtags(part, em);
      if (target instanceof DocumentFragment || target instanceof Node && target.nodeType === Node.DOCUMENT_FRAGMENT_NODE) target.appendChild(em);
      else if (target.appendChild) target.appendChild(em);
    } else {
      appendHashtags(part, target);
    }
  }
}

function appendHashtags(text, target) {
  if (!text) return;
  const re = /(^|[^\w])#([A-Za-z0-9][\w-]*)/g; // preceding boundary + #tag
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before) target.appendChild(document.createTextNode(before));
    const boundary = m[1] || '';
    if (boundary) target.appendChild(document.createTextNode(boundary));
    const tag = m[2];
    // At this stage, we only receive plain text (URLs already extracted into <a>),
    // so safe to always linkify hashtags here.
    const a = document.createElement('a');
    a.className = 'hashtag';
    a.href = `/tags?tag=${encodeURIComponent(tag)}`;
    a.setAttribute('data-link', '');
    a.textContent = `#${tag}`;
    target.appendChild(a);
    last = re.lastIndex;
  }
  const rest = text.slice(last);
  if (rest) target.appendChild(document.createTextNode(rest));
}

export async function resolveLegacyAndUpgrade(title, blockId, tokenString) {
  try {
    const res = await fetchJson('/api/pages/resolve', { method: 'POST', body: JSON.stringify({ title, type: 'note' }) });
    const page = res.page || res;
    const id = page.id;
    const slug = page.slug;
    if (blockId) {
      const blk = getCurrentPageBlocks().find(b => b.id === blockId);
      const content = parseMaybeJson(blk?.contentJson);
      const text = String(content?.text || '');
      const idx = text.indexOf(tokenString);
      let newText = text;
      if (idx >= 0) {
        const upgraded = `[[page:${id}|${title}]]`;
        newText = text.slice(0, idx) + upgraded + text.slice(idx + tokenString.length);
      }
      await apiPatchBlock(blockId, { content: { ...(content || {}), text: newText } });
      updateCurrentBlocks(b => b.id === blockId ? { ...b, contentJson: JSON.stringify({ ...(content || {}), text: newText }) } : b);
    }
    await refreshNav();
    const href = slug ? `/p/${encodeURIComponent(slug)}` : `/page/${encodeURIComponent(id)}`;
    navigate(href);
  } catch (e) {
    console.error('legacy link resolve failed', e);
    alert('Failed to resolve link: ' + (e?.message || e));
  }
}

function normalizeLabel(s) {
  try {
    return String(s || '')
      .toLowerCase()
      .trim()
      .replace(/[\.;:!?’"()\[\]{}]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/\s+/g, ' ');
  } catch { return String(s || '').toLowerCase().trim(); }
}

async function linkWikilinkToExisting({ title, blockId, token, page }) {
  try {
    const id = page.id;
    if (blockId) {
      const blk = getCurrentPageBlocks().find(b => b.id === blockId);
      const content = parseMaybeJson(blk?.contentJson);
      const text = String(content?.text || '');
      const idx = text.indexOf(token);
      let newText = text;
      if (idx >= 0) {
        const upgraded = `[[page:${id}|${title}]]`;
        newText = text.slice(0, idx) + upgraded + text.slice(idx + token.length);
      }
      await apiPatchBlock(blockId, { content: { ...(content || {}), text: newText } });
      updateCurrentBlocks(b => b.id === blockId ? { ...b, contentJson: JSON.stringify({ ...(content || {}), text: newText }) } : b);
    }
    // Re-render to reflect link resolution; don't navigate automatically
    rerenderReadOnly();
  } catch (e) {
    console.error('Failed to link wikilink to existing page', e);
    alert('Failed to link: ' + (e?.message || e));
  }
}

export function installWikiLinkHandler() {
  document.addEventListener('click', (e) => {
    const a = e.target?.closest?.('a[data-wiki]');
    if (!a) return;
    const kind = a.getAttribute('data-wiki');
    if (kind === 'title') {
      e.preventDefault();
      e.stopPropagation();
      const title = a.getAttribute('data-wiki-title') || '';
      const blockId = a.getAttribute('data-src-block') || '';
      const token = a.getAttribute('data-token') || `[[${title}]]`;
      openWikilinkModal({ title, blockId, token });
    }
  });
}

function findBlocksRoot() {
  return document.getElementById('pageBlocks');
}

function rerenderReadOnly() {
  const root = findBlocksRoot();
  if (!root) return;
  try {
    const blocks = getCurrentPageBlocks();
    renderBlocksReadOnly(root, blocks);
  } catch {}
}

async function revertWikilinkToPlain({ blockId, token, title }) {
  try {
    const blk = getCurrentPageBlocks().find(b => b.id === blockId);
    const content = parseMaybeJson(blk?.contentJson);
    const text = String(content?.text || '');
    const idx = text.indexOf(token);
    let newText = text;
    if (idx >= 0) {
      newText = text.slice(0, idx) + title + text.slice(idx + token.length);
    }
    await apiPatchBlock(blockId, { content: { ...(content || {}), text: newText } });
    updateCurrentBlocks(b => b.id === blockId ? { ...b, contentJson: JSON.stringify({ ...(content || {}), text: newText }) } : b);
    rerenderReadOnly();
  } catch (e) {
    console.error('Failed to revert wikilink', e);
    alert('Failed to revert wikilink: ' + (e?.message || e));
  }
}

async function createPageForWikilink({ title, blockId, token, type }) {
  try {
    const page = await fetchJson('/api/pages', { method: 'POST', body: JSON.stringify({ title, type }) });
    const id = page.id;
    if (blockId) {
      // Keep user-friendly token in editor: [[Title]] (no id)
      const blk = getCurrentPageBlocks().find(b => b.id === blockId);
      const content = parseMaybeJson(blk?.contentJson);
      const text = String(content?.text || '');
      const idx = text.indexOf(token);
      let newText = text;
      if (idx >= 0) {
        const friendly = `[[${title}]]`;
        newText = text.slice(0, idx) + friendly + text.slice(idx + token.length);
      }
      await apiPatchBlock(blockId, { content: { ...(content || {}), text: newText } });
      updateCurrentBlocks(b => b.id === blockId ? { ...b, contentJson: JSON.stringify({ ...(content || {}), text: newText }) } : b);
    }
    // Optionally apply bulk resolution if requested via modal controls
    try {
      const modal = document.getElementById('wikilinkCreateModal');
      if (modal) await applyBulkIfRequested({ label: title, targetPageId: id, modal });
    } catch {}
    await refreshNav();
    navigate(`/page/${encodeURIComponent(id)}`);
  } catch (e) {
    console.error('Failed to create page for wikilink', e);
    alert('Failed to create page: ' + (e?.message || e));
  }
}

function openWikilinkModal({ title, blockId, token }) {
  const modal = document.getElementById('wikilinkCreateModal');
  if (!modal) {
    // Fallback: keep existing behavior if modal not present
    void resolveLegacyAndUpgrade(title, blockId, token);
    return;
  }
  modal.setAttribute('data-wikilink-title', title);
  modal.setAttribute('data-wikilink-block', blockId || '');
  modal.setAttribute('data-wikilink-token', token || `[[${title}]]`);
  const label = modal.querySelector('.wikilink-title-label');
  if (label) label.textContent = title;
  // set default type to note
  const sel = modal.querySelector('select[name="wikiCreateType"]');
  if (sel) sel.value = sel.value || 'note';
  const btnCreate = modal.querySelector('.wiki-create .modal-confirm');
  const btnCancel = modal.querySelector('.wiki-create .modal-cancel');
  if (btnCreate) {
    btnCreate.onclick = async () => {
      const type = sel?.value || 'note';
      closeModal('wikilinkCreateModal');
      await createPageForWikilink({ title, blockId, token, type });
    };
  }
  if (btnCancel) {
    btnCancel.onclick = async () => {
      closeModal('wikilinkCreateModal');
      await revertWikilinkToPlain({ title, blockId, token });
    };
  }

  // Resolve section
  const input = modal.querySelector('input[name="wikiResolveQuery"]');
  const resultsEl = modal.querySelector('.wikiResolveResults');
  const autoEl = modal.querySelector('.wikiResolveAuto');
  const linkBtn = modal.querySelector('.wikiResolveConfirm');
  // Apply controls
  setupApplyControls({ modal, label: title });
  let selected = null; // { id, title, slug, type }
  const setSelected = (item) => {
    selected = item;
    // update selection UI
    resultsEl?.querySelectorAll('.result').forEach(n => n.classList.remove('is-selected'));
    if (item && resultsEl) {
      const node = resultsEl.querySelector(`.result[data-id="${CSS.escape(item.id)}"]`);
      if (node) node.classList.add('is-selected');
    }
    if (linkBtn) linkBtn.disabled = !selected;
  };

  const renderResults = (arr, qNorm) => {
    if (!resultsEl) return;
    resultsEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const r of arr) {
      const div = document.createElement('div');
      div.className = 'result';
      div.setAttribute('data-id', r.id);
      div.style.padding = '6px 8px';
      div.style.borderRadius = '6px';
      div.style.cursor = 'pointer';
      div.innerHTML = `<div style="font-weight:700;">${r.title}</div>
        <div style="font-size:12px; color: var(--muted);">${r.type || 'page'}${r.slug ? ` • ${r.slug}` : ''}</div>`;
      div.addEventListener('click', () => setSelected(r));
      div.addEventListener('dblclick', async () => {
        await linkWikilinkToExisting({ title, blockId, token, page: r });
        await applyBulkIfRequested({ label: title, targetPageId: r.id, modal });
        closeModal('wikilinkCreateModal');
      });
      div.addEventListener('mouseenter', () => { resultsEl.querySelectorAll('.result').forEach(n => n.classList.remove('hover')); div.classList.add('hover'); });
      div.addEventListener('mouseleave', () => div.classList.remove('hover'));
      frag.appendChild(div);
    }
    resultsEl.appendChild(frag);
    // Auto-suggest exact match
    if (autoEl) {
      const exact = arr.filter(r => normalizeLabel(r.title) === qNorm);
      if (exact.length === 1) {
        const r = exact[0];
        autoEl.style.display = '';
        autoEl.innerHTML = `<button type="button" class="chip" data-id="${r.id}">Link to \u201C${r.title}\u201D</button>`;
        autoEl.querySelector('button')?.addEventListener('click', async () => {
          await linkWikilinkToExisting({ title, blockId, token, page: r });
          await applyBulkIfRequested({ label: title, targetPageId: r.id, modal });
          closeModal('wikilinkCreateModal');
        });
        // Prefer existing when exact match found
        setSelected(r);
      } else {
        autoEl.style.display = 'none';
        autoEl.innerHTML = '';
      }
    }
  };

  let lastQ = '';
  let tmr = null;
  const doSearch = async (q) => {
    const qTrim = String(q || '').trim();
    lastQ = qTrim;
    if (!qTrim) { renderResults([], ''); setSelected(null); return; }
    try {
      const res = await fetchJson(`/api/search?q=${encodeURIComponent(qTrim)}`);
      const arr = Array.isArray(res?.results) ? res.results : [];
      // prioritize title matches first
      const qNorm = normalizeLabel(qTrim);
      const sorted = arr.slice().sort((a, b) => {
        const an = normalizeLabel(a.title);
        const bn = normalizeLabel(b.title);
        const ae = an === qNorm ? 0 : 1;
        const be = bn === qNorm ? 0 : 1;
        if (ae !== be) return ae - be;
        return (a.title || '').localeCompare(b.title || '');
      }).slice(0, 20);
      renderResults(sorted, qNorm);
    } catch {
      renderResults([], '');
    }
  };

  if (input) {
    input.value = title || '';
    input.oninput = () => {
      const v = input.value;
      if (tmr) clearTimeout(tmr);
      tmr = setTimeout(() => doSearch(v), 160);
    };
  }
  if (linkBtn) {
    linkBtn.onclick = async () => {
      if (!selected) return;
      await linkWikilinkToExisting({ title, blockId, token, page: selected });
      await applyBulkIfRequested({ label: title, targetPageId: selected.id, modal });
      closeModal('wikilinkCreateModal');
    };
  }

  openModal('wikilinkCreateModal');
  // Kick off initial search
  setTimeout(() => doSearch(title || ''), 0);
}

function currentPageIdFromBlocks() {
  try { return getCurrentPageBlocks()[0]?.pageId || null; } catch { return null; }
}

function setupApplyControls({ modal, label }) {
  const applyPageCb = modal.querySelector('input[name="wikiApplyPage"]');
  const applyGlobalCb = modal.querySelector('input[name="wikiApplyGlobal"]');
  const applyStatus = modal.querySelector('.wikiApplyGlobalStatus');
  const applyReview = modal.querySelector('.wikiApplyReview');
  const applyToggle = modal.querySelector('.wikiApplyToggle');
  const applyList = modal.querySelector('.wikiApplyList');
  if (applyStatus) { applyStatus.textContent = 'checking…'; }

  const updateReviewVisibility = () => {
    if (!applyReview) return;
    applyReview.style.display = applyGlobalCb?.checked ? '' : 'none';
    if (!applyGlobalCb?.checked && applyList) applyList.style.display = 'none';
  };
  applyGlobalCb?.addEventListener('change', updateReviewVisibility);
  updateReviewVisibility();

  applyToggle?.addEventListener('click', () => {
    if (!applyList) return;
    applyList.style.display = (applyList.style.display === 'none' || !applyList.style.display) ? '' : 'none';
  });

  // Fetch occurrences to populate counts and review list
  fetchJson(`/api/wikilinks/occurrences?label=${encodeURIComponent(label)}&limit=100`).then((arr) => {
    const results = Array.isArray(arr) ? arr : [];
    const n = results.length;
    if (applyStatus) applyStatus.textContent = `Found in ${n} page${n === 1 ? '' : 's'}`;
    if (applyList) {
      applyList.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (const r of results) {
        const row = document.createElement('label');
        row.style.display = 'block';
        row.style.padding = '4px 2px';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.setAttribute('data-page-id', r.pageId);
        const text = document.createElement('span');
        text.textContent = ` ${r.title}`;
        const meta = document.createElement('span');
        meta.style.color = 'var(--muted)';
        meta.style.fontSize = '12px';
        meta.textContent = r.slug ? ` • ${r.slug}` : '';
        row.appendChild(cb);
        row.appendChild(text);
        if (r.slug) row.appendChild(meta);
        frag.appendChild(row);
      }
      applyList.appendChild(frag);
    }
  }).catch(() => { if (applyStatus) applyStatus.textContent = 'unavailable'; });
}

async function applyBulkIfRequested({ label, targetPageId, modal }) {
  try {
    const applyPageCb = modal.querySelector('input[name="wikiApplyPage"]');
    const applyGlobalCb = modal.querySelector('input[name="wikiApplyGlobal"]');
    const applyList = modal.querySelector('.wikiApplyList');
    if (!(applyPageCb?.checked || applyGlobalCb?.checked)) return;

    const pageId = currentPageIdFromBlocks();
    let summary = null;

    if (applyGlobalCb?.checked) {
      const ids = Array.from(applyList?.querySelectorAll('input[type="checkbox"][data-page-id]') || [])
        .filter(el => el.checked)
        .map(el => el.getAttribute('data-page-id'))
        .filter(Boolean);
      if (ids.length) {
        summary = await fetchJson('/api/wikilinks/resolve', {
          method: 'POST',
          body: JSON.stringify({ label, targetPageId, scope: 'global', pageIds: ids, replaceMode: 'unresolvedOnly' })
        });
      }
    } else if (applyPageCb?.checked && pageId) {
      summary = await fetchJson('/api/wikilinks/resolve', {
        method: 'POST',
        body: JSON.stringify({ label, targetPageId, scope: 'page', pageId, replaceMode: 'unresolvedOnly' })
      });
    }

    if (summary && typeof summary.updatedPages === 'number') {
      alert(`Updated ${summary.updatedPages} page${summary.updatedPages === 1 ? '' : 's'}`);
    }

    if (pageId) {
      const { refreshBlocksFromServer } = await import('../blocks/edit/apiBridge.js');
      await refreshBlocksFromServer(pageId);
      rerenderReadOnly();
    }
  } catch (e) {
    console.error('Bulk resolve failed', e);
    alert('Bulk resolve failed: ' + (e?.message || e));
  }
}
