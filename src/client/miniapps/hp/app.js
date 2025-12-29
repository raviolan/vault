import { getAppState, setAppState } from '../../miniapps/state.js';
import { buildWikiTextNodes } from '../../features/wikiLinks.js';

const APP_ID = 'hp';

function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

function sum(arr) { return arr.reduce((n, x) => n + (Number(x?.dmg) || 0), 0); }

function formatInt(n) { const v = Math.max(0, Math.floor(Number(n) || 0)); return v; }

export const HpTrackerApp = {
  id: APP_ID,
  title: 'HP Tracker',
  surfaces: ['rightPanel'],
  mount(rootEl, ctx) {
    const mountEl = (ctx?.mountEl) || (rootEl || document).querySelector('#rightNotepadMount');
    if (!mountEl) return () => {};

    // Ensure mount can scroll when used in split/overlay areas
    try { mountEl.style.overflow = 'auto'; mountEl.style.minHeight = '0'; } catch {}

    let state = (() => {
      const raw = getAppState(APP_ID, { enemies: [] });
      if (raw && typeof raw === 'object' && Array.isArray(raw.enemies)) return { enemies: raw.enemies.slice() };
      return { enemies: [] };
    })();
    const persist = debounce(() => setAppState(APP_ID, state), 250);

    // Root container
    const root = document.createElement('div');
    root.className = 'hpTracker';

    // Top bar
    const bar = document.createElement('div');
    bar.className = 'hpTrackerBar';
    const title = document.createElement('div');
    title.textContent = 'HP Tracker';
    const addBtn = document.createElement('button');
    addBtn.className = 'chip';
    addBtn.type = 'button';
    addBtn.textContent = '+ Enemy';
    bar.appendChild(title);
    bar.appendChild(addBtn);
    root.appendChild(bar);

    const list = document.createElement('div');
    root.appendChild(list);

    function ensureEnemyDefaults(e) {
      return {
        id: e.id || crypto.randomUUID(),
        label: typeof e.label === 'string' ? e.label : '',
        target: Number.isFinite(e.target) ? e.target : 0,
        log: Array.isArray(e.log) ? e.log.map(l => ({ id: l.id || crypto.randomUUID(), who: l.who || '', dmg: Number(l.dmg) || 0, ts: l.ts || Date.now() })) : [],
      };
    }

    function addEnemy() {
      state.enemies = (state.enemies || []).slice();
      state.enemies.push({ id: crypto.randomUUID(), label: '', target: 0, log: [] });
      persist();
      renderList();
    }

    function removeEnemy(id) {
      state.enemies = (state.enemies || []).filter(e => e.id !== id);
      persist();
      renderList();
    }

    function addLogEntry(enemyId, who, dmg) {
      const e = state.enemies.find(x => x.id === enemyId);
      if (!e) return;
      const amt = Math.max(0, Math.floor(Number(dmg) || 0));
      if (!amt) return;
      e.log = (e.log || []).slice();
      e.log.push({ id: crypto.randomUUID(), who: String(who || '').trim(), dmg: amt, ts: Date.now() });
      persist();
      renderList();
    }

    function removeLogEntry(enemyId, entryId) {
      const e = state.enemies.find(x => x.id === enemyId);
      if (!e) return;
      e.log = (e.log || []).filter(l => l.id !== entryId);
      persist();
      renderList();
    }

    function updateEnemyLabel(enemyId, next) {
      const e = state.enemies.find(x => x.id === enemyId);
      if (!e) return;
      e.label = String(next || '');
      persist();
    }

    function updateEnemyTarget(enemyId, next) {
      const e = state.enemies.find(x => x.id === enemyId);
      if (!e) return;
      e.target = Math.max(0, Math.floor(Number(next) || 0));
      persist();
    }

    function renderEnemyCard(e) {
      e = ensureEnemyDefaults(e);
      const total = sum(e.log || []);
      const target = Math.max(0, Math.floor(Number(e.target) || 0));
      const down = target > 0 && total >= target;

      const card = document.createElement('div');
      card.className = 'hpEnemy' + (down ? ' hpEnemy--down' : '');
      card.dataset.id = e.id;

      // Header with remove and DOWN badge
      const header = document.createElement('div');
      header.className = 'hpEnemyHeader';
      const labelWrap = document.createElement('div');
      const removeBtn = document.createElement('button');
      removeBtn.className = 'chip';
      removeBtn.type = 'button';
      removeBtn.title = 'Remove enemy';
      removeBtn.textContent = '×';
      header.appendChild(labelWrap);
      const badge = document.createElement('span');
      badge.className = 'hpBadge';
      badge.textContent = 'DOWN';
      if (down) header.appendChild(badge);
      header.appendChild(removeBtn);
      card.appendChild(header);

      // Label + Target inputs
      const inputs = document.createElement('div');
      inputs.className = 'hpEnemyInputs';
      const label = document.createElement('input');
      label.type = 'text';
      label.placeholder = 'Enemy name or [[wikilink]]';
      label.value = e.label || '';
      const targetInput = document.createElement('input');
      targetInput.type = 'number';
      targetInput.min = '0';
      targetInput.step = '1';
      targetInput.inputMode = 'numeric';
      targetInput.value = String(target);
      inputs.appendChild(label);
      inputs.appendChild(targetInput);
      card.appendChild(inputs);

      // Preview line for label (wikilink-aware)
      const preview = document.createElement('div');
      preview.className = 'hpEnemyPreview';
      try {
        const frag = buildWikiTextNodes(e.label || '');
        preview.innerHTML = '';
        preview.appendChild(frag);
      } catch { preview.textContent = e.label || ''; }
      card.appendChild(preview);

      // Stats line
      const stats = document.createElement('div');
      stats.className = 'hpEnemyStats';
      const dmgText = document.createElement('span');
      const remainText = document.createElement('span');
      const remaining = Math.max(0, target - total);
      const overkill = Math.max(0, total - target);
      dmgText.textContent = `Damage ${total} / Target ${target}`;
      remainText.textContent = target > 0 ? (remaining > 0 ? `Remaining ${remaining}` : `Overkill +${overkill}`) : 'Remaining —';
      stats.appendChild(dmgText);
      stats.appendChild(remainText);
      card.appendChild(stats);

      // Progress element
      const prog = document.createElement('progress');
      prog.max = Math.max(1, target);
      prog.value = Math.min(total, prog.max);
      prog.style.width = '100%';
      card.appendChild(prog);

      // Damage entry form
      const form = document.createElement('form');
      form.className = 'hpForm';
      const whoInput = document.createElement('input');
      whoInput.type = 'text';
      whoInput.placeholder = 'who';
      const dmgInput = document.createElement('input');
      dmgInput.type = 'number';
      dmgInput.step = '1';
      dmgInput.min = '0';
      dmgInput.inputMode = 'numeric';
      dmgInput.placeholder = 'damage';
      const add = document.createElement('button');
      add.className = 'chip';
      add.type = 'submit';
      add.textContent = 'Add';
      form.appendChild(whoInput);
      form.appendChild(dmgInput);
      form.appendChild(add);
      card.appendChild(form);

      // Log list
      const logEl = document.createElement('div');
      logEl.className = 'hpLog';
      for (const entry of (e.log || [])) {
        const row = document.createElement('div');
        row.className = 'hpLogRow';
        row.dataset.id = entry.id;
        const left = document.createElement('div');
        const who = String(entry.who || '').trim();
        left.textContent = who ? `${who} – ${entry.dmg}` : String(entry.dmg);
        const right = document.createElement('div');
        const del = document.createElement('button');
        del.className = 'chip';
        del.title = 'Remove';
        del.type = 'button';
        del.textContent = '×';
        right.appendChild(del);
        row.appendChild(left);
        row.appendChild(right);
        logEl.appendChild(row);
        del.addEventListener('click', () => removeLogEntry(e.id, entry.id));
      }
      card.appendChild(logEl);

      // Wiring: inputs update state and local UI widgets in-place
      removeBtn.addEventListener('click', () => removeEnemy(e.id));
      label.addEventListener('input', () => {
        updateEnemyLabel(e.id, label.value);
        try { preview.innerHTML = ''; preview.appendChild(buildWikiTextNodes(label.value || '')); } catch {}
      });
      targetInput.addEventListener('input', () => {
        const v = formatInt(targetInput.value);
        updateEnemyTarget(e.id, v);
        const newTotal = sum(e.log || []);
        const rem = Math.max(0, v - newTotal);
        const over = Math.max(0, newTotal - v);
        dmgText.textContent = `Damage ${newTotal} / Target ${v}`;
        remainText.textContent = v > 0 ? (rem > 0 ? `Remaining ${rem}` : `Overkill +${over}`) : 'Remaining —';
        prog.max = Math.max(1, v);
        prog.value = Math.min(newTotal, prog.max);
        if (v > 0 && newTotal >= v) {
          if (!card.classList.contains('hpEnemy--down')) card.classList.add('hpEnemy--down');
          if (!badge.isConnected) header.insertBefore(badge, removeBtn);
        } else {
          card.classList.remove('hpEnemy--down');
          if (badge.isConnected) header.removeChild(badge);
        }
      });
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        addLogEntry(e.id, whoInput.value, dmgInput.value);
        dmgInput.value = '';
        try { dmgInput.focus(); } catch {}
      });

      return card;
    }

    function renderList() {
      list.innerHTML = '';
      const arr = Array.isArray(state.enemies) ? state.enemies : [];
      for (const e of arr) list.appendChild(renderEnemyCard(e));
    }

    addBtn.addEventListener('click', addEnemy);
    renderList();
    mountEl.innerHTML = '';
    mountEl.appendChild(root);

    // Persist initial shape to namespace
    setAppState(APP_ID, state);

    return () => {
      try { addBtn.removeEventListener('click', addEnemy); } catch {}
      try { mountEl.innerHTML = ''; } catch {}
    };
  },
  unmount() {},
};

