import { parseMaybeJson, blocksToTree } from '../tree.js';
import { getCurrentPageBlocks, setCurrentPageBlocks } from '../../lib/pageStore.js';
import { bindTextInputHandlers } from './handlersText.js';
import { bindSectionTitleHandlers, bindSectionHeaderControls } from './handlersSection.js';
import { focusBlockInput } from './focus.js';

function parseBlock(b) {
  return { ...b, props: parseMaybeJson(b.propsJson), content: parseMaybeJson(b.contentJson) };
}

export function renderBlocksEdit(rootEl, page, blocks) {
  setCurrentPageBlocks(blocks);
  if (!getCurrentPageBlocks().length) {
    const empty = document.createElement('div');
    empty.innerHTML = `<div class="block" data-block-id="" data-parent-id="">\n      <textarea class="block-input" placeholder="Start typing..."></textarea>\n    </div>`;
    const ta = empty.querySelector('textarea');
    ta.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const { apiCreateBlock, refreshBlocksFromServer } = await import('./apiBridge.js');
        const { getCurrentPageBlocks } = await import('../../lib/pageStore.js');
        const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: null, sort: 0, props: {}, content: { text: '' } });
        await refreshBlocksFromServer(page.id);
        renderBlocksEdit(rootEl, page, getCurrentPageBlocks());
        focusBlockInput(created.id);
      }
    });
    rootEl.innerHTML = '';
    rootEl.appendChild(empty.firstElementChild);
    setTimeout(() => ta.focus(), 0);
    return;
  }

  rootEl.innerHTML = '';
  const tree = blocksToTree(getCurrentPageBlocks());

  function orderedBlocksFlat() {
    const arr = getCurrentPageBlocks().slice();
    return arr.sort((a,b) => ((a.parentId||'') === (b.parentId||'')) ? (a.sort - b.sort) : (String(a.parentId||'').localeCompare(String(b.parentId||'')) || (a.sort - b.sort)));
  }

  function renderNodeEdit(rawNode, depth = 0) {
    const b = parseBlock(rawNode);
    const wrap = document.createElement('div');
    wrap.className = 'block';
    wrap.setAttribute('data-block-id', b.id);
    wrap.setAttribute('data-parent-id', b.parentId || '');

    const render = () => renderBlocksEdit(rootEl, page, getCurrentPageBlocks());
    const focus = (id) => focusBlockInput(id);

    if (b.type === 'heading') {
      const level = Math.min(3, Math.max(1, Number((b.props && b.props.level) || 2)));
      const input = document.createElement('input');
      input.className = 'block-input heading';
      input.value = b.content?.text || '';
      input.placeholder = level === 1 ? 'Heading 1' : (level === 2 ? 'Heading 2' : 'Heading 3');
      wrap.appendChild(input);
      bindTextInputHandlers({ page, block: b, inputEl: input, orderedBlocksFlat, render, focus });
    } else if (b.type === 'paragraph') {
      const ta = document.createElement('textarea');
      ta.className = 'block-input paragraph';
      ta.value = b.content?.text || '';
      ta.placeholder = 'Write something...';
      wrap.appendChild(ta);
      bindTextInputHandlers({ page, block: b, inputEl: ta, orderedBlocksFlat, render, focus });
    } else if (b.type === 'divider') {
      const hr = document.createElement('hr');
      wrap.appendChild(hr);
    } else if (b.type === 'section') {
      const header = document.createElement('div');
      header.className = 'section-header';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'section-toggle';
      toggle.textContent = b.props?.collapsed ? '▸' : '▾';
      header.appendChild(toggle);
      const title = document.createElement('input');
      title.className = 'block-input section-title';
      title.placeholder = 'Section title';
      title.value = b.content?.title || '';
      header.appendChild(title);
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'chip section-add';
      addBtn.textContent = '+';
      addBtn.title = 'Add child paragraph';
      header.appendChild(addBtn);
      wrap.appendChild(header);

      const kidsWrap = document.createElement('div');
      kidsWrap.className = 'section-children';
      kidsWrap.style.paddingLeft = '16px';
      if (b.props?.collapsed) kidsWrap.style.display = 'none';
      wrap.appendChild(kidsWrap);

      bindSectionHeaderControls({ page, block: b, rootEl: wrap, titleInput: title, onAfterChange: async () => { render(); }, focus });
      bindSectionTitleHandlers({ page, block: b, inputEl: title });

      for (const child of rawNode.children) kidsWrap.appendChild(renderNodeEdit(child, depth + 1));
      return wrap;
    } else {
      const pre = document.createElement('pre');
      pre.className = 'meta';
      pre.textContent = JSON.stringify({ type: b.type, content: b.content }, null, 2);
      wrap.appendChild(pre);
    }

    if (rawNode.children && rawNode.children.length) {
      const kidsWrap = document.createElement('div');
      kidsWrap.className = 'section-children';
      kidsWrap.style.paddingLeft = '16px';
      for (const child of rawNode.children) kidsWrap.appendChild(renderNodeEdit(child, depth + 1));
      wrap.appendChild(kidsWrap);
    }

    return wrap;
  }

  for (const node of tree) rootEl.appendChild(renderNodeEdit(node, 0));
}
