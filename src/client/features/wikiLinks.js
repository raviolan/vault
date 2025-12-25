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
        appendBoldItalicAndHashtags(part, frag);
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
    // Avoid linkifying inside URLs (e.g., http://x#frag)
    const leftCtxStart = Math.max(0, (text.lastIndexOf(' ', m.index) + 1) || 0);
    const leftCtx = text.slice(leftCtxStart, m.index + 1); // include '#'
    if (/^[a-zA-Z]+:\/\/.+?$/.test(leftCtx)) {
      // treat as plain text
      target.appendChild(document.createTextNode('#' + tag));
    } else {
      const a = document.createElement('a');
      a.className = 'hashtag';
      a.href = `/tags?tag=${encodeURIComponent(tag)}`;
      a.setAttribute('data-link', '');
      a.textContent = `#${tag}`;
      target.appendChild(a);
    }
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
  const btnCreate = modal.querySelector('.modal-confirm');
  const btnCancel = modal.querySelector('.modal-cancel');
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
  openModal('wikilinkCreateModal');
}
