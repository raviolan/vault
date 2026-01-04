// Minimal rich-text sanitizer for inline formatting inside paragraph blocks.
// Allowed tags: <strong>, <em>, <a href>, <br>
// Everything else is unwrapped; disallowed attributes removed.

const ALLOWED_TAGS = new Set(['STRONG', 'EM', 'A', 'BR']);
const ALLOWED_ANCHOR_ATTRS = new Set([
  'href', 'target', 'rel',
  'data-wiki', 'data-page-id', 'data-token', 'data-src-block'
]);

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

      // Allow only specific <span> wrappers: inline-quote, o5e-link, inline-comment
      if (tag === 'SPAN') {
        const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
        const isInlineQuote = cls.includes('inline-quote');
        const isO5e = cls.includes('o5e-link');
        const isInlineComment = cls.includes('inline-comment');
        if (isInlineQuote) {
          // Strip all attributes except class, and reduce class to inline-quote only
          el.setAttribute('class', 'inline-quote');
          for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            if (name !== 'class') el.removeAttribute(attr.name);
          }
          continue;
        }
        if (isO5e) {
          // Preserve minimal attributes for Open5e link spans
          // Keep data-o5e-type and data-o5e-slug only; normalize class to include type modifier if present
          const t = String((el.getAttribute('data-o5e-type') || '').toLowerCase());
          const slug = String(el.getAttribute('data-o5e-slug') || '');
          // Validate slug (alphanumeric + dash)
          const safeSlug = /^[-a-z0-9]+$/.test(slug) ? slug : '';
          // Normalize supported types
          const allowedTypes = new Set(['spell','creature','condition','item','weapon','armor']);
          const safeType = allowedTypes.has(t) ? t : (t ? 'spell' : '');
          // Reduce attributes
          el.setAttribute('class', `o5e-link${safeType ? ` o5e-${safeType}` : ''}`.trim());
          // Remove all attrs first, then reapply minimal
          for (const attr of Array.from(el.attributes)) { el.removeAttribute(attr.name); }
          el.setAttribute('class', `o5e-link${safeType ? ` o5e-${safeType}` : ''}`.trim());
          if (safeType) el.setAttribute('data-o5e-type', safeType);
          if (safeSlug) el.setAttribute('data-o5e-slug', safeSlug);
          continue;
        }
        if (isInlineComment) {
          // Preserve minimal attributes for inline comments
          const id = String(el.getAttribute('data-comment-id') || '');
          // Basic UUID guard (optional, tolerate non-UUID to avoid data loss)
          const okId = /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/.test(id) ? id : (id || '');
          const text = el.getAttribute('data-comment');
          for (const attr of Array.from(el.attributes)) { el.removeAttribute(attr.name); }
          el.setAttribute('class', 'inline-comment');
          if (okId) el.setAttribute('data-comment-id', okId);
          // Preserve data-comment if present for hover UI (not serialized into token)
          if (text != null) el.setAttribute('data-comment', String(text));
          continue;
        }
        // Other spans are unwrapped
        unwrap(el);
        continue;
      }

      // Remove script/style outright
      if (tag === 'SCRIPT' || tag === 'STYLE') {
        el.remove();
        continue;
      }

      if (ALLOWED_TAGS.has(tag)) {
        // Strip attributes; for <a> keep only a safe minimal set
        if (tag === 'A') {
          for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            if (!ALLOWED_ANCHOR_ATTRS.has(name)) el.removeAttribute(attr.name);
          }
          const href = el.getAttribute('href');
          if (!isSafeHref(href)) el.removeAttribute('href');
          // Ensure rel is present for safety if a target is used or external link
          if (!el.getAttribute('rel')) el.setAttribute('rel', 'noopener noreferrer');
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

// Count tokens in canonical text form (used by save guard and tests)
export function countAnnotationTokens(text) {
  try {
    const s = String(text || '');
    const wikiId = (s.match(/\[\[page:[0-9a-fA-F-]{36}\|[^\]]*?\]\]/g) || []).length;
    const o5e = (s.match(/\[\[o5e:([a-z]+):([a-z0-9-]+)\|[^\]]*?\]\]/gi) || []).length;
    const cmt = (s.match(/\[\[cmt:[0-9a-fA-F-]{36}\|[^\]]*?\]\]/g) || []).length;
    return { wikiId, o5e, cmt, total: wikiId + o5e + cmt };
  } catch { return { wikiId: 0, o5e: 0, cmt: 0, total: 0 }; }
}

// Serialize a rich DOM back to canonical text, preserving inline tokens
// Recognizes:
// - <a.wikilink idlink data-page-id> => [[page:<uuid>|Label]]
// - <a.wikilink.legacy data-token> => original token
// - <span.o5e-link data-o5e-type data-o5e-slug> => [[o5e:type:slug|Label]]
// - <span.inline-comment data-comment-id> => [[cmt:<uuid>|Label]]
// - <span.inline-quote>...</span> => {{q: ...}}
// - <br> => \n
export function plainTextFromHtmlContainer(el) {
  function serializeNode(n) {
    if (!n) return '';
    const nt = n.nodeType;
    if (nt === Node.TEXT_NODE) {
      return String(n.nodeValue || '');
    }
    if (nt === Node.ELEMENT_NODE) {
      const tag = (n.tagName || '').toUpperCase();
      const cl = (n.classList ? Array.from(n.classList) : []);
      // Line break
      if (tag === 'BR') return '\n';
      // Wikilink (id form)
      if (tag === 'A' && cl.includes('wikilink')) {
        const token = n.getAttribute('data-token');
        if (token) return String(token);
        const mode = String(n.getAttribute('data-wiki') || '').toLowerCase();
        if (mode === 'id') {
          const id = n.getAttribute('data-page-id') || '';
          const label = serializeChildren(n);
          if (id && label != null) return `[[page:${id}|${label}]]`;
        } else if (mode === 'title') {
          const title = n.getAttribute('data-wiki-title') || '';
          if (title) return `[[${title}]]`;
        }
        // Fallback: plain text
        return serializeChildren(n);
      }
      // Open5e link span
      if (tag === 'SPAN' && cl.includes('o5e-link')) {
        const t = (n.getAttribute('data-o5e-type') || '').toLowerCase();
        const slug = n.getAttribute('data-o5e-slug') || '';
        const label = serializeChildren(n);
        if (t && slug) return `[[o5e:${t}:${slug}|${label}]]`;
        return label;
      }
      // Inline comment span
      if (tag === 'SPAN' && cl.includes('inline-comment')) {
        const id = n.getAttribute('data-comment-id') || '';
        const label = serializeChildren(n);
        if (id) return `[[cmt:${id}|${label}]]`;
        return label;
      }
      // Inline quote wrapper
      if (tag === 'SPAN' && cl.includes('inline-quote')) {
        const inner = serializeChildren(n);
        return `{{q: ${inner}}}`;
      }
      // For other allowed/unknown tags, serialize children recursively
      return serializeChildren(n);
    }
    // Other nodes ignored
    return '';
  }
  function serializeChildren(el) {
    let out = '';
    const cs = el.childNodes || [];
    for (let i = 0; i < cs.length; i++) out += serializeNode(cs[i]);
    return out;
  }
  try {
    const s = serializeChildren(el)
      .replace(/\u00A0/g, ' ')
      .replace(/\s+$/g, '');
    return s;
  } catch {
    try {
      return String(el.innerText || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+$/g, '');
    } catch { return ''; }
  }
}
