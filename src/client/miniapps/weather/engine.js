import { SEASONS, PRESETS } from './constants.js';

// Simple catalog with gradients driven by CSS classes in components.css
export const CATALOG = [
  {
    id: 'clear',
    label: 'Clear Skies',
    icon: '☀️',
    params: { precip: 'none', thunder: false, wind: 'breezy' },
    tempC: [18, 30],
    seasonWeights: { spring: 3, summer: 6, autumn: 2, winter: 1 },
  },
  {
    id: 'partly',
    label: 'Partly Cloudy',
    icon: '🌤️',
    params: { precip: 'none', thunder: false, wind: 'breezy' },
    tempC: [12, 24],
    seasonWeights: { spring: 4, summer: 4, autumn: 4, winter: 2 },
  },
  {
    id: 'cloudy',
    label: 'Cloudy',
    icon: '☁️',
    params: { precip: 'none', thunder: false, wind: 'calm' },
    tempC: [10, 20],
    seasonWeights: { spring: 3, summer: 2, autumn: 4, winter: 4 },
  },
  {
    id: 'light_rain',
    label: 'Light Rain',
    icon: '🌦️',
    params: { precip: 'light', thunder: false, wind: 'breezy' },
    tempC: [6, 16],
    seasonWeights: { spring: 4, summer: 2, autumn: 5, winter: 2 },
  },
  {
    id: 'heavy_rain',
    label: 'Heavy Rain',
    icon: '🌧️',
    params: { precip: 'heavy', thunder: false, wind: 'windy' },
    tempC: [4, 14],
    seasonWeights: { spring: 3, summer: 2, autumn: 4, winter: 1 },
  },
  {
    id: 'thunder',
    label: 'Thunderstorm',
    icon: '⛈️',
    params: { precip: 'heavy', thunder: true, wind: 'windy' },
    tempC: [10, 22],
    seasonWeights: { spring: 2, summer: 3, autumn: 2, winter: 1 },
  },
  {
    id: 'fog',
    label: 'Fog',
    icon: '🌫️',
    params: { precip: 'none', thunder: false, wind: 'calm' },
    tempC: [0, 12],
    seasonWeights: { spring: 2, summer: 1, autumn: 3, winter: 4 },
  },
  {
    id: 'snow',
    label: 'Snow',
    icon: '❄️',
    params: { precip: 'heavy', thunder: false, wind: 'breezy' },
    tempC: [-10, 2],
    seasonWeights: { spring: 0, summer: 0, autumn: 1, winter: 6 },
  },
];

export function cToF(c) { return Math.round((c * 9) / 5 + 32); }
export function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

function pickWeighted(items, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function buildWeights(catalog, seasonPreset) {
  if (!seasonPreset || seasonPreset === 'none') return catalog.map(() => 1);
  return catalog.map((w) => Math.max(0, w.seasonWeights?.[seasonPreset] ?? 1));
}

export function evalRule(rule, current) {
  const { param, op, value } = rule || {};
  if (!param || !op) return false;
  const p = current?.params || {};
  let left;
  switch (param) {
    case 'precip': left = p.precip; break;
    case 'thunder': left = !!p.thunder; break;
    case 'wind': left = p.wind; break;
    case 'tempC': left = current?.tempC; break;
    case 'weatherId': left = current?.weatherId; break;
    default: return false;
  }
  switch (op) {
    case 'eq': return left === value;
    case 'ne': return left !== value;
    case 'gte': return Number(left) >= Number(value);
    case 'lte': return Number(left) <= Number(value);
    case 'includes':
      if (Array.isArray(left)) return left.includes(value);
      if (typeof left === 'string') return String(left).includes(String(value));
      return false;
    default:
      return false;
  }
}

// Merge base catalog with user custom weathers (from apps.weather.customWeathers)
export function effectiveCatalog(weatherState) {
  const customs = Array.isArray(weatherState?.customWeathers) ? weatherState.customWeathers : [];
  const mappedCustoms = customs.filter(c => !!c && !!c.id && !!c.label).map(c => ({
    id: c.id,
    label: c.label,
    icon: c.icon || '🌈',
    params: { precip: c.params?.precip || 'none', thunder: !!c.params?.thunder, wind: c.params?.wind || 'calm' },
    tempC: [Number(c.tempMinC ?? 0), Number(c.tempMaxC ?? 0)],
    gradient: c.gradient || null,
    // no seasonWeights for custom by default
  }));
  return [...CATALOG, ...mappedCustoms];
}

export function generateWeather({ weatherState }) {
  const enabledIds = weatherState?.enabledWeatherIds || [];
  const seasonPreset = weatherState?.seasonPreset || 'none';
  const all = effectiveCatalog(weatherState);
  // Apply preset intersection if present
  const preset = PRESETS[seasonPreset] || PRESETS.none;
  let basePool = all.filter(w => enabledIds.includes(w.id));
  if (Array.isArray(preset.included)) {
    const allowed = new Set(preset.included);
    const intersect = basePool.filter(w => allowed.has(w.id));
    basePool = intersect.length ? intersect : basePool; // fall back if empty
  }
  if (basePool.length === 0) return null;
  const weights = buildWeights(basePool, seasonPreset);
  const choice = pickWeighted(basePool, weights) || basePool[0];
  const [min, max] = choice.tempC;
  const tempC = Math.round(min + Math.random() * (max - min));
  return {
    weatherId: choice.id,
    label: choice.label,
    icon: choice.icon,
    tempC,
    params: { ...choice.params },
    rolledAt: Date.now(),
  };
}

export function catalogIds() { return CATALOG.map(w => w.id); }
export function catalogById(id, weatherState = null) {
  if (weatherState) {
    const all = effectiveCatalog(weatherState);
    return all.find(w => w.id === id) || null;
  }
  return CATALOG.find(w => w.id === id) || null;
}

// Built-in default rules for notables
export function builtinRules() {
  return [
    {
      id: 'builtin:heavy-precip-stealth',
      enabled: true,
      source: 'builtin',
      label: 'Heavy precipitation improves stealth',
      effect: '+1 to Stealth for everyone',
      when: { param: 'precip', op: 'eq', value: 'heavy' },
    },
    {
      id: 'builtin:thunder-perception',
      enabled: true,
      source: 'builtin',
      label: 'Thunder hampers perception',
      effect: 'Perception checks at disadvantage',
      when: { param: 'thunder', op: 'eq', value: true },
    },
    {
      id: 'builtin:fog-visibility',
      enabled: true,
      source: 'builtin',
      label: 'Fog reduces visibility',
      effect: 'Visibility reduced',
      when: { param: 'weatherId', op: 'eq', value: 'fog' },
    },
    {
      id: 'builtin:snow-slow',
      enabled: true,
      source: 'builtin',
      label: 'Snow slows movement',
      effect: 'Movement speed reduced in open terrain',
      when: { param: 'tempC', op: 'lte', value: 0 },
    },
    {
      id: 'builtin:windy-range',
      enabled: true,
      source: 'builtin',
      label: 'Wind hinders ranged attacks',
      effect: 'Ranged attacks have disadvantage at long range',
      when: { param: 'wind', op: 'eq', value: 'windy' },
    },
  ];
}
