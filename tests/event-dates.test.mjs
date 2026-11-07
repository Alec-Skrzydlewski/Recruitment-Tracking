// Optional event dates: YYYY-MM-DD, backward compatible with legacy sheets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { post, token, rowsOf, snapshot, workspace, current, OWNER } from './helpers/gsHarness.mjs';
import { createDemoBackend } from '../src/demo/demoBackend.js';
import { DEMO_PERSONAS } from '../src/demo/seed.js';
import { isValidEventDate, formatEventDate } from '../src/lib/eventDate.js';

function useWs(extra, headers) {
  const ws = workspace(extra);
  if (headers) Object.keys(headers).forEach(n => { ws.getSheetByName(n).rows[0] = headers[n].slice(); });
  current.ss = ws;
  current.lockFails = false; current.tokeninfoDown = false; current.onLock = null; current.lockHeld = false;
  token('owner', OWNER);
  token('member', 'member@example.test');
  return ws;
}

test('legacy Events sheet (no date header) reads with date "" and no writes', () => {
  const ss = useWs();
  const before = snapshot(ss);
  const admin = post('getAdminData', 'owner');
  assert.equal(admin.error, undefined);
  assert.deepEqual(admin.events.map(e => e.date), ['', '']);
  const vote = post('getVoteData', 'member');
  assert.ok(vote.events.every(e => e.date === ''));
  assert.deepEqual(snapshot(ss), before, 'reads never mutate the sheet');
});

test('undated addEvent on a legacy sheet does not add a date column', () => {
  const ss = useWs();
  assert.equal(post('addEvent', 'owner', { name: 'Mixer', date: '' }).error, undefined);
  assert.equal(post('addEvent', 'owner', { name: 'Mixer 2' }).error, undefined);
  const rows = rowsOf(ss, 'Events');
  assert.deepEqual(rows[0], ['id', 'name']);
  assert.ok(rows.slice(1).every(r => r.length === 2));
});

test('first dated addEvent appends only the date header, keeps rows/unknown columns, stores literal text', () => {
  const ss = useWs({ Events: [['evt-1', 'Info Night', 'keep-me'], ['evt-2', 'Case Night', '']] }, { Events: ['id', 'name', 'notes'] });
  const legacy = rowsOf(ss, 'Events').slice(1);
  const res = post('addEvent', 'owner', { name: 'Leap', date: '2028-02-29' });
  assert.equal(res.error, undefined);
  const rows = rowsOf(ss, 'Events');
  assert.deepEqual(rows[0], ['id', 'name', 'notes', 'date']);
  assert.deepEqual(rows.slice(1, 3), legacy, 'legacy rows untouched, order kept');
  const added = ss.getSheetByName('Events').rows[3];
  assert.equal(added[3], '2028-02-29');
  assert.equal(typeof added[3], 'string', 'apostrophe kept Sheets from converting it to a Date');
  const events = post('getAdminData', 'owner').events;
  assert.deepEqual(events.map(e => [e.name, e.date]), [['Info Night', ''], ['Case Night', ''], ['Leap', '2028-02-29']]);
  // second dated event reuses the column
  post('addEvent', 'owner', { name: 'Fall', date: '2026-09-15' });
  assert.deepEqual(rowsOf(ss, 'Events')[0], ['id', 'name', 'notes', 'date']);
});

test('blank-header data column and empty-evaluating formula header survive; date gets a new empty column', () => {
  const ss = useWs({ Events: [['evt-1', 'Info Night', 'legacy-a'], ['evt-2', 'Case Night', 'legacy-b']] }, { Events: ['id', 'name', ''] });
  const sheet = ss.getSheetByName('Events');
  // Simulate a formula header in column 4 that evaluates to "": values show
  // nothing there, but the sheet's used range includes it.
  const realLast = sheet.getLastColumn.bind(sheet);
  sheet.getLastColumn = () => Math.max(realLast(), 4);
  const before = rowsOf(ss, 'Events');
  assert.equal(post('addEvent', 'owner', { name: 'Fall', date: '2026-09-15' }).error, undefined);
  const rows = rowsOf(ss, 'Events');
  assert.deepEqual(rows[0].slice(0, 3), ['id', 'name', '']);
  assert.ok(!rows[0][3], 'formula column 4 untouched');
  assert.equal(rows[0][4], 'date', 'date header placed in column 5');
  assert.deepEqual(rows.slice(1, 3).map(r => r.slice(0, 3)), before.slice(1).map(r => r.slice(0, 3)));
  assert.ok(rows.slice(1, 3).every(r => !r[4]), 'new column empty for legacy rows');
  assert.equal(sheet.rows[3][4], '2026-09-15');
  assert.equal(sheet.rows[3][2], '', 'nothing written into the blank-header column');
});

test('unauthorized, invalid and replayed requests never add the date header', () => {
  const ss = useWs();
  post('addEvent', 'member', { name: 'X', date: '2026-09-15' });
  post('addEvent', 'owner', { name: 'X', date: '2026-02-30' });
  assert.deepEqual(rowsOf(ss, 'Events')[0], ['id', 'name']);
  const a = post('addEvent', 'owner', { name: 'R', date: '2026-09-15', requestId: 'rep-1' });
  const header = rowsOf(ss, 'Events')[0].slice();
  const count = rowsOf(ss, 'Events').length;
  const b = post('addEvent', 'owner', { name: 'R', date: '2026-09-15', requestId: 'rep-1' });
  assert.equal(a.id, b.id);
  assert.deepEqual(rowsOf(ss, 'Events')[0], header);
  assert.equal(rowsOf(ss, 'Events').length, count, 'replay wrote nothing');
});

test('invalid dates are rejected before any write or lock', () => {
  const bad = ['2027-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-9-15', '09/15/2026', '2026-09-15T00:00:00Z',
    ' 2026-09-15', '1999-12-31', '2101-01-01', 20260915, true, {}, ['2026-09-15'], 'abc'];
  for (const date of bad) {
    const ss = useWs();
    const before = snapshot(ss);
    const res = post('addEvent', 'owner', { name: 'X', date });
    assert.ok(res.error, JSON.stringify(date));
    assert.equal(res.code, 'INVALID', JSON.stringify(date));
    assert.deepEqual(snapshot(ss), before, JSON.stringify(date));
  }
});

test('leap-year rules and absent/null mean undated', () => {
  useWs();
  for (const d of ['2000-02-29', '2024-02-29', '2028-02-29']) assert.equal(post('addEvent', 'owner', { name: d, date: d }).error, undefined);
  useWs();
  assert.equal(post('addEvent', 'owner', { name: 'n', date: null }).error, undefined);
  assert.equal(post('addEvent', 'owner', { name: 'x', date: '2100-02-29' }).code, 'INVALID');
});

test('Date cells read in the spreadsheet time zone, no UTC day shift; junk reads as not recorded', () => {
  const ss = useWs({ Events: [
    ['evt-1', 'Typed', new Date('2026-02-28T00:00:00+11:00')],
    ['evt-2', 'Text', '2026-03-01'],
    ['evt-3', 'Junk', 'next tuesday'],
    ['evt-4', 'Blank', ''],
  ] }, { Events: ['id', 'name', 'date'] });
  ss.tz = 'Australia/Sydney';
  const before = snapshot(ss);
  const events = post('getAdminData', 'owner').events;
  assert.deepEqual(events.map(e => e.date), ['2026-02-28', '2026-03-01', '', '']);
  assert.deepEqual(snapshot(ss), before);
});

test('regression: delete cascade, votes and wipe still work with a date column', () => {
  const ss = useWs({ Events: [['evt-1', 'Info Night', '2026-09-08'], ['evt-2', 'Case Night', '']] }, { Events: ['id', 'name', 'date'] });
  assert.equal(post('castVote', 'member', { eventId: 'evt-1', recruitId: 'rec-1', score: 7 }).error, undefined);
  assert.equal(post('deleteEvent', 'owner', { id: 'evt-1' }).error, undefined);
  assert.equal(rowsOf(ss, 'Events').length, 2);
  assert.ok(!rowsOf(ss, 'Votes').some(v => v[0] === 'evt-1'));
  assert.ok(!rowsOf(ss, 'EventRecruits').some(v => v[0] === 'evt-1'));
  let done;
  for (let i = 0; i < 2 && !(done && done.ok); i++) {
    const expectedFingerprint = post('getAdminData', 'owner').cycleFingerprint;
    assert.match(expectedFingerprint, /^[0-9a-f]{64}$/);
    done = post('wipeCycle', 'owner', { confirm: 'WIPE CYCLE', expectedFingerprint });
  }
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.deepEqual(rowsOf(ss, 'Events')[0], ['id', 'name', 'date'], 'wipe keeps the header incl. date');
  assert.ok(rowsOf(ss, 'Events').slice(1).every(r => r.every(c => c === '')));
});

test('unauthorized users still cannot add events, dated or not', () => {
  const ss = useWs();
  const before = snapshot(ss);
  assert.ok(post('addEvent', 'member', { name: 'X', date: '2026-09-15' }).error);
  assert.deepEqual(snapshot(ss), before);
});

test('frontend helpers: validation parity and display from parts', () => {
  assert.equal(isValidEventDate('2028-02-29'), true);
  assert.equal(isValidEventDate('2027-02-29'), false);
  assert.equal(isValidEventDate(20260915), false);
  assert.equal(formatEventDate('2026-01-01'), 'Jan 1, 2026');
  assert.equal(formatEventDate('2026-12-31'), 'Dec 31, 2026');
  assert.equal(formatEventDate(''), '');
  assert.equal(formatEventDate(undefined), '');
  const saved = process.env.TZ;
  for (const tz of ['Pacific/Honolulu', 'Pacific/Kiritimati', 'UTC']) {
    process.env.TZ = tz;
    assert.equal(formatEventDate('2026-03-01'), 'Mar 1, 2026', tz);
  }
  process.env.TZ = saved;
});

test('demo backend parity: optional date, validation, round-trip', async () => {
  const b = createDemoBackend({ latencyMs: 0 });
  const A = DEMO_PERSONAS.find(p => p.role === 'admin').email;
  const data = await b.call(A, 'getAdminData');
  assert.equal(data.events.find(e => e.id === 'e-info').date, '2026-09-08');
  assert.ok(data.events.every(e => e.date), 'showcase events are all dated (undated legacy covered in ui-flows)');
  await b.call(A, 'addEvent', { name: 'Leap', date: '2028-02-29' });
  await b.call(A, 'addEvent', { name: 'Plain' });
  const after = (await b.call(A, 'getAdminData')).events;
  assert.equal(after.find(e => e.name === 'Leap').date, '2028-02-29');
  assert.equal(after.find(e => e.name === 'Plain').date, '');
  for (const date of ['2027-02-29', 20260915, '2026-9-1']) {
    await assert.rejects(() => b.call(A, 'addEvent', { name: 'Bad', date }), /date/i);
  }
});
