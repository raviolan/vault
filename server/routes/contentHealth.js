import fs from 'node:fs';
import path from 'node:path';
import { sendJson } from '../lib/http.js';
import { defaultUserState } from './userState.js';
import { getAllTagsWithUsage, computeFlags } from './tagInspector.js';

const PAGE_TYPES = new Set(['note', 'npc', 'character', 'location', 'arc', 'tool']);
const STALE_DAYS = 180;

function normalizeTitleKey(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function cleanupText(t) {
  let s = String(t || '');
  s = s.replace(/^\s*(?:[-*•]\s+)/, '');
  s = s.replace(/\[\[page:[^\]|\]]+\|([^\]]+)\]\]/gi, '$1');
  s = s.replace(/\[\[page:[^\]]+\]\]/gi, '');
  return s.replace(/\s+/g, ' ').trim();
}

function isJunkText(t) {
  const raw = String(t || '').trim();
  if (!raw) return true;
  if (raw.startsWith('#')) return true;
  const s = raw.toLowerCase();
  if (s === 'hello world') return true;
  if (s.startsWith('lorem ipsum')) return true;
  return false;
}

function readUserState(ctx) {
  const p = path.join(ctx.USER_DIR, 'state.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return defaultUserState(); }
}

function getSectionPageIds(state) {
  const sections = Array.isArray(state?.sections)
    ? state.sections
    : (Array.isArray(state?.sections?.items) ? state.sections.items : []);
  const ids = new Set();
  for (const sec of sections) {
    for (const id of (Array.isArray(sec?.pageIds) ? sec.pageIds : [])) ids.add(String(id));
  }
  return ids;
}

function safeParse(json) {
  if (!json) return {};
  if (typeof json === 'object') return json;
  try { return JSON.parse(String(json)); } catch { return {}; }
}

function buildPageHref(page) {
  if (page?.slug) return `/p/${encodeURIComponent(page.slug)}`;
  return `/page/${encodeURIComponent(page?.id || '')}`;
}

function pageItem(page, detail, extra = {}) {
  return {
    kind: 'page',
    id: page.id,
    label: page.title,
    href: buildPageHref(page),
    meta: [page.type, detail].filter(Boolean).join(' · '),
    ...extra,
  };
}

function isoAgeDays(iso) {
  const ts = Date.parse(String(iso || ''));
  if (!Number.isFinite(ts)) return null;
  return Math.floor((Date.now() - ts) / 86400000);
}

function scanLinks(pageId, text, titleToPageIds, inboundCounts, unresolvedByPage) {
  const s = String(text || '');
  if (!s) return;
  const re = /\[\[([^\]]+?)\]\]/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const inner = String(m[1] || '').trim();
    if (!inner) continue;
    const idMatch = inner.match(/^page:([0-9a-fA-F-]{36})(?:\|[\s\S]*)?$/i);
    if (idMatch) {
      const target = idMatch[1];
      inboundCounts.set(target, (inboundCounts.get(target) || 0) + 1);
      continue;
    }
    if (/^page:/i.test(inner)) continue;
    const key = normalizeTitleKey(inner);
    const candidates = titleToPageIds.get(key) || [];
    if (candidates.length === 1) inboundCounts.set(candidates[0], (inboundCounts.get(candidates[0]) || 0) + 1);
    else unresolvedByPage.set(pageId, (unresolvedByPage.get(pageId) || 0) + 1);
  }
}

function scanBlockText(pageId, raw, titleToPageIds, inboundCounts, unresolvedCounts) {
  const text = String(raw || '');
  if (!text) return;
  scanLinks(pageId, text, titleToPageIds, inboundCounts, unresolvedCounts);
}

export function routeContentHealth(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  if (pathname !== '/api/content-health' || req.method !== 'GET') return false;

  const pages = ctx.db.prepare(`
    SELECT p.id, p.title, p.type, p.slug, p.archived_at, p.updated_at, p.created_at
    FROM pages p
    ORDER BY p.updated_at DESC, p.created_at DESC
  `).all().map(r => ({
    id: r.id,
    title: r.title,
    type: r.type,
    slug: r.slug,
    archivedAt: r.archived_at ? new Date(r.archived_at * 1000).toISOString() : null,
    updatedAt: new Date(r.updated_at * 1000).toISOString(),
    createdAt: new Date(r.created_at * 1000).toISOString(),
  }));
  const titleToPageIds = new Map();
  for (const page of pages) {
    const key = normalizeTitleKey(page.title);
    if (!titleToPageIds.has(key)) titleToPageIds.set(key, []);
    titleToPageIds.get(key).push(page.id);
  }

  const tagCounts = new Map(ctx.db.prepare(`
    SELECT pt.page_id AS page_id, COUNT(DISTINCT pt.tag_id) AS count
    FROM page_tags pt
    GROUP BY pt.page_id
  `).all().map(r => [String(r.page_id), Number(r.count || 0)]));

  const sheetRows = ctx.db.prepare('SELECT page_id, sheet_json FROM page_sheets').all();
  const hasTagline = new Set();
  for (const row of sheetRows) {
    const sheet = safeParse(row.sheet_json);
    if (String(sheet?.tagline || '').trim()) hasTagline.add(String(row.page_id));
  }

  const blocks = ctx.db.prepare(`
    SELECT b.page_id, b.type, b.content_json, b.props_json
    FROM blocks b
    ORDER BY b.page_id, b.parent_id IS NOT NULL, b.parent_id, b.sort, b.created_at, b.id
  `).all();
  const hasSummary = new Set(hasTagline);
  const inboundCounts = new Map();
  const unresolvedCounts = new Map();
  for (const row of blocks) {
    const pageId = String(row.page_id);
    const content = safeParse(row.content_json);
    const props = safeParse(row.props_json);
    if (!hasSummary.has(pageId)) {
      const raw = row.type === 'section' ? content?.title : content?.text;
      const cleaned = cleanupText(raw);
      if (cleaned && !isJunkText(cleaned) && cleaned.length >= 24) hasSummary.add(pageId);
    }
    if (content?.text) scanBlockText(pageId, content.text, titleToPageIds, inboundCounts, unresolvedCounts);
    if (content?.title) scanBlockText(pageId, content.title, titleToPageIds, inboundCounts, unresolvedCounts);
    if (props?.html) scanBlockText(pageId, props.html, titleToPageIds, inboundCounts, unresolvedCounts);
  }

  const userState = readUserState(ctx);
  const sectionPageIds = getSectionPageIds(userState);
  const staleCutoff = Date.now() - (STALE_DAYS * 86400000);

  const pagesWithoutSummaries = [];
  const pagesWithoutTags = [];
  const unresolvedLinks = [];
  const missingBacklinks = [];
  const stalePages = [];
  const archiveCandidates = [];
  const orphans = [];

  for (const page of pages) {
    const pageId = String(page.id);
    const archived = !!page.archivedAt;
    const inbound = Number(inboundCounts.get(pageId) || 0);
    const unresolved = Number(unresolvedCounts.get(pageId) || 0);
    const tagCount = Number(tagCounts.get(pageId) || 0);
    const updatedTs = Date.parse(page.updatedAt);
    const ageDays = isoAgeDays(page.updatedAt);

    if (!archived && !hasSummary.has(pageId)) pagesWithoutSummaries.push(pageItem(page, 'No tagline or overview text'));
    if (!archived && tagCount === 0) pagesWithoutTags.push(pageItem(page, 'No tags'));
    if (!archived && unresolved > 0) unresolvedLinks.push(pageItem(page, `${unresolved} unresolved link${unresolved === 1 ? '' : 's'}`, { count: unresolved }));
    if (!archived && inbound === 0) missingBacklinks.push(pageItem(page, 'No inbound links', { count: 0 }));
    if (!archived && Number.isFinite(updatedTs) && updatedTs <= staleCutoff) stalePages.push(pageItem(page, `${ageDays} days since update`, { ageDays }));
    if (!archived && inbound === 0 && tagCount <= 1 && Number.isFinite(updatedTs) && updatedTs <= staleCutoff) {
      archiveCandidates.push(pageItem(page, `${ageDays} days stale · ${tagCount} tag${tagCount === 1 ? '' : 's'}`, { ageDays }));
    }
    if (!archived && inbound === 0 && !sectionPageIds.has(pageId)) orphans.push(pageItem(page, 'No section and no inbound links'));
  }

  unresolvedLinks.sort((a, b) => (b.count || 0) - (a.count || 0) || a.label.localeCompare(b.label));
  stalePages.sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0) || a.label.localeCompare(b.label));
  archiveCandidates.sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0) || a.label.localeCompare(b.label));
  const alphaByLabel = (a, b) => a.label.localeCompare(b.label);
  pagesWithoutSummaries.sort(alphaByLabel);
  pagesWithoutTags.sort(alphaByLabel);
  missingBacklinks.sort(alphaByLabel);
  orphans.sort(alphaByLabel);

  const tagRows = getAllTagsWithUsage(ctx.db);
  const tagFlags = computeFlags(tagRows, PAGE_TYPES);
  const suspiciousTags = tagRows
    .map(r => ({ row: r, flags: tagFlags.get(r.id) || {} }))
    .filter(({ flags }) => flags.usedOnce || flags.duplicatesStructure || flags.nearDuplicateGroupKey || flags.weirdFormat)
    .sort((a, b) => a.row.tag.localeCompare(b.row.tag))
    .map(({ row, flags }) => ({
      kind: 'tag',
      label: row.tag,
      href: `/tags?tag=${encodeURIComponent(row.key)}`,
      meta: [
        row.usedOnPagesCount === 1 ? 'Used once' : '',
        flags.duplicatesStructure ? 'Matches page type' : '',
        flags.nearDuplicateGroupKey ? 'Possible near-duplicate' : '',
        flags.weirdFormat ? 'Weird formatting' : '',
      ].filter(Boolean).join(' · '),
    }));

  const categories = [
    {
      key: 'pagesWithoutSummaries',
      label: 'Pages without summaries',
      description: 'No tagline or usable overview text detected.',
      count: pagesWithoutSummaries.length,
      href: null,
      items: pagesWithoutSummaries.slice(0, 8),
    },
    {
      key: 'pagesWithoutTags',
      label: 'Pages without tags',
      description: 'Builds directly on Tag Inspector coverage.',
      count: pagesWithoutTags.length,
      href: '/tags',
      items: pagesWithoutTags.slice(0, 8),
    },
    {
      key: 'suspiciousTags',
      label: 'Weak tags',
      description: 'Suspicious, redundant, or low-signal tags from Tag Inspector.',
      count: suspiciousTags.length,
      href: '/tags',
      items: suspiciousTags.slice(0, 8),
    },
    {
      key: 'unresolvedLinks',
      label: 'Unresolved wiki links',
      description: 'Pages containing legacy [[Title]] links that do not map cleanly to a page.',
      count: unresolvedLinks.reduce((sum, item) => sum + Number(item.count || 0), 0),
      href: '/cleanup',
      items: unresolvedLinks.slice(0, 8),
    },
    {
      key: 'orphans',
      label: 'Orphan pages',
      description: 'No section placement and no inbound links.',
      count: orphans.length,
      href: '/cleanup',
      items: orphans.slice(0, 8),
    },
    {
      key: 'missingBacklinks',
      label: 'Missing backlinks',
      description: 'Pages with no inbound links from other pages.',
      count: missingBacklinks.length,
      href: null,
      items: missingBacklinks.slice(0, 8),
    },
    {
      key: 'stalePages',
      label: 'Stale pages',
      description: `Not updated in the last ${STALE_DAYS} days.`,
      count: stalePages.length,
      href: null,
      items: stalePages.slice(0, 8),
    },
    {
      key: 'archiveCandidates',
      label: 'Archive candidates',
      description: `Stale, low-link, low-tag pages. Review before archiving.`,
      count: archiveCandidates.length,
      href: '/archive',
      items: archiveCandidates.slice(0, 8),
    },
  ];

  sendJson(res, 200, {
    summary: {
      totalPages: pages.filter(p => !p.archivedAt).length,
      archivedPages: pages.filter(p => !!p.archivedAt).length,
      pagesWithIssues: new Set([
        ...pagesWithoutSummaries.map(x => x.id),
        ...pagesWithoutTags.map(x => x.id),
        ...unresolvedLinks.map(x => x.id),
        ...missingBacklinks.map(x => x.id),
        ...stalePages.map(x => x.id),
        ...archiveCandidates.map(x => x.id),
        ...orphans.map(x => x.id),
      ]).size,
      staleThresholdDays: STALE_DAYS,
      dateCoverage: 'pending',
    },
    categories,
  });
  return true;
}
