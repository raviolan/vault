import { getUserState, patchUserState } from '../../miniapps/state.js';
import { applyTheme } from '../../lib/theme.js';

const APP_ID = 'settings';

export const SettingsApp = {
  id: APP_ID,
  title: 'Settings',
  surfaces: ['leftPanelBottom', 'route'],
  mount(rootEl) {
    if (!rootEl) return () => {};
    const s = getUserState() || {};
    const brand = s.brandLabel || 'Hembränt';
    const navTitle = s.navHeadline || 'Feywild Adventures';
    const theme = s.theme || 'dark';

    rootEl.innerHTML = `
      <div class="meta" style="margin-bottom:8px;">Settings</div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <label class="meta">Brand label
          <input id="setBrandLabel" type="text" value="${escapeHtmlAttr(brand)}" />
        </label>
        <label class="meta">Nav headline
          <input id="setNavHeadline" type="text" value="${escapeHtmlAttr(navTitle)}" />
        </label>
        <label class="meta">Theme
          <select id="setTheme">
            ${themeOption('dark', 'Dark', theme)}
            ${themeOption('light', 'Light', theme)}
            ${themeOption('auburn-linen', 'Auburn Linen', theme)}
            ${themeOption('orchid-porcelain', 'Orchid Porcelain', theme)}
            ${themeOption('chinese-pearls', 'Chinese Pearls', theme)}
            ${themeOption('mother-of-dragons', 'Mother of Dragons', theme)}
            ${themeOption('desert', 'Desert', theme)}
          </select>
        </label>
      </div>
    `;

    const brandInput = rootEl.querySelector('#setBrandLabel');
    const navInput = rootEl.querySelector('#setNavHeadline');
    const themeSel = rootEl.querySelector('#setTheme');

    const applyBrand = (val) => {
      const link = document.querySelector('.top .toolbar a.chip[data-link][href="/"]');
      if (link) link.textContent = val || 'Hembränt';
    };
    const applyNavTitle = (val) => {
      const el = document.querySelector('.campaign-title');
      if (el) el.textContent = val || 'Feywild Adventures';
    };

    let t1, t2;
    brandInput?.addEventListener('input', () => {
      clearTimeout(t1);
      const val = brandInput.value;
      applyBrand(val);
      t1 = setTimeout(() => patchUserState({ brandLabel: val }), 300);
    });
    navInput?.addEventListener('input', () => {
      clearTimeout(t2);
      const val = navInput.value;
      applyNavTitle(val);
      t2 = setTimeout(() => patchUserState({ navHeadline: val }), 300);
    });
    themeSel?.addEventListener('change', () => {
      const id = themeSel.value;
      applyTheme(id);
      patchUserState({ theme: id });
    });

    return () => {
      if (brandInput) brandInput.replaceWith(brandInput.cloneNode(true));
      if (navInput) navInput.replaceWith(navInput.cloneNode(true));
      if (themeSel) themeSel.replaceWith(themeSel.cloneNode(true));
      clearTimeout(t1);
      clearTimeout(t2);
    };
  },
  unmount() {},
};

function escapeHtmlAttr(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function themeOption(value, label, current) {
  const sel = current === value ? 'selected' : '';
  return `<option value="${escapeHtmlAttr(value)}" ${sel}>${escapeHtmlAttr(label)}</option>`;
}
