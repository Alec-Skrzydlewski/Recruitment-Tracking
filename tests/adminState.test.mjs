import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTemp,
  replaceId,
  replaceIdInMap,
  removeById,
  insertAt,
  toggleAttendance,
  setUserRole,
  addUser,
  removeUser,
  apply,
  rollback,
  nextTempId,
  isTempId,
  createInflightGuard,
} from '../src/lib/adminState.js';

function data(overrides = {}) {
  return {
    recruits: [],
    events: [],
    attendance: [],
    votes: [],
    notes: [],
    users: [],
    ...overrides,
  };
}

test('optimistic add then id swap including attendance that referenced the temp id', () => {
  const added = apply(data({
    events: [{ id: 'e1', name: 'Rush' }],
  }), {
    type: 'addTemp',
    collection: 'recruits',
    tempId: 'tmp-1',
    item: { name: 'Ada', major: 'CS' },
  });
  assert.equal(added.data.recruits[0].id, 'tmp-1');
  assert.equal(added.data.recruits[0].name, 'Ada');

  const withAtt = apply(added.data, {
    type: 'toggleAttendance',
    eventId: 'e1',
    recruitId: 'tmp-1',
  });
  assert.deepEqual(withAtt.data.attendance, [{ eventId: 'e1', recruitId: 'tmp-1' }]);

  const swapped = replaceId(withAtt.data, 'tmp-1', 'real-99');
  assert.equal(swapped.recruits[0].id, 'real-99');
  assert.equal(swapped.recruits[0].name, 'Ada');
  assert.deepEqual(swapped.attendance, [{ eventId: 'e1', recruitId: 'real-99' }]);
  assert.equal(swapped.events[0].id, 'e1');

  const drafts = replaceIdInMap({ 'tmp-1': 'strong rushee' }, 'tmp-1', 'real-99');
  assert.deepEqual(drafts, { 'real-99': 'strong rushee' });
});

test('replaceId also rewrites event ids in attendance and notes', () => {
  const src = data({
    events: [{ id: 'tmp-e', name: 'Social' }],
    attendance: [{ eventId: 'tmp-e', recruitId: 'r1' }],
    notes: [{ recruitId: 'r1', content: 'hi' }],
    votes: [{ eventId: 'tmp-e', recruitId: 'r1', score: 8 }],
  });
  const swapped = replaceId(src, 'tmp-e', 'e-real');
  assert.equal(swapped.events[0].id, 'e-real');
  assert.equal(swapped.attendance[0].eventId, 'e-real');
  assert.equal(swapped.votes[0].eventId, 'e-real');
  assert.equal(swapped.notes[0].recruitId, 'r1');
});

test('add failure rollback removes the temp item', () => {
  const original = data({ recruits: [{ id: 'r1', name: 'Ada', major: 'CS' }] });
  const added = apply(original, {
    type: 'addTemp',
    collection: 'recruits',
    tempId: 'tmp-fail',
    item: { name: 'Bea', major: 'EE' },
  });
  assert.equal(added.data.recruits.length, 2);
  const rolled = rollback(added.data, added.inverse);
  assert.deepEqual(rolled.recruits, original.recruits);
  assert.equal(rolled.recruits.some(r => r.id === 'tmp-fail'), false);
});

test('addTemp helper appends with the given temp id', () => {
  const list = addTemp([{ id: 'r1', name: 'Ada' }], { name: 'Bea', major: 'EE' }, 'tmp-1');
  assert.deepEqual(list, [
    { id: 'r1', name: 'Ada' },
    { id: 'tmp-1', name: 'Bea', major: 'EE' },
  ]);
});

test('delete + rollback restoring position', () => {
  const original = data({
    recruits: [
      { id: 'a', name: 'Ada' },
      { id: 'b', name: 'Bea' },
      { id: 'c', name: 'Cyd' },
    ],
  });
  const removed = apply(original, { type: 'removeById', collection: 'recruits', id: 'b' });
  assert.deepEqual(removed.data.recruits.map(r => r.id), ['a', 'c']);
  const restored = rollback(removed.data, removed.inverse);
  assert.deepEqual(restored.recruits.map(r => r.id), ['a', 'b', 'c']);
  assert.equal(restored.recruits[1].name, 'Bea');
});

test('delete rollback restores original index after a concurrent add at the end', () => {
  const original = data({
    events: [
      { id: 'e1', name: 'One' },
      { id: 'e2', name: 'Two' },
      { id: 'e3', name: 'Three' },
    ],
  });
  const del = apply(original, { type: 'removeById', collection: 'events', id: 'e2' });
  const added = apply(del.data, {
    type: 'addTemp',
    collection: 'events',
    tempId: 'tmp-e',
    item: { name: 'Four' },
  });
  const restored = rollback(added.data, del.inverse);
  assert.deepEqual(restored.events.map(e => e.id), ['e1', 'e2', 'e3', 'tmp-e']);
});

test('removeById and insertAt restore a hole in the middle', () => {
  const { list, removed, index } = removeById([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'b');
  assert.equal(index, 1);
  assert.equal(removed.id, 'b');
  assert.deepEqual(insertAt(list, index, removed).map(x => x.id), ['a', 'b', 'c']);
});

test('attendance toggle on/off + rollback', () => {
  const start = data({ attendance: [] });
  const on = apply(start, { type: 'toggleAttendance', eventId: 'e1', recruitId: 'r1' });
  assert.deepEqual(on.data.attendance, [{ eventId: 'e1', recruitId: 'r1' }]);

  const off = apply(on.data, { type: 'toggleAttendance', eventId: 'e1', recruitId: 'r1' });
  assert.deepEqual(off.data.attendance, []);

  const rolledOn = rollback(on.data, on.inverse);
  assert.deepEqual(rolledOn.attendance, []);

  const rolledOff = rollback(off.data, off.inverse);
  assert.deepEqual(rolledOff.attendance, [{ eventId: 'e1', recruitId: 'r1' }]);

  const direct = toggleAttendance([{ eventId: 'e1', recruitId: 'r1' }], 'e1', 'r1');
  assert.deepEqual(direct, []);
});

test('setRole + rollback', () => {
  const start = data({
    users: [{ email: 'bea@chapter.org', name: 'Bea', role: 'brother' }],
  });
  const promoted = apply(start, { type: 'setUserRole', email: 'Bea@chapter.org', role: 'admin' });
  assert.equal(promoted.data.users[0].role, 'admin');
  const rolled = rollback(promoted.data, promoted.inverse);
  assert.equal(rolled.users[0].role, 'brother');

  const helper = setUserRole(start.users, 'bea@chapter.org', 'admin');
  assert.equal(helper.previousRole, 'brother');
  assert.equal(helper.users[0].role, 'admin');
});

test('user add/remove + rollback', () => {
  const start = data({
    users: [{ email: 'ada@chapter.org', name: 'Ada', role: 'admin' }],
  });
  const added = apply(start, { type: 'addUser', email: 'bea@chapter.org' });
  assert.equal(added.data.users.length, 2);
  assert.equal(added.data.users[1].email, 'bea@chapter.org');
  assert.equal(added.data.users[1].name, 'bea@chapter.org');
  assert.equal(added.data.users[1].role, 'brother');

  const addRolled = rollback(added.data, added.inverse);
  assert.equal(addRolled.users.length, 1);
  assert.equal(addRolled.users[0].email, 'ada@chapter.org');

  const removed = apply(added.data, { type: 'removeUser', email: 'bea@chapter.org' });
  assert.equal(removed.data.users.length, 1);
  const removeRolled = rollback(removed.data, removed.inverse);
  assert.equal(removeRolled.users.length, 2);
  assert.equal(removeRolled.users[1].email, 'bea@chapter.org');
  assert.equal(removeRolled.users[1].role, 'brother');

  const helperAdd = addUser(start.users, 'cyd@chapter.org');
  assert.equal(helperAdd[1].name, 'cyd@chapter.org');
  const helperRemove = removeUser(helperAdd, 'cyd@chapter.org');
  assert.equal(helperRemove.users.length, 1);
  assert.equal(helperRemove.index, 1);
});

test('rollback of one action does not undo another concurrent successful action', () => {
  const start = data({
    recruits: [{ id: 'r1', name: 'Ada', major: 'CS' }],
    users: [{ email: 'ada@chapter.org', name: 'Ada', role: 'admin' }],
  });

  const addA = apply(start, {
    type: 'addTemp',
    collection: 'recruits',
    tempId: 'tmp-a',
    item: { name: 'Bea', major: 'EE' },
  });
  const addB = apply(addA.data, {
    type: 'addTemp',
    collection: 'recruits',
    tempId: 'tmp-b',
    item: { name: 'Cyd', major: 'ME' },
  });
  const bSucceeded = replaceId(addB.data, 'tmp-b', 'r-b');
  const aFailed = rollback(bSucceeded, addA.inverse);

  assert.equal(aFailed.recruits.some(r => r.name === 'Bea'), false);
  const kept = aFailed.recruits.find(r => r.id === 'r-b');
  assert.equal(kept.name, 'Cyd');
  assert.equal(aFailed.recruits.find(r => r.id === 'r1').name, 'Ada');

  const userAdd = apply(aFailed, { type: 'addUser', email: 'new@chapter.org' });
  const delRecruit = apply(userAdd.data, { type: 'removeById', collection: 'recruits', id: 'r1' });
  const userAddFailed = rollback(delRecruit.data, userAdd.inverse);

  assert.equal(userAddFailed.users.some(u => u.email === 'new@chapter.org'), false);
  assert.equal(userAddFailed.recruits.some(r => r.id === 'r1'), false);
  assert.equal(userAddFailed.recruits.find(r => r.id === 'r-b').name, 'Cyd');
});

test('apply does not mutate the original data object', () => {
  const original = data({
    recruits: [{ id: 'r1', name: 'Ada' }],
    attendance: [{ eventId: 'e1', recruitId: 'r1' }],
  });
  const snapshot = JSON.parse(JSON.stringify(original));
  apply(original, {
    type: 'addTemp',
    collection: 'recruits',
    tempId: 'tmp-1',
    item: { name: 'Bea' },
  });
  apply(original, { type: 'toggleAttendance', eventId: 'e1', recruitId: 'r1' });
  assert.deepEqual(original, snapshot);
});

test('recruit program fields survive optimistic add, id swap, and rollback', () => {
  const item = {
    name: 'Ada',
    major: 'Finance (BSBA)',
    secondMajor: 'Economics (BA)',
    minor: 'Accounting',
    programLevel: 'Undergraduate',
    gradTerm: 'Spring 2027',
    photoUrl: 'https://example.com/a.jpg',
  };
  const original = data({
    recruits: [{ id: 'r1', name: 'Bea', major: 'Marketing (BSBA)', minor: 'Finance' }],
  });
  const added = apply(original, {
    type: 'addTemp',
    collection: 'recruits',
    tempId: 'tmp-ada',
    item,
  });
  assert.deepEqual(added.data.recruits[1], { id: 'tmp-ada', ...item });

  const swapped = replaceId(added.data, 'tmp-ada', 'real-ada');
  assert.equal(swapped.recruits[1].id, 'real-ada');
  assert.equal(swapped.recruits[1].name, 'Ada');
  assert.equal(swapped.recruits[1].major, 'Finance (BSBA)');
  assert.equal(swapped.recruits[1].secondMajor, 'Economics (BA)');
  assert.equal(swapped.recruits[1].minor, 'Accounting');
  assert.equal(swapped.recruits[1].programLevel, 'Undergraduate');
  assert.equal(swapped.recruits[1].gradTerm, 'Spring 2027');
  assert.equal(swapped.recruits[1].photoUrl, 'https://example.com/a.jpg');
  assert.equal(swapped.recruits[0].minor, 'Finance');

  const rolled = rollback(added.data, added.inverse);
  assert.deepEqual(rolled.recruits, original.recruits);
  assert.equal(rolled.recruits.some(recruit => recruit.id === 'tmp-ada'), false);
});

test('double-submit guard helper rejects a second begin before end', () => {
  const guard = createInflightGuard();
  assert.equal(guard.begin('add-recruit'), true);
  assert.equal(guard.begin('add-recruit'), false);
  assert.equal(guard.has('add-recruit'), true);
  assert.equal(guard.begin('add-event'), true);
  guard.end('add-recruit');
  assert.equal(guard.has('add-recruit'), false);
  assert.equal(guard.begin('add-recruit'), true);
  assert.equal(isTempId(nextTempId()), true);
  assert.equal(isTempId('real-1'), false);
});
