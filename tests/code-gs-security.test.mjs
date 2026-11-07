// Security regression tests for Code.gs: token binding, bootstrap, the
// dispatcher authorization matrix, vote integrity, literal-text writes,
// validation, sanitized errors and the wipe guard. All synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  api, makeSs, workspace, post, rawPost, token, plain, rowsOf, snapshot, current, configure,
  stats, cache, fetchLog, driveState, resetDrive, seedPhotoFolder, OWNER, CLIENT_ID,
} from './helpers/gsHarness.mjs';

function fresh(extra) {
  configure();
  resetDrive();
  current.ss = workspace(extra);
  current.lockFails = false;
  current.tokeninfoDown = false;
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
  wipeCycle: { confirm: 'WIPE CYCLE', expected: {} },
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
  assert.equal(api.setAttendance(ss, { eventId: 'evt-1', recruitId: 'rec-1', present: false }).ok, true);
  assert.equal(post('castVote', 'member', { eventId: 'evt-1', recruitId: 'rec-1', score: 4 }).error, 'Invalid vote');
});

// ---------- literal text ----------

test('formula-leading text is stored as literal text everywhere admins can type', () => {
  const ss = fresh();
  stats.formulaWrites = 0;
  const evil = ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '=HYPERLINK("https://x.example")'];
  const created = api.addRecruit(ss, { name: evil[0], major: evil[1], secondMajor: evil[2] });
  api.addEvent(ss, { name: evil[3] });
  api.saveNote(ss, { recruitId: created.id, content: evil[4] });
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

test('wipeCycle needs the typed confirmation and matching counts; Users survive', () => {
  const ss = fresh({ Votes: [['evt-1', 'rec-1', OWNER, 5, 't']] });
  const expected = { Recruits: 2, Events: 2, EventRecruits: 2, Votes: 1, Notes: 0 };
  assert.equal(post('wipeCycle', 'owner', { expected }).code, 'INVALID');
  assert.equal(post('wipeCycle', 'owner', { confirm: 'WIPE CYCLE', expected: { ...expected, Votes: 0 } }).code, 'CONFLICT');
  assert.equal(rowsOf(ss, 'Votes').length, 2);
  const done = post('wipeCycle', 'owner', { confirm: 'WIPE CYCLE', expected });
  assert.equal(done.ok, true);
  assert.equal(plain(api.getAdminData(ss)).recruits.length, 0);
  assert.equal(plain(api.getAdminData(ss)).users.length, 3);
});

test('verifyToken binds audience directly', () => {
  configure();
  token('t', OWNER);
  assert.equal(api.verifyToken('t', 'other'), null);
  assert.equal(api.verifyToken('t', ''), null);
  assert.equal(api.verifyToken('t', CLIENT_ID).email, OWNER);
});
