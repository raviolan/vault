import { getUserState, patchUserState } from '../miniapps/state.js';

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
  return { groups, pageToGroup };
}

function setAllForSection(sectionKey, next) {
  const key = normKey(sectionKey);
  const all = getAll();
  const patch = { navGroupsV1: { ...all, [key]: next } };
  return patchUserState(patch);
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
  ptg[pid] = gid;
  await setAllForSection(key, { groups: [...(cur.groups || [])], pageToGroup: ptg });
}

