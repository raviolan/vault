export function parseMaybeJson(x) {
  if (!x) return {};
  if (typeof x === 'object') return x;
  try { return JSON.parse(String(x)); } catch { return {}; }
}

export function blocksToTree(blocks) {
  const byId = new Map(blocks.map(b => [b.id, { ...b, children: [] }]));
  const roots = [];
  for (const b of byId.values()) {
    if (b.parentId && byId.has(b.parentId)) {
      byId.get(b.parentId).children.push(b);
    } else {
      roots.push(b);
    }
  }
  const sortFn = (a, b) => (a.sort ?? 0) - (b.sort ?? 0);
  const sortTree = (nodes) => { nodes.sort(sortFn); nodes.forEach(n => sortTree(n.children)); };
  sortTree(roots);
  return roots;
}

