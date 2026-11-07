// Security regression tests for Code.gs: token binding, bootstrap, the
// dispatcher authorization matrix, vote integrity, literal-text writes,
// validation, sanitized errors and the wipe guard. All synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  api, makeSs, workspace, post, rawPost, token, plain, rowsOf, snapshot, current, configure,
  stats, cache, cacheLog, fetchLog, driveState, resetDrive, seedPhotoFolder, addDriveFile, OWNER, CLIENT_ID,
} from './helpers/gsHarness.mjs';

function fresh(extra) {
  configure();
  resetDrive();
  current.ss = workspace(extra);
  current.lockFails = false;
  current.tokeninfoDown = false;
  current.onLock = null;
  current.lockHeld = false;
  token('owner', OWNER);
  token('member', 'member@example.test');
  token('former', 'former@example.test');
  token('stranger', 'stranger@example.test');
  return current.ss;
}

// ---------- token verification ----------

test('tokens must be issued to this app: wrong or missing aud is rejected before any read', () => {
  const ss = fresh();
  token('other-app', OWNER, { aud: 'someone-else.apps.googleusercontent.com' });
  token('no-aud', OWNER, { aud: undefined });
  const reads = stats.reads;
  for (const t of ['other-app', 'no-aud']) {
    assert.deepEqual(post('getAdminData', t), { error: 'Invalid or expired login', code: 'AUTH' });
  }
  assert.equal(stats.reads, reads);
  assert.equal(post('getMe', 'owner').email, OWNER);
  assert.ok(fetchLog.at(-1).options.muteHttpExceptions);
  void ss;
});

test('bad issuer, unverified email, expired or malformed tokens are rejected', () => {
  fresh();
  token('bad-iss', OWNER, { iss: 'https://evil.example' });
  token('unverified', OWNER, { email_verified: 'false' });
  token('expired', OWNER, { exp: String(Math.floor(Date.now() / 1000) - 10) });
  token('no-email', 'x@y.z', { email: '' });
  for (const t of ['bad-iss', 'unverified', 'expired', 'no-email', 'unknown-token', '']) {
    assert.equal(post('getMe', t).code, 'AUTH', t);
  }
  assert.equal(post('getMe', 'x'.repeat(5000)).code, 'AUTH');
});

test('a tokeninfo outage is reported as retryable, not as a sign-out', () => {
  fresh();
  current.tokeninfoDown = true;
  const res = post('getMe', 'owner');
  assert.equal(res.code, 'AUTH_UNAVAILABLE');
  current.tokeninfoDown = false;
});

test('missing GOOGLE_CLIENT_ID fails closed for every action', () => {
  fresh();
  configure({ clientId: null });
  const res = post('getMe', 'owner');
  assert.equal(res.code, 'NOT_CONFIGURED');
  configure();
});

test('requests from an outdated client (no apiVersion) are refused', () => {
  fresh();
  const res = rawPost({ action: 'getMe', token: 'owner' });
  assert.equal(res.code, 'VERSION');
  assert.equal(rawPost('not json').code, 'BAD_REQUEST');
});

// ---------- bootstrap ----------

test('empty Users: an arbitrary verified identity cannot claim admin', () => {
  fresh({ Users: [] });
  const res = post('bootstrap', 'stranger');
  assert.equal(res.error, 'Not authorized. Ask an admin to add you.');
  assert.equal(rowsOf(current.ss, 'Users').length, 1);
});

test('empty Users: only OWNER_EMAIL becomes the first admin, once', () => {
  fresh({ Users: [] });
  const res = post('bootstrap', 'owner');
  assert.equal(res.role, 'admin');
  assert.equal(res.bootstrapped, true);
  assert.equal(post('bootstrap', 'stranger').code, 'FORBIDDEN');
  assert.equal(post('bootstrap', 'owner').bootstrapped, undefined);
  assert.equal(rowsOf(current.ss, 'Users').length, 2);
});

test('empty Users with no OWNER_EMAIL configured refuses everyone', () => {
  fresh({ Users: [] });
  configure({ owner: null });
  assert.equal(post('bootstrap', 'owner').code, 'FORBIDDEN');
  assert.equal(rowsOf(current.ss, 'Users').length, 1);
  configure();
});

test('setupSchema is owner-only and the only path that creates sheets', () => {
  configure();
  current.ss = makeSs({}, {}, ['Notes', 'Votes']);
  token('owner', OWNER);
  token('stranger', 'stranger@example.test');
  // Normal reads report setup instead of silently repairing.
  assert.equal(post('bootstrap', 'owner').code, undefined);
  assert.equal(post('getVoteData', 'owner').code, 'SETUP_REQUIRED');
  assert.equal(current.ss.getSheetByName('Votes'), null);
  assert.equal(post('setupSchema', 'stranger').code, 'FORBIDDEN');
  assert.equal(current.ss.getSheetByName('Votes'), null);
  const done = post('setupSchema', 'owner');
  assert.equal(done.ok, true);
  assert.deepEqual(done.created.sort(), ['Notes', 'Votes']);
  assert.ok(post('getVoteData', 'owner').me);
});

// ---------- dispatcher authorization matrix ----------

const MEMBER_READS = ['getMe', 'getVoteData', 'getPhotos'];
const ADMIN_ACTIONS = {
  getAdminData: {},
  addRecruit: { name: 'Zed', major: 'X' },
  deleteRecruit: { id: 'rec-1' },
  uploadPhoto: { recruitId: 'rec-1', dataBase64: 'AAAA' },
  syncPhotoFolder: {},
  linkPhoto: { fileId: 'f1', recruitId: 'rec-1' },
  addEvent: { name: 'New' },
  deleteEvent: { id: 'evt-1' },
  setAttendance: { eventId: 'evt-1', recruitId: 'rec-2', present: true },
  saveNote: { recruitId: 'rec-1', content: 'hi' },
  manageUser: { op: 'add', email: 'z@example.test' },
  wipeCycle: { confirm: 'WIPE CYCLE', expectedFingerprint: '0'.repeat(64) },
  getVoteCleanup: {},
  cleanupInvalidVotes: { confirm: 'DELETE INVALID VOTES', expectedFingerprint: '0'.repeat(64), expectedCount: 1 },
};

test('authorization matrix: non-members and inactive members reach nothing and write nothing', () => {
  const ss = fresh();
  const before = snapshot(ss);
  for (const who of ['stranger', 'former']) {
    for (const action of [...MEMBER_READS, 'castVote', ...Object.keys(ADMIN_ACTIONS)]) {
      const extra = action === 'castVote' ? { eventId: 'evt-1', recruitId: 'rec-1', score: 5 } : (ADMIN_ACTIONS[action] || {});
      const res = post(action, who, extra);
      assert.equal(res.code, 'FORBIDDEN', `${who} ${action}`);
    }
  }
  assert.deepEqual(snapshot(ss), before);
  assert.equal(driveState.createFolderCalls, 0);
});

test('authorization matrix: members can read and vote but every admin action is refused', () => {
  const ss = fresh();
  const before = snapshot(ss);
  for (const action of MEMBER_READS) assert.equal(post(action, 'member').code, undefined, action);
  for (const [action, extra] of Object.entries(ADMIN_ACTIONS)) {
    assert.deepEqual(post(action, 'member', extra), { error: 'Admin only', code: 'FORBIDDEN' }, action);
  }
  assert.deepEqual(snapshot(ss), before);
  assert.equal(post('unknownAction', 'member').code, 'UNKNOWN_ACTION');
});

test('getVoteData returns only the caller’s own votes', () => {
  fresh({ Votes: [
    ['evt-1', 'rec-1', 'member@example.test', 7, 't'],
    ['evt-1', 'rec-1', OWNER, 2, 't'],
  ] });
  const data = post('getVoteData', 'member');
  assert.deepEqual(data.myVotes, [{ eventId: 'evt-1', recruitId: 'rec-1', score: 7 }]);
  assert.equal(data.votes, undefined);
});

// ---------- vote integrity ----------

test('castVote: unknown, inactive and revoked identities write nothing', () => {
  const ss = fresh();
  const vote = { eventId: 'evt-1', recruitId: 'rec-1', score: 8 };
  assert.equal(post('castVote', 'stranger', vote).code, 'FORBIDDEN');
  assert.equal(post('castVote', 'former', vote).code, 'FORBIDDEN');
  // Revocation between page load and vote: handler re-checks inside the lock.
  api.manageUser(ss, { email: OWNER }, { op: 'remove', email: 'member@example.test' });
  assert.equal(api.castVote(ss, { email: 'member@example.test' }, vote).code, 'FORBIDDEN');
  assert.equal(rowsOf(ss, 'Votes').length, 1);
});

test('castVote: unknown event, unknown recruit and non-attendee are rejected with no write', () => {
  const ss = fresh();
  for (const vote of [
    { eventId: 'evt-404', recruitId: 'rec-1', score: 5 },
    { eventId: 'evt-1', recruitId: 'rec-404', score: 5 },
    { eventId: 'evt-1', recruitId: 'rec-2', score: 5 },
    { eventId: '=IMPORTXML("https://x.example","//a")', recruitId: 'rec-1', score: 5 },
    { eventId: 'evt-1', recruitId: 'rec-1', score: 11 },
    { eventId: 'evt-1', recruitId: 'rec-1', score: true },
    { eventId: ['evt-1'], recruitId: 'rec-1', score: 5 },
  ]) {
    assert.equal(post('castVote', 'member', vote).error, 'Invalid vote', JSON.stringify(vote));
  }
  assert.equal(rowsOf(ss, 'Votes').length, 1);
  assert.equal(post('castVote', 'member', { eventId: 'evt-1', recruitId: 'rec-1', score: 6 }).ok, true);
  assert.deepEqual(rowsOf(ss, 'Votes')[1].slice(0, 4), ['evt-1', 'rec-1', 'member@example.test', 6]);
});

test('castVote after a recruit is removed from attendance is rejected', () => {
  const ss = fresh();
  assert.equal(api.setAttendance(ss, ADMIN, { eventId: 'evt-1', recruitId: 'rec-1', present: false }).ok, true);
  assert.equal(post('castVote', 'member', { eventId: 'evt-1', recruitId: 'rec-1', score: 4 }).error, 'Invalid vote');
});

// ---------- literal text ----------

test('formula-leading text is stored as literal text everywhere admins can type', () => {
  const ss = fresh();
  stats.formulaWrites = 0;
  const evil = ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '=HYPERLINK("https://x.example")'];
  const created = api.addRecruit(ss, ADMIN, { name: evil[0], major: evil[1], secondMajor: evil[2] });
  api.addEvent(ss, ADMIN, { name: evil[3] });
  api.saveNote(ss, ADMIN, { recruitId: created.id, content: evil[4] });
  api.manageUser(ss, { email: OWNER }, { op: 'add', email: 'n@example.test', name: '=cmd|"/c calc"!A0' });
  assert.equal(stats.formulaWrites, 0);
  const read = plain(api.getAdminData(ss));
  const r = read.recruits.find(x => x.id === created.id);
  assert.deepEqual([r.name, r.major, r.secondMajor], evil.slice(0, 3));
  assert.equal(read.events.at(-1).name, '@cmd');
  assert.equal(read.notes[0].content, evil[4]);
  assert.equal(read.users.at(-1).name, '=cmd|"/c calc"!A0');
});

// ---------- schema ----------

test('reordered and legacy headers read and write by column name', () => {
  configure();
  current.ss = makeSs({
    Users: [['admin', 'yes', OWNER, 'Owner']],
    Votes: [],
    Events: [['Info Night', 'evt-1', 'x']],
    Recruits: [['rec-1', 'Avery', 'Accountancy']],
    EventRecruits: [['rec-1', 'evt-1']],
  }, {
    Users: ['role', 'active', 'email', 'name'],
    Votes: ['timestamp', 'score', 'userEmail', 'recruitId', 'eventId', 'legacyNote'],
    Events: ['name', 'id', 'legacy'],
    EventRecruits: ['recruitId', 'eventId'],
  });
  token('owner', OWNER);
  assert.equal(post('getMe', 'owner').role, 'admin');
  assert.equal(post('castVote', 'owner', { eventId: 'evt-1', recruitId: 'rec-1', score: 9 }).ok, true);
  const row = rowsOf(current.ss, 'Votes')[1];
  assert.deepEqual([row[1], row[2], row[3], row[4]], [9, OWNER, 'rec-1', 'evt-1']);
  assert.equal(post('castVote', 'owner', { eventId: 'evt-1', recruitId: 'rec-1', score: 3 }).ok, true);
  assert.equal(rowsOf(current.ss, 'Votes').length, 2);
  assert.equal(rowsOf(current.ss, 'Votes')[1][1], 3);
});

test('a duplicate or missing required column fails without changing data', () => {
  configure();
  current.ss = makeSs({ Users: [[OWNER, 'Owner', 'admin', 'yes']], Votes: [['evt-1']], Recruits: [['rec-1', 'Avery', 'X']] }, {
    Votes: ['eventId', 'recruitId', 'userEmail', 'score', 'timestamp', 'score'],
    Notes: ['recruitId', 'content'],
  });
  token('owner', OWNER);
  const before = snapshot(current.ss);
  assert.equal(post('getAdminData', 'owner').code, 'SCHEMA');
  assert.equal(post('saveNote', 'owner', { recruitId: 'rec-1', content: 'x' }).code, 'SETUP_REQUIRED');
  assert.deepEqual(snapshot(current.ss), before);
});

// ---------- errors, idempotency, attendance, wipe ----------

test('raw Google errors are never returned; Drive denial is a photo-scoped message', () => {
  fresh();
  seedPhotoFolder();
  driveState.deny = true;
  const res = post('syncPhotoFolder', 'owner');
  assert.equal(res.code, 'PHOTO_UNAVAILABLE');
  assert.doesNotMatch(res.error, /DriveApp|googleapis|permission to call/);
  assert.ok(post('getAdminData', 'owner').recruits, 'core admin data still loads');
  driveState.deny = false;
  current.lockFails = true;
  assert.equal(post('castVote', 'member', { eventId: 'evt-1', recruitId: 'rec-1', score: 4 }).code, 'BUSY');
  current.lockFails = false;
});

test('addRecruit/addEvent with the same requestId create one row', () => {
  const ss = fresh();
  cache.clear();
  const a = post('addEvent', 'owner', { name: 'Mixer', requestId: 'req-1' });
  const b = post('addEvent', 'owner', { name: 'Mixer', requestId: 'req-1' });
  assert.equal(a.id, b.id);
  assert.equal(rowsOf(ss, 'Events').length, 4);
  const r1 = post('addRecruit', 'owner', { name: 'Rory', major: 'X', requestId: 'req-2' });
  const r2 = post('addRecruit', 'owner', { name: 'Rory', major: 'X', requestId: 'req-2' });
  assert.equal(r1.id, r2.id);
  assert.equal(rowsOf(ss, 'Recruits').length, 4);
});

test('setAttendance is desired-state: replays do not flip', () => {
  const ss = fresh();
  const on = { eventId: 'evt-1', recruitId: 'rec-2', present: true };
  post('setAttendance', 'owner', on);
  post('setAttendance', 'owner', on);
  assert.equal(rowsOf(ss, 'EventRecruits').filter(r => r[0] === 'evt-1' && r[1] === 'rec-2').length, 1);
  post('setAttendance', 'owner', { ...on, present: false });
  post('setAttendance', 'owner', { ...on, present: false });
  assert.equal(rowsOf(ss, 'EventRecruits').filter(r => r[0] === 'evt-1' && r[1] === 'rec-2').length, 0);
  assert.equal(post('setAttendance', 'owner', { ...on, eventId: 'evt-404' }).code, 'NOT_FOUND');
  assert.equal(post('setAttendance', 'owner', { eventId: 'evt-1', recruitId: 'rec-2' }).code, 'INVALID');
});

const fp = () => post('getAdminData', 'owner').cycleFingerprint;

test('wipeCycle needs the typed confirmation and the current cycle fingerprint; Users survive', () => {
  const ss = fresh({ Votes: [['evt-1', 'rec-1', OWNER, 5, 't']] });
  const expectedFingerprint = fp();
  assert.match(expectedFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(post('wipeCycle', 'owner', { expectedFingerprint }).code, 'INVALID');
  assert.equal(post('wipeCycle', 'owner', { confirm: 'WIPE CYCLE' }).code, 'INVALID');
  assert.equal(post('wipeCycle', 'owner', { confirm: 'WIPE CYCLE', expectedFingerprint: 'f'.repeat(64) }).code, 'CONFLICT');
  assert.equal(rowsOf(ss, 'Votes').length, 2);
  const done = post('wipeCycle', 'owner', { confirm: 'WIPE CYCLE', expectedFingerprint });
  assert.equal(done.ok, true);
  assert.equal(plain(api.getAdminData(ss)).recruits.length, 0);
  assert.equal(plain(api.getAdminData(ss)).users.length, 3);
});

test('same-count stale wipe is refused: re-scored vote, edited note, delete+add', () => {
  const changes = [
    () => post('castVote', 'owner', { eventId: 'evt-1', recruitId: 'rec-1', score: 2 }),
    () => post('saveNote', 'owner', { recruitId: 'rec-1', content: 'edited' }),
    () => {
      post('setAttendance', 'owner', { eventId: 'evt-2', recruitId: 'rec-2', present: false });
      post('setAttendance', 'owner', { eventId: 'evt-1', recruitId: 'rec-2', present: true });
    },
  ];
  for (const change of changes) {
    const ss = fresh({ Votes: [['evt-1', 'rec-1', OWNER, 5, 't']], Notes: [['rec-1', 'orig', 't']] });
    const expectedFingerprint = fp();
    const counts = ['Recruits', 'Events', 'EventRecruits', 'Votes', 'Notes'].map(n => rowsOf(ss, n).length);
    change();
    assert.deepEqual(['Recruits', 'Events', 'EventRecruits', 'Votes', 'Notes'].map(n => rowsOf(ss, n).length), counts, 'row counts unchanged');
    const before = snapshot(ss);
    assert.equal(post('wipeCycle', 'owner', { confirm: 'WIPE CYCLE', expectedFingerprint }).code, 'CONFLICT');
    assert.deepEqual(snapshot(ss), before);
  }
});

test('a change committed while the wipe waits for the lock is detected', () => {
  const ss = fresh();
  const expectedFingerprint = fp();
  current.onLock = () => { api.saveNote(ss, ADMIN, { recruitId: 'rec-2', content: 'late' }); };
  assert.equal(post('wipeCycle', 'owner', { confirm: 'WIPE CYCLE', expectedFingerprint }).code, 'CONFLICT');
  assert.equal(rowsOf(ss, 'Recruits').length, 3);
});

// ---------- N3: admin authority is re-checked under the write lock ----------

const ADMIN = { email: OWNER };
const TWO_ADMINS = {
  Users: [
    [OWNER, 'Owner', 'admin', 'yes'],
    ['second@example.test', 'Second', 'admin', 'yes'],
    ['member@example.test', 'Member', 'brother', 'yes'],
  ],
};
function demoteSecond(ss) {
  return () => { api.manageUser(ss, ADMIN, { op: 'setRole', email: 'second@example.test', role: 'brother' }); };
}

test('revocation before the write lock is acquired blocks every admin mutation', () => {
  const cases = {
    wipeCycle: () => ({ confirm: 'WIPE CYCLE', expectedFingerprint: fp() }),
    manageUser: () => ({ op: 'add', email: 'z@example.test' }),
    deleteRecruit: () => ({ id: 'rec-1' }),
    deleteEvent: () => ({ id: 'evt-1' }),
    addRecruit: () => ({ name: 'Zed', major: 'X', photoDataBase64: 'AAAA' }),
    addEvent: () => ({ name: 'Late' }),
    setAttendance: () => ({ eventId: 'evt-1', recruitId: 'rec-2', present: true }),
    saveNote: () => ({ recruitId: 'rec-1', content: 'x' }),
    uploadPhoto: () => ({ recruitId: 'rec-1', dataBase64: 'AAAA' }),
    syncPhotoFolder: () => ({}),
  };
  for (const [action, body] of Object.entries(cases)) {
    const ss = fresh(TWO_ADMINS);
    token('second', 'second@example.test');
    seedPhotoFolder(ss);
    const payload = body();
    current.onLock = demoteSecond(ss);
    const before = snapshot(ss);
    const res = post(action, 'second', payload);
    assert.equal(res.code, 'FORBIDDEN', action);
    const after = snapshot(ss);
    // Only the demotion itself (Users role) may differ.
    for (const name of ['Recruits', 'Events', 'EventRecruits', 'Votes', 'Notes']) {
      assert.deepEqual(after[name], before[name], action + ' wrote ' + name);
    }
    assert.equal(rowsOf(ss, 'Users').length, 4, action);
  }
});

test('post-Drive revalidation: link after demotion during Drive work writes nothing', () => {
  const ss = fresh(TWO_ADMINS);
  token('second', 'second@example.test');
  seedPhotoFolder(ss);
  const fileId = addDriveFile('photos-1', 'Avery Quill.jpg');
  current.onLock = demoteSecond(ss);
  const before = snapshot(ss);
  assert.equal(post('linkPhoto', 'second', { fileId, recruitId: 'rec-1' }).code, 'FORBIDDEN');
  assert.deepEqual(snapshot(ss).Recruits, before.Recruits);
});

// ---------- N2: idempotency keyed by action + caller + requestId, under the lock ----------

test('idempotency lookup and store happen while the lock is held, after the re-check', () => {
  fresh();
  cacheLog.length = 0;
  post('addEvent', 'owner', { name: 'Mixer', requestId: 'req-lock' });
  const gets = cacheLog.filter(e => e[0] === 'get' && e[1].endsWith(':req-lock'));
  const puts = cacheLog.filter(e => e[0] === 'put');
  assert.ok(gets.length >= 1 && gets.every(e => e[2] === true));
  assert.equal(puts.length, 1);
  assert.equal(puts[0][2], true);
  assert.equal(puts[0][1], 'req:addEvent:' + OWNER + ':req-lock');
});

test('concurrent duplicate: a retry that commits while the first waits is replayed, not duplicated', () => {
  const ss = fresh();
  // Request B (same id) wins the lock while request A is waiting.
  let b;
  current.onLock = () => { b = post('addEvent', 'owner', { name: 'Mixer', requestId: 'req-race' }); };
  const a = post('addEvent', 'owner', { name: 'Mixer', requestId: 'req-race' });
  assert.equal(a.id, b.id);
  assert.equal(rowsOf(ss, 'Events').filter(r => r[1] === 'Mixer').length, 1);
});

test('cache miss (evicted) re-runs once and is then replayed', () => {
  const ss = fresh();
  const a = post('addEvent', 'owner', { name: 'Mixer', requestId: 'req-evict' });
  cache.clear();
  const b = post('addEvent', 'owner', { name: 'Mixer', requestId: 'req-evict' });
  const c = post('addEvent', 'owner', { name: 'Mixer', requestId: 'req-evict' });
  assert.notEqual(a.id, b.id);
  assert.equal(b.id, c.id);
  assert.equal(rowsOf(ss, 'Events').filter(r => r[1] === 'Mixer').length, 2);
});

test('different actions or different admins sharing a requestId are distinct requests', () => {
  const ss = fresh(TWO_ADMINS);
  token('second', 'second@example.test');
  const e = post('addEvent', 'owner', { name: 'Shared', requestId: 'req-shared' });
  const r = post('addRecruit', 'owner', { name: 'Shared', major: 'X', requestId: 'req-shared' });
  const e2 = post('addEvent', 'second', { name: 'Shared', requestId: 'req-shared' });
  assert.ok(e.id && r.id && e2.id);
  assert.notEqual(e.id, r.id);
  assert.notEqual(e.id, e2.id);
  assert.equal(rowsOf(ss, 'Events').filter(x => x[1] === 'Shared').length, 2);
  assert.equal(rowsOf(ss, 'Recruits').filter(x => x[1] === 'Shared').length, 1);
});

test('a cached replay does not bypass a later revocation', () => {
  const ss = fresh(TWO_ADMINS);
  token('second', 'second@example.test');
  const first = post('addEvent', 'second', { name: 'Mixer', requestId: 'req-revoke' });
  assert.ok(first.id);
  demoteSecond(ss)();
  assert.equal(post('addEvent', 'second', { name: 'Mixer', requestId: 'req-revoke' }).code, 'FORBIDDEN');
});

test('verifyToken binds audience directly', () => {
  configure();
  token('t', OWNER);
  assert.equal(api.verifyToken('t', 'other'), null);
  assert.equal(api.verifyToken('t', ''), null);
  assert.equal(api.verifyToken('t', CLIENT_ID).email, OWNER);
});

// ---------- permanent vote deletion (no excluded/history votes) ----------

const V = (e, r, u, score) => [e, r, u, score, '2026-09-01T00:00:00.000Z'];
const CASCADE_SEED = {
  Recruits: [
    ['rec-1', 'Avery Quill', 'Accountancy (BSAcc)', '', '2028', 'drive-photo-1', 'upload'],
    ['rec-2', 'Blake Ember', 'Finance (BSBA)', '', '2027', '', ''],
  ],
  EventRecruits: [['evt-1', 'rec-1'], ['evt-1', 'rec-2'], ['evt-2', 'rec-1'], ['evt-2', 'rec-2']],
  Votes: [
    V('evt-1', 'rec-1', OWNER, 7), V('evt-1', 'rec-1', 'member@example.test', 8),
    V('evt-1', 'rec-2', OWNER, 6), V('evt-2', 'rec-1', OWNER, 9), V('evt-2', 'rec-2', 'member@example.test', 5),
  ],
  Notes: [['rec-1', 'note one', 't'], ['rec-2', 'note two', 't']],
};
const pairs = (ss, name) => rowsOf(ss, name).slice(1).map(r => r.slice(0, 3).join('|'));

test('deleting an event permanently deletes its votes and attendance; everything else intact', () => {
  const ss = fresh(CASCADE_SEED);
  const res = post('deleteEvent', 'owner', { id: 'evt-1' });
  assert.equal(res.ok, true);
  assert.equal(res.votesDeleted, 3);
  assert.deepEqual(pairs(ss, 'Votes'), ['evt-2|rec-1|' + OWNER, 'evt-2|rec-2|member@example.test']);
  assert.deepEqual(rowsOf(ss, 'EventRecruits').slice(1), [['evt-2', 'rec-1'], ['evt-2', 'rec-2']]);
  assert.equal(rowsOf(ss, 'Recruits').length, 3);
  assert.equal(rowsOf(ss, 'Notes').length, 3);
  assert.deepEqual(rowsOf(ss, 'Events').slice(1).map(r => r[0]), ['evt-2']);
});

test('deleting a recruit deletes its votes, attendance and note; Drive files and others intact', () => {
  const ss = fresh(CASCADE_SEED);
  const drive = JSON.stringify(driveState);
  const res = post('deleteRecruit', 'owner', { id: 'rec-1' });
  assert.equal(res.votesDeleted, 3);
  assert.deepEqual(pairs(ss, 'Votes'), ['evt-1|rec-2|' + OWNER, 'evt-2|rec-2|member@example.test']);
  assert.deepEqual(rowsOf(ss, 'EventRecruits').slice(1), [['evt-1', 'rec-2'], ['evt-2', 'rec-2']]);
  assert.deepEqual(rowsOf(ss, 'Notes').slice(1).map(r => r[0]), ['rec-2']);
  assert.equal(rowsOf(ss, 'Events').length, 3);
  assert.equal(JSON.stringify(driveState), drive, 'no Drive file deleted');
});

test('marking absent deletes only that pair\'s votes; marking present deletes nothing', () => {
  const ss = fresh(CASCADE_SEED);
  assert.equal(post('setAttendance', 'owner', { eventId: 'evt-1', recruitId: 'rec-1', present: true }).votesDeleted, 0);
  assert.equal(rowsOf(ss, 'Votes').length, 6);
  const res = post('setAttendance', 'owner', { eventId: 'evt-1', recruitId: 'rec-1', present: false });
  assert.equal(res.votesDeleted, 2);
  assert.deepEqual(pairs(ss, 'Votes'), ['evt-1|rec-2|' + OWNER, 'evt-2|rec-1|' + OWNER, 'evt-2|rec-2|member@example.test']);
  assert.equal(rowsOf(ss, 'Notes').length, 3);
});

test('cascades re-check admin authority under the lock and write nothing after revocation', () => {
  for (const [action, body] of [['deleteEvent', { id: 'evt-1' }], ['deleteRecruit', { id: 'rec-1' }], ['setAttendance', { eventId: 'evt-1', recruitId: 'rec-1', present: false }]]) {
    const ss = fresh({ ...CASCADE_SEED, ...TWO_ADMINS });
    token('second', 'second@example.test');
    current.onLock = demoteSecond(ss);
    const before = snapshot(ss);
    assert.equal(post(action, 'second', body).code, 'FORBIDDEN', action);
    for (const n of ['Recruits', 'Events', 'EventRecruits', 'Votes', 'Notes']) assert.deepEqual(snapshot(ss)[n], before[n], action + ' ' + n);
  }
});

// ---------- invalid-vote cleanup (staged; never automatic) ----------

const DIRTY_SEED = {
  ...CASCADE_SEED,
  Users: [
    [OWNER, 'Owner', 'admin', 'yes'],
    ['second@example.test', 'Second', 'admin', 'yes'],
    ['member@example.test', 'Member', 'brother', 'yes'],
    ['former@example.test', 'Former', 'brother', 'no'],
  ],
  Votes: [
    ...CASCADE_SEED.Votes,
    V('evt-1', 'rec-1', 'former@example.test', 4), // valid row by an inactive voter: kept
    V('evt-1', 'rec-1', OWNER, 3), // duplicate weight: not a cleanup criterion, kept
    V('evt-1', 'rec-gone', OWNER, 5), // missing recruit
    V('evt-gone', 'rec-1', OWNER, 5), // missing event
    V('evt-1', 'rec-1', 'stray@example.test', 11), // invalid score
  ],
  EventRecruits: [['evt-1', 'rec-1'], ['evt-1', 'rec-2'], ['evt-2', 'rec-2']], // evt-2/rec-1 vote lacks attendance
};

test('getVoteCleanup finds exactly the four criteria and never writes', () => {
  const ss = fresh(DIRTY_SEED);
  const before = snapshot(ss);
  const writes = stats.writes;
  const p = post('getVoteCleanup', 'owner');
  assert.deepEqual(p.byReason, { missingRecruit: 1, missingEvent: 1, notPresent: 1, invalidScore: 1 });
  assert.equal(p.count, 4);
  assert.match(p.cycleFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(p.cycleFingerprint, post('getAdminData', 'owner').cycleFingerprint);
  assert.deepEqual(snapshot(ss), before);
  assert.equal(stats.writes, writes);
});

test('cleanupInvalidVotes deletes only the previewed invalid rows; valid rows intact', () => {
  const ss = fresh(DIRTY_SEED);
  const p = post('getVoteCleanup', 'owner');
  assert.equal(post('cleanupInvalidVotes', 'owner', { expectedFingerprint: p.cycleFingerprint, expectedCount: 4 }).code, 'INVALID');
  assert.equal(post('cleanupInvalidVotes', 'owner', { confirm: 'DELETE INVALID VOTES', expectedFingerprint: p.cycleFingerprint }).code, 'INVALID');
  assert.equal(post('cleanupInvalidVotes', 'owner', { confirm: 'DELETE INVALID VOTES', expectedFingerprint: p.cycleFingerprint, expectedCount: 3 }).code, 'CONFLICT');
  assert.equal(rowsOf(ss, 'Votes').length, 11);
  const res = post('cleanupInvalidVotes', 'owner', {
    confirm: 'DELETE INVALID VOTES', expectedFingerprint: p.cycleFingerprint, expectedCount: 4,
    predicate: 'all', eventId: 'evt-2', // browser-supplied criteria are ignored
  });
  assert.equal(res.ok, true);
  assert.equal(res.deleted, 4);
  assert.deepEqual(pairs(ss, 'Votes'), [
    'evt-1|rec-1|' + OWNER, 'evt-1|rec-1|member@example.test', 'evt-1|rec-2|' + OWNER,
    'evt-2|rec-2|member@example.test', 'evt-1|rec-1|former@example.test', 'evt-1|rec-1|' + OWNER,
  ]);
  for (const n of ['Recruits', 'EventRecruits', 'Notes', 'Users']) assert.equal(rowsOf(ss, n).length, DIRTY_SEED[n].length + 1, n);
  assert.equal(rowsOf(ss, 'Events').length, 3);
  assert.equal(post('getVoteCleanup', 'owner').count, 0);
});

test('cleanup is refused if anything changed since the preview, or after revocation', () => {
  let ss = fresh(DIRTY_SEED);
  const p = post('getVoteCleanup', 'owner');
  post('saveNote', 'owner', { recruitId: 'rec-2', content: 'changed' });
  assert.equal(post('cleanupInvalidVotes', 'owner', { confirm: 'DELETE INVALID VOTES', expectedFingerprint: p.cycleFingerprint, expectedCount: 4 }).code, 'CONFLICT');
  assert.equal(rowsOf(ss, 'Votes').length, 11);

  ss = fresh(DIRTY_SEED);
  token('second', 'second@example.test');
  const p2 = post('getVoteCleanup', 'second');
  current.onLock = () => { api.saveNote(ss, ADMIN, { recruitId: 'rec-2', content: 'race' }); };
  assert.equal(post('cleanupInvalidVotes', 'second', { confirm: 'DELETE INVALID VOTES', expectedFingerprint: p2.cycleFingerprint, expectedCount: 4 }).code, 'CONFLICT');
  current.onLock = demoteSecond(ss);
  const p3 = post('getVoteCleanup', 'owner');
  assert.equal(post('cleanupInvalidVotes', 'second', { confirm: 'DELETE INVALID VOTES', expectedFingerprint: p3.cycleFingerprint, expectedCount: 4 }).code, 'FORBIDDEN');
  assert.equal(rowsOf(ss, 'Votes').length, 11);
  assert.equal(post('getVoteCleanup', 'member').code, 'FORBIDDEN');
});

test('setup and admin reads never run the cleanup automatically', () => {
  const ss = fresh(DIRTY_SEED);
  const before = snapshot(ss);
  post('getAdminData', 'owner');
  post('getMe', 'owner');
  post('getVoteData', 'member');
  api.setupSchema(ss);
  assert.deepEqual(snapshot(ss).Votes, before.Votes);
});
