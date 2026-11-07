// The demo backend must enforce the same rules as Code.gs so the public demo
// shows real behavior, not a mock that accepts anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoBackend } from '../src/demo/demoBackend.js';
import { demoSeed, DEMO_PERSONAS } from './helpers/legacyDemoSeed.js';

const ADMIN = DEMO_PERSONAS.find(p => p.role === 'admin').email;
const VOTER = DEMO_PERSONAS.find(p => p.role === 'brother').email;

test('seed is fictional: reserved example.test emails only, no external URLs', () => {
  const text = JSON.stringify(demoSeed());
  const emails = text.match(/[\w.+-]+@[\w.-]+/g) || [];
  assert.ok(emails.length > 0);
  emails.forEach(e => assert.match(e, /@example\.test$/));
  assert.doesNotMatch(text, /https?:\/\//);
});

test('voter: reads own votes, can vote only for attendees, cannot reach admin actions', async () => {
  const b = createDemoBackend({ latencyMs: 0, seed: demoSeed });
  const data = await b.call(VOTER, 'getVoteData');
  assert.ok(data.myVotes.every(v => v.eventId && v.score));
  assert.equal(data.votes, undefined);
  await assert.rejects(() => b.call(VOTER, 'castVote', { eventId: 'e-info', recruitId: 'r-finley', score: 5 }), /Invalid vote/);
  await assert.rejects(() => b.call(VOTER, 'castVote', { eventId: 'e-info', recruitId: 'r-avery', score: 11 }), /Invalid vote/);
  assert.equal((await b.call(VOTER, 'castVote', { eventId: 'e-info', recruitId: 'r-avery', score: 9 })).ok, true);
  for (const action of ['getAdminData', 'addRecruit', 'manageUser', 'wipeCycle', 'setAttendance']) {
    await assert.rejects(() => b.call(VOTER, action, {}), /Admin only/, action);
  }
  await assert.rejects(() => b.call('nobody@example.test', 'getVoteData'), /Not authorized/);
});

test('admin: last-admin and self-removal guards, wipe guard, reset to seed', async () => {
  const b = createDemoBackend({ latencyMs: 0, seed: demoSeed });
  await assert.rejects(() => b.call(ADMIN, 'manageUser', { op: 'remove', email: ADMIN }), /cannot remove yourself/);
  await b.call(ADMIN, 'manageUser', { op: 'setRole', email: 'taylor.admin@example.test', role: 'brother' });
  await assert.rejects(() => b.call('taylor.admin@example.test', 'manageUser', { op: 'setRole', email: ADMIN, role: 'brother' }), /Admin only/);
  await assert.rejects(() => b.call(ADMIN, 'manageUser', { op: 'setRole', email: ADMIN, role: 'brother' }), /last admin/);
  await assert.rejects(() => b.call(ADMIN, 'wipeCycle', { confirm: 'WIPE CYCLE' }), /changed since/);
  const stale = (await b.call(ADMIN, 'getAdminData')).cycleFingerprint;
  // Same-count change: edit an existing note.
  const recruitId = (await b.call(ADMIN, 'getAdminData')).recruits[0].id;
  await b.call(ADMIN, 'saveNote', { recruitId, content: 'edited after load' });
  await assert.rejects(() => b.call(ADMIN, 'wipeCycle', { confirm: 'WIPE CYCLE', expectedFingerprint: stale }), /changed since/);
  const d = await b.call(ADMIN, 'getAdminData');
  assert.notEqual(d.cycleFingerprint, stale);
  assert.equal((await b.call(ADMIN, 'wipeCycle', { confirm: 'WIPE CYCLE', expectedFingerprint: d.cycleFingerprint })).ok, true);
  assert.equal((await b.call(ADMIN, 'getAdminData')).recruits.length, 0);
  b.reset();
  assert.equal((await b.call(ADMIN, 'getAdminData')).recruits.length, demoSeed().recruits.length);
});

test('creates are idempotent by requestId and attendance is desired-state', async () => {
  const b = createDemoBackend({ latencyMs: 0, seed: demoSeed });
  const a = await b.call(ADMIN, 'addEvent', { name: 'Mixer', requestId: 'r1' });
  const c = await b.call(ADMIN, 'addEvent', { name: 'Mixer', requestId: 'r1' });
  assert.equal(a.id, c.id);
  await b.call(ADMIN, 'setAttendance', { eventId: a.id, recruitId: 'r-avery', present: true });
  await b.call(ADMIN, 'setAttendance', { eventId: a.id, recruitId: 'r-avery', present: true });
  assert.equal(b.snapshot().attendance.filter(x => x.eventId === a.id).length, 1);
});

test('photos are generated local SVGs', async () => {
  const b = createDemoBackend({ latencyMs: 0, seed: demoSeed });
  const res = await b.call(VOTER, 'getPhotos', { ids: ['demo-photo-r-avery', 'not-linked'] });
  assert.deepEqual(Object.keys(res.photos), ['demo-photo-r-avery']);
  assert.match(res.photos['demo-photo-r-avery'], /^data:image\/svg\+xml/);
});

test('demo mirrors live: cascades delete votes, cleanup is staged and exact', async () => {
  const b = createDemoBackend({ latencyMs: 0, seed: demoSeed });
  // Seed has one stale vote for a missing event.
  const preview = await b.call(ADMIN, 'getVoteCleanup');
  assert.deepEqual(preview.byReason, { missingRecruit: 0, missingEvent: 1, notPresent: 0, invalidScore: 0 });
  assert.equal(preview.count, 1);
  const votesBefore = b.snapshot().votes.length;
  assert.equal(b.snapshot().votes.length, votesBefore, 'preview does not write');
  await assert.rejects(() => b.call(VOTER, 'getVoteCleanup'), /Admin only/);
  await assert.rejects(() => b.call(ADMIN, 'cleanupInvalidVotes', { confirm: 'DELETE INVALID VOTES', expectedFingerprint: preview.cycleFingerprint, expectedCount: 2 }), /changed since/);
  const done = await b.call(ADMIN, 'cleanupInvalidVotes', { confirm: 'DELETE INVALID VOTES', expectedFingerprint: preview.cycleFingerprint, expectedCount: 1 });
  assert.equal(done.deleted, 1);
  assert.equal(b.snapshot().votes.length, votesBefore - 1);
  assert.equal((await b.call(ADMIN, 'getVoteCleanup')).count, 0);

  const snap = b.snapshot();
  const vote = snap.votes[0];
  const pairVotes = snap.votes.filter(v => v.eventId === vote.eventId && v.recruitId === vote.recruitId).length;
  const res = await b.call(ADMIN, 'setAttendance', { eventId: vote.eventId, recruitId: vote.recruitId, present: false });
  assert.equal(res.votesDeleted, pairVotes);
  assert.equal(b.snapshot().votes.length, snap.votes.length - pairVotes);

  const ev = b.snapshot().events[0].id;
  const evVotes = b.snapshot().votes.filter(v => v.eventId === ev).length;
  assert.equal((await b.call(ADMIN, 'deleteEvent', { id: ev })).votesDeleted, evVotes);
  assert.equal(b.snapshot().attendance.some(a => a.eventId === ev), false);

  const rec = b.snapshot().recruits[0].id;
  await b.call(ADMIN, 'deleteRecruit', { id: rec });
  const after = b.snapshot();
  assert.equal(after.votes.some(v => v.recruitId === rec) || after.attendance.some(a => a.recruitId === rec) || after.notes.some(n => n.recruitId === rec), false);
  assert.equal((await b.call(ADMIN, 'getVoteCleanup')).count, 0, 'cascades never leave invalid votes');
});

test('demo addRecruit requires a valid graduation year like the server', async () => {
  const b = createDemoBackend({ latencyMs: 0, seed: demoSeed });
  const n = b.snapshot().recruits.length;
  for (const gradYear of [undefined, '', '  ', '27', 'abcd', '1999', '2101']) {
    await assert.rejects(() => b.call(ADMIN, 'addRecruit', { name: 'X', major: 'Finance (BSBA)', gradYear, photoDataBase64: 'AAAA' }), /Graduation year/, String(gradYear));
  }
  assert.equal(b.snapshot().recruits.length, n);
  await b.call(ADMIN, 'addRecruit', { name: 'X', major: 'Finance (BSBA)', gradYear: '2030' });
  assert.equal(b.snapshot().recruits.length, n + 1);
  assert.ok(demoSeed().recruits.every(r => /^\d{4}$/.test(r.gradYear)), 'demo fixtures carry a year');
});
