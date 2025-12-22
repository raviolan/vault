// Lightweight helpers for per-user nav sections stored in user state.
// State shape (additive, backwards-compatible):
//   userState.sections = [ { id, title, pageIds: [] } ]
//   userState.toolPrefs = { enemyGenerator: { lastSectionId: string } }

export function normalizeSections(st) {
  const sections = Array.isArray(st?.sections) ? st.sections.map(s => ({ id: s.id, title: s.title, pageIds: Array.isArray(s.pageIds) ? s.pageIds.slice() : [] })) : [];
  const toolPrefs = typeof st?.toolPrefs === 'object' && st.toolPrefs ? { ...st.toolPrefs } : {};
  return { sections, toolPrefs };
}

export function listSections(st) {
  const { sections } = normalizeSections(st || {});
  return sections.map(s => ({ id: s.id, title: s.title }));
}

function makeId() { return 'sec-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); }

export function ensureSection(st, title) {
  const n = normalizeSections(st || {});
  const t = String(title || '').trim();
  if (!t) return { nextUserState: { ...st }, sectionId: null };
  const existing = n.sections.find(s => s.title.toLowerCase() === t.toLowerCase());
  if (existing) return { nextUserState: { ...st, sections: n.sections }, sectionId: existing.id };
  const id = makeId();
  const next = { ...st, sections: [...n.sections, { id, title: t, pageIds: [] }] };
  return { nextUserState: next, sectionId: id };
}

export function addPageToSection(st, sectionId, pageId) {
  const n = normalizeSections(st || {});
  const idx = n.sections.findIndex(s => s.id === sectionId);
  if (idx < 0) return { ...st };
  const sec = { ...n.sections[idx] };
  const ids = new Set(sec.pageIds);
  ids.add(pageId);
  const updated = { ...st, sections: n.sections.slice(0, idx).concat([{ ...sec, pageIds: Array.from(ids) }], n.sections.slice(idx + 1)) };
  return updated;
}

export function removePageFromSection(st, sectionId, pageId) {
  const n = normalizeSections(st || {});
  const idx = n.sections.findIndex(s => s.id === sectionId);
  if (idx < 0) return { ...st };
  const sec = { ...n.sections[idx] };
  const ids = new Set(sec.pageIds);
  ids.delete(pageId);
  const updated = { ...st, sections: n.sections.slice(0, idx).concat([{ ...sec, pageIds: Array.from(ids) }], n.sections.slice(idx + 1)) };
  return updated;
}

