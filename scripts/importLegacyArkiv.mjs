// scripts/importLegacyArkiv.mjs
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

let AdmZip, parseHtml;
try {
  ({ default: AdmZip } = await import('adm-zip'));
  ({ parse: parseHtml } = await import('node-html-parser'));
} catch (e) {
  console.error('\nMissing deps for importer.\nRun:\n  npm i -D adm-zip node-html-parser\n');
  process.exit(1);
}

function normTitle(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

function usage() {
  console.log(`
Usage:
  node scripts/importLegacyArkiv.mjs /path/to/Arkiv.zip [--base http://localhost:8080] [--dry-run] [--overwrite]

Notes:
- Requires the DM Vault server running (default base: http://localhost:8080)
- Imports HTML pages via the public API (/api/pages, /api/pages/:id/blocks, /api/pages/:id/tags)
`);
}

function inferTypeFromRelPath(relPath) {
  const top = relPath.split('/')[0];
  if (top === '03_PCs') return 'character';
  if (top === '04_NPCs') return 'npc';
  if (top === 'Locations') return 'location';
  if (top === '01_Arcs') return 'arc';
  if (top === "05_Tools & Tables") return 'tool';
  if (top === "000_today's tools") return 'tool';
  if (top === '00_Campaign') return 'note';
  return 'note';
}

function shouldSkipEntry(entryName) {
  if (!entryName.endsWith('.html')) return true;
  if (entryName.startsWith('__MACOSX/')) return true;
  if (entryName.includes('/.DS_Store')) return true;
  if (entryName.startsWith('assets/')) return true;
  if (entryName.startsWith('99_Attachments/')) return true;
  return false;
}

function cleanText(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function pickArticleRoot(doc) {
  const main = doc.querySelector('main');
  const article = main?.querySelector('article') || doc.querySelector('article');
  return article || main || doc;
}

function isEntityPage(article) {
  const cls = article.getAttribute?.('class') || '';
  return /\bentity-page\b/.test(cls);
}
function isLandingPage(article) {
  const cls = article.getAttribute?.('class') || '';
  return /\blanding-page\b/.test(cls);
}

function extractTitleAndSubtitle(article, relPath) {
  // entity-page: title + subtitle from section.entity text
  if (isEntityPage(article)) {
    const ent = article.querySelector('section.entity');
    const lines = ent ? ent.textContent.split('\n').map(s => s.trim()).filter(Boolean) : [];
    const title = lines[0] || path.basename(relPath, '.html');
    const subtitle = lines[1] || '';
    return { title: normTitle(title), subtitle: cleanText(subtitle) };
  }

  // landing-page: from .landing-header (often icon, title, description)
  if (isLandingPage(article)) {
    const head = article.querySelector('.landing-header');
    const lines = head ? head.textContent.split('\n').map(s => s.trim()).filter(Boolean) : [];
    // heuristic: first might be emoji/icon, second is title
    let title = lines[0] || '';
    if (title.length <= 3 && lines[1]) title = lines[1];
    if (!title) title = path.basename(relPath, '.html');
    // description is usually last line
    const desc = lines.length >= 2 ? lines[lines.length - 1] : '';
    return { title: normTitle(title), subtitle: cleanText(desc) };
  }

  // fallback
  const t = article.ownerDocument?.querySelector('title')?.textContent || path.basename(relPath, '.html');
  return { title: normTitle(t), subtitle: '' };
}

function legacyKeyFromHref(href) {
  if (!href) return null;
  // accept "/03_PCs/Foo.html" or "03_PCs/Foo.html"
  let h = href.trim();
  if (h.startsWith('http://') || h.startsWith('https://')) return null;
  if (h.startsWith('#')) return null;
  h = h.replace(/^\//, '');
  // normalize missing .html
  if (!h.endsWith('.html') && !h.includes('?') && !h.includes('#')) {
    // many exports use "/03_PCs/Foo" without .html
    h = `${h}.html`;
  }
  // strip query/hash
  h = h.split('?')[0].split('#')[0];
  return h;
}

function inlineText(node, resolveLink) {
  if (!node) return '';
  // node-html-parser: text nodes have rawText and no rawTagName
  if (!node.rawTagName) {
    return node.rawText || '';
  }
  const tag = node.rawTagName.toLowerCase();
  if (tag === 'a') {
    const label = cleanText(node.textContent);
    const dataTarget = node.getAttribute('data-target');
    const href = node.getAttribute('href');
    const legacyKey = legacyKeyFromHref(href);
    const resolved = resolveLink({ dataTarget, legacyKey, label });
    return resolved || label;
  }
  // ignore buttons/nav UI
  if (tag === 'button' || tag === 'nav') return '';
  // recurse
  let out = '';
  for (const child of node.childNodes || []) out += inlineText(child, resolveLink);
  return out;
}

function extractTokens(contentRoot, resolveLink) {
  const tokens = [];

  function walk(node) {
    if (!node) return;
    // text node
    if (!node.rawTagName) return;

    const tag = node.rawTagName.toLowerCase();

    // Skip obvious UI wrappers we don't want duplicated
    if (tag === 'nav') return;

    if (tag === 'hr') {
      tokens.push({ kind: 'divider' });
      return;
    }

    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
      const lvl = Math.min(3, Number(tag.slice(1)) || 3);
      const txt = cleanText(inlineText(node, resolveLink));
      if (txt) tokens.push({ kind: 'heading', level: lvl, text: txt });
      return;
    }

    if (tag === 'p') {
      const txt = cleanText(inlineText(node, resolveLink));
      if (txt) tokens.push({ kind: 'paragraph', text: txt });
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      const items = node.querySelectorAll('li') || [];
      const lines = [];
      for (const li of items) {
        const t = cleanText(inlineText(li, resolveLink));
        if (t) lines.push(`- ${t}`);
      }
      const txt = cleanText(lines.join('\n'));
      if (txt) tokens.push({ kind: 'paragraph', text: txt });
      return;
    }

    // recurse children
    for (const child of node.childNodes || []) walk(child);
  }

  walk(contentRoot);
  return tokens;
}

function extractTagsFromText(text) {
  const tags = new Set();
  const re = /#([a-z0-9_-]+)/gi;
  let m;
  while ((m = re.exec(text))) tags.add(m[1].toLowerCase());
  return [...tags];
}

async function api(baseUrl, method, url, body) {
  const res = await fetch(baseUrl + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text().catch(() => '');
  if (!res.ok) {
    const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
    throw new Error(`${method} ${url} -> ${res.status} ${msg}`);
  }
  return payload;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(args.length ? 0 : 1);
  }

  const zipPath = args[0];
  let baseUrl = 'http://localhost:8080';
  let dryRun = false;
  let overwrite = false;

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--base') baseUrl = args[++i] || baseUrl;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--overwrite') overwrite = true;
  }

  if (!fs.existsSync(zipPath)) {
    console.error(`Zip not found: ${zipPath}`);
    process.exit(1);
  }

  // Load existing pages to avoid duplicates
  const existing = await api(baseUrl, 'GET', '/api/pages');
  const existingByTitle = new Map();
  for (const p of existing || []) existingByTitle.set(normTitle(p.title), p);

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries()
    .filter(e => !e.isDirectory)
    .filter(e => !shouldSkipEntry(e.entryName));

  console.log(`Found ${entries.length} HTML files to import.`);

  // Pass 1: create pages (or map existing)
  const importItems = [];
  const legacyPathToPage = new Map(); // "03_PCs/Foo.html" => page
  const titleToPage = new Map();      // normalized title => page

  let created = 0, skipped = 0, deleted = 0;

  for (const e of entries) {
    const relPath = e.entryName;
    const html = e.getData().toString('utf8');
    const doc = parseHtml(html);
    const article = pickArticleRoot(doc);

    const { title, subtitle } = extractTitleAndSubtitle(article, relPath);
    const type = inferTypeFromRelPath(relPath);

    importItems.push({ relPath, html, title, subtitle, type });

    const existingPage = existingByTitle.get(title);
    if (existingPage && !overwrite) {
      legacyPathToPage.set(relPath, existingPage);
      titleToPage.set(title, existingPage);
      skipped++;
      continue;
    }

    if (existingPage && overwrite) {
      if (!dryRun) await api(baseUrl, 'DELETE', `/api/pages/${encodeURIComponent(existingPage.id)}`);
      deleted++;
      existingByTitle.delete(title);
    }

    if (dryRun) {
      const fake = { id: `DRY_${created}`, title, type };
      legacyPathToPage.set(relPath, fake);
      titleToPage.set(title, fake);
      created++;
      continue;
    }

    const page = await api(baseUrl, 'POST', '/api/pages', { title, type });
    legacyPathToPage.set(relPath, page);
    titleToPage.set(title, page);
    created++;
  }

  // Build quick link resolver: href "/03_PCs/Foo.html" => imported page id
  const legacyHrefToPageId = new Map();
  for (const [relPath, p] of legacyPathToPage.entries()) {
    if (!p?.id) continue;
    legacyHrefToPageId.set(relPath, p.id);
    legacyHrefToPageId.set(relPath.replace(/\.html$/i, ''), p.id);
    legacyHrefToPageId.set('/' + relPath, p.id);
    legacyHrefToPageId.set('/' + relPath.replace(/\.html$/i, ''), p.id);
  }

  console.log(`Pages: created=${created} skipped=${skipped} deleted=${deleted} (dryRun=${dryRun})`);

  // Pass 2: create blocks + tags
  let blockPages = 0, blockErrors = 0;

  for (const item of importItems) {
    const page = legacyPathToPage.get(item.relPath);
    if (!page?.id) continue;

    if (String(page.id).startsWith('DRY_')) continue;

    const doc = parseHtml(item.html);
    const article = pickArticleRoot(doc);

    // content root selection
    let contentRoot = article;
    if (isEntityPage(article)) {
      contentRoot = article.querySelector('.entity-body') || article;
    }

    // link resolver -> DM Vault wikilinks
    const resolveLink = ({ dataTarget, legacyKey, label }) => {
      // Prefer href-based resolution
      if (legacyKey && legacyHrefToPageId.has(legacyKey)) {
        const id = legacyHrefToPageId.get(legacyKey);
        return `[[page:${id}|${label || dataTarget || 'Link'}]]`;
      }
      // Next: data-target resolution by title
      if (dataTarget) {
        const t = normTitle(dataTarget);
        const p = titleToPage.get(t);
        if (p?.id) return `[[page:${p.id}|${label || t}]]`;
        return `[[${t}]]`;
      }
      return label || '';
    };

    const tokens = [];

    // add entity subtitle as first paragraph if present
    if (isEntityPage(article) && item.subtitle) {
      tokens.push({ kind: 'paragraph', text: item.subtitle });
    }
    // add landing page description as first paragraph if present (subtitle is description there)
    if (isLandingPage(article) && item.subtitle) {
      tokens.push({ kind: 'paragraph', text: item.subtitle });
    }

    tokens.push(...extractTokens(contentRoot, resolveLink));

    // tags from all paragraph text
    const tags = new Set();
    for (const t of tokens) {
      if (t.kind === 'paragraph') for (const tg of extractTagsFromText(t.text)) tags.add(tg);
    }

    if (!dryRun) {
      // Build blocks with heading nesting
      const stack = { 1: null, 2: null, 3: null };
      const nextSort = new Map();
      const getSort = (parentId) => {
        const key = parentId || '__root__';
        const n = nextSort.get(key) || 0;
        nextSort.set(key, n + 1);
        return n;
      };

      // (Optional) If page already has blocks and we skipped creation, we won't append.
      // This importer assumes new pages are empty. If you re-run, use --overwrite.
      // Create blocks in order:
      for (const tok of tokens) {
        if (tok.kind === 'heading') {
          const level = Math.min(3, Math.max(1, Number(tok.level) || 3));
          const parentId =
            level === 1 ? null :
            (stack[level - 1] || null);

          const block = await api(baseUrl, 'POST', `/api/pages/${encodeURIComponent(page.id)}/blocks`, {
            type: 'section',
            parentId,
            sort: getSort(parentId),
            props: { collapsed: false, level },
            content: { title: tok.text },
          });

          stack[level] = block.id;
          if (level < 3) stack[level + 1] = null;
          if (level < 2) stack[level + 2] = null;
          continue;
        }

        if (tok.kind === 'divider') {
          const parentId = stack[3] || stack[2] || stack[1] || null;
          await api(baseUrl, 'POST', `/api/pages/${encodeURIComponent(page.id)}/blocks`, {
            type: 'divider',
            parentId,
            sort: getSort(parentId),
            props: {},
            content: {},
          });
          continue;
        }

        if (tok.kind === 'paragraph') {
          const parentId = stack[3] || stack[2] || stack[1] || null;
          const txt = cleanText(tok.text);
          if (!txt) continue;
          await api(baseUrl, 'POST', `/api/pages/${encodeURIComponent(page.id)}/blocks`, {
            type: 'paragraph',
            parentId,
            sort: getSort(parentId),
            props: {},
            content: { text: txt },
          });
        }
      }

      // set tags (if any)
      if (tags.size) {
        await api(baseUrl, 'PUT', `/api/pages/${encodeURIComponent(page.id)}/tags`, { tags: [...tags] });
      }
    }

    blockPages++;
    if (blockPages % 10 === 0) console.log(`Imported blocks for ${blockPages}/${importItems.length} pages...`);
  }

  console.log(`Done. Block import pages processed=${blockPages} errors=${blockErrors}`);
  console.log('Tip: If you re-run, use --overwrite to avoid duplicate content.');
}

main().catch((e) => {
  console.error('\nImport failed:\n', e);
  process.exit(1);
});

