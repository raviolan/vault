import { getNavGroupsForSection } from './navGroups.js';
import { normalizeSections } from '../lib/sections.js';
import { sectionForType, sectionKeyForType } from '../lib/pageSections.js';

function getFolderTitleByPageId(state) {
  const { sections } = normalizeSections(state || {});
  const out = new Map();
  for (const sec of sections || []) {
    const title = String(sec.title || '').trim();
    const lower = title.toLowerCase();
    if (!title) continue;
    if (lower === 'enemies') continue;
    if (lower === 'favorites') continue;
    for (const pageId of (Array.isArray(sec.pageIds) ? sec.pageIds : [])) {
      out.set(String(pageId), title);
    }
  }
  return out;
}

export function buildArchiveBuckets(pages, state) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const folderTitleByPageId = getFolderTitleByPageId(state);
  const groupsCache = new Map();
  const buckets = new Map();

  function getGroupMeta(sectionKey) {
    if (!groupsCache.has(sectionKey)) {
      const { groups, pageToGroup } = getNavGroupsForSection(sectionKey);
      const groupById = new Map((groups || []).map(g => [String(g.id), String(g.name || '')]));
      groupsCache.set(sectionKey, { groupById, pageToGroup: pageToGroup || {} });
    }
    return groupsCache.get(sectionKey);
  }

  for (const page of (Array.isArray(pages) ? pages : [])) {
    if (!page?.archivedAt) continue;
    const folderTitle = folderTitleByPageId.get(String(page.id)) || '';
    const sectionLabel = folderTitle || sectionForType(page.type);
    let bucketId = `archive:${sectionLabel.toLowerCase()}`;
    let bucketName = sectionLabel;

    if (!folderTitle) {
      const sectionKey = sectionKeyForType(page.type || 'note');
      const { groupById, pageToGroup } = getGroupMeta(sectionKey);
      const groupId = pageToGroup?.[page.id] ? String(pageToGroup[page.id]) : '';
      const groupName = groupId ? groupById.get(groupId) || '' : '';
      if (groupName) {
        bucketId = `${bucketId}:${groupId}`;
        bucketName = `${sectionLabel} / ${groupName}`;
      }
    }

    if (!buckets.has(bucketId)) buckets.set(bucketId, { id: bucketId, name: bucketName, pages: [] });
    buckets.get(bucketId).pages.push(page);
  }

  return Array.from(buckets.values())
    .map(bucket => ({
      ...bucket,
      pages: bucket.pages.slice().sort((a, b) => collator.compare(a?.title || '', b?.title || '')),
    }))
    .sort((a, b) => collator.compare(a?.name || '', b?.name || ''));
}
