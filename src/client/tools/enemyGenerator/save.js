import { fetchJson } from '../../lib/http.js';
import { navigate } from '../../lib/router.js';
import { getState, updateState } from '../../lib/state.js';
import { listSections, ensureSection, addPageToSection } from '../../lib/sections.js';
import { refreshNav } from '../../features/nav.js';

export async function saveToVault(gen) {
  const defaultTitle = `Enemy: ${gen.name} — L${gen.level} ${gen.raceName} ${gen.className}`.replace(/\s+/g, ' ').trim();
  const selection = await pickSectionAndTitle({ defaultTitle });
  if (!selection) return; // cancelled
  const { title, sectionId, newSectionTitle } = selection;
  const type = 'npc';
  // Create page
  const page = await fetchJson('/api/pages', { method: 'POST', body: JSON.stringify({ title, type }) });
  const pageId = page.id;
  const blocks = [];
  let sort = 0;
  const add = async (type, content, props = {}) => {
    const b = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}/blocks`, {
      method: 'POST',
      body: JSON.stringify({ type, content, props })
    });
    blocks.push(b);
    sort++;
  };

  await add('heading', { text: gen.name }, { level: 2 });
  await add('section', { text: 'Overview' });
  await add('paragraph', { text: `Level ${gen.level} ${gen.raceName} ${gen.className}. AC ${gen.ac}, HP ${gen.hp}, Speed ${gen.speed}. Proficiency +${gen.prof}.` });
  await add('section', { text: 'Stats' });
  await add('paragraph', { text: `STR ${gen.stats.str} (${fmt(gen.mod.str)}), DEX ${gen.stats.dex} (${fmt(gen.mod.dex)}), CON ${gen.stats.con} (${fmt(gen.mod.con)}), INT ${gen.stats.int} (${fmt(gen.mod.int)}), WIS ${gen.stats.wis} (${fmt(gen.mod.wis)}), CHA ${gen.stats.cha} (${fmt(gen.mod.cha)})` });
  await add('section', { text: 'Proficiencies' });
  await add('paragraph', { text: stripHtml(gen.profsText || '') || '(class baseline)' });
  await add('section', { text: 'Traits' });
  await add('paragraph', { text: stripHtml(gen.traitsText || '') || '(race summary)' });
  if (gen.spellsText) {
    await add('section', { text: 'Spells' });
    await add('paragraph', { text: stripHtml(gen.spellsText) });
  }

  // Append Combat details at the bottom (additive only)
  const c = gen.combat;
  if (c) {
    await add('section', { text: 'Combat' });
    if (c.actions && c.actions.length) {
      await add('section', { text: 'Actions' });
      for (const a of c.actions) {
        await add('paragraph', { text: `${a.name}: ${stripHtml(a.text.replace(/^.*?:\s*/, ''))}` });
      }
    }
    if (c.reactions && c.reactions.length) {
      await add('section', { text: 'Reactions' });
      for (const r of c.reactions) {
        await add('paragraph', { text: `${r.name}: ${stripHtml(r.text)}` });
      }
    }
    if (c.traits && c.traits.length) {
      await add('section', { text: 'Traits' });
      for (const t of c.traits) {
        await add('paragraph', { text: `${t.name}: ${stripHtml(t.text)}` });
      }
    }
    if (c.spellcasting) {
      await add('section', { text: 'Spellcasting' });
      await add('paragraph', { text: stripHtml(c.spellcasting.header) });
      for (const g of (c.spellcasting.spellsByLevel || [])) {
        await add('paragraph', { text: `${g.levelLabel}: ${g.spells.join(', ')}` });
      }
    }
  }

  // Tags
  const tags = ['enemy'].concat([gen.className, gen.raceName].filter(Boolean));
  try { await fetchJson(`/api/pages/${encodeURIComponent(pageId)}/tags`, { method: 'PUT', body: JSON.stringify({ tags }) }); } catch {}

  // Persist section membership and tool last used
  try {
    let st = getState();
    let secId = sectionId;
    if (!secId && newSectionTitle) {
      const r = ensureSection(st, newSectionTitle);
      st = r.nextUserState;
      secId = r.sectionId;
    }
    if (!secId) {
      // Create default section on first save
      const r = ensureSection(st, 'Enemies');
      st = r.nextUserState;
      secId = r.sectionId;
    }
    if (secId) st = addPageToSection(st, secId, pageId);
    const toolPrefs = { ...(st.toolPrefs || {}), enemyGenerator: { ...(st.toolPrefs?.enemyGenerator || {}), lastSectionId: secId || '' } };
    updateState({ ...st, toolPrefs });
  } catch {}

  // Refresh nav so the page appears under the selected section
  try { await refreshNav(); } catch {}

  navigate(`/page/${encodeURIComponent(pageId)}`);
}

function fmt(n) { return (n >= 0 ? '+' : '') + String(n); }
function stripHtml(s) { return String(s).replace(/<[^>]+>/g, '').trim(); }

async function pickSectionAndTitle({ defaultTitle }) {
  // Build lightweight modal
  return new Promise((resolve) => {
    const st = getState();
    const sections = listSections(st);
    const last = st?.toolPrefs?.enemyGenerator?.lastSectionId || '';
    const root = document.createElement('div');
    root.className = 'modal';
    root.style.display = 'block';
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.background = 'rgba(0,0,0,0.4)';
    root.style.zIndex = '1000';

    root.innerHTML = `
      <div class="card" style="max-width:520px; margin: 10% auto; padding:12px; background: var(--bg-default);">
        <h3 class="meta">Save to Vault</h3>
        <label style="display:block; margin:6px 0;">Title
          <input id="egSaveTitle" type="text" style="width:100%;" />
        </label>
        <label style="display:block; margin:6px 0;">Section
          <select id="egSaveSection" style="width:100%;">
            ${sections.map(s => `<option value="${s.id}" ${s.id===last?'selected':''}>${s.title}</option>`).join('')}
            <option value="__new__">+ New section…</option>
          </select>
        </label>
        <label id="egNewSecRow" style="display:none; margin:6px 0;">New section title
          <input id="egNewSectionTitle" type="text" style="width:100%;" />
        </label>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px;">
          <button id="egCancel" class="chip">Cancel</button>
          <button id="egConfirm" class="chip" data-primary>Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    const inputTitle = root.querySelector('#egSaveTitle');
    const sel = root.querySelector('#egSaveSection');
    const newRow = root.querySelector('#egNewSecRow');
    const inputNew = root.querySelector('#egNewSectionTitle');
    inputTitle.value = defaultTitle;

    sel.addEventListener('change', () => {
      const v = sel.value;
      newRow.style.display = (v === '__new__') ? 'block' : 'none';
    });

    root.querySelector('#egCancel').addEventListener('click', () => {
      root.remove();
      resolve(null);
    });
    root.querySelector('#egConfirm').addEventListener('click', () => {
      const v = sel.value;
      const titleVal = inputTitle.value.trim() || defaultTitle;
      const payload = (v === '__new__')
        ? { title: titleVal, sectionId: null, newSectionTitle: (inputNew.value.trim() || 'Enemies') }
        : { title: titleVal, sectionId: v || null, newSectionTitle: '' };
      root.remove();
      resolve(payload);
    });
  });
}
