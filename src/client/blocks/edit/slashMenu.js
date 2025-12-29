import { apiCreateBlock, apiPatchBlock } from './apiBridge.js';
import { getCurrentPageBlocks, updateCurrentBlocks, setCurrentPageBlocks } from '../../lib/pageStore.js';

let slashMenuEl = null;
let slashMenuForBlockId = null;
let slashMenuInputEl = null;

function ensureSlashMenuStyles() {
  if (document.getElementById('slash-menu-styles')) return;
  const style = document.createElement('style');
  style.id = 'slash-menu-styles';
  style.textContent = `
  .slash-menu{position:absolute;z-index:1000;min-width:180px;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.3);padding:6px;margin-top:4px;}
  .slash-menu .item{padding:6px 8px;cursor:pointer;border-radius:4px;display:flex;justify-content:space-between;align-items:center;}
  .slash-menu .item:hover,.slash-menu .item[aria-selected="true"]{background:#1f2937}
  .slash-menu .hint{opacity:0.6;font-size:12px}
  `;
  document.head.appendChild(style);
}

function getSlashMenuItems() {
  return [
    { key: 'h1', label: 'Heading 1', type: 'section', props: { collapsed: false, level: 1 } },
    { key: 'h2', label: 'Heading 2', type: 'section', props: { collapsed: false, level: 2 } },
    { key: 'h3', label: 'Heading 3', type: 'section', props: { collapsed: false, level: 3 } },
    { key: 'p', label: 'Paragraph', type: 'paragraph', props: {} },
    { key: 'divider', label: 'Divider', type: 'divider', props: {} },
    { key: 'section', label: 'Section', type: 'section', props: { collapsed: false } },
  ];
}

function hideSlashMenu() {
  if (slashMenuEl && slashMenuEl.parentNode) slashMenuEl.parentNode.removeChild(slashMenuEl);
  slashMenuEl = null;
  slashMenuForBlockId = null;
  slashMenuInputEl = null;
  document.removeEventListener('mousedown', handleGlobalMenuDismiss, true);
}

function handleGlobalMenuDismiss(e) {
  if (!slashMenuEl) return;
  if (slashMenuEl.contains(e.target)) return;
  hideSlashMenu();
}

function showSlashMenuForBlock(block, inputEl, filterText, onSelect) {
  ensureSlashMenuStyles();
  slashMenuForBlockId = block.id;
  slashMenuInputEl = inputEl;

  const items = getSlashMenuItems();
  const q = String(filterText || '').trim().replace(/^\//, '').toLowerCase();
  const filtered = items.filter(it => !q || it.key.startsWith(q) || it.label.toLowerCase().includes(q));
  if (!filtered.length) { hideSlashMenu(); return; }

  if (!slashMenuEl) {
    slashMenuEl = document.createElement('div');
    slashMenuEl.className = 'slash-menu';
    document.body.appendChild(slashMenuEl);
    document.addEventListener('mousedown', handleGlobalMenuDismiss, true);
  }

  slashMenuEl.innerHTML = filtered.map((it, idx) => `<div class="item" data-key="${it.key}" tabindex="-1" ${idx===0?'aria-selected="true"':''}>${it.label} <span class="hint">/${it.key}</span></div>`).join('');

  try {
    const rect = inputEl.getBoundingClientRect();
    const top = rect.top + window.scrollY + Math.min(rect.height, 28);
    const left = rect.left + window.scrollX + 8;
    slashMenuEl.style.top = `${top}px`;
    slashMenuEl.style.left = `${left}px`;
  } catch {}

  for (const child of slashMenuEl.querySelectorAll('.item')) {
    child.addEventListener('click', () => {
      const key = child.getAttribute('data-key');
      const choice = getSlashMenuItems().find(x => x.key === key);
      if (choice) onSelect(choice);
      hideSlashMenu();
    });
  }
}

export function maybeHandleSlashMenu({ page, block, inputEl, orderedBlocksFlat, onAfterChange }) {
  const val = String(inputEl.value || '');
  const trimmed = val.replace(/^\s+/, '');
  if (!trimmed.startsWith('/')) { if (slashMenuForBlockId === block.id) hideSlashMenu(); return; }
  if (!(block.type === 'paragraph' || block.type === 'heading')) return;

  showSlashMenuForBlock(block, inputEl, trimmed, async (choice) => {
    let newType = choice.type;
    let newProps = choice.props || {};
    let restText = String(inputEl.value || '').replace(/^\s*\/[a-z0-9-]*\s*/, '');
    let newContent = {};
    if (newType === 'heading' || newType === 'paragraph') newContent = { text: restText || '' };
    else if (newType === 'section') newContent = { title: restText || '' };
    else if (newType === 'divider') newContent = {};
    try {
      await apiPatchBlock(block.id, { type: newType, props: newProps, content: newContent });
      // Update local snapshot for immediate feedback
      updateCurrentBlocks(b => b.id === block.id ? { ...b, type: newType, propsJson: JSON.stringify(newProps || {}), contentJson: JSON.stringify(newContent || {}) } : b);
      // If this is a leveled section, normalize outline nesting
      if (newType === 'section' && (newProps?.level === 1 || newProps?.level === 2 || newProps?.level === 3)) {
        const { normalizeOutlineFromLevels } = await import('./outline.js');
        await normalizeOutlineFromLevels(page);
      }
      await onAfterChange();
      if (newType === 'divider') {
        const flat = orderedBlocksFlat();
        const idx = flat.findIndex(x => x.id === block.id);
        let next = flat[idx + 1];
        if (!next) {
          const created = await apiCreateBlock(page.id, { type: 'paragraph', parentId: block.parentId ?? null, sort: (block.sort ?? 0) + 1, props: {}, content: { text: '' } });
          setCurrentPageBlocks([...getCurrentPageBlocks(), created]);
          await onAfterChange();
          return { focusId: created.id };
        }
        let hops = 0;
        while (next && next.type === 'divider' && hops < 3) {
          const idx2 = flat.findIndex(x => x.id === next.id);
          next = flat[idx2 + 1];
          hops++;
        }
        return { focusId: next?.id || block.id };
      }
      return { focusId: block.id };
    } catch (err) {
      console.error('convert failed', err);
    }
  });
}

export function hideSlashMenuPublic() { hideSlashMenu(); }
export function isSlashMenuFor(blockId) { return slashMenuForBlockId === blockId; }
