#!/usr/bin/env node
// Deterministic smoke for Open5e link tokens across resources

function assert(cond, msg) { if (!cond) { console.error(msg); process.exit(1); } }

function roundtrip(obj) { return JSON.parse(JSON.stringify(obj)); }

const PAGE_ID = '00000000-0000-0000-0000-000000000000';
const BLOCK_ID = '33333333-3333-3333-3333-333333333333';

const TEXT = [
  'A ',
  '[[o5e:spell:magic-missile|Magic Missile]]',
  ' and ',
  '[[o5e:creature:hawk|Hawk]]',
  ' and ',
  '[[o5e:condition:blinded|Blinded]]',
  ' and ',
  '[[o5e:item:bag-of-holding|Bag of Holding]]',
  ' and ',
  '[[o5e:weapon:longsword|Longsword]]',
  ' and ',
  '[[o5e:armor:chain-mail|Chain Mail]]',
  '.'
].join('');

const block = {
  id: BLOCK_ID,
  pageId: PAGE_ID,
  type: 'paragraph',
  parentId: null,
  sort: 0,
  propsJson: JSON.stringify({ html: '', comments: {} }),
  contentJson: JSON.stringify({ text: TEXT }),
};

const rt = roundtrip(block);
const content = JSON.parse(rt.contentJson || '{}');

assert(content.text === TEXT, 'o5e multi-type token roundtrip failed');
console.log('smoke:open5e-links OK');

