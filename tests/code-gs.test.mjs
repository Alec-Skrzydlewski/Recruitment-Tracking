import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const codePath = require.resolve('../apps-script/Code.gs');
const code = fs.readFileSync(codePath, 'utf8');

function makeSheet(rows) {
  return {
    appendRow(row) {
      rows.push(Array.from(row));
    },
    deleteRow(rowIndex) {
      rows.splice(rowIndex - 1, 1);
    },
    getLastRow() {
      return rows.length;
    },
    getLastColumn() {
      return rows.reduce((max, row) => Math.max(max, row.length), 0);
    },
    getDataRange() {
      return {
        getValues() {
          return rows.map(row => row.slice());
        },
      };
    },
    getRange(row, col, numRows, numCols) {
      const height = numRows == null ? 1 : numRows;
      const width = numCols == null ? 1 : numCols;
      return {
        setValue(value) {
          const target = rows[row - 1];
          while (target.length < col) target.push('');
          target[col - 1] = value;
        },
        clearContent() {
          for (let r = 0; r < height; r++) {
            const target = rows[row - 1 + r];
            if (!target) continue;
            for (let c = 0; c < width; c++) {
              if (col - 1 + c < target.length) target[col - 1 + c] = '';
            }
          }
        },
      };
    },
  };
}

function makeSs(seed = {}, headerOverrides = {}) {
  const sheets = {};
  const spec = {
    Users: ['email', 'name', 'role', 'active'],
    Recruits: ['id', 'name', 'major', 'photoUrl', 'secondMajor', 'minor', 'programLevel', 'gradTerm'],
    Events: ['id', 'name'],
    EventRecruits: ['eventId', 'recruitId'],
    Votes: ['eventId', 'recruitId', 'userEmail', 'score', 'timestamp'],
    Notes: ['recruitId', 'content', 'updatedAt'],
  };
  Object.keys(spec).forEach(name => {
    const header = headerOverrides[name] || spec[name];
    sheets[name] = makeSheet([header.slice(), ...(seed[name] || []).map(row => row.slice())]);
  });
  return {
    getId() { return 'test-sheet'; },
    getSheetByName(name) { return sheets[name] || null; },
    insertSheet(name) {
      sheets[name] = makeSheet([]);
      return sheets[name];
    },
  };
}

const tokenUsers = {};
const lockLog = [];
let currentSs = null;
let uuidN = 0;

const sandbox = {
  module: { exports: {} },
  console,
  SpreadsheetApp: {
    getActiveSpreadsheet() {
      if (!currentSs) throw new Error('no active spreadsheet');
      return currentSs;
    },
    openById(id) {
      if (!currentSs || currentSs.getId() !== id) throw new Error('missing spreadsheet');
      return currentSs;
    },
  },
  LockService: {
    getScriptLock() {
      return {
        waitLock(ms) { lockLog.push(['wait', ms]); },
        releaseLock() { lockLog.push(['release']); },
      };
    },
  },
  UrlFetchApp: {
    fetch(url) {
      const token = decodeURIComponent(String(url).split('id_token=')[1] || '');
      const user = tokenUsers[token];
      if (!user) throw new Error('invalid token');
      return { getContentText() { return JSON.stringify(user); } };
    },
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput(text) {
      const out = {
        text,
        setMimeType() { return out; },
      };
      return out;
    },
  },
  Utilities: {
    getUuid() {
      uuidN += 1;
      return `uuid-${uuidN}`;
    },
  },
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: codePath });
const api = sandbox.module.exports;

function post(action, token, extra = {}) {
  const out = api.doPost({
    postData: { contents: JSON.stringify({ action, token, ...extra }) },
  });
  return JSON.parse(out.text);
}

function usersOf(ss) {
  return JSON.parse(JSON.stringify(api.rowsToObjects(ss.getSheetByName('Users'))));
}

// Objects built inside the Apps Script vm have a different prototype.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('loading Code.gs does not touch SpreadsheetApp', () => {
  assert.equal(typeof api.doPost, 'function');
  assert.equal(typeof api.rowsToObjects, 'function');
  assert.equal(lockLog.length, 0);
});

test('notes with only recruitId read back', () => {
  const ss = makeSs({
    Notes: [
      ['', '', ''],
      ['rec-1', 'Asked good questions', '2026-01-01'],
    ],
  });
  const notes = plain(api.rowsToObjects(ss.getSheetByName('Notes')));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].recruitId, 'rec-1');
  assert.equal(notes[0].content, 'Asked good questions');

  const saved = api.saveNote(ss, { recruitId: 'rec-9', content: 'Follow up Monday' });
  assert.deepEqual(plain(saved), { ok: true });
  const again = plain(api.getAdminData(ss).notes);
  assert.equal(again.find(note => note.recruitId === 'rec-9').content, 'Follow up Monday');
  assert.equal(again.find(note => note.recruitId === 'rec-1').content, 'Asked good questions');
});

test('castVote updates the existing row and deletes duplicates', () => {
  lockLog.length = 0;
  const ss = makeSs({
    Votes: [
      ['evt-1', 'rec-1', 'voter@chapter.org', 3, 't1'],
      ['evt-1', 'rec-2', 'voter@chapter.org', 5, 't2'],
      ['evt-1', 'rec-1', 'Voter@chapter.org', 4, 't3'],
    ],
  });
  const bad = api.castVote(ss, { email: 'voter@chapter.org' }, { eventId: 'evt-1', recruitId: 'rec-1', score: 3.5 });
  assert.equal(bad.error, 'Invalid vote');

  const result = api.castVote(ss, { email: 'Voter@chapter.org' }, { eventId: 'evt-1', recruitId: 'rec-1', score: '9' });
  assert.deepEqual(plain(result), { ok: true });
  const votes = plain(api.rowsToObjects(ss.getSheetByName('Votes')));
  assert.equal(votes.length, 2);
  const kept = votes.filter(vote => vote.recruitId === 'rec-1');
  assert.equal(kept.length, 1);
  assert.equal(kept[0].score, 9);
  assert.equal(kept[0].userEmail, 'voter@chapter.org');
  assert.equal(votes.find(vote => vote.recruitId === 'rec-2').score, 5);
  assert.deepEqual(lockLog.filter(entry => entry[0] === 'wait'), [['wait', 10000]]);
  assert.equal(lockLog.filter(entry => entry[0] === 'release').length, 1);
});

test('manageUser add rejects an email that already exists', () => {
  const ss = makeSs({
    Users: [['Ada@chapter.org', 'Ada', 'admin', 'yes']],
  });
  const result = api.manageUser(ss, { email: 'boss@chapter.org' }, { op: 'add', email: 'ada@chapter.org', role: 'brother' });
  assert.equal(result.error, 'User already exists');
  assert.equal(usersOf(ss).length, 1);
});

test('manageUser refuses self-removal', () => {
  const ss = makeSs({
    Users: [
      ['ada@chapter.org', 'Ada', 'admin', 'yes'],
      ['bea@chapter.org', 'Bea', 'admin', 'yes'],
    ],
  });
  const result = api.manageUser(ss, { email: 'Ada@chapter.org' }, { op: 'remove', email: 'ada@chapter.org' });
  assert.equal(result.error, 'You cannot remove yourself');
  assert.equal(usersOf(ss).length, 2);
});

test('last active admin cannot be removed or demoted', () => {
  const ss = makeSs({
    Users: [
      ['ada@chapter.org', 'Ada', 'admin', 'yes'],
      ['bea@chapter.org', 'Bea', 'brother', 'yes'],
    ],
  });
  const removed = api.manageUser(ss, { email: 'bea@chapter.org' }, { op: 'remove', email: 'Ada@chapter.org' });
  assert.equal(removed.error, 'Cannot remove the last admin');
  assert.equal(usersOf(ss).find(user => user.email === 'ada@chapter.org').role, 'admin');

  const demoted = api.manageUser(ss, { email: 'ada@chapter.org' }, { op: 'setRole', email: 'ada@chapter.org', role: 'brother' });
  assert.equal(demoted.error, 'Cannot demote the last admin');
  assert.equal(usersOf(ss).find(user => user.email === 'ada@chapter.org').role, 'admin');
});

test('first sign-in becomes admin and returns email', () => {
  lockLog.length = 0;
  tokenUsers.first = { email: 'First@Chapter.org', email_verified: 'true', name: 'First Person' };
  currentSs = makeSs();
  const result = post('bootstrap', 'first');
  assert.equal(result.role, 'admin');
  assert.equal(result.email, 'first@chapter.org');
  assert.equal(result.name, 'First Person');
  const users = usersOf(currentSs);
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'admin');
  assert.deepEqual(lockLog.filter(entry => entry[0] === 'wait'), [['wait', 10000]]);
  assert.equal(lockLog.filter(entry => entry[0] === 'release').length, 1);

  const me = api.getMe(currentSs, { email: 'first@chapter.org' });
  assert.deepEqual(plain(me), { email: 'first@chapter.org', name: 'First Person', role: 'admin' });
});

const RECRUIT_HEADER = ['id', 'name', 'major', 'photoUrl', 'secondMajor', 'minor', 'programLevel', 'gradTerm'];

test('ensureSheets appends missing Recruits headers without reordering or deleting', () => {
  const ss = makeSs(
    { Recruits: [['Ada', 'r1', 'Finance (BSBA)', 'http://photo']] },
    { Recruits: ['name', 'id', 'major', 'photoUrl'] },
  );
  api.ensureSheets(ss);
  const sheet = ss.getSheetByName('Recruits');
  let values = sheet.getDataRange().getValues();
  assert.deepEqual(values[0], ['name', 'id', 'major', 'photoUrl', 'secondMajor', 'minor', 'programLevel', 'gradTerm']);
  assert.deepEqual(values[1], ['Ada', 'r1', 'Finance (BSBA)', 'http://photo']);

  api.ensureSheets(ss);
  values = sheet.getDataRange().getValues();
  assert.deepEqual(values[0], ['name', 'id', 'major', 'photoUrl', 'secondMajor', 'minor', 'programLevel', 'gradTerm']);
  assert.equal(values.length, 2);
  assert.deepEqual(values[1], ['Ada', 'r1', 'Finance (BSBA)', 'http://photo']);

  const partial = makeSs(
    { Recruits: [['r1', 'Ada', 'Marketing (BSBA)', '', 'Economics (BA)', 'keep']] },
    { Recruits: ['id', 'name', 'major', 'photoUrl', 'secondMajor', 'legacy'] },
  );
  api.ensureSheets(partial);
  const migrated = partial.getSheetByName('Recruits').getDataRange().getValues();
  assert.deepEqual(migrated[0], ['id', 'name', 'major', 'photoUrl', 'secondMajor', 'legacy', 'minor', 'programLevel', 'gradTerm']);
  assert.deepEqual(migrated[1], ['r1', 'Ada', 'Marketing (BSBA)', '', 'Economics (BA)', 'keep']);
});

test('ensureSheets creates a Recruits sheet with the extended header', () => {
  const sheets = {};
  const ss = {
    getSheetByName(name) { return sheets[name] || null; },
    insertSheet(name) {
      sheets[name] = makeSheet([]);
      return sheets[name];
    },
  };
  api.ensureSheets(ss);
  assert.deepEqual(ss.getSheetByName('Recruits').getDataRange().getValues()[0], RECRUIT_HEADER);
  assert.deepEqual(ss.getSheetByName('Users').getDataRange().getValues()[0], ['email', 'name', 'role', 'active']);
});

test('addRecruit writes trimmed fields in header order and reads back', () => {
  const ss = makeSs({
    Users: [['ada@chapter.org', 'Ada', 'brother', 'yes']],
  });
  api.ensureSheets(ss);
  const created = api.addRecruit(ss, {
    name: '  Ada Lovelace ',
    major: ' Finance (BSBA) ',
    photoUrl: ' https://example.com/a.jpg ',
    secondMajor: ' Economics (BA) ',
    minor: ' Accounting ',
    programLevel: ' Undergraduate ',
    gradTerm: ' Spring 2027 ',
  });
  let values = ss.getSheetByName('Recruits').getDataRange().getValues();
  assert.deepEqual(values[0], RECRUIT_HEADER);
  assert.deepEqual(values[1], [
    created.id,
    'Ada Lovelace',
    'Finance (BSBA)',
    'https://example.com/a.jpg',
    'Economics (BA)',
    'Accounting',
    'Undergraduate',
    'Spring 2027',
  ]);

  const blank = api.addRecruit(ss, { name: '  Bea  ', photoUrl: '   ', secondMajor: '  ' });
  values = ss.getSheetByName('Recruits').getDataRange().getValues();
  assert.deepEqual(values[2], [blank.id, 'Bea', '', '', '', '', '', '']);

  const shifted = makeSs(
    { Recruits: [['Ada', 'r1', 'Finance (BSBA)', 'http://photo']] },
    { Recruits: ['name', 'id', 'major', 'photoUrl'] },
  );
  api.ensureSheets(shifted);
  const extra = api.addRecruit(shifted, {
    name: 'Cyd',
    major: 'Marketing (BSBA)',
    minor: 'Statistics',
    programLevel: 'MBA',
    gradTerm: 'Fall 2030',
  });
  const shiftedRows = shifted.getSheetByName('Recruits').getDataRange().getValues();
  assert.deepEqual(shiftedRows[2], [
    'Cyd',
    extra.id,
    'Marketing (BSBA)',
    '',
    '',
    'Statistics',
    'MBA',
    'Fall 2030',
  ]);

  const admin = plain(api.getAdminData(ss));
  const ada = admin.recruits.find(recruit => recruit.id === created.id);
  assert.equal(ada.major, 'Finance (BSBA)');
  assert.equal(ada.photoUrl, 'https://example.com/a.jpg');
  assert.equal(ada.secondMajor, 'Economics (BA)');
  assert.equal(ada.minor, 'Accounting');
  assert.equal(ada.programLevel, 'Undergraduate');
  assert.equal(ada.gradTerm, 'Spring 2027');
  assert.equal(admin.recruits.find(recruit => recruit.id === blank.id).secondMajor, '');

  const vote = plain(api.getVoteData(ss, { email: 'Ada@chapter.org' }));
  const voted = vote.recruits.find(recruit => recruit.id === created.id);
  assert.equal(voted.major, 'Finance (BSBA)');
  assert.equal(voted.secondMajor, 'Economics (BA)');
  assert.equal(voted.minor, 'Accounting');
  assert.equal(voted.programLevel, 'Undergraduate');
  assert.equal(voted.gradTerm, 'Spring 2027');
});

test('unknown user gets the unauthorized message', () => {
  tokenUsers.other = { email: 'other@chapter.org', email_verified: 'true', name: 'Other' };
  currentSs = makeSs({
    Users: [['ada@chapter.org', 'Ada', 'admin', 'yes']],
  });
  const result = post('bootstrap', 'other');
  assert.deepEqual(result, { error: 'Not authorized. Ask an admin to add you.' });
  assert.equal(usersOf(currentSs).length, 1);
});
