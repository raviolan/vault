import { WEATHER_APP_ID } from './constants.js';
import { getWeatherState, ensureCurrent, rollNew } from './state.js';
import { cToF, catalogById, evalRule } from './engine.js';
import { navigate } from '../../lib/router.js';

export const WeatherApp = {
  id: WEATHER_APP_ID,
  surfaces: ['leftPanelWeather', 'route'],
  mount(root, ctx) {
    const container = document.getElementById('weatherCard');
    if (!container) return () => {};

    // Respect visibility toggles if present
    try {
      const hidden = new Set(Array.isArray((ctx?.userState?.getUserState?.() || {}).miniAppsHidden)
        ? ctx.userState.getUserState().miniAppsHidden
        : []);
      if (hidden.has('weather')) {
        container.setAttribute('hidden', '');
        return () => {};
      }
    } catch {}

    container.removeAttribute('hidden');
    renderInto(container);
    return () => {
      // clear minimal content when unmounted
      const el = document.getElementById('weatherCard');
      if (el) el.innerHTML = '';
    };
  },
};

function renderInto(container) {
  const st = getWeatherState();
  const cur = ensureCurrent();
  const unit = st.unit || 'C';
  const temp = unit === 'F' ? cToF(cur.tempC) : cur.tempC;
  const currentMeta = catalogById(cur.weatherId, st);
  const cssClass = currentMeta ? ` ${'wc-' + currentMeta.id}` : '';

  const notables = (st.showNotables && Array.isArray(st.rules))
    ? st.rules.filter(r => r.enabled !== false).filter(r => !r.when || evalRule(r.when, cur))
        .map(r => r.label ? `${r.label}: ${r.effect}` : r.effect)
    : [];

  container.className = `card weather-card${cssClass}`;
  // For custom weathers without a predefined CSS gradient class, set inline gradient if available
  const customGradient = currentMeta?.gradient;
  if (customGradient && (!currentMeta.id || !/^clear|partly|cloudy|light_rain|heavy_rain|thunder|fog|snow$/.test(currentMeta.id))) {
    container.style.background = `linear-gradient(180deg, ${customGradient.from}, ${customGradient.to})`;
  } else {
    container.style.background = '';
  }
  container.innerHTML = `
    <div class="weather-meta-row">
      <div class="meta">Current</div>
      <button id="weatherCog" class="chip" title="Weather settings">⚙︎</button>
    </div>
    <div class="weather-now">
      <div class="weather-icon">${currentMeta?.icon || '⛅'}</div>
      <div class="weather-condition">${currentMeta?.label || cur.weatherId}</div>
      <div class="weather-main">
        <div class="weather-temp">${temp}°${unit}</div>
        <button id="weatherRoll" class="chip">Roll weather</button>
      </div>
    </div>
    ${st.showNotables && notables.length ? `<div class="weather-effects">${notables.map(e => `<span class="effect-badge">${escapeHtml(String(e))}</span>`).join('')}</div>` : ''}
  `;

  container.querySelector('#weatherRoll')?.addEventListener('click', () => {
    container.classList.add('weather-rolling');
    const next = rollNew();
    setTimeout(() => {
      container.classList.remove('weather-rolling');
      renderInto(container);
    }, 180);
  });
  container.querySelector('#weatherCog')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/apps/weather/settings');
  });

}

// Small escape utility (use existing dom util if available in scope)
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
