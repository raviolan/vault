import { createMiniAppHost } from '../miniapps/host.js';
import { register } from '../miniapps/registry.js';
import { WeatherApp } from '../miniapps/weather/app.js';
import { getUserState, getAppState, setAppState, patchUserState } from '../miniapps/state.js';

export function mountLeftPanelWeather() {
  register(WeatherApp); // idempotent safe
  const root = document.getElementById('weatherCard');
  if (!root) return;
  const host = createMiniAppHost({
    surfaceId: 'leftPanelWeather',
    rootEl: root,
    getCtx: () => ({ userState: { getUserState, patchUserState, getAppState, setAppState } }),
  });
  // Respect visibility toggle via app itself; host just shows it
  host.show('weather');
  return () => host.destroy();
}

export function destroyLeftPanelWeather() {
  const root = document.getElementById('weatherCard');
  if (root) root.innerHTML = '';
}

