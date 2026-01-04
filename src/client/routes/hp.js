import { setBreadcrumb, setPageActionsEnabled } from '../lib/ui.js';
import { mountSubsectionPicker } from '../features/subsectionPicker.js';
import { HpTrackerApp } from '../miniapps/hp/app.js';

export function render(container) {
  setBreadcrumb('HP Tracker');
  setPageActionsEnabled({ canEdit: false, canDelete: false });

  if (!container) return;
  container.innerHTML = `
    <section class="page page--hp">
      <div id="hpSubsectionPickerRow" class="meta" style="margin:6px 0;"></div>
      <div id="hpRouteRoot"></div>
    </section>
  `;
  // Mount Tools category picker into the reserved row
  try {
    const row = document.getElementById('hpSubsectionPickerRow');
    if (row) {
      row.innerHTML = '';
      mountSubsectionPicker({ hostEl: row, sectionKey: 'tools', itemId: 'hp-tracker', labelText: 'Category' });
    }
  } catch {}
  const root = document.getElementById('hpRouteRoot');
  const cleanup = HpTrackerApp.mount(root, { mountEl: root });
  return () => {
    try { if (typeof cleanup === 'function') cleanup(); } catch {}
    const outlet = document.getElementById('outlet');
    if (outlet) outlet.innerHTML = '';
  };
}
