import { getAppState, setAppState } from '../../miniapps/state.js';
import { escapeHtml } from '../../lib/dom.js';

const APP_ID = 'todo';

function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

export const TodoApp = {
  id: APP_ID,
  title: 'To-Do',
  surfaces: ['rightPanel'],
  mount(rootEl, ctx) {
    const input = (rootEl || document).querySelector('#todoInput');
    const addBtn = (rootEl || document).querySelector('#todoAdd');
    const list = (rootEl || document).querySelector('#todoList');
    if (!list) return () => {};

    const todoSection = (rootEl || document).querySelector(".right-panel[data-panel='todo']");

    function migrateLegacy(legacy) {
      const arr = Array.isArray(legacy) ? legacy : [];
      let idx = 0;
      return {
        items: arr.map(x => {
          const text = typeof x === 'string' ? x : (x?.text ?? '');
          const done = typeof x === 'object' ? !!x?.done : false;
          return { id: crypto.randomUUID(), text, done, parentId: null, sort: idx += 10, collapsed: false };
        }),
        showCompleted: true,
      };
    }

    let state = (() => {
      const raw = getAppState(APP_ID, []);
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.items)) return { items: raw.items.slice(), showCompleted: !!raw.showCompleted };
      return migrateLegacy(raw);
    })();

    const persist = debounce(() => setAppState(APP_ID, state), 120);

    // Header toggle for show/hide completed
    let toggleBtn;
    const updateToggleLabel = () => {
      if (!toggleBtn) return;
      toggleBtn.textContent = state.showCompleted ? 'Hide completed' : 'Show completed';
      toggleBtn.setAttribute('aria-pressed', String(!state.showCompleted));
    };
    const mountHeaderToggle = () => {
      if (!todoSection) return;
      const h = todoSection.querySelector('h3.meta');
      if (!h) return;
      if (toggleBtn) return;
      toggleBtn = document.createElement('button');
      toggleBtn.className = 'chip';
      toggleBtn.style.marginLeft = '8px';
      toggleBtn.id = 'todoToggleCompleted';
      toggleBtn.addEventListener('click', () => {
        state.showCompleted = !state.showCompleted;
        render();
        persist();
      });
      h.insertAdjacentElement('afterend', toggleBtn);
      updateToggleLabel();
    };

    const childrenOf = (pid) => state.items.filter(it => (it.parentId || null) === (pid || null)).sort((a,b)=> (a.sort||0)-(b.sort||0));
    const hasChildren = (id) => state.items.some(it => (it.parentId||null) === (id||null));
    const byId = () => { const m = new Map(); state.items.forEach(it => m.set(it.id, it)); return m; };
    const descendantCount = (id) => { const stack = childrenOf(id).slice(); let n = 0; while (stack.length) { const cur = stack.pop(); n++; childrenOf(cur.id).forEach(c=>stack.push(c)); } return n; };

    function render() {
      updateToggleLabel();
      list.classList.add('todo-list');
      list.innerHTML = '';
      const roots = childrenOf(null);
      for (const it of roots) list.appendChild(renderItem(it, 0));
    }

    function renderItem(item, level) {
      const li = document.createElement('li');
      li.className = 'todo-item top-level';
      if (hasChildren(item.id)) li.classList.add('is-parent');
      li.dataset.id = item.id;
      li.dataset.level = String(level);
      const row = document.createElement('div'); row.className = 'todo-row';

      if (hasChildren(item.id)) {
        const chevron = document.createElement('button');
        chevron.className = 'todo-chevron' + (item.collapsed ? '' : ' expanded');
        chevron.type = 'button'; chevron.title = item.collapsed ? 'Expand' : 'Collapse';
        chevron.textContent = '›'; row.appendChild(chevron);
      } else { const spacer = document.createElement('div'); spacer.className = 'todo-chevron-spacer'; row.appendChild(spacer); }

      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'todo-check'; cb.checked = !!item.done; row.appendChild(cb);
      const text = document.createElement('span'); text.className = 'todo-text' + (hasChildren(item.id) ? ' parent-text' : '') + (item.done ? ' done' : ''); text.contentEditable = 'true'; text.spellcheck = false; text.textContent = item.text || ''; row.appendChild(text);
      if (item.collapsed && hasChildren(item.id)) { const badge = document.createElement('span'); const cnt = descendantCount(item.id); if (cnt>0) { badge.className='todo-count-badge'; badge.textContent=String(cnt); row.appendChild(badge);} }
      const grip = document.createElement('span'); grip.className = 'todo-grip'; grip.title = 'Drag to reorder or nest'; grip.textContent = '⋮⋮'; row.appendChild(grip);
      const actions = document.createElement('div'); actions.className = 'todo-actions'; const del = document.createElement('button'); del.className='todo-more'; del.type='button'; del.title='Delete'; del.textContent='×'; actions.appendChild(del); row.appendChild(actions);

      li.appendChild(row);
      const kids = childrenOf(item.id);
      if (kids.length) { const ul = document.createElement('ul'); ul.className = 'todo-sublist' + (item.collapsed ? ' collapsed' : ''); ul.dataset.parent = item.id; for (const c of kids) ul.appendChild(renderChild(c, level+1)); li.appendChild(ul); }

      if (!state.showCompleted && item.done) li.classList.add('hiding');
      return li;
    }

    function renderChild(item, level) {
      const li = document.createElement('li'); li.className = 'todo-item'; li.dataset.id = item.id; li.dataset.level = String(level);
      const row = document.createElement('div'); row.className = 'todo-row';
      if (hasChildren(item.id)) { const chevron = document.createElement('button'); chevron.className = 'todo-chevron' + (item.collapsed ? '' : ' expanded'); chevron.type='button'; chevron.title=item.collapsed?'Expand':'Collapse'; chevron.textContent='›'; row.appendChild(chevron);} else { const spacer = document.createElement('div'); spacer.className='todo-chevron-spacer'; row.appendChild(spacer); }
      const cb = document.createElement('input'); cb.type='checkbox'; cb.className='todo-check'; cb.checked=!!item.done; row.appendChild(cb);
      const text = document.createElement('span'); text.className='todo-text' + (hasChildren(item.id)?' parent-text':'') + (item.done?' done':''); text.contentEditable='true'; text.spellcheck=false; text.textContent=item.text || ''; row.appendChild(text);
      if (item.collapsed && hasChildren(item.id)) { const badge=document.createElement('span'); const cnt=descendantCount(item.id); if (cnt>0) { badge.className='todo-count-badge'; badge.textContent=String(cnt); row.appendChild(badge);} }
      const grip = document.createElement('span'); grip.className='todo-grip'; grip.title='Drag to reorder or nest'; grip.textContent='⋮⋮'; row.appendChild(grip);
      const actions = document.createElement('div'); actions.className = 'todo-actions'; const del = document.createElement('button'); del.className='todo-more'; del.type='button'; del.title='Delete'; del.textContent='×'; actions.appendChild(del); row.appendChild(actions);
      li.appendChild(row);
      const kids = childrenOf(item.id); if (kids.length) { const ul=document.createElement('ul'); ul.className='todo-sublist' + (item.collapsed?' collapsed':''); ul.dataset.parent=item.id; for (const c of kids) ul.appendChild(renderChild(c, level+1)); li.appendChild(ul);} if (!state.showCompleted && item.done) li.classList.add('hiding');
      return li;
    }

    function addItem(text) {
      const trimmed = (text || '').trim(); if (!trimmed) return;
      const siblings = childrenOf(null);
      const maxSort = siblings.reduce((m, it) => Math.max(m, it.sort || 0), 0);
      state.items.push({ id: crypto.randomUUID(), text: trimmed, done: false, parentId: null, sort: maxSort + 10, collapsed: false });
      render();
      persist();
    }
    function removeItem(id) {
      const ids = new Set([id]);
      const collect = (pid) => { childrenOf(pid).forEach(c => { ids.add(c.id); collect(c.id); }); };
      collect(id);
      state.items = state.items.filter(it => !ids.has(it.id));
      render();
      persist();
    }
    function toggleDone(id, done) { const m = byId(); const it = m.get(id); if (!it) return; it.done = !!done; render(); persist(); }
    function updateText(id, text) { const it = byId().get(id); if (!it) return; it.text = (text || '').trim(); render(); persist(); }
    function toggleCollapsed(id) { const it = byId().get(id); if (!it) return; it.collapsed = !it.collapsed; render(); persist(); }

    // Drag & drop
    let drag = null;
    function clearDropIndicators() { list.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach(el => el.classList.remove('drop-before','drop-after','drop-into')); }
    function nearestItem(y) {
      const items = Array.from(list.querySelectorAll('.todo-item'));
      let best = null; let bestDist = Infinity;
      for (const el of items) { const r = el.getBoundingClientRect(); const mid = (r.top + r.bottom)/2; const d = Math.abs(y - mid); if (d < bestDist) { bestDist = d; best = el; } }
      return best;
    }
    function reindexSort(siblings) { siblings.sort((a,b)=>(a.sort||0)-(b.sort||0)); siblings.forEach((it,i)=>{ it.sort=(i+1)*10; }); }
    function onPointerDown(e) {
      const grip = e.target.closest('.todo-grip'); if (!grip) return;
      const itemEl = grip.closest('.todo-item'); if (!itemEl) return;
      const id = itemEl.dataset.id;
      drag = { id, startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY };
      e.target.setPointerCapture?.(e.pointerId);
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp, { once: true });
      e.preventDefault();
    }
    function onPointerMove(e) {
      if (!drag) return; drag.curX = e.clientX; drag.curY = e.clientY; clearDropIndicators();
      const target = nearestItem(drag.curY); if (!target) return;
      const r = target.getBoundingClientRect(); const intoZone = drag.curY > r.top + r.height*0.25 && drag.curY < r.bottom - r.height*0.25; const xOff = drag.curX - r.left; const level = parseInt(target.dataset.level||'0',10); const indentThreshold = 24;
      if (intoZone && xOff > (level * 24 + indentThreshold)) target.classList.add('drop-into');
      else if (drag.curY < r.top + r.height/2) target.classList.add('drop-before');
      else target.classList.add('drop-after');
    }
    function onPointerUp(e) {
      document.removeEventListener('pointermove', onPointerMove);
      const d = drag; drag = null; if (!d) return;
      const dropEl = list.querySelector('.drop-before, .drop-after, .drop-into');
      const dragged = byId().get(d.id);
      if (!dropEl || !dragged) { clearDropIndicators(); return; }
      const targetId = dropEl.closest('.todo-item')?.dataset.id; const targetItem = byId().get(targetId); if (!targetItem) { clearDropIndicators(); return; }
      const siblingsFor = (pid) => state.items.filter(it => (it.parentId||null) === (pid||null));
      if (dropEl.classList.contains('drop-into')) {
        dragged.parentId = targetItem.id; const sibs = siblingsFor(targetItem.id); const maxSort = sibs.reduce((m,it)=>Math.max(m, it.sort||0), 0); dragged.sort = maxSort + 10;
      } else {
        dragged.parentId = targetItem.parentId || null; if (dropEl.classList.contains('drop-before')) dragged.sort = (targetItem.sort||0) - 5; else dragged.sort = (targetItem.sort||0) + 5; reindexSort(siblingsFor(dragged.parentId));
      }
      // Prevent cycles
      const isDesc = (pid) => { if (!pid) return false; if (pid === dragged.id) return true; const p = byId().get(pid); return isDesc(p?.parentId || null); };
      if (isDesc(dragged.parentId)) dragged.parentId = targetItem.parentId || null;
      [dragged.parentId || null, targetItem.parentId || null, targetItem.id].forEach(pid => { const sibs = siblingsFor(pid); reindexSort(sibs); });
      clearDropIndicators(); render(); persist();
    }

    // Delegated interactions
    function onListClick(e) {
      const chevron = e.target.closest('.todo-chevron');
      if (chevron) { const id = e.target.closest('.todo-item')?.dataset.id; if (id) toggleCollapsed(id); return; }
      const del = e.target.closest('.todo-more'); if (del) { const id = e.target.closest('.todo-item')?.dataset.id; if (id) removeItem(id); return; }
    }
    function onListChange(e) { const cb = e.target.closest('.todo-check'); if (cb) { const id = e.target.closest('.todo-item')?.dataset.id; if (id) toggleDone(id, cb.checked); } }
    function onListKeydown(e) { const el = e.target.closest('.todo-text'); if (!el) return; const id = e.target.closest('.todo-item')?.dataset.id; if (!id) return; if (e.key==='Enter'){ e.preventDefault(); el.blur(); } else if (e.key==='Escape'){ e.preventDefault(); const it = byId().get(id); el.textContent = it?.text || ''; el.blur(); } else if (e.key==='Backspace'){ if (!(el.textContent||'').trim()) { e.preventDefault(); removeItem(id); }}}
    function onListBlur(e) { const el = e.target.closest('.todo-text'); if (!el) return; const id = e.target.closest('.todo-item')?.dataset.id; if (!id) return; updateText(id, el.textContent || ''); }

    // Input add
    const onAddClick = () => { addItem(input?.value || ''); if (input) input.value = ''; };
    const onInputKeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); onAddClick(); } };

    // Mount listeners
    if (addBtn) addBtn.addEventListener('click', onAddClick);
    if (input) input.addEventListener('keydown', onInputKeydown);
    list.addEventListener('click', onListClick);
    list.addEventListener('change', onListChange);
    list.addEventListener('keydown', onListKeydown);
    list.addEventListener('blur', onListBlur, true);
    list.addEventListener('pointerdown', onPointerDown);
    mountHeaderToggle();

    render();
    // Persist migrated structure immediately to new namespace (with legacy maintained by bridge)
    setAppState(APP_ID, state);

    return () => {
      if (addBtn) addBtn.removeEventListener('click', onAddClick);
      if (input) input.removeEventListener('keydown', onInputKeydown);
      list.removeEventListener('click', onListClick);
      list.removeEventListener('change', onListChange);
      list.removeEventListener('keydown', onListKeydown);
      list.removeEventListener('blur', onListBlur, true);
      list.removeEventListener('pointerdown', onPointerDown);
      if (list) list.innerHTML = '';
    };
  },
  unmount() {},
};
