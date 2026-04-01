import { sendJson, readBody, parseJsonSafe, decodePathParam } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';

function parseArchivedMode(raw) {
  const mode = String(raw || '').toLowerCase();
  if (mode === 'include' || mode === 'only') return mode;
  return 'exclude';
}

export function routeTimeline(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (pathname === '/api/timeline' && req.method === 'GET') {
    const payload = ctx.dbListTimelineEvents(ctx.db, {
      archived: parseArchivedMode(url.searchParams.get('archived')),
      eventType: url.searchParams.get('eventType') || '',
      arcPageId: url.searchParams.get('arcPageId') || '',
      locationPageId: url.searchParams.get('locationPageId') || '',
      tag: url.searchParams.get('tag') || '',
      limit: url.searchParams.get('limit') || '',
    });
    sendJson(res, 200, payload);
    return true;
  }

  if (pathname === '/api/timeline' && req.method === 'POST') {
    return (async () => {
      try {
        const body = parseJsonSafe(await readBody(req), {});
        const event = ctx.dbCreateTimelineEvent(ctx.db, body || {});
        sendJson(res, 201, { event });
      } catch (error) {
        badRequest(res, error?.message || 'invalid timeline event');
      }
      return true;
    })();
  }

  const match = pathname.match(/^\/api\/timeline\/([^\/]+)$/);
  if (!match) return false;
  const eventId = decodePathParam(match[1]);

  if (req.method === 'GET') {
    const event = ctx.dbGetTimelineEvent(ctx.db, eventId);
    if (!event) { notFound(res); return true; }
    sendJson(res, 200, { event });
    return true;
  }

  if (req.method === 'PATCH') {
    return (async () => {
      try {
        const body = parseJsonSafe(await readBody(req), {});
        const event = ctx.dbPatchTimelineEvent(ctx.db, eventId, body || {});
        if (!event) { notFound(res); return true; }
        sendJson(res, 200, { event });
      } catch (error) {
        badRequest(res, error?.message || 'invalid timeline event');
      }
      return true;
    })();
  }

  if (req.method === 'DELETE') {
    const ok = ctx.dbDeleteTimelineEvent(ctx.db, eventId);
    if (!ok) { notFound(res); return true; }
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
