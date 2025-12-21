// Contract verification suite
// Builds the client, boots a local server against a temp DATA_DIR, then
// exercises core API contracts. Exits non-zero on any failure.
//
// Usage: npm run verify

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(() => {});
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : null;
      srv.close(() => port ? resolve(port) : reject(new Error('no port')));
    });
    srv.on('error', reject);
  });
}

function withBase(base) {
  const url = (p) => `${base}${p.startsWith('/') ? '' : '/'}${p}`;
  const fetchText = async (p, opts) => {
    const res = await fetch(url(p), opts);
    const text = await res.text();
    return { res, text };
  };
  const fetchJson = async (p, opts) => {
    const res = await fetch(url(p), {
      headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
      ...opts,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { res, json, text };
  };
  return { url, fetchText, fetchJson };
}

async function waitForServer(fetchJson, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { res, json } = await fetchJson('/api/health');
      if (res.ok && json && json.ok) return true;
    } catch {}
    await delay(200);
  }
  throw new Error('server did not become ready');
}

async function run() {
  // 0) Build client first to ensure static assets are in place
  console.log('[verify] Building client...');
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['scripts/build.js'], { stdio: 'inherit' });
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`build failed (${code})`)));
  });

  // 1) Prepare temp data root
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dmvault-verify-'));
  console.log(`[verify] DATA_DIR: ${tmpRoot}`);

  // 2) Find a free port and start server
  const PORT = await getFreePort();
  const env = { ...process.env, DATA_DIR: tmpRoot, PORT: String(PORT), DMV_LOG_REQUESTS: '' };
  console.log(`[verify] Starting server on http://localhost:${PORT}`);
  const server = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });

  server.stdout.on('data', (d) => process.stdout.write(String(d)));
  server.stderr.on('data', (d) => process.stderr.write(String(d)));

  const { fetchJson, fetchText } = withBase(`http://localhost:${PORT}`);

  try {
    await waitForServer(fetchJson);

    // A) GET /api/pages returns array of pages
    process.stdout.write('[A] GET /api/pages ... ');
    {
      const { res, json } = await fetchJson('/api/pages');
      assert(res.ok, `expected 200, got ${res.status}`);
      assert(Array.isArray(json), 'expected array response');
    }
    console.log('OK');

    // (tags tests moved later after creating a dedicated page)

    // Create Page via resolve (Swedish letters)
    const titleSwe = 'ÅÄÖ Test';
    let page, pageId;
    process.stdout.write('[B] POST /api/pages/resolve (ÅÄÖ) ... ');
    {
      const { res, json, text } = await fetchJson('/api/pages/resolve', {
        method: 'POST',
        body: JSON.stringify({ title: titleSwe, type: 'note' }),
      });
      assert(res.status === 200 || res.status === 201, `expected 200/201, got ${res.status} — ${text}`);
      assert(json && json.page && typeof json.created === 'boolean', 'bad resolve shape');
      page = json.page;
      pageId = page.id;
      assert(page.title === titleSwe, 'title mismatch');
      assert(!/[åäöÅÄÖ]/.test(page.slug), 'slug contains Å/Ä/Ö');
    }
    console.log('OK');

    // C) PATCH page title should not change slug unless regenerateSlug=true
    process.stdout.write('[C] PATCH /api/pages/:id (no regenerateSlug) ... ');
    {
      const originalSlug = page.slug;
      const { res, json } = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'New Title' }),
      });
      assert(res.ok, `expected 200, got ${res.status}`);
      assert(json && json.slug === originalSlug, 'slug changed without regenerateSlug');
      // now regenerate
      const { res: res2, json: json2 } = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Regenerated Slug', regenerateSlug: true }),
      });
      assert(res2.ok, `expected 200, got ${res2.status}`);
      assert(json2 && json2.slug !== originalSlug, 'slug did not change with regenerateSlug');
    }
    console.log('OK');

    // I) Tags contract on a dedicated page
    const tagTitle = 'Tags Contract ' + Date.now();
    let tagPageId;
    {
      const { json } = await fetchJson('/api/pages/resolve', { method: 'POST', body: JSON.stringify({ title: tagTitle, type: 'note' }) });
      tagPageId = json.page.id;
    }
    process.stdout.write('[I1] PUT /api/pages/:id/tags (NPC, session) ... ');
    {
      const { res, json, text } = await fetchJson(`/api/pages/${encodeURIComponent(tagPageId)}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ tags: ['NPC', 'session'] }),
      });
      assert(res.ok, `expected 200, got ${res.status} — ${text}`);
      assert(json && json.pageId === tagPageId && Array.isArray(json.tags), 'bad page tags shape');
      assert(json.tags.length === 2 && json.tags.includes('NPC') && json.tags.includes('session'), 'tags not set/preserved');
    }
    console.log('OK');

    process.stdout.write('[I2] GET /api/pages/:id/tags reflect display (NPC, session) ... ');
    {
      const { res, json } = await fetchJson(`/api/pages/${encodeURIComponent(tagPageId)}/tags`);
      assert(res.ok && Array.isArray(json.tags), 'bad page tags get');
      assert(json.tags.length === 2 && json.tags.includes('NPC') && json.tags.includes('session'), 'page tags mismatch');
    }
    console.log('OK');

    process.stdout.write('[I3] PUT again with (npc, Session) updates display casing ... ');
    {
      const { res, json } = await fetchJson(`/api/pages/${encodeURIComponent(tagPageId)}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ tags: ['npc', 'Session'] }),
      });
      assert(res.ok && Array.isArray(json.tags), 'bad page tags put');
      // latest casing wins; ensure no duplicates and updated displays
      assert(json.tags.length === 2, 'unexpected tag count after update');
      assert(json.tags.includes('Session'), 'display casing did not update for Session');
      assert(json.tags.some(t => t.toLowerCase() === 'npc'), 'npc missing');
    }
    console.log('OK');

    process.stdout.write('[I4] GET /api/tags includes both with counts ... ');
    {
      const { res, json } = await fetchJson('/api/tags');
      assert(res.ok && Array.isArray(json.tags), 'bad tags list');
      const map = new Map(json.tags.map(t => [t.name.toLowerCase(), t.count]));
      assert(map.has('npc') && map.has('session'), 'global tags missing');
      assert(map.get('npc') === 1 && map.get('session') === 1, `unexpected counts: npc=${map.get('npc')}, session=${map.get('session')}`);
    }
    console.log('OK');

    process.stdout.write('[I5] Remove one tag (npc) and verify counts update ... ');
    {
      const { res } = await fetchJson(`/api/pages/${encodeURIComponent(tagPageId)}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ tags: ['npc'] }),
      });
      assert(res.ok, `expected 200, got ${res.status}`);
      const { json } = await fetchJson('/api/tags');
      const map = new Map(json.tags.map(t => [t.name.toLowerCase(), t.count]));
      assert(map.get('npc') === 1, `npc count unexpected: ${map.get('npc')}`);
      assert(map.get('session') === 0, `session count should be 0: ${map.get('session')}`);
    }
    console.log('OK');

    // D) Blocks create/patch/reorder
    let blockId;
    process.stdout.write('[D1] POST /api/pages/:id/blocks ... ');
    {
      const { res, json, text } = await fetchJson(`/api/pages/${encodeURIComponent(pageId)}/blocks`, {
        method: 'POST',
        body: JSON.stringify({ type: 'paragraph', content: { text: 'hello' } }),
      });
      assert(res.status === 201, `expected 201, got ${res.status} — ${text}`);
      assert(json && json.id && json.type === 'paragraph', 'block response missing fields');
      blockId = json.id;
    }
    console.log('OK');

    process.stdout.write('[D2] PATCH /api/blocks/:id ... ');
    {
      const { res, json } = await fetchJson(`/api/blocks/${encodeURIComponent(blockId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: { text: 'updated' } }),
      });
      assert(res.ok, `expected 200, got ${res.status}`);
      assert(json && typeof json.contentJson === 'string', 'missing contentJson');
      assert(JSON.parse(json.contentJson).text === 'updated', 'content not updated');
    }
    console.log('OK');

    process.stdout.write('[D3] POST /api/blocks/reorder ... ');
    {
      const { res, json } = await fetchJson('/api/blocks/reorder', {
        method: 'POST',
        body: JSON.stringify({ pageId, moves: [] }),
      });
      assert(res.ok, `expected 200, got ${res.status}`);
      assert(json && json.ok === true, 'reorder did not return ok:true');
    }
    console.log('OK');

    // E) Backlinks: create A and B; link B -> A; query backlinks(A)
    process.stdout.write('[E] Backlinks across pages ... ');
    {
      const titleA = 'Contract Gate A ' + Date.now();
      const titleB = 'Contract Gate B ' + Math.random().toString(36).slice(2,6);
      const { json: resA } = await fetchJson('/api/pages/resolve', { method: 'POST', body: JSON.stringify({ title: titleA, type: 'note' }) });
      const { json: resB } = await fetchJson('/api/pages/resolve', { method: 'POST', body: JSON.stringify({ title: titleB, type: 'note' }) });
      const pageA = resA.page; const pageB = resB.page;
      await fetchJson(`/api/pages/${encodeURIComponent(pageB.id)}/blocks`, { method: 'POST', body: JSON.stringify({ type: 'paragraph', content: { text: `See [[${titleA}]]!` } }) });
      const { res, json } = await fetchJson(`/api/pages/${encodeURIComponent(pageA.id)}/backlinks`);
      assert(res.ok, `expected 200, got ${res.status}`);
      assert(json && json.pageId === pageA.id && Array.isArray(json.backlinks), 'bad backlinks shape');
      assert(json.backlinks.some(b => b.id === pageB.id), 'backlinks missing referring page');
    }
    console.log('OK');

    // F) Search returns A by title fragment
    process.stdout.write('[F] GET /api/search ... ');
    {
      const { res, json } = await fetchJson(`/api/search?q=${encodeURIComponent('Contract Gate A')}`);
      assert(res.ok, `expected 200, got ${res.status}`);
      assert(json && typeof json.q === 'string' && Array.isArray(json.results), 'bad search shape');
      assert(json.results.some(r => /Contract Gate A/.test(r.title)), 'search missing expected page');
    }
    console.log('OK');

    // G) User state roundtrip
    process.stdout.write('[G] User state GET/PUT ... ');
    {
      const { res, json } = await fetchJson('/api/user/state');
      assert(res.ok && json && typeof json === 'object', 'bad user state');
      const patch = { notepadText: `verify-${Date.now()}` };
      const { res: r2, json: j2 } = await fetchJson('/api/user/state', { method: 'PUT', body: JSON.stringify(patch) });
      assert(r2.ok && j2.notepadText === patch.notepadText, 'PUT state did not persist');
      const { json: j3 } = await fetchJson('/api/user/state');
      assert(j3.notepadText === patch.notepadText, 'state not persisted on re-read');
    }
    console.log('OK');

    // H) Unknown route shape
    process.stdout.write('[H] Unknown /api route 404 ... ');
    {
      const { res, json } = await fetchJson('/api/this-route-should-not-exist');
      assert(res.status === 404, `expected 404, got ${res.status}`);
      assert(json && json.error === 'unknown api route', 'unexpected unknown route shape');
    }
    console.log('OK');

    console.log('\n[verify] Contract suite passed.');
  } finally {
    // Teardown child process and temp dir
    try { server.kill(); } catch {}
    try { await delay(200); } catch {}
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
}

run().catch(err => {
  console.error(`\n[verify] FAILED: ${err?.message || err}`);
  process.exitCode = 1;
});
