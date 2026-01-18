#!/usr/bin/env node
// Smoke test: Open5e URL builders by type

function assert(cond, msg) { if (!cond) { console.error(msg); process.exit(1); } }

import { buildApiPath, buildOpenUrl, normalizeO5eType } from '../src/client/features/open5eCore.js';

const slug = 'hawk';
const t = normalizeO5eType('creature');
const api = buildApiPath(t, slug);
const site = buildOpenUrl(t, slug);
assert(api.includes('/monsters/'), `API path should use monsters: ${api}`);
assert(site.includes('/monsters/'), `Site URL should use monsters: ${site}`);
console.log('smoke:o5e-urls OK');

