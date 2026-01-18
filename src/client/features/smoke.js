// Deterministic browser smoke checks for annotation roundtrip
// Run by visiting with ?smoke=1 (logs to console and shows a small banner)
import { sanitizeRichHtml, plainTextFromHtmlContainer, countAnnotationTokens } from '../lib/sanitize.js';
import { buildApiPath } from '../features/open5eCore.js';

function banner(text, ok = true) {
  try {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.zIndex = '2000';
    el.style.right = '8px';
    el.style.bottom = '8px';
    el.style.padding = '8px 10px';
    el.style.borderRadius = '8px';
    el.style.background = ok ? 'rgba(0,160,0,0.9)' : 'rgba(180,0,0,0.9)';
    el.style.color = 'white';
    el.style.fontSize = '12px';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => { try { el.remove(); } catch {} }, 4000);
  } catch {}
}

export function runAnnotationSmoke() {
  try {
    const host = document.createElement('div');
    host.innerHTML = sanitizeRichHtml(
      '<span class="o5e-link" data-o5e-type="spell" data-o5e-slug="acid-arrow">Melf\'s Acid Arrow</span> and ' +
      '<a class="wikilink idlink" data-wiki="id" data-page-id="00000000-0000-0000-0000-000000000000">Home</a> and ' +
      '<span class="inline-comment" data-comment-id="11111111-1111-1111-1111-111111111111">note</span><br>' +
      '<span class="inline-quote">quoted</span>'
    );
    const text = plainTextFromHtmlContainer(host);
    const counts = countAnnotationTokens(text);
    const ok = (counts.o5e === 1 && counts.wikiId === 1 && counts.cmt === 1 && /\{\{q:\s*quoted\s*\}\}/.test(text) && /\n/.test(text));
    if (ok) {
      console.log('[smoke] annotation roundtrip ok', { text, counts });
      banner('Smoke: annotations OK', true);
    } else {
      console.error('[smoke] annotation roundtrip FAILED', { text, counts });
      banner('Smoke: annotations FAILED', false);
    }
  } catch (e) {
    console.error('[smoke] error', e);
    banner('Smoke: error', false);
  }

  // Additional quick checks: Open5e API path mapping correctness
  try {
    const m1 = buildApiPath('creature', 'hawk');
    const m2 = buildApiPath('condition', 'blinded');
    const m3 = buildApiPath('item', 'bag-of-holding');
    const okMap = (/\/api\/open5e\/monsters\//.test(m1)
      && /\/api\/open5e\/conditions\//.test(m2)
      && /\/api\/open5e\/magicitems\//.test(m3));
    if (okMap) {
      console.log('[smoke] Open5e path mapping ok', { m1, m2, m3 });
    } else {
      console.error('[smoke] Open5e path mapping FAILED', { m1, m2, m3 });
      banner('Smoke: Open5e mapping FAILED', false);
    }
  } catch {}
}

// Auto-run when ?smoke=1
try {
  const params = new URLSearchParams(window.location.search || '');
  if (params.get('smoke') === '1') setTimeout(() => runAnnotationSmoke(), 100);
} catch {}
