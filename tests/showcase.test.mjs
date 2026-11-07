import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { demoSeed, DEMO_PERSONAS, DEMO_USER } from '../src/demo/seed.js';
import { createDemoBackend } from '../src/demo/demoBackend.js';
const admin = DEMO_PERSONAS.find(p => p.role === 'admin').email;
const voter = DEMO_PERSONAS.find(p => p.role === 'brother').email;

test('showcase contains all 11 first-string Jaguars with explicit fictional education', () => {
  const db = demoSeed();
  assert.equal(db.recruits.length, 11);
  assert.equal(new Set(db.recruits.map(r => r.id)).size, 11);
  assert.equal(new Set(db.recruits.map(r => r.name)).size, 11);
  assert.ok(db.recruits.some(r => r.name === 'Trevor Lawrence'));
  assert.ok(db.recruits.some(r => r.name === 'Bhayshul Tuten'));
  assert.ok(!db.recruits.some(r => r.name === 'Chris Rodriguez Jr.'));
  for (const r of db.recruits) {
    assert.equal(r.educationIsFictional, true);
    assert.match(r.major, /\(example\)/);
    assert.match(r.gradYear, /^20(27|28|29|30)$/);
    assert.ok(fs.statSync(new URL('../src/demo/photos/jaguars/' + r.photoPath.split('/').pop(), import.meta.url)).size > 10000);
  }
});

test('sample attendance and votes are coherent, varied and fictional', () => {
  const db = demoSeed();
  const ids = new Set(db.recruits.map(r => r.id));
  const evs = new Set(db.events.map(e => e.id));
  const members = new Set(db.users.filter(u => u.active === 'yes').map(u => u.email));
  const attended = new Set(db.attendance.map(a => a.eventId + '|' + a.recruitId));
  assert.equal(attended.size, db.attendance.length, 'no duplicate attendance');
  for (const a of db.attendance) assert.ok(ids.has(a.recruitId) && evs.has(a.eventId));
  assert.equal(db.attendance.filter(a => a.eventId === 'e-info').length, 11, 'all 11 at the first event');
  const last = db.events[db.events.length - 1].id; // Vote page default
  assert.ok(db.attendance.filter(a => a.eventId === last).length >= 8, 'default vote event has checked-in recruits');
  assert.ok(db.attendance.filter(a => a.eventId === 'e-case').length < 11, 'varied attendance');
  for (const u of db.users) assert.match(u.email, /@example\.test$/);
  const voters = new Set(db.votes.map(v => v.userEmail));
  assert.ok(voters.size >= 6);
  assert.equal(voters.has(DEMO_USER.email), false, 'demo admin keeps an empty ballot');
  const keys = new Set();
  for (const v of db.votes) {
    assert.ok(attended.has(v.eventId + '|' + v.recruitId), 'votes only on attended pairs');
    assert.ok(members.has(v.userEmail));
    assert.ok(Number.isInteger(v.score) && v.score >= 1 && v.score <= 10);
    assert.ok(!Number.isNaN(Date.parse(v.timestamp)));
    const k = v.eventId + '|' + v.recruitId + '|' + v.userEmail;
    assert.ok(!keys.has(k), 'one vote per voter/event/recruit'); keys.add(k);
  }
  assert.ok(new Set(db.votes.map(v => v.score)).size >= 4, 'scores are not uniform');
  for (const r of db.recruits) assert.ok(db.votes.filter(v => v.recruitId === r.id).length >= 5, r.name + ' has analytics');
  assert.deepEqual(demoSeed(), db, 'deterministic seed');
});

test('photos map every seeded player to a bundled official image', async () => {
  const b = createDemoBackend({ latencyMs: 0 });
  const db = b.snapshot();
  for (let i = 0; i < db.recruits.length; i += 20) {
    const rs = db.recruits.slice(i, i + 20);
    const { photos } = await b.call(voter, 'getPhotos', { ids: rs.map(r => r.photoFileId) });
    rs.forEach(r => assert.equal(photos[r.photoFileId], r.photoPath));
  }
  const r = db.recruits[0];
  const mapped = createDemoBackend({ latencyMs: 0, photoUrls: { [r.photoPath]: '/assets/verified-hash.jpg' } });
  assert.equal((await mapped.call(voter, 'getPhotos', { ids: [r.photoFileId] })).photos[r.photoFileId], '/assets/verified-hash.jpg');
});

test('visitor votes and resets are isolated from other visitors', async () => {
  const a = createDemoBackend({ latencyMs: 0 });
  const b = createDemoBackend({ latencyMs: 0 });
  const recruitId = a.snapshot().recruits[0].id;
  const base = a.snapshot().votes.length;
  assert.ok(base > 0);
  await a.call(DEMO_USER.email, 'castVote', { eventId: 'e-info', recruitId, score: 8 });
  assert.equal(a.snapshot().votes.length, base + 1);
  assert.equal(b.snapshot().votes.length, base);
  a.reset();
  assert.deepEqual(a.snapshot(), b.snapshot(), 'reset restores the same baseline');
  const admin1 = await a.call(admin, 'getAdminData');
  assert.equal(admin1.votes.length, base);
  assert.equal((await a.call(admin, 'getAdminData')).recruits.length, 11);
  await assert.rejects(() => a.call(voter, 'getAdminData'), /Admin only/);
});

test('Vercel serves the isolated demo build while live auth is preserved', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url)));
  assert.equal(config.buildCommand, 'npm run build:demo');
  assert.equal(config.outputDirectory, 'dist-demo');
  const source = fs.readFileSync(new URL('../src/demo/DemoApp.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /GoogleOAuthProvider|GoogleLogin|script\.google/);
  assert.match(source, /DEMO_PHOTO_URLS/);
  // Hash is included to make accidental cross-file tampering easy to spot in review.
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url))).digest('hex'), '533503fad5c4f45310592ba48947bd2d41e6c48565ba82818d8d15b9991e93a3');
});
