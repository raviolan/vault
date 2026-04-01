import { randomUUID } from 'node:crypto';
import { ensureTag } from './tags.js';

const PRECISIONS = new Set(['year', 'month', 'day']);

function toIso(ts) {
  return ts ? new Date(ts * 1000).toISOString() : null;
}

function parseArchivedMode(raw) {
  const mode = String(raw || '').toLowerCase();
  if (mode === 'include' || mode === 'only') return mode;
  return 'exclude';
}

function archiveWhere(alias, archived) {
  const col = `${alias}.archived_at`;
  if (archived === 'only') return `${col} IS NOT NULL`;
  if (archived === 'include') return '1=1';
  return `${col} IS NULL`;
}

function cleanText(value, { required = false, max = 240 } = {}) {
  const text = String(value ?? '').trim();
  if (!text) {
    if (required) throw Object.assign(new Error('required'), { status: 400 });
    return '';
  }
  if (text.length > max) throw Object.assign(new Error(`must be <= ${max} chars`), { status: 400 });
  return text;
}

function toIntOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function toUnixOrNull(value) {
  if (!value) return null;
  const ts = new Date(String(value)).getTime();
  if (!Number.isFinite(ts)) throw Object.assign(new Error('archivedAt invalid'), { status: 400 });
  return Math.floor(ts / 1000);
}

function compareDateParts(a, b) {
  const left = [a.year, a.month || 0, a.day || 0];
  const right = [b.year, b.month || 0, b.day || 0];
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

function parseDateParts(input, prefix, { required = false } = {}) {
  const precision = String(input?.[`${prefix}Precision`] || input?.[`${prefix}_precision`] || (required ? 'day' : '')).toLowerCase();
  const year = toIntOrNull(input?.[`${prefix}Year`] ?? input?.[`${prefix}_year`]);
  const month = toIntOrNull(input?.[`${prefix}Month`] ?? input?.[`${prefix}_month`]);
  const day = toIntOrNull(input?.[`${prefix}Day`] ?? input?.[`${prefix}_day`]);

  if (year == null) {
    if (required) throw Object.assign(new Error(`${prefix} year required`), { status: 400 });
    return null;
  }
  if (!PRECISIONS.has(precision)) throw Object.assign(new Error(`${prefix} precision invalid`), { status: 400 });
  if (month != null && (month < 1 || month > 12)) throw Object.assign(new Error(`${prefix} month invalid`), { status: 400 });
  if (day != null && (day < 1 || day > 31)) throw Object.assign(new Error(`${prefix} day invalid`), { status: 400 });
  if (precision === 'year' && (month != null || day != null)) throw Object.assign(new Error(`${prefix} precision does not allow month/day`), { status: 400 });
  if (precision === 'month' && month == null) throw Object.assign(new Error(`${prefix} month required`), { status: 400 });
  if (precision === 'month' && day != null) throw Object.assign(new Error(`${prefix} precision does not allow day`), { status: 400 });
  if (precision === 'day' && (month == null || day == null)) throw Object.assign(new Error(`${prefix} month/day required`), { status: 400 });
  return {
    year,
    month: precision === 'year' ? null : month,
    day: precision === 'day' ? day : null,
    precision,
  };
}

function normalizeIdList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function assertPageIdsExist(db, ids) {
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  const found = new Set(db.prepare(`SELECT id FROM pages WHERE id IN (${placeholders})`).all(...ids).map((row) => String(row.id)));
  for (const id of ids) {
    if (!found.has(id)) throw Object.assign(new Error(`page not found: ${id}`), { status: 400 });
  }
}

function formatYear(year) {
  return String(year);
}

function formatDate(parts) {
  if (!parts) return '';
  const year = formatYear(parts.year);
  if (parts.precision === 'year') return year;
  const month = String(parts.month).padStart(2, '0');
  if (parts.precision === 'month') return `${year}-${month}`;
  const day = String(parts.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mapEventRow(row) {
  const start = {
    year: Number(row.start_year),
    month: row.start_month == null ? null : Number(row.start_month),
    day: row.start_day == null ? null : Number(row.start_day),
    precision: row.start_precision,
  };
  const end = row.end_year == null ? null : {
    year: Number(row.end_year),
    month: row.end_month == null ? null : Number(row.end_month),
    day: row.end_day == null ? null : Number(row.end_day),
    precision: row.end_precision,
  };
  return {
    id: row.id,
    title: row.title,
    summary: row.summary || '',
    eventType: row.event_type || '',
    archivedAt: toIso(row.archived_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    date: {
      start,
      end,
      label: end ? `${formatDate(start)} - ${formatDate(end)}` : formatDate(start),
    },
    arc: row.arc_page_id ? { id: row.arc_page_id, title: row.arc_title || 'Untitled', slug: row.arc_slug || null } : null,
    location: row.location_page_id ? { id: row.location_page_id, title: row.location_title || 'Untitled', slug: row.location_slug || null } : null,
    linkedPages: [],
    tags: [],
  };
}

function replaceLinkedPages(db, eventId, pageIds) {
  db.prepare('DELETE FROM timeline_event_pages WHERE event_id = ?').run(eventId);
  if (!pageIds.length) return;
  const stmt = db.prepare('INSERT INTO timeline_event_pages(event_id, page_id, sort) VALUES (?, ?, ?)');
  pageIds.forEach((pageId, index) => stmt.run(eventId, pageId, index));
}

function replaceTags(db, eventId, tagNames) {
  db.prepare('DELETE FROM timeline_event_tags WHERE event_id = ?').run(eventId);
  if (!tagNames.length) return;
  const stmt = db.prepare('INSERT OR IGNORE INTO timeline_event_tags(event_id, tag_id) VALUES (?, ?)');
  for (const tagName of tagNames) {
    const tag = ensureTag(db, tagName);
    stmt.run(eventId, tag.id);
  }
}

function loadEventRelations(db, events) {
  if (!events.length) return events;
  const ids = events.map((event) => event.id);
  const placeholders = ids.map(() => '?').join(',');
  const byId = new Map(events.map((event) => [event.id, event]));

  const pageRows = db.prepare(
    `SELECT tep.event_id, p.id, p.title, p.slug, p.type
       FROM timeline_event_pages tep
       JOIN pages p ON p.id = tep.page_id
      WHERE tep.event_id IN (${placeholders})
      ORDER BY tep.event_id, tep.sort, p.title COLLATE NOCASE`
  ).all(...ids);
  for (const row of pageRows) {
    byId.get(row.event_id)?.linkedPages.push({
      id: row.id,
      title: row.title,
      slug: row.slug || null,
      type: row.type || '',
    });
  }

  const tagRows = db.prepare(
    `SELECT tet.event_id, t.display_name
       FROM timeline_event_tags tet
       JOIN tags t ON t.id = tet.tag_id
      WHERE tet.event_id IN (${placeholders})
      ORDER BY tet.event_id, t.name`
  ).all(...ids);
  for (const row of tagRows) {
    byId.get(row.event_id)?.tags.push(row.display_name);
  }
  return events;
}

function buildWhere({ archived = 'exclude', eventType, arcPageId, locationPageId, tag }) {
  const where = [archiveWhere('e', archived)];
  const params = [];
  if (eventType) {
    where.push('e.event_type = ?');
    params.push(String(eventType));
  }
  if (arcPageId) {
    where.push('e.arc_page_id = ?');
    params.push(String(arcPageId));
  }
  if (locationPageId) {
    where.push('e.location_page_id = ?');
    params.push(String(locationPageId));
  }
  if (tag) {
    where.push(`EXISTS (
      SELECT 1
        FROM timeline_event_tags tet
        JOIN tags t ON t.id = tet.tag_id
       WHERE tet.event_id = e.id
         AND t.name = lower(?)
    )`);
    params.push(String(tag).trim());
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listTimelineEvents(db, options = {}) {
  const archived = parseArchivedMode(options.archived);
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 200));
  const eventType = cleanText(options.eventType, { max: 64 });
  const arcPageId = cleanText(options.arcPageId, { max: 64 });
  const locationPageId = cleanText(options.locationPageId, { max: 64 });
  const tag = cleanText(options.tag, { max: 64 });
  const { clause, params } = buildWhere({ archived, eventType, arcPageId, locationPageId, tag });

  const rows = db.prepare(
    `SELECT e.*,
            arc.title AS arc_title,
            arc.slug AS arc_slug,
            loc.title AS location_title,
            loc.slug AS location_slug
       FROM timeline_events e
       LEFT JOIN pages arc ON arc.id = e.arc_page_id
       LEFT JOIN pages loc ON loc.id = e.location_page_id
       ${clause}
      ORDER BY e.start_year ASC, COALESCE(e.start_month, 0) ASC, COALESCE(e.start_day, 0) ASC, e.created_at ASC
      LIMIT ?`
  ).all(...params, limit);

  const events = loadEventRelations(db, rows.map(mapEventRow));
  const filters = getTimelineFilterOptions(db, { archived });
  return { events, filters, archived };
}

export function getTimelineEvent(db, eventId) {
  const row = db.prepare(
    `SELECT e.*,
            arc.title AS arc_title,
            arc.slug AS arc_slug,
            loc.title AS location_title,
            loc.slug AS location_slug
       FROM timeline_events e
       LEFT JOIN pages arc ON arc.id = e.arc_page_id
       LEFT JOIN pages loc ON loc.id = e.location_page_id
      WHERE e.id = ?`
  ).get(eventId);
  if (!row) return null;
  return loadEventRelations(db, [mapEventRow(row)])[0] || null;
}

export function getTimelineFilterOptions(db, { archived = 'exclude' } = {}) {
  const archiveClause = archiveWhere('e', archived);
  const eventTypes = db.prepare(
    `SELECT e.event_type AS value, COUNT(*) AS count
       FROM timeline_events e
      WHERE ${archiveClause} AND e.event_type <> ''
      GROUP BY e.event_type
      ORDER BY e.event_type COLLATE NOCASE`
  ).all().map((row) => ({ value: row.value, count: Number(row.count || 0) }));

  const arcs = db.prepare(
    `SELECT p.id, p.title, p.slug, COUNT(*) AS count
       FROM timeline_events e
       JOIN pages p ON p.id = e.arc_page_id
      WHERE ${archiveClause}
      GROUP BY p.id, p.title, p.slug
      ORDER BY p.title COLLATE NOCASE`
  ).all().map((row) => ({ id: row.id, title: row.title, slug: row.slug || null, count: Number(row.count || 0) }));

  const locations = db.prepare(
    `SELECT p.id, p.title, p.slug, COUNT(*) AS count
       FROM timeline_events e
       JOIN pages p ON p.id = e.location_page_id
      WHERE ${archiveClause}
      GROUP BY p.id, p.title, p.slug
      ORDER BY p.title COLLATE NOCASE`
  ).all().map((row) => ({ id: row.id, title: row.title, slug: row.slug || null, count: Number(row.count || 0) }));

  const tags = db.prepare(
    `SELECT t.name, t.display_name, COUNT(*) AS count
       FROM timeline_events e
       JOIN timeline_event_tags tet ON tet.event_id = e.id
       JOIN tags t ON t.id = tet.tag_id
      WHERE ${archiveClause}
      GROUP BY t.id, t.name, t.display_name
      ORDER BY t.name`
  ).all().map((row) => ({ name: row.name, display: row.display_name, count: Number(row.count || 0) }));

  return { eventTypes, arcs, locations, tags };
}

function normalizeTimelinePayload(db, payload, current = null) {
  const title = payload.title !== undefined ? cleanText(payload.title, { required: true, max: 200 }) : current?.title;
  const summary = payload.summary !== undefined ? cleanText(payload.summary, { max: 1000 }) : current?.summary || '';
  const eventType = payload.eventType !== undefined ? cleanText(payload.eventType, { max: 64 }) : current?.eventType || '';
  const start = (payload.startYear !== undefined || payload.startMonth !== undefined || payload.startDay !== undefined || payload.startPrecision !== undefined)
    ? parseDateParts(payload, 'start', { required: true })
    : current?.date?.start || null;
  if (!start) throw Object.assign(new Error('start date required'), { status: 400 });
  const endTouched = ['endYear', 'endMonth', 'endDay', 'endPrecision'].some((key) => Object.prototype.hasOwnProperty.call(payload || {}, key));
  const end = endTouched ? parseDateParts(payload, 'end', { required: false }) : (current?.date?.end || null);
  if (end && compareDateParts(end, start) < 0) throw Object.assign(new Error('end date must be after start date'), { status: 400 });

  const arcPageId = payload.arcPageId !== undefined ? cleanText(payload.arcPageId, { max: 64 }) || null : (current?.arc?.id || null);
  const locationPageId = payload.locationPageId !== undefined ? cleanText(payload.locationPageId, { max: 64 }) || null : (current?.location?.id || null);
  const linkedPageIds = payload.linkedPageIds !== undefined ? normalizeIdList(payload.linkedPageIds) : ((current?.linkedPages || []).map((page) => page.id));
  const tags = payload.tags !== undefined ? normalizeIdList(payload.tags.map((tag) => String(tag).trim()).filter(Boolean)) : (current?.tags || []);
  const archivedAt = payload.archived !== undefined
    ? (payload.archived ? new Date().toISOString() : null)
    : (payload.archivedAt !== undefined ? (payload.archivedAt ? String(payload.archivedAt) : null) : current?.archivedAt);

  const pageIdsToCheck = [
    ...(arcPageId ? [arcPageId] : []),
    ...(locationPageId ? [locationPageId] : []),
    ...linkedPageIds,
  ];
  assertPageIdsExist(db, pageIdsToCheck);

  return {
    title,
    summary,
    eventType,
    start,
    end,
    arcPageId,
    locationPageId,
    linkedPageIds,
    tags,
    archivedAt: toUnixOrNull(archivedAt),
  };
}

export function createTimelineEvent(db, payload) {
  const next = normalizeTimelinePayload(db, payload);
  const id = randomUUID();
  const ts = Math.floor(Date.now() / 1000);
  const trx = db.transaction(() => {
    db.prepare(
      `INSERT INTO timeline_events(
         id, title, summary, event_type,
         start_year, start_month, start_day, start_precision,
         end_year, end_month, end_day, end_precision,
         arc_page_id, location_page_id, archived_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      next.title,
      next.summary,
      next.eventType,
      next.start.year,
      next.start.month,
      next.start.day,
      next.start.precision,
      next.end?.year ?? null,
      next.end?.month ?? null,
      next.end?.day ?? null,
      next.end?.precision ?? null,
      next.arcPageId,
      next.locationPageId,
      next.archivedAt,
      ts,
      ts,
    );
    replaceLinkedPages(db, id, next.linkedPageIds);
    replaceTags(db, id, next.tags);
  });
  trx();
  return getTimelineEvent(db, id);
}

export function patchTimelineEvent(db, eventId, payload) {
  const current = getTimelineEvent(db, eventId);
  if (!current) return null;
  const next = normalizeTimelinePayload(db, payload, current);
  const ts = Math.floor(Date.now() / 1000);
  const trx = db.transaction(() => {
    db.prepare(
      `UPDATE timeline_events
          SET title = ?,
              summary = ?,
              event_type = ?,
              start_year = ?,
              start_month = ?,
              start_day = ?,
              start_precision = ?,
              end_year = ?,
              end_month = ?,
              end_day = ?,
              end_precision = ?,
              arc_page_id = ?,
              location_page_id = ?,
              archived_at = ?,
              updated_at = ?
        WHERE id = ?`
    ).run(
      next.title,
      next.summary,
      next.eventType,
      next.start.year,
      next.start.month,
      next.start.day,
      next.start.precision,
      next.end?.year ?? null,
      next.end?.month ?? null,
      next.end?.day ?? null,
      next.end?.precision ?? null,
      next.arcPageId,
      next.locationPageId,
      next.archivedAt,
      ts,
      eventId,
    );
    replaceLinkedPages(db, eventId, next.linkedPageIds);
    replaceTags(db, eventId, next.tags);
  });
  trx();
  return getTimelineEvent(db, eventId);
}

export function deleteTimelineEvent(db, eventId) {
  const info = db.prepare('DELETE FROM timeline_events WHERE id = ?').run(eventId);
  return Number(info.changes || 0) > 0;
}
