import { UNITS, SEASONS, PRESETS } from './constants.js';
import { CATALOG } from './engine.js';
import {
  getWeatherState,
  saveWeatherState,
  setUnit,
  setShowNotables,
  setSeasonPreset,
  setEnabledWeatherIds,
  addCustomRule,
  removeCustomRule,
  setRuleEnabled,
  addCustomWeather,
  removeCustomWeather,
  setCustomWeatherEnabled,
} from './state.js';

export function renderSettings(root) {
  const s = getWeatherState();
  if (!root) return () => {};
  root.innerHTML = `
    <section class="page">
      <h2>Weather Settings</h2>
      <div class="meta">Configure units, seasons, your weather library, and rules for in-game effects.</div>

      <h3>Display</h3>
      <div style="display:grid;gap:12px;max-width:780px;">
        <label>Units
          <select id="wUnits">
            ${UNITS.map(u => `<option value="${u}" ${s.unit===u?'selected':''}>${u==='C'?'Celsius (°C)':'Fahrenheit (°F)'}</option>`).join('')}
          </select>
        </label>
        <label>
          <input type="checkbox" id="wShowNotables" ${s.showNotables ? 'checked' : ''} />
          Show notable game effects in the weather card
        </label>
      </div>

      <h3 style="margin-top:16px;">Presets</h3>
      <div class="meta">Season presets change which weather types are eligible to roll. If a preset results in no enabled types, your enabled list is used.</div>
      <label>Season preset
        <select id="wSeason">
          ${SEASONS.map(se => `<option value="${se}" ${s.seasonPreset===se?'selected':''}>${PRESETS[se]?.label || se}</option>`).join('')}
        </select>
      </label>
      <div id="wSeasonWarn" class="meta" style="color:#e8a;display:none;">No enabled types in this preset; using your enabled list.</div>

      <h3 style="margin-top:16px;">Weather Library</h3>
      <div class="meta">Enable which weather types can be rolled. You can also add your own custom types.</div>
      <div id="wTypes" style="display:grid;grid-template-columns:repeat(2,minmax(240px,1fr));gap:6px;margin-top:6px;"></div>

      <h4 style="margin-top:12px;">Custom Weathers</h4>
      <div id="wCustomList"></div>
      <details style="margin-top:8px;">
        <summary class="nav-label">Add Weather</summary>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:8px;margin-top:8px;">
          <label>Weather name <input id="cwLabel" placeholder="e.g., Drizzle, Heatwave" /></label>
          <label>Temperature min (°C) <input id="cwMin" type="number" value="0" /></label>
          <label>Temperature max (°C) <input id="cwMax" type="number" value="20" /></label>
          <label>Rain/Snow intensity
            <select id="cwPrecip">
              <option value="none">none</option>
              <option value="light">light</option>
              <option value="heavy">heavy</option>
            </select>
          </label>
          <label>Thunderstorms happening
            <select id="cwThunder">
              <option value="false">no</option>
              <option value="true">yes</option>
            </select>
          </label>
          <label>Wind strength
            <select id="cwWind">
              <option value="calm">calm</option>
              <option value="breezy">breezy</option>
              <option value="windy">windy</option>
            </select>
          </label>
          <label>Gradient from (hex) <input id="cwFrom" placeholder="#e0f0ff" /></label>
          <label>Gradient to (hex) <input id="cwTo" placeholder="#bcdfff" /></label>
        </div>
        <div class="meta" style="margin-top:6px;">Tip: gradients color the card background for this type.</div>
        <button id="cwSave" class="chip" style="margin-top:8px;">Save Weather</button>
      </details>

      <h3 style="margin-top:16px;">Rules (Notable Conditions)</h3>
      <div class="meta">Rules add game effects based on the current weather. Example: Heavy rain ⇒ +1 Stealth.</div>
      <div style="margin-top:8px;" id="wRules"></div>
      <details style="margin-top:8px;">
        <summary class="nav-label">Add Rule</summary>
        <div id="wRuleForm" style="margin-top:8px;">
          <div class="meta" style="margin-bottom:6px;">When this is true…</div>
          <div style="display:grid;grid-template-columns:repeat(3,minmax(200px,1fr));gap:8px;align-items:end;">
            <label>Rule name <input id="rfLabel" placeholder="e.g., Storm penalty" /></label>
            <label>Effect text <input id="rfEffect" placeholder="What happens in game?" /></label>
            <label>Enabled
              <select id="rfEnabled"><option value="true" selected>yes</option><option value="false">no</option></select>
            </label>
            <label>Weather property
              <select id="rfParam">
                <option value="precip">Rain/Snow intensity</option>
                <option value="thunder">Thunderstorms happening</option>
                <option value="wind">Wind strength</option>
                <option value="tempC">Temperature (°C)</option>
              </select>
              <div class="meta">Choose which part of the weather to check.</div>
            </label>
            <label>Comparison
              <select id="rfOp"></select>
              <div class="meta">For temp: at least / at most / equals. Others: is / is not.</div>
            </label>
            <label>Value <input id="rfValue" placeholder="e.g., heavy / windy / 12" />
              <div class="meta">Examples: precip=heavy, wind=windy, tempC=12</div>
            </label>
          </div>
          <div style="margin-top:8px;"><button id="rfSave" class="chip">Save Rule</button></div>
        </div>
      </details>
    </section>
  `;

  // Base types + custom types checkboxes
  function renderTypes() {
    const st = getWeatherState();
    const typesRoot = root.querySelector('#wTypes');
    const currentIds = new Set(st.enabledWeatherIds || []);
    const customs = Array.isArray(st.customWeathers) ? st.customWeathers : [];
    const baseList = CATALOG.map(w => ({ id: w.id, label: `${w.icon} ${w.label}`, isCustom: false }));
    const customList = customs.map(c => ({ id: c.id, label: `🛠️ ${c.label}`, isCustom: true }));
    const all = [...baseList, ...customList];
    typesRoot.innerHTML = all.map(w => `
      <label style="display:flex;align-items:center;gap:6px;">
        <input type="checkbox" data-type-id="${w.id}" ${currentIds.has(w.id) ? 'checked' : ''}/>
        <span>${w.label}</span>
      </label>
    `).join('');
    typesRoot.querySelectorAll('input[type="checkbox"][data-type-id]')
      .forEach(cb => cb.addEventListener('change', () => {
        const ids = Array.from(root.querySelectorAll('#wTypes input[type="checkbox"][data-type-id]'))
          .filter(el => el.checked).map(el => el.getAttribute('data-type-id'));
        setEnabledWeatherIds(ids);
        checkPresetIntersection();
      }));
  }
  renderTypes();

  // Units
  root.querySelector('#wUnits')?.addEventListener('change', (e) => {
    setUnit(e.target.value);
  });
  // Notables
  root.querySelector('#wShowNotables')?.addEventListener('change', (e) => {
    setShowNotables(!!e.target.checked);
  });
  // Season
  root.querySelector('#wSeason')?.addEventListener('change', (e) => {
    setSeasonPreset(e.target.value);
    checkPresetIntersection();
  });

  function checkPresetIntersection() {
    const st = getWeatherState();
    const included = PRESETS[st.seasonPreset]?.included || null;
    let ok = true;
    if (Array.isArray(included)) {
      const setIds = new Set(st.enabledWeatherIds || []);
      ok = included.some(id => setIds.has(id));
    }
    const warn = root.querySelector('#wSeasonWarn');
    if (warn) warn.style.display = ok ? 'none' : 'block';
  }
  checkPresetIntersection();

  // Custom weather list and add form
  function renderCustomList() {
    const st = getWeatherState();
    const wrap = root.querySelector('#wCustomList');
    const customs = Array.isArray(st.customWeathers) ? st.customWeathers : [];
    wrap.innerHTML = customs.length ? customs.map(c => `
      <div class="card" style="padding:8px;margin:6px 0;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong>${escapeHtml(c.label)}</strong>
          <div class="meta">${escapeHtml(c.params?.precip || 'none')}${c.params?.thunder ? ', thunder' : ''}, ${escapeHtml(c.params?.wind || 'calm')} — ${Number(c.tempMinC)}°C to ${Number(c.tempMaxC)}°C</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <label class="meta">Enabled <input type="checkbox" data-cw-enable="${c.id}" ${c.enabled ? 'checked' : ''} /></label>
          <button class="chip" data-cw-del="${c.id}">Delete</button>
        </div>
      </div>
    `).join('') : '<div class="meta">No custom weathers yet</div>';
    wrap.querySelectorAll('[data-cw-enable]')
      .forEach(cb => cb.addEventListener('change', () => { setCustomWeatherEnabled(cb.getAttribute('data-cw-enable'), cb.checked); renderTypes(); }));
    wrap.querySelectorAll('[data-cw-del]')
      .forEach(btn => btn.addEventListener('click', () => { if (confirm('Delete this custom weather?')) { removeCustomWeather(btn.getAttribute('data-cw-del')); renderTypes(); renderCustomList(); } }));
  }
  renderCustomList();

  root.querySelector('#cwSave')?.addEventListener('click', () => {
    const label = root.querySelector('#cwLabel').value.trim();
    const tempMinC = Number(root.querySelector('#cwMin').value || 0);
    const tempMaxC = Number(root.querySelector('#cwMax').value || 0);
    const precip = root.querySelector('#cwPrecip').value;
    const thunder = root.querySelector('#cwThunder').value === 'true';
    const wind = root.querySelector('#cwWind').value;
    const from = (root.querySelector('#cwFrom').value || '#dbeffd').trim();
    const to = (root.querySelector('#cwTo').value || '#cfe9ff').trim();
    addCustomWeather({ label, tempMinC, tempMaxC, params: { precip, thunder, wind }, gradient: { from, to } });
    // clear inputs
    root.querySelector('#cwLabel').value = '';
    renderTypes();
    renderCustomList();
  });

  // Add rule form
  const opSelect = root.querySelector('#rfOp');
  const paramSelect = root.querySelector('#rfParam');
  function syncOps() {
    const p = paramSelect.value;
    let ops = [];
    if (p === 'tempC') ops = [ ['gte', 'at least (>=)'], ['lte', 'at most (<=)'], ['eq', 'equals'] ];
    else if (p === 'thunder') ops = [ ['eq', 'is'], ['ne', 'is not'] ];
    else ops = [ ['eq', 'is'], ['ne', 'is not'] ];
    opSelect.innerHTML = ops.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  }
  syncOps();
  paramSelect.addEventListener('change', syncOps);

  function renderRules() {
    const st = getWeatherState();
    const rootRules = root.querySelector('#wRules');
    const list = Array.isArray(st.rules) ? st.rules : [];
    rootRules.innerHTML = list.length ? list.map(r => `
      <div class="card" style="padding:8px;margin:6px 0;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <label class="meta" style="margin-right:8px;">Enabled <input type="checkbox" data-rule-en="${r.id}" ${r.enabled!==false?'checked':''}></label>
          <strong>${escapeHtml(r.label || '')}</strong> — ${escapeHtml(r.effect || '')}
          <div class="meta">when ${escapeHtml(summaryWhen(r.when))}</div>
        </div>
        ${r.source==='custom' ? `<button class="chip" data-del="${r.id}">Delete</button>` : ''}
      </div>
    `).join('') : '<div class="meta">No rules yet</div>';
    rootRules.querySelectorAll('[data-del]')
      .forEach(btn => btn.addEventListener('click', () => { removeCustomRule(btn.getAttribute('data-del')); renderRules(); }));
    rootRules.querySelectorAll('[data-rule-en]')
      .forEach(cb => cb.addEventListener('change', () => setRuleEnabled(cb.getAttribute('data-rule-en'), cb.checked)));
  }
  renderRules();

  root.querySelector('#rfSave')?.addEventListener('click', () => {
    const label = root.querySelector('#rfLabel').value.trim();
    const effect = root.querySelector('#rfEffect').value.trim();
    const param = root.querySelector('#rfParam').value;
    const opVal = root.querySelector('#rfOp').value;
    const raw = root.querySelector('#rfValue').value;
    const value = coerceValue(param, raw);
    const op = opVal;
    addCustomRule({ label, effect, when: { param, op, value }, enabled: true });
    root.querySelector('#rfLabel').value = '';
    root.querySelector('#rfEffect').value = '';
    root.querySelector('#rfValue').value = '';
    renderRules();
  });

  return () => { /* nothing for now */ };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function coerceValue(param, raw) {
  if (param === 'thunder') return /^(true|1|yes|on)$/i.test(String(raw));
  if (param === 'tempC') return Number(raw);
  return raw;
}

function summaryWhen(when) {
  if (!when) return 'always';
  const { param, op, value } = when;
  const prettyParam = param === 'precip' ? 'Rain/Snow intensity' : param === 'thunder' ? 'Thunderstorms happening' : param === 'wind' ? 'Wind strength' : 'Temperature (°C)';
  const prettyOp = op === 'gte' ? 'at least' : op === 'lte' ? 'at most' : 'is';
  return `${prettyParam} ${prettyOp} ${String(value)}`;
}
