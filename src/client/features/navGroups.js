import { getUserState, patchUserState, flushUserState } from '../miniapps/state.js';

function normKey(key) {
  return String(key || '').toLowerCase();
}

function sanitizeName(name) {
  const s = String(name || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, 48);
}

function genId() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {}
  return 'g_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
}

function getAll() {
  const s = getUserState() || {};
  const all = s.navGroupsV1 && typeof s.navGroupsV1 === 'object' ? s.navGroupsV1 : {};
  return all;
}

function sortGroups(arr) {
  return (Array.isArray(arr) ? arr.slice() : []).sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function getNavGroupsForSection(sectionKey) {
  const key = normKey(sectionKey);
  const all = getAll();
  const entry = all[key] || { groups: [], pageToGroup: {} };
  const groups = sortGroups(entry.groups);
  const pageToGroup = entry.pageToGroup && typeof entry.pageToGroup === 'object' ? entry.pageToGroup : {};

  // One-time repair: coerce any name-based mappings to id-based
  const { nextPageToGroup, changed } = coerceGroupMappingToIds(groups, pageToGroup);
  if (changed) {
    // Persist repaired mapping without awaiting to avoid changing sync API
    const next = { groups: entry.groups || [], pageToGroup: nextPageToGroup };
    void setAllForSection(key, next);
  }
  return { groups, pageToGroup: nextPageToGroup };
}

// Repair mapping values: if a value matches a group name, convert to that group's id
function coerceGroupMappingToIds(groups, pageToGroup) {
  const nameToId = new Map((Array.isArray(groups) ? groups : []).map(g => [String(g.name), String(g.id)]));
  const ptg = { ...(pageToGroup || {}) };
  let changed = false;
  for (const [pid, v] of Object.entries(ptg)) {
    const sv = String(v || '');
    if (!sv) continue;
    // If already matches an id, keep it
    if ((Array.isArray(groups) ? groups : []).some(g => String(g.id) === sv)) continue;
    // If matches a name, convert
    if (nameToId.has(sv)) {
      ptg[pid] = nameToId.get(sv);
      changed = true;
    }
  }
  return { nextPageToGroup: ptg, changed };
}

async function setAllForSection(sectionKey, next) {
  const key = normKey(sectionKey);
  const all = getAll();
  const patch = { navGroupsV1: { ...all, [key]: next } };
  patchUserState(patch);
  await flushUserState();
  return true;
}

export async function addGroup(sectionKey, name) {
  const key = normKey(sectionKey);
  const val = sanitizeName(name);
  if (!val) return null;
  const all = getAll();
  const cur = all[key] || { groups: [], pageToGroup: {} };
  const nextOrder = cur.groups.length ? Math.max(...cur.groups.map(g => g.order || 0)) + 1 : 1;
  const id = genId();
  const next = { groups: [...cur.groups, { id, name: val, order: nextOrder }], pageToGroup: { ...(cur.pageToGroup || {}) } };
  await setAllForSection(key, next);
  return id;
}

export async function renameGroup(sectionKey, groupId, name) {
  const key = normKey(sectionKey);
  const val = sanitizeName(name);
  if (!val) return false;
  const all = getAll();
  const cur = all[key];
  if (!cur) return false;
  const groups = (cur.groups || []).map(g => g.id === groupId ? { ...g, name: val } : g);
  await setAllForSection(key, { groups, pageToGroup: { ...(cur.pageToGroup || {}) } });
  return true;
}

export async function deleteGroup(sectionKey, groupId) {
  const key = normKey(sectionKey);
  const all = getAll();
  const cur = all[key];
  if (!cur) return false;
  const groups = (cur.groups || []).filter(g => g.id !== groupId);
  const ptg = { ...(cur.pageToGroup || {}) };
  for (const pid of Object.keys(ptg)) {
    if (ptg[pid] === groupId) ptg[pid] = null;
  }
  await setAllForSection(key, { groups, pageToGroup: ptg });
  return true;
}

export async function setGroupForPage(sectionKey, pageId, groupId) {
  const key = normKey(sectionKey);
  const pid = String(pageId);
  const gid = groupId ? String(groupId) : null;
  const all = getAll();
  const cur = all[key] || { groups: [], pageToGroup: {} };
  const ptg = { ...(cur.pageToGroup || {}) };
  if (gid) ptg[pid] = gid; else delete ptg[pid];
  await setAllForSection(key, { groups: [...(cur.groups || [])], pageToGroup: ptg });
}
