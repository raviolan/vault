// Deterministic Mini Apps registry with safety guards.
// - Map keyed by app.id for fast lookups
// - Separate ordered id list to preserve deterministic ordering

const appMap = new Map();
const orderedIds = [];

function isProduction() {
  try {
    return (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production');
  } catch {
    return false;
  }
}

function validateApp(app) {
  if (!app || typeof app !== 'object') throw new Error('miniapps: invalid app');
  if (!app.id || typeof app.id !== 'string') throw new Error('miniapps: app.id is required');
  if (typeof app.mount !== 'function') throw new Error(`miniapps: app.mount required for ${app.id}`);
}

export function register(app) {
  validateApp(app);
  const existing = appMap.get(app.id);
  if (existing) {
    if (existing === app) return; // idempotent if same reference
    if (!isProduction()) throw new Error(`miniapps: duplicate registration for id "${app.id}"`);
    // production: ignore duplicate and keep first
    return;
  }
  appMap.set(app.id, app);
  orderedIds.push(app.id);
}

export function registerMany(arr) {
  if (!Array.isArray(arr)) return;
  for (const app of arr) register(app);
}

export function get(id) {
  return appMap.get(id);
}

export function list() {
  // Return apps in the original registration order
  return orderedIds.map(id => appMap.get(id)).filter(Boolean);
}
