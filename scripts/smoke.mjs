// Lightweight smoke test against a running server
// Usage:
//   BASE_URL=http://localhost:8080 node scripts/smoke.mjs
// or via npm script: npm run smoke

const BASE = process.env.BASE_URL || 'http://localhost:8080';

function url(p) {
  return `${BASE}${p.startsWith('/') ? '' : '/'}${p}`;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchText(path, opts) {
  const res = await fetch(url(path), opts);
  const text = await res.text();
  return { res, text };
}

async function fetchJson(path, opts) {
  const res = await fetch(url(path), {
    headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
    ...opts,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { res, json, text };
}

async function main() {
  console.log(`[smoke] Base URL: ${BASE}`);

  let createdSmokePageId = null;
  let createdO5ePageId = null;
  let createdResolvePageId = null;

  try {
    // 1) GET /
    process.stdout.write('[1] GET / ... ');
    {
      const { res, text } = await fetchText('/');
      assert(res.ok, `expected 200, got ${res.status}`);
      assert(/DM Vault|Hembränt/.test(text), 'landing HTML missing recognizable text');
    }
    console.log('OK');

    // 2) GET /app.js
    process.stdout.write('[2] GET /app.js ... ');
    {
      const { res, text } = await fetchText('/app.js');
      assert(res.ok, `expected 200, got ${res.status}`);
      assert(/import\s|function\s/.test(text), 'bundle does not look like JS');
    }
    console.log('OK');

    // 3) GET /api/pages
    process.stdout.write('[3] GET /api/pages ... ');
    {
      const { res, json } = await fetchJson('/api/pages');
      assert(res.ok, `expected 200, got ${res.status}`);
      assert(Array.isArray(json), 'expected JSON array');
    }
    console.log('OK');

    // Unique title for this run
    const stamp = Date.now();
    const uniq = `SMOKE_TEST_${stamp}_${Math.random().toString(36).slice(2, 8)}`;

    // 4) Create page
    process.stdout.write('[4] POST /api/pages (create page) ... ');
    let createdPage;
    {
      const { res, json, text } = await fetchJson('/api/pages', {
        method: 'POST',
        body: JSON.stringify({ title: uniq, type: 'note' }),
      });
      assert(res.status === 201, `expected 201, got ${res.status} — ${text}`);
      assert(json && json.id && json.title && json.type, 'page object missing fields');
      createdSmokePageId = json.id;
      createdPage = json;
    }
    console.log('OK');

    // 5) Fetch created page
    process.stdout.write('[5] GET /api/pages/:id ... ');
    {
      const { res, json } = await fetchJson(`/api/pages/${encodeURIComponent(createdSmokePageId)}`);
      assert(res.ok, `expected 200, got ${res.status}`);
      assert(json && json.id === createdSmokePageId, 'fetched page id mismatch');
      assert(Array.isArray(json.blocks), 'expected blocks array');
    }
    console.log('OK');

    // 6) Create a paragraph block with a legacy wiki token
    process.stdout.write('[6] POST /api/pages/:id/blocks (paragraph) ... ');
    {
      const { res, json, text } = await fetchJson(`/api/pages/${encodeURIComponent(createdSmokePageId)}/blocks`, {
        method: 'POST',
        body: JSON.stringify({ type: 'paragraph', parentId: null, sort: 0, props: {}, content: { text: 'Hello [[ÅTEJ]] world' } }),
      });
      assert(res.status === 201, `expected 201, got ${res.status} — ${text}`);
      assert(json && json.id && json.type === 'paragraph', 'block create failed');
    }
    console.log('OK');

    // 7) Search for the page by its unique title
    process.stdout.write('[7] GET /api/search?q=... ... ');
    {
      const { res, json } = await fetchJson(`/api/search?q=${encodeURIComponent(uniq)}`);
      assert(res.ok, `expected 200, got ${res.status}`);
      assert(json && typeof json.q === 'string' && Array.isArray(json.results), 'bad search response shape');
      const hit = json.results.find(r => r.id === createdSmokePageId || r.title === uniq);
      assert(!!hit, 'created page not found in search results');
    }
    console.log('OK');

    // 8) Resolve legacy wiki link for ÅTEJ and validate slug mapping
    process.stdout.write('[8] POST /api/pages/resolve (ÅTEJ) ... ');
    {
      const { res, json, text } = await fetchJson('/api/pages/resolve', {
        method: 'POST',
        body: JSON.stringify({ title: 'ÅTEJ', type: 'note' }),
      });
      assert(res.ok || res.status === 201, `expected 200/201, got ${res.status} — ${text}`);
      assert(json && json.page && typeof json.created === 'boolean', 'resolve response missing fields');
      const slug = String(json.page.slug || '');
      assert(/^[a-z0-9-]+$/.test(slug), `slug not URL-safe: ${slug}`);
      assert(slug.includes('atej'), `slug does not reflect mapping (expected contains 'atej'): ${slug}`);
      if (json.created) createdResolvePageId = json.page.id;
    }
    console.log('OK');

    // 9) Optional: backlinks
    process.stdout.write('[9] GET /api/pages/:id/backlinks ... ');
    {
      const { res, json } = await fetchJson(`/api/pages/${encodeURIComponent(createdSmokePageId)}/backlinks`);
      if (res.ok) {
        assert(json && json.pageId && typeof json.title === 'string' && Array.isArray(json.backlinks), 'bad backlinks response shape');
        console.log('OK');
      } else {
        console.log('SKIP (endpoint not present)');
      }
    }

    // 10) Delete created page(s)
    // 10) Verify Open5e local-pages lookup
    process.stdout.write('[10] Open5e local-pages lookup ... ');
    {
      // Create a page and mark it as Open5e creature: hawk
      const { json: p } = await fetchJson('/api/pages', { method: 'POST', body: JSON.stringify({ title: `Hawk (${stamp})`, type: 'note' }) });
      createdO5ePageId = p.id;
      await fetchJson(`/api/pages/${encodeURIComponent(p.id)}/sheet`, { method: 'PATCH', body: JSON.stringify({ open5eSource: { type: 'creature', slug: 'hawk', apiUrl: '/api/open5e/monsters/hawk/', createdFrom: 'open5e', readonly: true } }) });
      const { res, json } = await fetchJson('/api/open5e/local-pages?type=creature&slug=hawk');
      assert(res.ok, `expected 200, got ${res.status}`);
      assert(Array.isArray(json.pages), 'pages array missing');
      const found = json.pages.find(x => x.id === createdO5ePageId);
      assert(!!found, 'local-pages did not find created page');
    }
    console.log('OK');

    // 11) DELETE /api/pages/:id (cleanup)
    process.stdout.write('[11] DELETE /api/pages/:id (cleanup) ... ');
    {
      const { res } = await fetchJson(`/api/pages/${encodeURIComponent(createdSmokePageId)}`, { method: 'DELETE' });
      assert(res.ok, `delete smoke page failed (${res.status})`);
    }
    console.log('OK');

    if (createdResolvePageId) {
      process.stdout.write('[12] DELETE resolved ÅTEJ page (cleanup) ... ');
      const { res } = await fetchJson(`/api/pages/${encodeURIComponent(createdResolvePageId)}`, { method: 'DELETE' });
      if (res.ok) console.log('OK'); else console.log(`WARN (${res.status})`);
    }
    if (createdO5ePageId) {
      process.stdout.write('[13] DELETE created Open5e page (cleanup) ... ');
      const { res } = await fetchJson(`/api/pages/${encodeURIComponent(createdO5ePageId)}`, { method: 'DELETE' });
      if (res.ok) console.log('OK'); else console.log(`WARN (${res.status})`);
    }

    console.log('\nAll smoke tests passed.');
  } catch (err) {
    console.error(`\nSmoke test FAILED: ${err?.message || err}`);
    // Try cleanup best-effort
    try {
      if (createdSmokePageId) await fetchJson(`/api/pages/${encodeURIComponent(createdSmokePageId)}`, { method: 'DELETE' });
    } catch {}
    try {
      if (createdResolvePageId) await fetchJson(`/api/pages/${encodeURIComponent(createdResolvePageId)}`, { method: 'DELETE' });
    } catch {}
    process.exit(1);
  }
}

main();
