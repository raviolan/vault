import { fetchJson } from '../../lib/http.js';

const cache = {
  classes: null,
  races: null,
  spellsByList: new Map(),
};

async function fetchAllPaged(basePath) {
  // Basic pagination handling; stop if no next
  let url = `${basePath}${basePath.includes('?') ? '&' : '?'}limit=1000`;
  const out = [];
  for (let i = 0; i < 10; i++) {
    const data = await fetchJson(url);
    if (Array.isArray(data?.results)) out.push(...data.results);
    if (!data?.next) break;
    url = data.next.replace('https://api.open5e.com', '/api/open5e');
  }
  return out;
}

export async function getClasses() {
  if (cache.classes) return cache.classes;
  const list = await fetchAllPaged('/api/open5e/v1/classes/');
  cache.classes = list;
  return list;
}

export async function getRaces() {
  if (cache.races) return cache.races;
  const list = await fetchAllPaged('/api/open5e/v1/races/');
  cache.races = list;
  return list;
}

export async function getSpellsForList(listName) {
  const key = String(listName || '').toLowerCase();
  if (cache.spellsByList.has(key)) return cache.spellsByList.get(key);
  // Try server side filtering first if supported; otherwise filter client-side
  const all = await fetchAllPaged('/api/open5e/spells/');
  const filtered = all.filter(s => {
    const lists = (s.spell_lists || s.dnd_class || '').toLowerCase();
    return lists.includes(key);
  });
  cache.spellsByList.set(key, filtered);
  return filtered;
}

