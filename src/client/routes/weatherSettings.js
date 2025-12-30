import { setBreadcrumb, setPageActionsEnabled } from '../lib/ui.js';
import { setActivePage } from '../lib/activePage.js';
import { renderSettings as renderWeatherSettings } from '../miniapps/weather/settingsView.js';

export function render(container) {
  setBreadcrumb('Weather Settings');
  setPageActionsEnabled({ canEdit: false, canDelete: false });
  try { setActivePage({ id: null, slug: null, canEdit: false, kind: 'page' }); } catch {}
  if (!container) return;
  container.innerHTML = `
    <section class="page">
      <div id="weatherSettingsRoot"></div>
    </section>
  `;
  const root = document.getElementById('weatherSettingsRoot');
  const cleanup = renderWeatherSettings(root);
  return () => {
    try { if (typeof cleanup === 'function') cleanup(); } catch {}
    const outlet = document.getElementById('outlet');
    if (outlet) outlet.innerHTML = '';
  };
}
