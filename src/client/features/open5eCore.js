// Small Open5e helper core
// - searchOpen5e(type, query, { allSources })
// - fetchOpen5e(type, slug)
// - buildOpenUrl(type, slug) -> site page
// - buildApiPath(type, slug) -> our proxy JSON URL
// - getOpen5eResource(type, slug, { ttlMs }) -> shared in-memory TTL cache

import { fetchJson } from '../lib/http.js';

const DEFAULT_MAP = {
  spell: { api: 'spells', site: 'spells' },
  creature: { api: 'monsters', site: 'monsters' },
  monster: { api: 'monsters', site: 'monsters' },
  condition: { api: 'conditions', site: 'conditions' },
  item: { api: 'magicitems', site: 'magic-items' },
  magicitem: { api: 'magicitems', site: 'magic-items' },
  weapon: { api: 'weapons', site: 'weapons' },
  armor: { api: 'armor', site: 'armor' },
};

let discovered = null; // lazy discovery from /api/open5e/

async function ensureDiscovery() {
  if (discovered) return discovered;
  try {
    // API root typically lists available endpoints; tolerate failures.
    const root = await fetchJson('/api/open5e/');
    discovered = root || {};
  } catch {
    discovered = {};
  }
  return discovered;
}

function mapForType(type) {
  const t = String(type || '').toLowerCase();
  return DEFAULT_MAP[t] || null;
}

export function buildOpenUrl(type, slug) {
  const m = mapForType(type) || { site: 'spells' };
  const base = 'https://open5e.com/';
  const path = m.site || 'spells';
  return `${base}${path}/${encodeURIComponent(slug)}/`;
}

export function buildApiPath(type, slug) {
  const m = mapForType(type) || mapForType('spell');
  const endpoint = m.api;
  return `/api/open5e/${endpoint}/${encodeURIComponent(slug)}/`;
}

export async function searchOpen5e(type, query, { allSources = false } = {}) {
  await ensureDiscovery(); // currently unused, but keeps contract to verify root
  const m = mapForType(type) || mapForType('spell');
  const endpoint = m.api;
  let url = `/api/open5e/${endpoint}/?search=${encodeURIComponent(String(query || '').trim())}`;
  if (!allSources) url += `&document__slug=wotc-srd`;
  const res = await fetchJson(url);
  const arr = Array.isArray(res?.results) ? res.results : (Array.isArray(res) ? res : []);
  return arr;
}

export async function fetchOpen5e(type, slug) {
  await ensureDiscovery();
  const m = mapForType(type) || mapForType('spell');
  const endpoint = m.api;
  const res = await fetchJson(`/api/open5e/${endpoint}/${encodeURIComponent(slug)}/`);
  return res;
}

export function normalizeO5eType(t) {
  const s = String(t || '').toLowerCase();
  if (s === 'monster') return 'creature';
  if (s === 'magicitem') return 'item';
  return s;
}

// Simple in-memory TTL cache across features (hover + page view)
const _o5eCache = new Map(); // key -> { ts:number, data:any }

export async function getOpen5eResource(type, slug, { ttlMs = 15 * 60 * 1000 } = {}) {
  const key = `${normalizeO5eType(type)}:${slug}`;
  const now = Date.now();
  const hit = _o5eCache.get(key);
  if (hit && (now - (hit.ts || 0) < Math.max(1000, ttlMs))) return hit.data;
  const data = await fetchOpen5e(type, slug);
  _o5eCache.set(key, { ts: now, data });
  return data;
}
