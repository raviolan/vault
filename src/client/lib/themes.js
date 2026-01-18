// Theme registry with metadata for UI and mode grouping

export const THEMES = [
  { id: 'dark', label: 'Dark', mode: 'dark', swatches: ['#0f1115', '#151821', '#e5e7eb', '#8b5cf6'] },
  { id: 'light', label: 'Light', mode: 'light', swatches: ['#f7f7fb', '#ffffff', '#0b0d12', '#7c3aed'] },
  { id: 'auburn-linen', label: 'Auburn Linen', mode: 'light', swatches: ['#FBF5F0', '#FFFFFF', '#1E1416', '#8F2D1B'] },
  { id: 'orchid-porcelain', label: 'Orchid Porcelain', mode: 'light', swatches: ['#FFF7FB', '#FFFFFF', '#1B1218', '#7E2A62'] },
  { id: 'chinese-pearls', label: 'Chinese Pearls', mode: 'dark', swatches: ['#111424', '#171A2F', '#F6F3FF', '#4A55B3'] },
  { id: 'mother-of-dragons', label: 'Mother of Dragons', mode: 'dark', swatches: ['#070A14', '#0E1326', '#FDF3EB', '#5B2A63'] },
  { id: 'desert', label: 'Desert', mode: 'dark', swatches: ['#1E1A13', '#272116', '#FBF6EE', '#A24D31'] },
];

export function listThemes() { return THEMES.slice(); }
export function getThemeById(id) { return THEMES.find(t => t.id === id); }
export function listThemesByMode(mode) { return THEMES.filter(t => t.mode === mode); }
export function getModeForThemeId(id) { return getThemeById(id)?.mode || (id === 'light' ? 'light' : 'dark'); }

