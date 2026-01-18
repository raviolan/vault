#!/usr/bin/env node
// Minimal roundtrip smoke for annotation tokens and comment storage.
// Verifies that JSON serialize/parse preserves tokens and comment maps.

function assert(cond, msg) { if (!cond) { console.error(msg); process.exit(1); } }

function roundtrip(obj) {
  const s = JSON.stringify(obj);
  return JSON.parse(s);
}

// Fixture: a paragraph block with all three inline tokens
const PAGE_ID = '00000000-0000-0000-0000-000000000000';
const BLOCK_ID = '11111111-1111-1111-1111-111111111111';
const CMT_ID = '22222222-2222-2222-2222-222222222222';
const TEXT = `Before [[page:${PAGE_ID}|My Page]] and [[o5e:spell:magic-missile|Magic Missile]] and [[cmt:${CMT_ID}|note]] after.`;

const block = {
  id: BLOCK_ID,
  pageId: PAGE_ID,
  type: 'paragraph',
  parentId: null,
  sort: 0,
  propsJson: JSON.stringify({ html: '', comments: { [CMT_ID]: 'A small comment.' } }),
  contentJson: JSON.stringify({ text: TEXT }),
};

const rt = roundtrip(block);

// Validate tokens survived and comment map intact
const props = JSON.parse(rt.propsJson || '{}');
const content = JSON.parse(rt.contentJson || '{}');

assert(content.text === TEXT, 'content.text token roundtrip failed');
assert(props && props.comments && props.comments[CMT_ID] === 'A small comment.', 'comment map roundtrip failed');

console.log('smoke:annotations OK');

