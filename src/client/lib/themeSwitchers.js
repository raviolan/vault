import { getState, updateState } from './state.js';
import { applyThemeMode, applyTheme } from './theme.js';
import { getModeForThemeId } from './themes.js';

function syncThemeButtons() {
  try {
    const st = getState() || {};
    const isLight = st.themeMode === 'light';
    const btnDark = document.getElementById('themeModeDark');
    const btnLight = document.getElementById('themeModeLight');
    if (btnDark) {
      btnDark.setAttribute('aria-pressed', String(!isLight));
      btnDark.classList.toggle('active', !isLight);
    }
    if (btnLight) {
      btnLight.setAttribute('aria-pressed', String(isLight));
      btnLight.classList.toggle('active', isLight);
    }
  } catch {}
}

export function setThemeMode(mode) {
  const m = mode === 'light' ? 'light' : 'dark';
  updateState({ themeMode: m });
  applyThemeMode(m, getState());
  syncThemeButtons();
}

export function setDefaultThemeAndSwitch(themeId) {
  const id = (themeId || '').trim();
  const mode = getModeForThemeId(id);
  const patch = mode === 'light'
    ? { defaultLightThemeId: id, themeMode: 'light' }
    : { defaultDarkThemeId: id, themeMode: 'dark' };
  updateState(patch);
  // Apply the selected theme immediately for responsiveness
  applyTheme(id);
  // Ensure buttons reflect new mode
  syncThemeButtons();
}

// Expose sync for boot-time usage if needed
export { syncThemeButtons };

