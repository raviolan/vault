#!/usr/bin/env node
// Smoke test: nested wikilinks normalize to a single token

function assert(cond, msg) { if (!cond) { console.error(msg); process.exit(1); } }

function normalizeNestedWikiTokens(s) {
  try {
    let out = String(s || '');
    const re = /\[\[page:([0-9a-fA-F-]{36})\|\s*\[\[page:\1\|([^\]]*?)\]\]\s*\]\]/g;
    let prev;
    do { prev = out; out = out.replace(re, '[[page:$1|$2]]'); } while (out !== prev);
    return out;
  } catch { return String(s || ''); }
}

const id = '00000000-0000-0000-0000-000000000000';
const bad = `[[page:${id}|[[page:${id}|Bavlorna]]]]`;
const good = `[[page:${id}|Bavlorna]]`;
const out = normalizeNestedWikiTokens(bad);
assert(out === good, `Normalization failed. Got: ${out}`);
console.log('smoke:wikilinks-nesting OK');

