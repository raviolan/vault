import { renderWidgetsArea } from '../features/widgets.js';

export function render(container, ctx = {}) {
  if (!container) return;
  container.innerHTML = `
    <section>
      <h1>Session</h1>
    </section>
    <div id="sessionWidgetsHost"></div>
  `;
  const host = container.querySelector('#sessionWidgetsHost');
  try { renderWidgetsArea(host, { surfaceId: 'session', title: 'Widgets' }); } catch {}
}
