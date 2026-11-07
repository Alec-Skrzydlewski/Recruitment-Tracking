import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTally, formatAverage } from '../src/lib/tally.js';
import { createWriteQueue } from '../src/lib/voteQueue.js';
import {
  setPhotoScope, clearPhotoCache, photoCacheGet, photoCacheSet, photoCacheSize, fetchPhotos,
} from '../src/lib/photoCache.js';

test('tally counts only valid votes and has no excluded category', () => {
  const data = {
    recruits: [{ id: 'r1' }, { id: 'r2' }],
    events: [{ id: 'e1' }, { id: 'e2' }],
    attendance: [{ eventId: 'e1', recruitId: 'r1' }, { eventId: 'e2', recruitId: 'r1' }, { eventId: 'e1', recruitId: 'r2' }],
    votes: [
      { eventId: 'e1', recruitId: 'r1', score: 8, userEmail: 'a@x.test' },
      { eventId: 'e2', recruitId: 'r1', score: '6', userEmail: 'a@x.test' },
      { eventId: 'e1', recruitId: 'r1', score: 10, userEmail: 'b@x.test' },
      { eventId: 'gone', recruitId: 'r1', score: 1, userEmail: 'b@x.test' },
      { eventId: 'e2', recruitId: 'r2', score: 9, userEmail: 'b@x.test' },
      { eventId: 'e1', recruitId: 'removed', score: 9, userEmail: 'b@x.test' },
      { eventId: 'e1', recruitId: 'r2', score: 'x', userEmail: 'b@x.test' },
    ],
  };
  const t = buildTally(data);
  assert.equal(t.byRecruit.r1.activeCount, 3);
  assert.equal(formatAverage(t.byRecruit.r1.average), '8.0');
  assert.equal(t.byRecruit.r1.voterCount, 2);
  assert.equal(t.byRecruit.r1.byEvent.e1.count, 2);
  assert.equal(t.byRecruit.r1.byEvent.e1.average, 9);
  assert.equal(t.byRecruit.r2.average, null);
  // Malformed snapshot rows are never counted, and nothing reports them.
  assert.deepEqual(Object.keys(t).sort(), ['activeVotes', 'byRecruit']);
  assert.equal('excludedCount' in t.byRecruit.r1, false);
  assert.equal(t.activeVotes, 3);
  // Deleting an event removes its share of the average.
  const after = buildTally({ ...data, events: [{ id: 'e1' }] });
  assert.equal(after.byRecruit.r1.average, 9);
});

test('write queue serializes per key and the last value wins', async () => {
  const sent = [];
  const gates = [];
  const queue = createWriteQueue((key, value) => new Promise(resolve => { sent.push([key, value]); gates.push(resolve); }));
  const a = queue.push('k', 3);
  const b = queue.push('k', 5);
  const c = queue.push('k', 7);
  const other = queue.push('j', 1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(sent, [['k', 3], ['j', 1]]);
  gates[0]();
  const first = await a;
  assert.equal(first.superseded, true);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(sent.map(s => s[1]), [3, 1, 7]);
  gates[1]();
  gates[2]();
  const [rb, rc] = await Promise.all([b, c]);
  assert.equal(rb.value, 7);
  assert.equal(rc.ok, true);
  assert.equal(rc.superseded, false);
  assert.equal((await other).ok, true);
  assert.equal(queue.pending('k'), false);
});

test('write queue reports failures without retrying', async () => {
  let calls = 0;
  const queue = createWriteQueue(async () => { calls += 1; throw new Error('down'); });
  const out = await queue.push('k', 4);
  assert.equal(out.ok, false);
  assert.equal(out.error.message, 'down');
  assert.equal(calls, 1);
});

test('photo cache is memory-only, scoped, bounded and cleared on sign-out', async () => {
  const before = globalThis.sessionStorage;
  const writes = [];
  globalThis.sessionStorage = { setItem: (...a) => writes.push(a), getItem: () => null, removeItem() {} };
  try {
    clearPhotoCache();
    photoCacheSet('p1', 'data:image/png;base64,AA');
    assert.equal(photoCacheGet('p1'), '', 'nothing is cached without a scope');
    setPhotoScope('live:a@x.test');
    photoCacheSet('p1', 'data:image/png;base64,AA');
    photoCacheSet('p2', 'javascript:alert(1)');
    assert.equal(photoCacheGet('p1'), 'data:image/png;base64,AA');
    assert.equal(photoCacheGet('p2'), '');
    setPhotoScope('live:b@x.test');
    assert.equal(photoCacheGet('p1'), '', 'another account cannot read the previous cache');
    for (let i = 0; i < 200; i++) photoCacheSet('n' + i, 'data:image/png;base64,AA');
    assert.equal(photoCacheSize(), 150);
    clearPhotoCache();
    assert.equal(photoCacheSize(), 0);
    assert.equal(writes.length, 0, 'photos are never persisted to sessionStorage');
  } finally {
    globalThis.sessionStorage = before;
  }
});

test('fetchPhotos batches by 20 in parallel and drops responses from an old scope', async () => {
  clearPhotoCache();
  setPhotoScope('demo:a');
  const batches = [];
  const ids = Array.from({ length: 45 }, (_, i) => 'id' + i);
  const out = await fetchPhotos(async chunk => {
    batches.push(chunk.length);
    const photos = {};
    chunk.forEach(id => { photos[id] = 'data:image/png;base64,' + id; });
    return { photos };
  }, ids);
  assert.deepEqual(batches, [20, 20, 5]);
  assert.equal(Object.keys(out).length, 45);
  let release;
  const pending = fetchPhotos(chunk => new Promise(r => { release = () => r({ photos: { [chunk[0]]: 'data:image/png;base64,x' } }); }), ['late']);
  setPhotoScope('demo:b');
  release();
  assert.deepEqual(await pending, {});
  assert.equal(photoCacheGet('late'), '');
  await assert.rejects(() => fetchPhotos(async () => { throw new Error('denied'); }, ['zz']), /denied/);
});
