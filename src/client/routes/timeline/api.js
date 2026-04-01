import { fetchJson } from '../../lib/http.js';

function buildQuery(filters) {
  const params = new URLSearchParams();
  if (filters.eventType) params.set('eventType', filters.eventType);
  if (filters.arcPageId) params.set('arcPageId', filters.arcPageId);
  if (filters.locationPageId) params.set('locationPageId', filters.locationPageId);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.archived && filters.archived !== 'exclude') params.set('archived', filters.archived);
  return params.toString();
}

export async function fetchTimeline(filters) {
  const qs = buildQuery(filters);
  return fetchJson(`/api/timeline${qs ? `?${qs}` : ''}`);
}

export async function createTimelineEvent(payload) {
  return fetchJson('/api/timeline', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTimelineEvent(eventId, payload) {
  return fetchJson(`/api/timeline/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteTimelineEvent(eventId) {
  return fetchJson(`/api/timeline/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  });
}
