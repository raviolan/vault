import { getUserState, patchUserState } from '../../miniapps/state.js';
import { applyThemeMode } from '../../lib/theme.js';
import { listThemesByMode } from '../../lib/themes.js';
import { el, clear } from '../../ui/els.js';
import { CollapsibleSection } from '../../ui/components/CollapsibleSection.js';
import { SwatchOption } from '../../ui/components/SwatchOption.js';
import { list as listApps } from '../../miniapps/registry.js';

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
    const mode = s.themeMode || 'dark';
    const defDark = s.defaultDarkThemeId || 'dark';
    const defLight = s.defaultLightThemeId || 'light';

    // Root wrapper
    clear(rootEl);
    const container = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
    container.appendChild(el('h2', {}, 'Settings'));

    // Branding section
    const brandInput = el('input', { type: 'text', value: brand });
    const navInput = el('input', { type: 'text', value: navTitle });
    const brandForm = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      el('label', { class: 'meta' }, 'Brand label', brandInput),
      el('label', { class: 'meta' }, 'Nav headline', navInput),
    );
    const secBrand = CollapsibleSection({ title: 'Branding', open: true }, brandForm);
    container.appendChild(secBrand);

    // Appearance section: default dark/light swatches
    const darkThemes = listThemesByMode('dark');
    const lightThemes = listThemesByMode('light');
    const darkList = el('div', { class: 'theme-list' });
    for (const t of darkThemes) {
      darkList.appendChild(SwatchOption({ id: t.id, label: t.label, colors: t.swatches, selected: t.id === defDark, onSelect: (id) => {
        patchUserState({ defaultDarkThemeId: id });
        if ((getUserState().themeMode || 'dark') === 'dark') applyThemeMode('dark', getUserState());
        refreshSelected(darkList, id);
      }}));
    }
    const lightList = el('div', { class: 'theme-list' });
    for (const t of lightThemes) {
      lightList.appendChild(SwatchOption({ id: t.id, label: t.label, colors: t.swatches, selected: t.id === defLight, onSelect: (id) => {
        patchUserState({ defaultLightThemeId: id });
        if ((getUserState().themeMode || 'dark') === 'light') applyThemeMode('light', getUserState());
        refreshSelected(lightList, id);
      }}));
    }
    const appearance = el('div', {},
      el('div', { class: 'meta' }, 'Default Dark Theme'), darkList,
      el('div', { class: 'meta', style: { marginTop: '8px' } }, 'Default Light Theme'), lightList,
    );
    const secAppearance = CollapsibleSection({ title: 'Appearance', open: true }, appearance);
    container.appendChild(secAppearance);

    // Mini Apps visibility section (scaffolding)
    const apps = listApps();
    const hidden = new Set(Array.isArray(s.miniAppsHidden) ? s.miniAppsHidden : []);
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    for (const a of apps) {
      const id = a.id;
      const checked = !hidden.has(id);
      const cb = el('input', { type: 'checkbox' });
      cb.checked = checked;
      const row = el('label', {}, cb, el('span', { style: { marginLeft: '6px' } }, `${a.title || id} — Visible`));
      cb.addEventListener('change', () => {
        const cur = new Set(Array.isArray(getUserState().miniAppsHidden) ? getUserState().miniAppsHidden : []);
        if (cb.checked) cur.delete(id); else cur.add(id);
        patchUserState({ miniAppsHidden: Array.from(cur) });
      });
      list.appendChild(row);
    }
    const secApps = CollapsibleSection({ title: 'Mini Apps', open: false }, list);
    container.appendChild(secApps);

    rootEl.appendChild(container);

    // Live label updates and persistence
    const applyBrand = (val) => {
      const link = document.querySelector('.top .toolbar a.chip[data-link][href="/"]');
      if (link) link.textContent = val || 'Hembränt';
    };
    const applyNavTitle = (val) => {
      const elx = document.querySelector('.campaign-title');
      if (elx) elx.textContent = val || 'Feywild Adventures';
    };
    let t1, t2;
    brandInput.addEventListener('input', () => {
      clearTimeout(t1);
      const val = brandInput.value;
      applyBrand(val);
      t1 = setTimeout(() => patchUserState({ brandLabel: val }), 300);
    });
    navInput.addEventListener('input', () => {
      clearTimeout(t2);
      const val = navInput.value;
      applyNavTitle(val);
      t2 = setTimeout(() => patchUserState({ navHeadline: val }), 300);
    });

    return () => {
      clearTimeout(t1); clearTimeout(t2);
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

function refreshSelected(listRoot, selectedId) {
  Array.from(listRoot.children).forEach(card => {
    if (card?.dataset?.id === selectedId) card.setAttribute('data-selected', 'true');
    else card.removeAttribute('data-selected');
  });
}
