import { debouncePatch } from './edit/state.js';
import { buildWikiTextNodes } from '../features/wikiLinks.js';

function genId(prefix = 'id') {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {}
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
}

export function ensureTableProps(props) {
  const now = Date.now();
  const table = props?.table && typeof props.table === 'object' ? props.table : null;
  if (table && Array.isArray(table.columns) && Array.isArray(table.rows)) return table;
  return {
    tableId: genId('tbl'),
    hasHeader: true,
    columns: [ { id: genId('col'), name: 'Column 1', width: 'm' }, { id: genId('col'), name: 'Column 2', width: 'm' } ],
    rows: [ { id: genId('row'), cells: ['', ''] }, { id: genId('row'), cells: ['', ''] } ]
  };
}

export function renderTablePreview(container, table, { blockId } = {}) {
  if (!container) return;
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'table-block-wrap';
  wrap.style.overflowX = 'auto';
  wrap.style.maxWidth = '100%';
  const tbl = document.createElement('table');
  tbl.className = 'table-block';
  // Colgroup width presets
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
        const nodes = buildWikiTextNodes(s, blockId);
        if (nodes) nodes.forEach(n => td.appendChild(n)); else td.textContent = s;
      } catch { td.textContent = s; }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  container.appendChild(wrap);
}

export async function deleteTableBlock({ page, blockId, rootEl = null, focus = null, renderStable = null } = {}) {
  try {
    console.debug('[table] delete click', blockId);
  } catch {}
  try {
    const { getCurrentPageBlocks, setCurrentPageBlocks } = await import('../lib/pageStore.js');
    const { stableRender } = await import('./edit/render.js');
    const { apiDeleteBlock } = await import('./edit/apiBridge.js');

    const beforeBlocks = getCurrentPageBlocks();
    const target = beforeBlocks.find(b => String(b.id) === String(blockId));
    const parentId = target?.parentId ?? null;

    const siblings = beforeBlocks
      .filter(x => (x.parentId ?? null) === parentId)
      .sort((a,b) => Number(a.sort||0) - Number(b.sort||0));
    const idx = siblings.findIndex(x => String(x.id) === String(blockId));
    const prev = idx > 0 ? siblings[idx-1] : null;
    const next = (idx >= 0 && idx+1 < siblings.length) ? siblings[idx+1] : null;

    // Close any open table editor modal
    try {
      document.querySelectorAll('.modal .table-editor-modal')
        .forEach(el => el.closest('.modal')?.remove());
    } catch {}

    // Optimistic removal
    setCurrentPageBlocks(beforeBlocks.filter(b => String(b.id) !== String(blockId)));

    const container = rootEl || document.getElementById('pageBlocks');
    const preferFocus = prev ? prev.id : (parentId ?? (next ? next.id : null));
    try {
      if (typeof renderStable === 'function') renderStable(preferFocus || null);
      else stableRender(container, page, getCurrentPageBlocks(), preferFocus || null);
    } catch (err) { console.error('table delete re-render failed', err); }
    try {
      if (focus) {
        if (prev) focus(prev.id);
        else if (parentId != null) focus(parentId);
        else if (next) focus(next.id);
      }
    } catch {}

    // Server delete
    try {
      await apiDeleteBlock(blockId);
    } catch (errDel) {
      alert("Couldn't delete table. Please try again.");
      try {
        setCurrentPageBlocks(beforeBlocks);
        const container2 = rootEl || document.getElementById('pageBlocks');
        if (typeof renderStable === 'function') renderStable(blockId);
        else stableRender(container2, page, getCurrentPageBlocks(), blockId);
        try { focus?.(blockId); } catch {}
      } catch {}
    }
  } catch (err) {
    console.error('deleteTableBlock failed', err);
  }
}

export function openTableEditor({ page, block, onClose } = {}) {
  const props = (typeof block.propsJson === 'string') ? (()=>{ try { return JSON.parse(block.propsJson||'{}'); } catch { return {}; } })() : (block.props||{});
  const table = ensureTableProps(props);

  const root = document.createElement('div');
  root.className = 'modal';
  root.style.display = 'flex';
  root.innerHTML = `
    <div class="modal-content table-editor-modal">
      <h3 class="meta">Edit Table</h3>
      <div class="table-editor-controls">
        <label class="chip" style="display:inline-flex; gap:6px; align-items:center;">
          <input type="checkbox" id="teHeaderToggle" ${table.hasHeader ? 'checked' : ''} />
          <span>Show headers</span>
        </label>
        <span class="sep"></span>
        <button type="button" class="chip" id="teAddRow">+ Row</button>
        <button type="button" class="chip" id="teAddCol">+ Column</button>
        <button type="button" class="chip" id="teDelRow">Delete Row</button>
        <button type="button" class="chip" id="teDelCol">Delete Col</button>
        <div style="flex:1"></div>
        <button type="button" class="chip" id="teClose" data-primary>Close</button>
      </div>
      <div class="table-editor-grid-wrap">
        <table class="table-editor-grid">
          <thead></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  // Ensure the sizing class is on the modal content and apply inline fallback sizing
  try {
    const contentEl = root.querySelector('.modal-content');
    contentEl?.classList?.add('table-editor-modal');
    if (contentEl && contentEl.style) {
      // JS fallback sizing (scoped to table editor modal only)
      contentEl.style.width = 'min(1400px, 96vw)';
      contentEl.style.maxWidth = 'min(1400px, 96vw)';
      contentEl.style.maxHeight = '86vh';
      contentEl.style.minHeight = '520px';
    }
  } catch {}

  // Navigation guard: confirm on browser Back while the table editor modal is open
  let popGuardInstalled = false;
  let popCaptureHandler = null;

  function uninstallPopGuard() {
    if (popGuardInstalled && popCaptureHandler) {
      try { window.removeEventListener('popstate', popCaptureHandler, true); } catch {}
      popGuardInstalled = false;
    }
  }

  function installPopGuard() {
    if (popGuardInstalled) return;
    popCaptureHandler = (e) => {
      // Intercept router handling first
      try { if (e && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation(); } catch {}
      const ok = window.confirm('Leave this page? This will close the table editor.');
      if (!ok) {
        // User canceled: return to current page entry without routing; allow router to handle the forward pop
        try {
          window.removeEventListener('popstate', popCaptureHandler, true);
          popGuardInstalled = false;
        } catch {}
        try { history.forward(); } catch {}
        // Reinstall after the forward completes
        setTimeout(() => {
          if (root?.isConnected && !popGuardInstalled) {
            try { window.addEventListener('popstate', popCaptureHandler, true); popGuardInstalled = true; } catch {}
          }
        }, 0);
        return;
      }
      // User confirmed: close the modal, remove guard, then let router render the back location
      try {
        uninstallPopGuard();
        closeModal();
      } catch {}
      // Re-dispatch a popstate so the router renders the already-current back URL
      setTimeout(() => {
        try { window.dispatchEvent(new PopStateEvent('popstate')); } catch {}
      }, 0);
    };
    try { window.addEventListener('popstate', popCaptureHandler, true); popGuardInstalled = true; } catch {}
  }

  function closeModal() {
    try { uninstallPopGuard(); } catch {}
    try { root.remove(); } catch {}
    try { onClose?.(); } catch {}
  }

  // Install guard now that modal is open
  installPopGuard();

  let selRow = 0, selCol = 0;

  function patch(nextTable) {
    const next = { ...(props||{}), table: nextTable };
    debouncePatch(block.id, { props: next });
  }

  function ensureRows(n) {
    while (table.rows.length < n) table.rows.push({ id: genId('row'), cells: Array(table.columns.length).fill('') });
  }
  function ensureCols(n) {
    while (table.columns.length < n) table.columns.push({ id: genId('col'), name: `Column ${table.columns.length+1}`, width: 'm' });
    for (const r of table.rows) {
      while (r.cells.length < n) r.cells.push('');
    }
  }

  function renderGrid() {
    const thead = root.querySelector('.table-editor-grid thead');
    const tbody = root.querySelector('.table-editor-grid tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';
    // Header
    if (table.hasHeader) {
      const tr = document.createElement('tr');
      for (let c = 0; c < table.columns.length; c++) {
        const col = table.columns[c];
        const th = document.createElement('th');
        const name = document.createElement('input');
        name.type = 'text';
        name.className = 'te-col-name';
        name.value = String(col.name || '');
        name.addEventListener('input', () => {
          col.name = name.value;
          patch(table);
        });
        const width = document.createElement('select');
        width.className = 'te-col-width';
        width.innerHTML = `<option value="auto">Auto</option><option value="s">S</option><option value="m">M</option><option value="l">L</option><option value="xl">XL</option>`;
        width.value = String(col.width || 'auto');
        width.addEventListener('change', () => { col.width = width.value; patch(table); });
        const head = document.createElement('div');
        head.className = 'te-col-head';
        head.appendChild(name);
        head.appendChild(width);
        th.appendChild(head);
        tr.appendChild(th);
      }
      thead.appendChild(tr);
    }
    // Body
    for (let r = 0; r < table.rows.length; r++) {
      const row = table.rows[r];
      const tr = document.createElement('tr');
      for (let c = 0; c < table.columns.length; c++) {
        const td = document.createElement('td');
        const ta = document.createElement('textarea');
        ta.className = 'te-cell';
        ta.value = String(row.cells[c] || '');
        ta.setAttribute('data-r', String(r));
        ta.setAttribute('data-c', String(c));
        ta.rows = 1;
        ta.spellcheck = false;
        ta.addEventListener('focus', () => { selRow = r; selCol = c; });
        ta.addEventListener('input', () => { row.cells[c] = ta.value; patch(table); autosize(ta); });
        ta.addEventListener('keydown', (e) => onKeyNav(e, ta));
        ta.addEventListener('paste', onPaste);
        td.appendChild(ta);
        tr.appendChild(td);
        setTimeout(() => autosize(ta), 0);
      }
      tbody.appendChild(tr);
    }
  }

  function autosize(ta) {
    try { ta.style.height = 'auto'; ta.style.height = Math.max(24, ta.scrollHeight) + 'px'; } catch {}
  }

  function moveTo(r, c, { createRowIfNeeded = false } = {}) {
    if (r < 0) r = 0;
    if (c < 0) c = 0;
    if (r >= table.rows.length) {
      if (createRowIfNeeded) {
        table.rows.push({ id: genId('row'), cells: Array(table.columns.length).fill('') });
        patch(table); renderGrid();
      }
      r = table.rows.length - 1;
    }
    if (c >= table.columns.length) c = table.columns.length - 1;
    selRow = r; selCol = c;
    const next = root.querySelector(`.te-cell[data-r="${r}"][data-c="${c}"]`);
    if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
  }

  function caretAtStart(ta) { return (ta.selectionStart || 0) === 0 && (ta.selectionEnd || 0) === 0; }
  function caretAtEnd(ta) { const l = (ta.value || '').length; return (ta.selectionStart || 0) === l && (ta.selectionEnd || 0) === l; }

  function onKeyNav(e, ta) {
    const r = Number(ta.getAttribute('data-r')||0);
    const c = Number(ta.getAttribute('data-c')||0);
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      moveTo(r+1, c, { createRowIfNeeded: (r+1) >= table.rows.length });
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      let nr = r, nc = c + (e.shiftKey ? -1 : 1);
      if (nc >= table.columns.length) { nr = r + 1; nc = 0; ensureRows(nr+1); }
      if (nc < 0) { nr = Math.max(0, r - 1); nc = table.columns.length - 1; }
      patch(table); renderGrid();
      moveTo(nr, nc, { createRowIfNeeded: true });
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveTo(r+1, c); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveTo(r-1, c); return; }
    if (e.key === 'ArrowRight') {
      if (caretAtEnd(ta)) { e.preventDefault(); moveTo(r, Math.min(table.columns.length-1, c+1)); return; }
      return;
    }
    if (e.key === 'ArrowLeft') {
      if (caretAtStart(ta)) { e.preventDefault(); moveTo(r, Math.max(0, c-1)); return; }
      return;
    }
    if (e.key === 'Escape') { try { closeModal(); } catch {}; }
  }

  function onPaste(e) {
    try {
      const ta = e.target;
      const r0 = Number(ta.getAttribute('data-r')||0);
      const c0 = Number(ta.getAttribute('data-c')||0);
      const txt = e.clipboardData?.getData('text') || '';
      if (!txt) return;
      const rows = txt.split(/\r?\n/).filter(x => x.length > 0);
      if (!rows.length) return;
      e.preventDefault();
      const parsed = rows.map(line => line.split(/\t|,/));
      const needCols = Math.max(...parsed.map(r => r.length));
      ensureCols(c0 + needCols);
      ensureRows(r0 + parsed.length);
      for (let i = 0; i < parsed.length; i++) {
        const r = r0 + i;
        for (let j = 0; j < parsed[i].length; j++) {
          const c = c0 + j;
          table.rows[r].cells[c] = String(parsed[i][j] || '');
        }
      }
      patch(table); renderGrid();
      moveTo(r0 + parsed.length - 1, c0 + parsed[parsed.length-1].length - 1);
    } catch {}
  }

  root.querySelector('#teHeaderToggle')?.addEventListener('change', (e) => {
    table.hasHeader = !!e.target.checked; patch(table); renderGrid();
  });
  root.querySelector('#teAddRow')?.addEventListener('click', () => { table.rows.push({ id: genId('row'), cells: Array(table.columns.length).fill('') }); patch(table); renderGrid(); });
  root.querySelector('#teAddCol')?.addEventListener('click', () => { ensureCols(table.columns.length+1); patch(table); renderGrid(); });
  root.querySelector('#teDelRow')?.addEventListener('click', () => {
    if (table.rows.length <= 1) return; const idx = Math.min(table.rows.length-1, Math.max(0, selRow));
    table.rows.splice(idx, 1); patch(table); renderGrid();
  });
  root.querySelector('#teDelCol')?.addEventListener('click', () => {
    if (table.columns.length <= 1) return; const idx = Math.min(table.columns.length-1, Math.max(0, selCol));
    table.columns.splice(idx, 1); for (const r of table.rows) r.cells.splice(idx, 1); patch(table); renderGrid();
  });
  // Add Delete action within the editor modal
  try {
    const controls = root.querySelector('.table-editor-controls');
    if (controls) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'chip';
      delBtn.id = 'teDelete';
      delBtn.textContent = 'Delete Table…';
      // place before Close
      const closeBtn = controls.querySelector('#teClose');
      if (closeBtn?.parentNode) closeBtn.parentNode.insertBefore(delBtn, closeBtn);
      else controls.appendChild(delBtn);
      delBtn.addEventListener('click', async () => {
        // Detect emptiness similarly to edit renderer
        const isEmpty = (() => {
          try {
            const allCellsEmpty = (table.rows || []).every(r => (Array.isArray(r?.cells) ? r.cells : []).every(c => String(c || '').trim() === ''));
            if (!allCellsEmpty) return false;
            const allColsDefault = (table.columns || []).every((col, i) => {
              const name = String(col?.name || '').trim();
              return name === '' || name === `Column ${i+1}`;
            });
            return allColsDefault;
          } catch { return true; }
        })();
        if (!isEmpty) {
          const ok = window.confirm('Delete this table? It contains content. This cannot be undone.');
          if (!ok) return;
        }
        const { deleteTableBlock } = await import('./tableEditor.js');
        await deleteTableBlock({ page, blockId: block.id });
      });
    }
  } catch {}

  root.querySelector('#teClose')?.addEventListener('click', () => { closeModal(); });
  root.addEventListener('click', (e) => { if (e.target === root) { closeModal(); } });

  renderGrid();
  return { close: () => { try { closeModal(); } catch {} } };
}
