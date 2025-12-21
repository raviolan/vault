import { navigate } from '../lib/router.js';
import { fetchJson } from '../lib/http.js';
import { parseMaybeJson } from '../blocks/tree.js';
import { apiPatchBlock } from '../blocks/api.js';
import { getCurrentPageBlocks, updateCurrentBlocks } from '../lib/pageStore.js';
import { refreshNav } from './nav.js';

export function buildWikiTextNodes(text, blockIdForLegacyReplace = null) {
  const frag = document.createDocumentFragment();
  const re = /\[\[(?:page:([0-9a-fA-F-]{36})\|([^\]]*?)|([^\]]+))\]\]/g; // [[page:<uuid>|Label]] or [[Title]]
  let lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(lastIndex, m.index);
    if (before) frag.appendChild(document.createTextNode(before));
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
  if (rest) frag.appendChild(document.createTextNode(rest));
  return frag;
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
      void resolveLegacyAndUpgrade(title, blockId, token);
    }
  });
}

