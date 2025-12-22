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
  const { name, raceName, className, level, stats, mod, hp, ac, speed, prof, traitsHtml = '', profsHtml = '', spellsHtml = '' } = data;
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
    <p class="meta" style="margin-top:8px;">AC assumptions: basic armor per class; adjust as needed.</p>
  `;
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
