// Minimal rich-text sanitizer for inline formatting inside paragraph blocks.
// Allowed tags: <strong>, <em>, <a href>, <br>
// Everything else is unwrapped; disallowed attributes removed.

const ALLOWED_TAGS = new Set(['STRONG', 'EM', 'A', 'BR']);

function isSafeHref(href) {
  try {
    if (!href) return false;
    const trimmed = String(href).trim();
    // Allow relative URLs
    if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true;
    const u = new URL(trimmed, window.location.origin);
    const p = u.protocol.toLowerCase();
    return p === 'http:' || p === 'https:' || p === 'mailto:';
  } catch {
    return false;
  }
}

export function sanitizeRichHtml(html) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return '';

    function unwrap(el) {
      const p = el.parentNode;
      if (!p) return;
      while (el.firstChild) p.insertBefore(el.firstChild, el);
      p.removeChild(el);
    }

    // Normalize b/i to strong/em BEFORE pruning so they won't be stripped.
    const mapTag = (src, dst) => {
      root.querySelectorAll(src).forEach((el) => {
        const repl = doc.createElement(dst.toUpperCase());
        while (el.firstChild) repl.appendChild(el.firstChild);
        el.replaceWith(repl);
      });
    };
    mapTag('b', 'strong');
    mapTag('i', 'em');

    // Normalize styled <span> produced by editors into allowed <strong>/<em>
    // Do this before pruning so formatting is preserved.
    root.querySelectorAll('span').forEach((span) => {
      const style = String(span.getAttribute('style') || '').toLowerCase();
      if (!style) return; // no inline style; span will be stripped later

      // Detect bold: font-weight: bold/bolder or >= 600
      let isBold = false;
      const fwMatch = style.match(/font-weight\s*:\s*([^;]+)/);
      if (fwMatch) {
        const val = fwMatch[1].trim();
        if (val === 'bold' || val === 'bolder') {
          isBold = true;
        } else {
          const num = parseInt(val, 10);
          if (!Number.isNaN(num) && num >= 600) isBold = true;
        }
      }

      // Detect italic: font-style: italic
      let isItalic = /font-style\s*:\s*(italic|oblique)/.test(style);

      if (!isBold && !isItalic) return; // leave as-is to be stripped later

      // Build the replacement wrapper(s): <em> then <strong> if applicable
      const frag = doc.createDocumentFragment();
      while (span.firstChild) frag.appendChild(span.firstChild);

      let wrapped = frag;
      if (isItalic) {
        const em = doc.createElement('EM');
        em.appendChild(wrapped);
        wrapped = em;
      }
      if (isBold) {
        const strong = doc.createElement('STRONG');
        strong.appendChild(wrapped);
        wrapped = strong;
      }

      span.replaceWith(wrapped);
    });

    // Process all elements deepest-to-shallowest and unwrap disallowed tags.
    const all = Array.from(root.querySelectorAll('*')).reverse();
    for (const el of all) {
      const tag = el.tagName.toUpperCase();

      // Remove script/style outright
      if (tag === 'SCRIPT' || tag === 'STYLE') {
        el.remove();
        continue;
      }

      if (ALLOWED_TAGS.has(tag)) {
        // Strip attributes; for <a> keep only a safe href and set rel
        if (tag === 'A') {
          for (const attr of Array.from(el.attributes)) {
            if (attr.name.toLowerCase() !== 'href') el.removeAttribute(attr.name);
          }
          const href = el.getAttribute('href');
          if (!isSafeHref(href)) el.removeAttribute('href');
          el.setAttribute('rel', 'noopener noreferrer');
        } else {
          for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
        }
        continue;
      }

      // Disallowed tag: unwrap it to preserve children/formatting
      unwrap(el);
    }

    // Return innerHTML of the container
    return root.innerHTML
      .replace(/\u00A0/g, ' ')
      .replace(/\s+$/g, ''); // trimEnd
  } catch {
    return '';
  }
}

export function plainTextFromHtmlContainer(el) {
  try {
    // Use innerText so it respects <br> as line breaks
    return String(el.innerText || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+$/g, ''); // trimEnd only
  } catch {
    return '';
  }
}
