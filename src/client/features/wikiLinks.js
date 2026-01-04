import { navigate } from '../lib/router.js';
import { fetchJson } from '../lib/http.js';
import { canonicalHrefForPageId, canonicalPageHref } from '../lib/pageUrl.js';
import { parseMaybeJson } from '../blocks/tree.js';
import { apiPatchBlock } from '../blocks/api.js';
import { getCurrentPageBlocks, updateCurrentBlocks } from '../lib/pageStore.js';
import { refreshNav } from './nav.js';
import { openModal, closeModal } from './modals.js';
import { renderBlocksReadOnly } from '../blocks/readOnly.js';
import { stableRender, refreshBlocksFromServer } from '../blocks/edit/index.js';
import { debouncePatch } from '../blocks/edit/state.js';

// Reset shared wikilink modal to default state each time it opens
function resetWikilinkModal(modal) {
  if (!modal) return;
  // Reset mode and transient data
  modal.dataset.mode = 'wikilink';
  delete modal.dataset.linkifyTerm;
  delete modal.dataset.linkifyPages;

  // Unhide sections possibly hidden by linkify mode
  try { modal.querySelector('.wiki-apply')?.style.setProperty('display', ''); } catch {}
  try { modal.querySelector('.wiki-create')?.style.setProperty('display', ''); } catch {}

  // Re-enable confirm buttons
  const btn = modal.querySelector('[data-action="link"]')
    || modal.querySelector('#wikilinkLinkBtn')
    || modal.querySelector('#wikiConfirm')
    || modal.querySelector('.wikiResolveConfirm');
  if (btn) btn.disabled = false;

  // Restore default header if changed
  const h2 = modal.querySelector('h2');
  if (h2 && h2.textContent === 'Linkify Term') h2.textContent = 'Resolve Wikilink';
}

// Inline rendering helpers: escape via text nodes; then add wiki links, hashtags, bold/italic.
// Avoid formatting inside inline code spans delimited by backticks.
export function buildWikiTextNodes(text, blockIdForLegacyReplace = null) {
  // First, split on inline quote tokens so inner content can be fully parsed
  const frag = document.createDocumentFragment();
  const reQ = /\{\{q:\s*([\s\S]*?)\}\}/g;
  let lastQ = 0;
  let mq;
  while ((mq = reQ.exec(String(text || ''))) !== null) {
    const before = String(text || '').slice(lastQ, mq.index);
    if (before) frag.appendChild(buildWikiTextNodesCore(before, blockIdForLegacyReplace));
    const inner = mq[1] || '';
    const span = document.createElement('span');
    span.className = 'inline-quote';
    span.appendChild(buildWikiTextNodesCore(inner, blockIdForLegacyReplace));
    frag.appendChild(span);
    lastQ = reQ.lastIndex;
  }
  const restQ = String(text || '').slice(lastQ);
  if (restQ) frag.appendChild(buildWikiTextNodesCore(restQ, blockIdForLegacyReplace));
  return frag;
}

function buildWikiTextNodesCore(text, blockIdForLegacyReplace = null) {
  const frag = document.createDocumentFragment();
  // Supported tokens:
  // - [[o5e:<type>:<slug>|Label]] (type: spell, creature, condition, item, weapon, armor)
  // - [[page:<uuid>|Label]]
  // - [[cmt:<uuid>|Label]] (inline comment; comment text stored in block props.comments[uuid])
  // - [[Title]] (legacy unresolved)
  const re = /\[\[(?:o5e:([a-z]+):([a-z0-9-]+)\|([^\]]*?)|page:([0-9a-fA-F-]{36})\|([^\]]*?)|cmt:([0-9a-fA-F-]{36})\|([^\]]*?)|([^\]]+))\]\]/gi;
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
    const [full, o5eType, o5eSlug, o5eLabel, idPart, labelPart, cmtId, cmtLabel, legacyTitle] = m;
    if (o5eSlug) {
      const t = String(o5eType || 'spell').toLowerCase();
      const slug = (o5eSlug || '').trim();
      const label = (o5eLabel || '').trim() || slug;
      const span = document.createElement('span');
      span.className = `o5e-link o5e-${t}`;
      span.setAttribute('data-o5e-type', t);
      span.setAttribute('data-o5e-slug', slug);
      span.textContent = label;
      frag.appendChild(span);
    } else if (idPart) {
      const id = idPart;
      const label = (labelPart || '').trim();
      const a = document.createElement('a');
      // Temporary safe href until canonical slug is loaded; avoids exposing UUID on hover
      a.href = '#';
      a.setAttribute('data-link', '');
      a.className = 'wikilink idlink';
      a.setAttribute('data-wiki', 'id');
      a.setAttribute('data-page-id', id);
      a.textContent = label || id;
      // Resolve canonical href asynchronously for hover/copy friendliness
      (async () => {
        try {
          window.__pageMetaCache = window.__pageMetaCache || new Map();
          const href = await canonicalHrefForPageId(id, fetchJson, window.__pageMetaCache);
          a.href = href;
        } catch {
          // Fallback to legacy path if lookup fails
          a.href = `/page/${encodeURIComponent(id)}`;
        }
      })().catch(() => {});
      // Canonicalize navigation to slug on click
      a.addEventListener('click', async (ev) => {
        try { ev.preventDefault(); ev.stopPropagation(); } catch {}
        try {
          window.__pageMetaCache = window.__pageMetaCache || new Map();
          const href = await canonicalHrefForPageId(id, fetchJson, window.__pageMetaCache);
          navigate(href);
        } catch {
          const href = a.getAttribute('href') || `/page/${encodeURIComponent(id)}`;
          navigate(href);
        }
      });
      frag.appendChild(a);
    } else if (cmtId) {
      const id = (cmtId || '').trim();
      const label = (cmtLabel || '').trim();
      const span = document.createElement('span');
      span.className = 'inline-comment';
      span.setAttribute('data-comment-id', id);
      // Lookup comment text from current blocks' props.comments map
      try {
        const blocks = getCurrentPageBlocks?.() || [];
        const bid = String(blockIdForLegacyReplace || '');
        const blk = bid ? blocks.find(b => String(b.id) === bid) : null;
        const props = parseMaybeJson?.(blk?.propsJson) || {};
        const map = props?.comments || {};
        const c = map && (map[id] || map[String(id)]) || '';
        if (c) span.setAttribute('data-comment', String(c));
      } catch {}
      span.textContent = label || '';
      frag.appendChild(span);
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
      // Optimistic update + async save
      updateCurrentBlocks(b => b.id === blockId ? { ...b, contentJson: JSON.stringify({ ...(content || {}), text: newText }) } : b);
      try { debouncePatch(blockId, { content: { text: newText } }, 0); } catch { void apiPatchBlock(blockId, { content: { ...(content || {}), text: newText } }).catch(() => {}); }
      try { await rerenderBlocksNow(blockId || null); } catch {}
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

export async function linkWikilinkToExisting({ title, blockId, token, page }) {
  try {
    const id = page.id;
    if (blockId) {
      const blk = getCurrentPageBlocks().find(b => b.id === blockId);
      const content = parseMaybeJson(blk?.contentJson);
      const props = parseMaybeJson(blk?.propsJson);
      const text = String(content?.text || '');
      const upgraded = `[[page:${id}|${title}]]`;
      const idx = text.indexOf(token);
      let newText = text;
      if (idx >= 0) {
        newText = text.slice(0, idx) + upgraded + text.slice(idx + token.length);
      }
      // Also update props.html if it contains the token
      let newHtml = null;
      try {
        const html = String(props?.html || '');
        if (html && html.includes(token)) {
          const tmp = document.createElement('div');
          tmp.innerHTML = html;
          const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
          let tn;
          let replaced = false;
          while ((tn = walker.nextNode())) {
            if (replaced) break;
            const s = tn.nodeValue || '';
            const j = s.indexOf(token);
            if (j >= 0) {
              tn.nodeValue = s.slice(0, j) + upgraded + s.slice(j + token.length);
              replaced = true;
            }
          }
          // sanitize using existing read-only sanitizer contract indirectly by allowing readOnly to sanitize
          newHtml = tmp.innerHTML;
        }
      } catch {}
      // Optimistically update model and re-render immediately
      updateCurrentBlocks(b => b.id === blockId
        ? { ...b,
            contentJson: JSON.stringify({ ...(content || {}), text: newText }),
            ...(newHtml != null ? { propsJson: JSON.stringify({ ...(props || {}), html: newHtml }) } : {})
          }
        : b);
      try {
        const root = document.getElementById('pageBlocks');
        const editing = document?.body?.dataset?.mode === 'edit';
        const pageId = document?.body?.dataset?.activePageId || null;
        if (root && editing && pageId) {
          const pageObj = { id: pageId };
          stableRender(root, pageObj, getCurrentPageBlocks(), blockId || null);
        } else {
          renderBlocksReadOnly(root, getCurrentPageBlocks());
        }
      } catch {}
      // Trigger normal save pipeline (async)
      try {
        debouncePatch(blockId, { content: { text: newText }, ...(newHtml != null ? { props: { html: newHtml } } : {}) }, 0);
      } catch {
        void apiPatchBlock(blockId, { content: { ...(content || {}), text: newText }, ...(newHtml != null ? { props: { ...(props || {}), html: newHtml } } : {}) }).catch(() => {});
      }
    }
    // Background refresh to reconcile if needed
    await rerenderBlocksNow(blockId || null);
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
      const modal = document.getElementById('wikilinkCreateModal');
      resetWikilinkModal(modal);
      openWikilinkModal({ title, blockId, token, mode: 'wikilink' });
    }
  });
  // Delegated handling for id-based page links so newly inserted links work
  document.addEventListener('click', async (e) => {
    const a = e.target?.closest?.('a[data-page-id], a.wikilink.idlink');
    if (!a) return;
    const id = a.getAttribute('data-page-id');
    if (!id) return;
    try { e.preventDefault(); e.stopPropagation(); } catch {}
    try {
      window.__pageMetaCache = window.__pageMetaCache || new Map();
      const href = await canonicalHrefForPageId(id, fetchJson, window.__pageMetaCache);
      navigate(href);
    } catch {
      const href = a.getAttribute('href') || `/page/${encodeURIComponent(id)}`;
      navigate(href);
    }
  }, true);
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

async function rerenderBlocksNow(preferFocusId = null) {
  try {
    const root = findBlocksRoot();
    if (!root) return;
    const pageId = document?.body?.dataset?.activePageId;
    const editing = document?.body?.dataset?.mode === 'edit';
    if (!pageId) { rerenderReadOnly(); return; }
    // Immediate local render first (do not wait on server)
    if (editing) {
      const page = { id: pageId };
      stableRender(root, page, getCurrentPageBlocks(), preferFocusId || null);
    } else {
      renderBlocksReadOnly(root, getCurrentPageBlocks());
    }
    // Background refresh to reconcile state; render again when done
    try {
      refreshBlocksFromServer(pageId)
        .then(() => {
          try {
            if (editing) {
              const page = { id: pageId };
              stableRender(root, page, getCurrentPageBlocks(), preferFocusId || null);
            } else {
              renderBlocksReadOnly(root, getCurrentPageBlocks());
            }
          } catch {}
        })
        .catch(() => {});
    } catch {}
  } catch {}
}

async function revertWikilinkToPlain({ blockId, token, title }) {
  try {
    const blk = getCurrentPageBlocks().find(b => b.id === blockId);
    const content = parseMaybeJson(blk?.contentJson);
    const props = parseMaybeJson(blk?.propsJson);
    const text = String(content?.text || '');
    const idx = text.indexOf(token);
    let newText = text;
    if (idx >= 0) {
      newText = text.slice(0, idx) + title + text.slice(idx + token.length);
    }
    // Also update props.html if present
    let newHtml = null;
    try {
      const html = String(props?.html || '');
      if (html && html.includes(token)) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
        let tn;
        let replaced = false;
        while ((tn = walker.nextNode())) {
          if (replaced) break;
          const s = tn.nodeValue || '';
          const j = s.indexOf(token);
          if (j >= 0) {
            tn.nodeValue = s.slice(0, j) + title + s.slice(j + token.length);
            replaced = true;
          }
        }
        newHtml = tmp.innerHTML;
      }
    } catch {}
    // Optimistic model update
    updateCurrentBlocks(b => b.id === blockId
      ? { ...b,
          contentJson: JSON.stringify({ ...(content || {}), text: newText }),
          ...(newHtml != null ? { propsJson: JSON.stringify({ ...(props || {}), html: newHtml }) } : {})
        }
      : b);
    try { await rerenderBlocksNow(blockId || null); } catch {}
    // Async save through normal pipeline
    try { debouncePatch(blockId, { content: { text: newText }, ...(newHtml != null ? { props: { html: newHtml } } : {}) }, 0); }
    catch { void apiPatchBlock(blockId, { content: { ...(content || {}), text: newText }, ...(newHtml != null ? { props: { ...(props || {}), html: newHtml } } : {}) }).catch(() => {}); }
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
      updateCurrentBlocks(b => b.id === blockId ? { ...b, contentJson: JSON.stringify({ ...(content || {}), text: newText }) } : b);
      try { debouncePatch(blockId, { content: { text: newText } }, 0); } catch { void apiPatchBlock(blockId, { content: { ...(content || {}), text: newText } }).catch(() => {}); }
      try { await rerenderBlocksNow(blockId || null); } catch {}
    }
    // Optionally apply bulk resolution if requested via modal controls
    try {
      const modal = document.getElementById('wikilinkCreateModal');
      if (modal) await applyBulkIfRequested({ label: title, targetPageId: id, modal });
    } catch {}
    await refreshNav();
    navigate(canonicalPageHref(page));
  } catch (e) {
    console.error('Failed to create page for wikilink', e);
    alert('Failed to create page: ' + (e?.message || e));
  }
}

// Open the wikilink modal in two modes:
// - mode 'wikilink' (default): resolving a [[Title]] token
// - mode 'linkify': bulk linkify plain term across pages
// Open the wikilink modal in two modes:
// - mode 'wikilink' (default): resolving a [[Title]] token
// - mode 'linkify': bulk linkify plain term across pages
// Optionally, provide onConfirmResolved to handle confirm externally (e.g., insert into textarea)
export function openWikilinkModal({ title, blockId, token, mode = 'wikilink', linkifyPageIds = [], onConfirmResolved = null }) {
  const modal = document.getElementById('wikilinkCreateModal');
  if (!modal) {
    // Fallback: keep existing behavior if modal not present
    void resolveLegacyAndUpgrade(title, blockId, token);
    return;
  }
  // Ensure modal starts from a clean state
  resetWikilinkModal(modal);
  modal.setAttribute('data-wikilink-title', title);
  modal.setAttribute('data-wikilink-block', blockId || '');
  modal.setAttribute('data-wikilink-token', token || `[[${title}]]`);
  modal.setAttribute('data-mode', mode);
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
      try {
        closeModal('wikilinkCreateModal');
      } finally {
        resetWikilinkModal(modal);
      }
      await createPageForWikilink({ title, blockId, token, type });
    };
  }
  if (btnCancel) {
    btnCancel.onclick = async () => {
      try {
        closeModal('wikilinkCreateModal');
      } finally {
        resetWikilinkModal(modal);
      }
      const effectiveMode = mode || modal.dataset.mode || 'wikilink';
      // Only revert auto-inserted token for the legacy click path with no external confirm handler
      if (effectiveMode !== 'linkify' && !onConfirmResolved) {
        await revertWikilinkToPlain({ title, blockId, token });
      }
    };
  }

  // Resolve section
  const input = modal.querySelector('input[name="wikiResolveQuery"]');
  const resultsEl = modal.querySelector('.wikiResolveResults');
  const autoEl = modal.querySelector('.wikiResolveAuto');
  const selectedSummary = modal.querySelector('.wikiSelectedSummary');
  const confirmBtn = modal.querySelector('#wikiConfirm');
  const cancelBtn = modal.querySelector('#wikiCancel');
  // State vars must be declared before any helper uses them
  let selected = null; // selected target page from results
  let scope = 'single'; // 'single' | 'page' | 'vault'
  // Scope controls
  if ((mode || modal.dataset.mode || 'wikilink') !== 'linkify') {
    setupScopeControls({ modal, label: title, onScopeChange: (s) => { scope = s; updateConfirmLabel(); } });
  } else {
    // In linkify mode hide apply and create sections, retitle modal
    const h2 = modal.querySelector('h2');
    if (h2) h2.textContent = 'Linkify Term';
    try { modal.querySelector('.wiki-apply')?.style.setProperty('display','none'); } catch {}
    try { modal.querySelector('.wiki-create')?.style.setProperty('display','none'); } catch {}
  }
  let currentResults = [];
  const setSelected = (item) => {
    selected = item;
    // update selection UI
    resultsEl?.querySelectorAll('.wikiPickRow').forEach(n => n.classList.remove('is-selected'));
    if (item && resultsEl) {
      const node = resultsEl.querySelector(`.wikiPickRow[data-id="${CSS.escape(item.id)}"]`);
      if (node) node.classList.add('is-selected');
    }
    // update checkmarks and ARIA
    if (resultsEl) {
      resultsEl.querySelectorAll('.wikiPickRow').forEach(n => {
        const mark = n.querySelector('.wikiPickMark');
        if (!mark) return;
        if (selected && n.getAttribute('data-id') === String(selected.id)) {
          mark.textContent = '✓';
          n.setAttribute('aria-selected', 'true');
        } else {
          mark.textContent = '';
          n.setAttribute('aria-selected', 'false');
        }
      });
    }
    if (confirmBtn) confirmBtn.disabled = !selected;
    if (selectedSummary) selectedSummary.textContent = selected ? `Selected: ${selected.title}` : 'No page selected';
    updateConfirmLabel();
  };

  function updateConfirmLabel() {
    if (!confirmBtn) return;
    const t = selected?.title || '';
    confirmBtn.disabled = !selected;
    confirmBtn.textContent = !selected
      ? 'Link'
      : (scope === 'vault'
          ? `Link across vault → ${t}`
          : scope === 'page'
            ? `Link in this page → ${t}`
            : `Link → ${t}`);
  }

  const renderResults = (arr, qNorm) => {
    if (!resultsEl) return;
    resultsEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const r of arr) {
      const div = document.createElement('div');
      div.className = 'result';
      div.classList.add('wikiPickRow');
      div.setAttribute('data-id', r.id);
      div.setAttribute('role', 'option');
      div.setAttribute('aria-selected', 'false');
      div.style.padding = '6px 8px';
      div.style.borderRadius = '6px';
      div.style.cursor = 'pointer';
      div.innerHTML = `<div style="font-weight:700;">${r.title}</div>
        <div style="font-size:12px; color: var(--muted);">${r.type || 'page'}${r.slug ? ` • ${r.slug}` : ''}</div>`;
      // append checkmark holder
      try {
        const mark = document.createElement('div');
        mark.className = 'wikiPickMark';
        mark.textContent = '';
        div.appendChild(mark);
      } catch {}
      div.addEventListener('click', () => setSelected(r));
      div.addEventListener('dblclick', async () => {
        const effectiveMode = mode || modal.dataset.mode || 'wikilink';
        try {
          if (effectiveMode === 'linkify') {
            const summary = await fetchJson('/api/wikilinks/linkify', {
              method: 'POST',
              body: JSON.stringify({ term: title, targetPageId: r.id, scope: 'pages', pageIds: linkifyPageIds || [], caseSensitive: false })
            });
            const linked = Number(summary?.linkedOccurrences || 0);
            const upPages = Number(summary?.updatedPages || 0);
            alert(`Linked ${linked} occurrence${linked === 1 ? '' : 's'} across ${upPages} page${upPages === 1 ? '' : 's'}`);
          } else if (onConfirmResolved) {
            // External handler path for context menu: do not rely on globals
            await onConfirmResolved({ title, page: r });
          } else {
            await linkWikilinkToExisting({ title, blockId, token, page: r });
            await applyBulkIfRequested({ label: title, targetPageId: r.id, modal, scope });
            alert('Linked ✓');
          }
        } catch (e) {
          console.error('wikilink commit failed', e);
          alert('Link failed. Check console/network for details.');
        } finally {
          closeModal('wikilinkCreateModal');
          resetWikilinkModal(modal);
        }
      });
      div.addEventListener('mouseenter', () => { resultsEl.querySelectorAll('.wikiPickRow').forEach(n => n.classList.remove('hover')); div.classList.add('hover'); });
      div.addEventListener('mouseleave', () => div.classList.remove('hover'));
      frag.appendChild(div);
    }
    resultsEl.appendChild(frag);
    // Hide auto-suggest action; default selection to first item
    if (autoEl) { autoEl.style.display = 'none'; autoEl.innerHTML = ''; }
    if (!selected && arr.length > 0) setSelected(arr[0]);
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
  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      try {
        if (!selected) return;
        const effectiveMode = mode || modal.dataset.mode || 'wikilink';
        if (effectiveMode === 'linkify') {
          const summary = await fetchJson('/api/wikilinks/linkify', {
            method: 'POST',
            body: JSON.stringify({ term: title, targetPageId: selected.id, scope: 'pages', pageIds: linkifyPageIds || [], caseSensitive: false })
          });
          const linked = Number(summary?.linkedOccurrences || 0);
          const upPages = Number(summary?.updatedPages || 0);
          alert(`Linked ${linked} occurrence${linked === 1 ? '' : 's'} across ${upPages} page${upPages === 1 ? '' : 's'}`);
        } else if (onConfirmResolved) {
          // External handler path for context menu: do not rely on globals
          await onConfirmResolved({ title, page: selected });
        } else {
          await linkWikilinkToExisting({ title, blockId, token, page: selected });
          await applyBulkIfRequested({ label: title, targetPageId: selected.id, modal, scope });
          alert('Linked ✓');
        }
      } catch (e) {
        console.error('wikilink commit failed', e);
        alert('Link failed. Check console/network for details.');
      } finally {
        closeModal('wikilinkCreateModal');
        resetWikilinkModal(modal);
      }
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      closeModal('wikilinkCreateModal');
      resetWikilinkModal(modal);
    };
  }

  // Keyboard navigation: up/down to move selection; Enter to confirm
  modal.addEventListener('keydown', (ev) => {
    if (!currentResults.length) return;
    if (ev.key === 'ArrowDown' || ev.key === 'Down') {
      ev.preventDefault();
      if (!selected) { setSelected(currentResults[0]); return; }
      const idx = currentResults.findIndex(r => r.id === selected.id);
      const next = currentResults[Math.min(idx + 1, currentResults.length - 1)] || selected;
      setSelected(next);
    } else if (ev.key === 'ArrowUp' || ev.key === 'Up') {
      ev.preventDefault();
      if (!selected) { setSelected(currentResults[0]); return; }
      const idx = currentResults.findIndex(r => r.id === selected.id);
      const prev = currentResults[Math.max(idx - 1, 0)] || selected;
      setSelected(prev);
    } else if (ev.key === 'Enter') {
      if (confirmBtn && !confirmBtn.disabled) {
        ev.preventDefault();
        confirmBtn.click();
      }
    }
  });

  // Initial label state
  updateConfirmLabel();

  openModal('wikilinkCreateModal');
  // Kick off initial search
  setTimeout(() => doSearch(title || ''), 0);
}

export function openLinkifyTermModal({ term, pageIds }) {
  const modal = document.getElementById('wikilinkCreateModal');
  if (!modal) return;
  resetWikilinkModal(modal);
  modal.dataset.mode = 'linkify';
  modal.dataset.linkifyTerm = term || '';
  modal.dataset.linkifyPages = JSON.stringify(pageIds || []);
  openWikilinkModal({ title: term, blockId: '', token: '', mode: 'linkify', linkifyPageIds: pageIds || [] });
}

function currentPageIdFromBlocks() {
  try { return getCurrentPageBlocks()[0]?.pageId || null; } catch { return null; }
}

function setupScopeControls({ modal, label, onScopeChange }) {
  const radios = Array.from(modal.querySelectorAll('input[name="wikiScope"]'));
  const reviewRow = modal.querySelector('.wikiScopeReview');
  const statusEl = modal.querySelector('.wikiScopeStatus');
  const reviewBtn = modal.querySelector('.wikiScopeReviewBtn');
  const applyList = modal.querySelector('.wikiApplyList');

  const updateReviewVisibility = () => {
    const val = (radios.find(r => r.checked)?.value) || 'single';
    if (onScopeChange) onScopeChange(val);
    if (!reviewRow) return;
    reviewRow.style.display = val === 'vault' ? '' : 'none';
    if (val !== 'vault' && applyList) applyList.style.display = 'none';
  };
  radios.forEach(r => r.addEventListener('change', updateReviewVisibility));
  updateReviewVisibility();

  reviewBtn?.addEventListener('click', async () => {
    try {
      statusEl.textContent = 'Counting…';
      const arr = await fetchJson(`/api/wikilinks/occurrences?label=${encodeURIComponent(label)}&limit=100`);
      const results = Array.isArray(arr) ? arr : [];
      const n = results.length;
      statusEl.textContent = `Found in ${n} page${n === 1 ? '' : 's'}`;
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
        applyList.style.display = '';
      }
    } catch (e) {
      console.error('scope count failed', e);
      statusEl.textContent = 'Not counted yet';
      alert('Count unavailable.');
    }
  });
}

async function applyBulkIfRequested({ label, targetPageId, modal, scope }) {
  try {
    const scopeVal = scope || (modal.querySelector('input[name="wikiScope"]:checked')?.value) || 'single';
    const applyList = modal.querySelector('.wikiApplyList');
    if (scopeVal === 'single') return;

    const pageId = currentPageIdFromBlocks();
    let summary = null;

    if (scopeVal === 'vault') {
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
    } else if (scopeVal === 'page' && pageId) {
      summary = await fetchJson('/api/wikilinks/resolve', {
        method: 'POST',
        body: JSON.stringify({ label, targetPageId, scope: 'page', pageId, replaceMode: 'unresolvedOnly' })
      });
    }

    if (summary && typeof summary.updatedPages === 'number') {
      alert(`Updated ${summary.updatedPages} page${summary.updatedPages === 1 ? '' : 's'}`);
    }

    if (pageId) await rerenderBlocksNow();
  } catch (e) {
    console.error('Bulk resolve failed', e);
    alert('Bulk resolve failed: ' + (e?.message || e));
  }
}
