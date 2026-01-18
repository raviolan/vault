// Theme utility: apply theme id consistently.
// Existing behavior: dark is the default (no data-theme), light via body[data-theme='light'].

export function applyTheme(themeId) {
  const el = document.body || document.documentElement;
  if (!el) return;
  const id = (themeId || '').trim();
  if (!id || id === 'dark') {
    delete el.dataset.theme;
  } else {
    el.dataset.theme = id;
  }
}

export function getAppliedTheme() {
  const el = document.body || document.documentElement;
  return el?.dataset?.theme || 'dark';
}

export function applyThemeId(themeId) {
  return applyTheme(themeId);
}

export function applyThemeMode(mode, userState) {
  const st = userState || {};
  const m = mode === 'light' ? 'light' : 'dark';
  const id = m === 'light' ? (st.defaultLightThemeId || 'light') : (st.defaultDarkThemeId || 'dark');
  return applyThemeId(id);
}
