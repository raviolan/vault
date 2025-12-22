import { getAppState, setAppState } from '../../miniapps/state.js';
import { WEATHER_APP_ID, DEFAULT_UNIT } from './constants.js';
import { catalogIds, generateWeather, effectiveCatalog, builtinRules, catalogById } from './engine.js';

function defaults() {
  return {
    unit: DEFAULT_UNIT,
    showNotables: true,
    seasonPreset: 'none',
    enabledWeatherIds: catalogIds(),
    customWeathers: [],
    rules: builtinRules(),
    current: null,
  };
}

export function getWeatherState() {
  const s = getAppState(WEATHER_APP_ID) || {};
  const d = defaults();
  const merged = { ...d, ...s };
  if (!Array.isArray(merged.enabledWeatherIds) || merged.enabledWeatherIds.length === 0) {
    merged.enabledWeatherIds = catalogIds();
  }
  // Seed builtin rules if missing and preserve custom rule enables
  if (!Array.isArray(merged.rules)) merged.rules = [];
  const byId = new Map(merged.rules.map(r => [r.id, r]));
  const seeded = [];
  for (const r of builtinRules()) {
    const existing = byId.get(r.id);
    seeded.push(existing ? { ...r, enabled: existing.enabled } : r);
  }
  // Append any custom rules not in builtin set
  for (const r of merged.rules) if (r.source === 'custom') seeded.push(r);
  merged.rules = seeded;
  return merged;
}

export function saveWeatherState(next) {
  return setAppState(WEATHER_APP_ID, next);
}

export function ensureCurrent() {
  const state = getWeatherState();
  if (!state.current) {
    const rolled = generateWeather({ weatherState: state });
    state.current = rolled;
    saveWeatherState(state);
  }
  // Ensure validity of current
  const meta = catalogById(state.current?.weatherId, state);
  if (!meta) {
    const rolled = generateWeather({ weatherState: state });
    state.current = rolled;
    saveWeatherState(state);
  }
  return state.current;
}

export function rollNew() {
  const s = getWeatherState();
  const rolled = generateWeather({ weatherState: s });
  s.current = rolled;
  saveWeatherState(s);
  return rolled;
}

export function setUnit(unit) {
  const s = getWeatherState();
  s.unit = unit === 'F' ? 'F' : 'C';
  saveWeatherState(s);
  return s;
}

export function setShowNotables(flag) {
  const s = getWeatherState();
  s.showNotables = !!flag;
  saveWeatherState(s);
  return s;
}

export function setSeasonPreset(preset) {
  const s = getWeatherState();
  s.seasonPreset = preset || 'none';
  saveWeatherState(s);
  return s;
}

export function setEnabledWeatherIds(ids) {
  const s = getWeatherState();
  s.enabledWeatherIds = Array.isArray(ids) && ids.length ? ids : catalogIds();
  // If current no longer valid, reroll
  if (!catalogById(s.current?.weatherId, s) || !s.enabledWeatherIds.includes(s.current?.weatherId)) {
    const rolled = generateWeather({ weatherState: s });
    s.current = rolled;
  }
  saveWeatherState(s);
  return s;
}

export function addCustomRule(rule) {
  const s = getWeatherState();
  const r = {
    id: 'custom:' + Math.random().toString(36).slice(2) + Date.now().toString(36),
    enabled: rule.enabled !== false,
    source: 'custom',
    label: rule.label || 'Custom rule',
    effect: rule.effect || '',
    when: rule.when || null,
  };
  s.rules = Array.isArray(s.rules) ? [...s.rules, r] : [r];
  saveWeatherState(s);
  return r;
}

export function removeCustomRule(id) {
  const s = getWeatherState();
  s.rules = (s.rules || []).filter(r => !(r.id === id && r.source === 'custom'));
  saveWeatherState(s);
}

export function setRuleEnabled(id, enabled) {
  const s = getWeatherState();
  s.rules = (s.rules || []).map(r => r.id === id ? { ...r, enabled: !!enabled } : r);
  saveWeatherState(s);
}

export function addCustomWeather(w) {
  const s = getWeatherState();
  const id = 'custom:' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const item = {
    id,
    label: String(w.label || 'Custom Weather'),
    tempMinC: Number(w.tempMinC ?? 0),
    tempMaxC: Number(w.tempMaxC ?? 0),
    params: {
      precip: w.params?.precip || 'none',
      thunder: !!w.params?.thunder,
      wind: w.params?.wind || 'calm',
    },
    gradient: w.gradient || { from: '#e0e0e0', to: '#c0c0c0' },
    enabled: true,
  };
  s.customWeathers = Array.isArray(s.customWeathers) ? [...s.customWeathers, item] : [item];
  s.enabledWeatherIds = Array.from(new Set([...(s.enabledWeatherIds || []), id]));
  saveWeatherState(s);
  return item;
}

export function removeCustomWeather(id) {
  const s = getWeatherState();
  s.customWeathers = (s.customWeathers || []).filter(c => c.id !== id);
  s.enabledWeatherIds = (s.enabledWeatherIds || []).filter(x => x !== id);
  // If current now invalid, reroll
  if (!catalogById(s.current?.weatherId, s)) {
    const rolled = generateWeather({ weatherState: s });
    s.current = rolled;
  }
  saveWeatherState(s);
}

export function setCustomWeatherEnabled(id, enabled) {
  const s = getWeatherState();
  s.customWeathers = (s.customWeathers || []).map(c => c.id === id ? { ...c, enabled: !!enabled } : c);
  if (enabled) {
    s.enabledWeatherIds = Array.from(new Set([...(s.enabledWeatherIds || []), id]));
  } else {
    s.enabledWeatherIds = (s.enabledWeatherIds || []).filter(x => x !== id);
    if (!catalogById(s.current?.weatherId, s)) {
      const rolled = generateWeather({ weatherState: s });
      s.current = rolled;
    }
  }
  saveWeatherState(s);
}
