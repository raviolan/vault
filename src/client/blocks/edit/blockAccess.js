import { parseMaybeJson } from '../tree.js';

export function normalizeParentId(v) {
  return v || null;
}

export function parseBlockRecord(raw) {
  return {
    ...raw,
    props: parseMaybeJson(raw?.propsJson) || {},
    content: parseMaybeJson(raw?.contentJson) || {},
  };
}

export function getParsedById(all, id) {
  const found = all.find((b) => String(b.id) === String(id));
  return found ? parseBlockRecord(found) : null;
}

export function getChildren(all, parentId) {
  const pid = normalizeParentId(parentId);
  return all
    .filter((b) => normalizeParentId(b.parentId) === pid)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map(parseBlockRecord);
}

export function getSiblings(all, parentId) {
  const pid = normalizeParentId(parentId);
  return all
    .filter((b) => normalizeParentId(b.parentId) === pid)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map(parseBlockRecord);
}

