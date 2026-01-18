import { $, escapeHtml } from '../../lib/dom.js';

export function renderForm(root, opts) {
  const { classes = [], races = [], state = {} } = opts;
  root.innerHTML = `
    <section class="card" aria-label="Enemy Generator" id="egRoot">
      <div class="toolbar" style="display:flex; gap:8px; align-items:center; justify-content:space-between;">
        <div style="display:flex; gap:8px; align-items:center;">
          <label>Level <input id="egLevel" type="number" min="1" max="20" required value="${escapeHtml(String(state.level || 1))}" /></label>
          <label>Class 
            <select id="egClass" required>
              <option value="">Select class…</option>
              ${classes.map(c => `<option value="${escapeHtml(c.slug || c.name)}">${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </label>
          <label>Race 
            <select id="egRace">
              <option value="">Random</option>
              ${races.map(r => `<option value="${escapeHtml(r.slug || r.name)}">${escapeHtml(r.name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <button id="egFavorite" class="chip" aria-pressed="${state.favorited ? 'true' : 'false'}" title="Favorite">${state.favorited ? '★' : '☆'}</button>
          <button id="egGenerate" class="chip" data-primary>Generate</button>
          <button id="egReroll" class="chip">Re-roll</button>
          <button id="egSave" class="chip" hidden>Save to Vault</button>
        </div>
      </div>
      <div id="egLoading" class="meta" aria-live="polite" role="status" style="min-height:1em;"></div>
      <div id="egError" class="meta" style="color:var(--fg-danger);"></div>
      <div id="egPreview" class="card" style="margin-top:10px;"></div>
    </section>
  `;
}

export function updateFavoriteButton(favorited) {
  const btn = $('#egFavorite');
  if (!btn) return;
  btn.setAttribute('aria-pressed', favorited ? 'true' : 'false');
  btn.textContent = favorited ? '★' : '☆';
}

export function renderPreview(preRoot, data) {
  if (!preRoot) return;
  if (!data) { preRoot.innerHTML = ''; return; }
  const { name, raceName, className, level, stats, mod, hp, ac, speed, prof, traitsHtml = '', profsHtml = '', spellsHtml = '', combat } = data;
  const statRow = (k, label) => `<div><strong>${label}:</strong> ${stats[k]} (${mod[k]>=0?'+':''}${mod[k]})</div>`;
  preRoot.innerHTML = `
    <h2>${escapeHtml(name)}</h2>
    <p class="meta">Level ${level} ${escapeHtml(raceName)} ${escapeHtml(className)} · AC ${ac} · HP ${hp} · Speed ${speed} · Proficiency +${prof}</p>
    <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:6px;">
      ${statRow('str', 'STR')}
      ${statRow('dex', 'DEX')}
      ${statRow('con', 'CON')}
      ${statRow('int', 'INT')}
      ${statRow('wis', 'WIS')}
      ${statRow('cha', 'CHA')}
    </div>
    <div style="margin-top:8px;">
      <h3 class="meta">Proficiencies</h3>
      <div>${profsHtml || '<span class="meta">(from class baseline)</span>'}</div>
    </div>
    <div style="margin-top:8px;">
      <h3 class="meta">Race Traits</h3>
      <div>${traitsHtml || '<span class="meta">(summary)</span>'}</div>
    </div>
    ${spellsHtml ? `<div style="margin-top:8px;"><h3 class=\"meta\">Spells</h3><div>${spellsHtml}</div></div>` : ''}
    <div style="margin-top:10px;">
      <button id="egToggleCombat" class="chip" aria-expanded="false">Show combat details</button>
      <div id="egCombat" hidden></div>
    </div>
    <p class="meta" style="margin-top:8px;">AC assumptions: basic armor per class; adjust as needed.</p>
  `;

  // Wire toggle and render details lazily
  const btn = document.getElementById('egToggleCombat');
  const panel = document.getElementById('egCombat');
  if (btn && panel && combat) {
    const fill = () => {
      const html = [];
      if (combat.actions?.length) {
        html.push('<h4 class="meta">Actions</h4>');
        for (const a of combat.actions) html.push(`<div class="meta"><strong>${escapeHtml(a.name)}:</strong> ${escapeHtml(a.text.replace(/^.*?:\s*/, ''))}</div>`);
      }
      if (combat.reactions?.length) {
        html.push('<h4 class="meta" style="margin-top:6px;">Reactions</h4>');
        for (const r of combat.reactions) html.push(`<div class="meta"><strong>${escapeHtml(r.name)}:</strong> ${escapeHtml(r.text)}</div>`);
      }
      if (combat.traits?.length) {
        html.push('<h4 class="meta" style="margin-top:6px;">Traits</h4>');
        for (const t of combat.traits) html.push(`<div class="meta"><strong>${escapeHtml(t.name)}:</strong> ${escapeHtml(t.text)}</div>`);
      }
      if (combat.spellcasting) {
        html.push('<h4 class="meta" style="margin-top:6px;">Spellcasting</h4>');
        html.push(`<div class="meta">${escapeHtml(combat.spellcasting.header)}</div>`);
        for (const g of (combat.spellcasting.spellsByLevel || [])) {
          html.push(`<div class="meta"><strong>${escapeHtml(g.levelLabel)}:</strong> ${escapeHtml((g.spells || []).join(', '))}</div>`);
        }
      }
      panel.innerHTML = html.join('');
    };
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      const next = !expanded;
      btn.setAttribute('aria-expanded', String(next));
      btn.textContent = next ? 'Hide combat details' : 'Show combat details';
      panel.toggleAttribute('hidden', !next);
      if (next && !panel.innerHTML) fill();
    });
  }
}

export function setLoading(busy, text = 'Generating…') {
  const ids = ['egGenerate', 'egReroll', 'egSave', 'egClass', 'egRace', 'egLevel', 'egFavorite'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.toggleAttribute('disabled', !!busy);
  }
  const root = document.getElementById('egRoot');
  if (root) root.setAttribute('aria-busy', busy ? 'true' : 'false');
  const msg = document.getElementById('egLoading');
  if (msg) msg.textContent = busy ? text : '';
}
