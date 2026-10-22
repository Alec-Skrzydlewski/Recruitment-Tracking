import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeName, similarity, planPhotoLinks } from '../src/lib/photoMatch.js';

test('normalizeName cleans extensions, copy suffixes, commas, and punctuation', () => {
  assert.equal(normalizeName('jane_smith.PNG'), 'jane smith');
  assert.equal(normalizeName('Smith, Jane.jpg'), 'jane smith');
  assert.equal(normalizeName('Jane Smith (1).jpeg'), 'jane smith');
  assert.equal(normalizeName('JANE-SMITH.jpeg'), 'jane smith');
  assert.equal(normalizeName('Jane Smith-copy.jpeg'), 'jane smith');
  assert.equal(normalizeName('Renée Müller.png'), 'renee muller');
});

test('similarity ignores word order and treats a one-letter swap as a close match', () => {
  assert.equal(similarity('Smith Jane', 'Jane Smith'), 1);
  assert.ok(similarity('Jane Smtih', 'Jane Smith') >= 0.85);
  assert.ok(similarity('Jane Smith', 'Jane Smyth') < 1);
});

test('Jane Smtih auto-links when the recruit is unambiguous', () => {
  const plan = planPhotoLinks(
    [{ fileId: 'f1', fileName: 'Jane Smtih.jpg' }],
    [
      { id: 'a', name: 'Jane Smith' },
      { id: 'b', name: 'Bob Jones' },
    ],
  );
  assert.equal(plan.linked.length, 1);
  assert.equal(plan.linked[0].recruitId, 'a');
  assert.equal(plan.linked[0].fileId, 'f1');
  assert.ok(plan.linked[0].score >= 0.85);
  assert.equal(plan.unmatched.length, 0);
});

test('ambiguous Jane Smith vs Jane Smyth goes to review', () => {
  const plan = planPhotoLinks(
    [{ fileId: 'f1', fileName: 'Jane Smith.jpg' }],
    [
      { id: 'a', name: 'Jane Smith' },
      { id: 'b', name: 'Jane Smyth' },
    ],
  );
  assert.equal(plan.linked.length, 0);
  assert.equal(plan.unmatched.length, 1);
  assert.deepEqual(
    plan.unmatched[0].suggestions.map(item => item.name).sort(),
    ['Jane Smith', 'Jane Smyth'],
  );
});

test('a middling name stays unmatched with suggestions, and a stranger has none', () => {
  const review = planPhotoLinks(
    [{ fileId: 'f1', fileName: 'Jon Smith.jpg' }],
    [{ id: 'a', name: 'Jane Smith' }],
  );
  assert.equal(review.linked.length, 0);
  assert.equal(review.unmatched[0].suggestions.length, 1);
  assert.ok(review.unmatched[0].suggestions[0].score >= 0.6);
  assert.ok(review.unmatched[0].suggestions[0].score < 0.85);

  const stranger = planPhotoLinks(
    [{ fileId: 'f2', fileName: 'zzzz unrelated.png' }],
    [{ id: 'a', name: 'Jane Smith' }],
  );
  assert.equal(stranger.linked.length, 0);
  assert.deepEqual(stranger.unmatched[0].suggestions, []);
});

test('an uploaded photo is never overwritten and an already linked file is ignored', () => {
  const uploaded = planPhotoLinks(
    [{ fileId: 'f9', fileName: 'Jane Smith.jpg' }],
    [{ id: 'a', name: 'Jane Smith', photoFileId: 'old', photoSource: 'upload' }],
  );
  assert.equal(uploaded.linked.length, 0);
  assert.equal(uploaded.unmatched.length, 1);
  assert.equal(uploaded.unmatched[0].suggestions[0].recruitId, 'a');

  const sourceOnly = planPhotoLinks(
    [{ fileId: 'f8', fileName: 'Jane Smith.jpg' }],
    [{ id: 'a', name: 'Jane Smith', photoSource: 'upload' }],
  );
  assert.equal(sourceOnly.linked.length, 0);

  const ignored = planPhotoLinks(
    [{ fileId: 'f1', fileName: 'Jane Smith.jpg' }],
    [{ id: 'a', name: 'Jane Smith', photoFileId: 'f1', photoSource: 'folder' }],
  );
  assert.deepEqual(ignored.linked, []);
  assert.deepEqual(ignored.unmatched, []);
});

test('two files for one recruit only auto-link once', () => {
  const plan = planPhotoLinks(
    [
      { fileId: 'f2', fileName: 'jane_smith.png' },
      { fileId: 'f1', fileName: 'Jane Smith.jpg' },
    ],
    [{ id: 'r1', name: 'Jane Smith' }],
  );
  assert.equal(plan.linked.length, 1);
  assert.equal(plan.linked[0].fileId, 'f1');
  assert.equal(plan.unmatched.length, 1);
  assert.equal(plan.unmatched[0].fileId, 'f2');
});

test('Code.gs keeps the same photo matching source', () => {
  const lib = fs.readFileSync(new URL('../src/lib/photoMatch.js', import.meta.url), 'utf8')
    .split('\n')
    .map(line => (line.startsWith('export ') ? line.slice('export '.length) : line))
    .join('\n')
    .trim();
  const gs = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.ok(gs.includes(lib));
});
