import { parseMaybeJson, blocksToTree } from './tree.js';
import { buildWikiTextNodes } from '../features/wikiLinks.js';
import { apiPatchBlock } from './api.js';
import { sanitizeRichHtml } from '../lib/sanitize.js';

export function renderBlocksReadOnly(rootEl, blocks) {
  if (!blocks || !blocks.length) {
    rootEl.innerHTML = '<p class="meta">Empty page</p>';
    return;
  }
  rootEl.innerHTML = '';
  const tree = blocksToTree(blocks);

  function makeNode(n, depth = 0) {
    const props = parseMaybeJson(n.propsJson);
    const content = parseMaybeJson(n.contentJson);
    if (n.type === 'heading') {
      const level = Math.min(3, Math.max(1, Number(props.level || 2)));
      const tag = level === 1 ? 'h1' : (level === 2 ? 'h2' : 'h3');
      const el = document.createElement(tag);
      const txt = String(content.text || '');
      el.appendChild(buildWikiTextNodes(txt, n.id));
      return el;
    }
    if (n.type === 'paragraph') {
      const p = document.createElement('p');
      const rich = (props && props.html) ? String(props.html) : '';
      if (rich && rich.trim()) {
        // Render sanitized HTML when present
        p.innerHTML = sanitizeRichHtml(rich);
      } else {
        const txt = String(content.text || '');
        p.appendChild(buildWikiTextNodes(txt, n.id));
      }
      return p;
    }
    if (n.type === 'divider') {
      return document.createElement('hr');
    }
    if (n.type === 'section') {
      const wrap = document.createElement('div');
      wrap.className = 'section-block';
      wrap.setAttribute('data-block-id', n.id);
      const header = document.createElement('div');
      header.className = 'section-header';
      // Expose collapsed state for CSS styling
      header.dataset.collapsed = props.collapsed ? '1' : '0';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'section-toggle';
      btn.setAttribute('aria-label', 'Toggle');
      btn.textContent = props.collapsed ? '▸' : '▾';
      // Accessible state for chevron CSS
      btn.setAttribute('aria-expanded', props.collapsed ? 'false' : 'true');
      header.appendChild(btn);
      const title = document.createElement('span');
      title.className = 'section-title-read';
      const lvl = Math.min(3, Math.max(0, Number(props.level || 0)));
      if (lvl) title.classList.add(`h${lvl}`);
      title.textContent = content.title || '';
      header.appendChild(title);
      wrap.appendChild(header);
      const kidsWrap = document.createElement('div');
      kidsWrap.className = 'section-children';
      kidsWrap.style.paddingLeft = '16px';
      if (props.collapsed) kidsWrap.style.display = 'none';
      for (const child of n.children) {
        kidsWrap.appendChild(makeNode(child, depth + 1));
      }
      wrap.appendChild(kidsWrap);
      btn.addEventListener('click', async () => {
        try {
          const next = { ...(props || {}), collapsed: !props.collapsed };
          await apiPatchBlock(n.id, { props: next });
          props.collapsed = !props.collapsed;
          btn.textContent = props.collapsed ? '▸' : '▾';
          btn.setAttribute('aria-expanded', props.collapsed ? 'false' : 'true');
          header.dataset.collapsed = props.collapsed ? '1' : '0';
          kidsWrap.style.display = props.collapsed ? 'none' : '';
        } catch (e) { console.error('toggle failed', e); }
      });
      return wrap;
    }
    const pre = document.createElement('pre');
    pre.className = 'meta';
    pre.textContent = JSON.stringify({ type: n.type, content }, null, 2);
    return pre;
  }

  for (const n of tree) rootEl.appendChild(makeNode(n, 0));
}
