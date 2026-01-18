import { escapeHtml } from './lib/dom.js';
import { boot } from './boot.js';

boot().catch((err) => {
  console.error(err);
  const outlet = document.getElementById('outlet');
  if (outlet) outlet.innerHTML = `<section><h1>Something went wrong</h1><pre>${escapeHtml(err.stack || String(err))}</pre></section>`;
});

