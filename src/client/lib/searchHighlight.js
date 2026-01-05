// Minimal, safe highlighter for plain text. Returns HTML string with <mark>.
// - Escapes all text
// - Case-insensitive matching
// - Does not rely on regex replacement of raw HTML

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function highlightHtml(text, term) {
  const src = String(text || '');
  const q = String(term || '');
  if (!q) return escapeHtml(src);
  const srcLower = src.toLowerCase();
  const qLower = q.toLowerCase();
  let i = 0;
  let pos = 0;
  const parts = [];
  while ((i = srcLower.indexOf(qLower, pos)) !== -1) {
    // pre
    if (i > pos) parts.push(escapeHtml(src.slice(pos, i)));
    // match
    parts.push('<mark>' + escapeHtml(src.slice(i, i + q.length)) + '</mark>');
    pos = i + q.length;
    // guard
    if (parts.length > 2000) break;
  }
  if (pos < src.length) parts.push(escapeHtml(src.slice(pos)));
  return parts.join('');
}

