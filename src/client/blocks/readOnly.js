import { parseMaybeJson, blocksToTree } from './tree.js';
import { buildWikiTextNodes } from '../features/wikiLinks.js';
import { apiPatchBlock } from './api.js';
import { sanitizeRichHtml } from '../lib/sanitize.js';

// Local helper: linkify [[wikilinks]] and #hashtags inside a DOM subtree.
function linkifyWikiTokensInElement(rootEl, blockId) {
  if (!rootEl) return;
  try {
    const txt = rootEl.textContent || '';
    if (!txt || (!txt.includes('[[') && !txt.includes('#'))) return;
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) {
      const s = n.nodeValue || '';
      if (!s) continue;
      const p = n.parentElement;
      if (!p) continue;
      if (p.closest('a,code,pre,textarea,script,style')) continue;
      if (!s.includes('[[') && !s.includes('#')) continue;
      nodes.push(n);
    }
    for (const tn of nodes) {
      const frag = buildWikiTextNodes(tn.nodeValue || '', blockId);
      if (frag && tn.parentNode) tn.parentNode.replaceChild(frag, tn);
    }
  } catch {}
}

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
      el.setAttribute('data-block-id', n.id);
      const txt = String(content.text || '');
      el.appendChild(buildWikiTextNodes(txt, n.id));
      return el;
    }
    if (n.type === 'paragraph') {
      const p = document.createElement('p');
      p.setAttribute('data-block-id', n.id);
      const rich = (props && props.html) ? String(props.html) : '';
      if (rich && rich.trim()) {
        // Render sanitized HTML when present, then linkify wiki tokens within it
        p.innerHTML = sanitizeRichHtml(rich);
        linkifyWikiTokensInElement(p, n.id);
      } else {
        const txt = String(content.text || '');
        p.appendChild(buildWikiTextNodes(txt, n.id));
      }
      return p;
    }
    if (n.type === 'divider') {
      return document.createElement('hr');
    }
    if (n.type === 'table') {
      const wrap = document.createElement('div');
      wrap.className = 'table-block-wrap';
      wrap.style.overflowX = 'auto';
      wrap.style.maxWidth = '100%';
      const props = parseMaybeJson(n.propsJson) || {};
      const table = (props && typeof props.table === 'object') ? props.table : { columns: [], rows: [], hasHeader: false };
      const tbl = document.createElement('table');
      tbl.className = 'table-block';
      // Column widths
      const cg = document.createElement('colgroup');
      for (const col of (table.columns || [])) {
        const c = document.createElement('col');
        const w = String(col.width || 'auto');
        c.className = `tb-col tb-col--${w.replace(/[^a-z0-9:]/g,'_')}`;
        cg.appendChild(c);
      }
      tbl.appendChild(cg);
      if (table.hasHeader) {
        const thead = document.createElement('thead');
        const tr = document.createElement('tr');
        for (const col of (table.columns || [])) {
          const th = document.createElement('th');
          th.textContent = String(col.name || '');
          tr.appendChild(th);
        }
        thead.appendChild(tr);
        tbl.appendChild(thead);
      }
      const tbody = document.createElement('tbody');
      for (const r of (table.rows || [])) {
        const tr = document.createElement('tr');
        for (let i = 0; i < (table.columns || []).length; i++) {
          const td = document.createElement('td');
          const s = (r.cells && r.cells[i]) ? String(r.cells[i]) : '';
          try {
            const nodes = buildWikiTextNodes(s, n.id);
            if (nodes) nodes.forEach(node => td.appendChild(node)); else td.textContent = s;
          } catch { td.textContent = s; }
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      wrap.appendChild(tbl);
      return wrap;
    }
    if (n.type === 'section') {
      const wrap = document.createElement('div');
      wrap.className = 'section-block';
      wrap.setAttribute('data-block-id', n.id);
      const header = document.createElement('div');
      header.className = 'section-header';
      // Collapsed-by-default when completed
      const initiallyCollapsed = !!(props?.collapsed || props?.completed);
      // Expose collapsed state for CSS styling
      header.dataset.collapsed = initiallyCollapsed ? '1' : '0';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'section-toggle';
      btn.setAttribute('aria-label', 'Toggle');
      btn.textContent = initiallyCollapsed ? '▸' : '▾';
      // Accessible state for chevron CSS
      btn.setAttribute('aria-expanded', initiallyCollapsed ? 'false' : 'true');
      header.appendChild(btn);
      const title = document.createElement('span');
      title.className = 'section-title-read';
      const lvl = Math.min(3, Math.max(0, Number(props.level || 0)));
      if (lvl) title.classList.add(`h${lvl}`);
      const ttxt = String(content.title || '');
      try { title.appendChild(buildWikiTextNodes(ttxt, n.id)); } catch { title.textContent = ttxt; }
      header.appendChild(title);

      // Completion checkbox (H1–H3 only), placed far-right
      if (lvl >= 1 && lvl <= 3) {
        const completeWrap = document.createElement('label');
        completeWrap.className = 'section-complete';
        completeWrap.title = 'Mark section complete (collapses by default)';
        const complete = document.createElement('input');
        complete.type = 'checkbox';
        complete.className = 'section-complete-checkbox';
        complete.checked = !!props?.completed;
        // Prevent header interactions (toggle/drag) when clicking checkbox
        const stop = (e) => { try { e.stopPropagation(); e.stopImmediatePropagation?.(); } catch {} };
        complete.addEventListener('pointerdown', stop, true);
        complete.addEventListener('click', stop, true);
        complete.addEventListener('change', async (e) => {
          try {
            const next = { ...(props || {}), completed: !!complete.checked };
            await apiPatchBlock(n.id, { props: next });
            // Update local props reference for subsequent interactions
            props.completed = !!complete.checked;
            // Apply immediate collapse when checking (DOM only; do not force expand on uncheck)
            if (complete.checked) {
              try {
                header.dataset.collapsed = '1';
                btn.textContent = '▸';
                btn.setAttribute('aria-expanded', 'false');
                if (kidsWrap) kidsWrap.style.display = 'none';
              } catch {}
            }
          } catch (e) { console.error('set completed failed', e); }
        });
        completeWrap.appendChild(complete);
        // Add subtle glyph for spacing/click area without extra text
        const dot = document.createElement('span');
        dot.className = 'section-complete-dot';
        dot.textContent = '';
        completeWrap.appendChild(dot);
        header.appendChild(completeWrap);
      }
      wrap.appendChild(header);
      const kidsWrap = document.createElement('div');
      kidsWrap.className = 'section-children';
      kidsWrap.style.paddingLeft = '16px';
      if (initiallyCollapsed) kidsWrap.style.display = 'none';
      for (const child of n.children) {
        kidsWrap.appendChild(makeNode(child, depth + 1));
      }
      wrap.appendChild(kidsWrap);
      btn.addEventListener('click', async () => {
        try {
          const next = { ...(props || {}), collapsed: !props.collapsed };
          await apiPatchBlock(n.id, { props: next });
          props.collapsed = !props.collapsed;
          const now = !!(props.collapsed);
          btn.textContent = now ? '▸' : '▾';
          btn.setAttribute('aria-expanded', now ? 'false' : 'true');
          header.dataset.collapsed = now ? '1' : '0';
          kidsWrap.style.display = now ? 'none' : '';
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
