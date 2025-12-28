// Minimal rich-text sanitizer for inline formatting inside paragraph blocks.
// Allowed tags: <strong>/<b>, <em>/<i>, <a href>, <br>
// Everything else is stripped; disallowed attributes removed.

const ALLOWED_TAGS = new Set(['STRONG', 'B', 'EM', 'I', 'A', 'BR']);

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

    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    const toRemove = [];
    const toCleanAttrs = [];

    let node = root;
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toUpperCase();
        if (!ALLOWED_TAGS.has(tag)) {
          toRemove.push(node);
        } else {
          // Clean attributes
          if (tag === 'A') {
            for (const attr of Array.from(node.attributes)) {
              if (attr.name.toLowerCase() !== 'href') node.removeAttribute(attr.name);
            }
            const href = node.getAttribute('href');
            if (!isSafeHref(href)) node.removeAttribute('href');
            // Security: default to rel noopener for external links (render-time concern, but safe to add)
            node.setAttribute('rel', 'noopener noreferrer');
          } else {
            for (const attr of Array.from(node.attributes)) node.removeAttribute(attr.name);
          }
          toCleanAttrs.push(node);
        }
      }
      node = walker.nextNode();
    }

    // Remove disallowed nodes but keep their text content where sensible.
    for (const el of toRemove) {
      const parent = el.parentNode;
      if (!parent) continue;
      // Replace with its text content and <br> for line breaks if it was a block-level; but since we only allow inline,
      // simply unwrap children.
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }

    // Normalize <b>/<i> to <strong>/<em> for consistency (optional)
    const mapTag = (src, dst) => {
      root.querySelectorAll(src).forEach((el) => {
        const repl = doc.createElement(dst.toUpperCase());
        while (el.firstChild) repl.appendChild(el.firstChild);
        el.replaceWith(repl);
      });
    };
    mapTag('b', 'strong');
    mapTag('i', 'em');

    // Ensure no scripts snuck in via malformed HTML
    root.querySelectorAll('script, style').forEach((el) => el.remove());

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

