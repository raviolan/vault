import { setBreadcrumb, setPageActionsEnabled } from '../../lib/ui.js';
import { $, $$, escapeHtml } from '../../lib/dom.js';
import { getClasses, getRaces, getSpellsForList } from './api.js';
import { assignStandardArray, buildPreview, maxSpellLevel, pickSpells } from './gen.js';
import { renderForm, renderPreview, updateFavoriteButton, setLoading } from './render.js';
import { saveToVault } from './save.js';
import { isFavorited, toggleFavorite } from './favorites.js';

function titleCase(s) { return String(s || '').replace(/\b([a-z])/g, (m, c) => c.toUpperCase()); }

export async function render(outlet) {
  setBreadcrumb('Enemy Generator');
  setPageActionsEnabled({ canEdit: false, canDelete: false });
  if (!outlet) return;

  // Load base data
  let classes = [], races = [];
  let error = '';
  try { classes = await getClasses(); } catch { error = 'Failed to load classes.'; }
  try { races = await getRaces(); } catch { error = (error || '') + ' Failed to load races.'; }

  renderForm(outlet, { classes, races, state: { level: 1, favorited: isFavorited() } });
  if (error) $('#egError').textContent = error.trim();
  const selClass = $('#egClass');
  const selRace = $('#egRace');
  const inpLevel = $('#egLevel');
  const preRoot = $('#egPreview');
  const btnGen = $('#egGenerate');
  const btnRe = $('#egReroll');
  const btnSave = $('#egSave');
  const btnFav = $('#egFavorite');

  if (selClass) selClass.value = '';
  if (selRace) selRace.value = '';
  updateFavoriteButton(isFavorited());

  let lastGen = null;

  async function doGenerate() {
    $('#egError').textContent = '';
    const lvl = Math.max(1, Math.min(20, Number(inpLevel?.value || 1)));
    const clsId = selClass?.value || '';
    if (!clsId) { $('#egError').textContent = 'Select a class first.'; return; }
    const raceId = selRace?.value || '';
    setLoading(true, 'Generating…');
    try {
      const cls = classes.find(c => (c.slug || c.name) === clsId);
      const race = raceId ? races.find(r => (r.slug || r.name) === raceId) : (races[Math.floor(Math.random() * races.length)] || null);
      const stats = assignStandardArray(String(cls?.slug || cls?.name || '').toLowerCase(), race);
      const base = buildPreview({ name: `${race?.name || ''} ${cls?.name || ''}`.trim(), race, cls, level: lvl, stats });

      // Class proficiencies summary
      const profsBits = [cls?.prof_saving_throws, cls?.prof_weapons, cls?.prof_armor, cls?.prof_tools].filter(Boolean).map(x => escapeHtml(String(x)));
      const profsHtml = profsBits.length ? `<ul>${profsBits.map(x => `<li>${x}</li>`).join('')}</ul>` : '';

      // Race traits summary
      const traits = (race?.desc || '').split(/\n+/).filter(Boolean).slice(0, 3).map(s => `<li>${escapeHtml(s)}</li>`).join('');
      const traitsHtml = traits ? `<ul>${traits}</ul>` : '';

      // Spells (if any)
      let spellsHtml = '';
      let spellsText = '';
      if (cls?.spellcasting_ability) {
        const listKey = String((cls?.name || '').split(' ')[0]).toLowerCase();
        let spellList = [];
        try { spellList = await getSpellsForList(listKey); } catch {}
        const msl = maxSpellLevel(String(cls?.slug || cls?.name || '').toLowerCase(), lvl);
        const pick = pickSpells(spellList, msl, lvl);
        if ((pick.cantrips.length + pick.spells.length) > 0) {
          const can = pick.cantrips.map(s => escapeHtml(s.name)).join(', ');
          const spl = pick.spells.map(s => `${escapeHtml(s.name)} (L${escapeHtml(String(s.level||s.level_int||''))})`).join(', ');
          spellsHtml = `<div><strong>Cantrips:</strong> ${can || '(—)'}<br/><strong>Prepared Spells:</strong> ${spl || '(—)'}</div>`;
          spellsText = `Cantrips: ${can || '(—)'}; Spells: ${pick.spells.map(s => s.name).join(', ')}`;
        }
      }

      const out = { ...base, traitsHtml, profsHtml, spellsHtml };
      out.traitsText = (race?.desc || '').split(/\n+/).filter(Boolean).slice(0, 3).join(' ');
      out.profsText = profsBits.join('; ');
      out.spellsText = spellsText;
      out.name = `${titleCase(race?.name || '')} ${titleCase(cls?.name || '')}`.trim();
      lastGen = out;
      renderPreview(preRoot, out);
      btnSave?.removeAttribute('hidden');
    } finally {
      setLoading(false);
    }
  }

  btnGen?.addEventListener('click', doGenerate);
  btnRe?.addEventListener('click', doGenerate);
  btnSave?.addEventListener('click', async () => { if (lastGen) await saveToVault(lastGen); });
  btnFav?.addEventListener('click', () => { toggleFavorite(); try { import('../../features/favorites.js').then(m => m.renderFavorites()); } catch {} });
}
