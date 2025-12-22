import { fetchJson } from '../../lib/http.js';
import { navigate } from '../../lib/router.js';

export async function saveToVault(gen) {
  const defaultTitle = `Enemy: ${gen.name} — L${gen.level} ${gen.raceName} ${gen.className}`.replace(/\s+/g, ' ').trim();
  const title = prompt('Page title', defaultTitle) || defaultTitle;
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

  // Tags
  const tags = ['enemy'].concat([gen.className, gen.raceName].filter(Boolean));
  try { await fetchJson(`/api/pages/${encodeURIComponent(pageId)}/tags`, { method: 'PUT', body: JSON.stringify({ tags }) }); } catch {}

  navigate(`/page/${encodeURIComponent(pageId)}`);
}

function fmt(n) { return (n >= 0 ? '+' : '') + String(n); }
function stripHtml(s) { return String(s).replace(/<[^>]+>/g, '').trim(); }

