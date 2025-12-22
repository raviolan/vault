import { el } from '../els.js';

export function SwatchOption({ id, label, colors = [], selected = false, onSelect } = {}) {
  const card = el('div', { class: 'theme-card', dataset: { id } });
  const btn = el('button', { class: 'theme-swatch', type: 'button' });
  const preview = el('div', { class: 'swatch-preview' });
  for (const c of colors.slice(0, 5)) preview.appendChild(el('span', { style: { background: c } }));
  const text = el('span', { class: 'theme-label' }, label || id);
  btn.appendChild(preview);
  btn.appendChild(text);
  card.appendChild(btn);
  if (selected) card.setAttribute('data-selected', 'true');
  btn.addEventListener('click', () => {
    if (typeof onSelect === 'function') onSelect(id);
  });
  return card;
}

