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
    Recruits: ['id', 'name', 'major', 'secondMajor', 'gradYear', 'photoFileId', 'photoSource'],
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

const driveState = {
  props: {},
  files: {},
  folders: {},
  blobReads: 0,
  fileLookups: 0,
  getFilesCalls: 0,
  createFolderCalls: 0,
  sharingCalls: 0,
  trashCalls: 0,
  seq: 0,
};

function resetDrive() {
  driveState.props = {};
  driveState.files = {};
  driveState.folders = {};
  driveState.blobReads = 0;
  driveState.fileLookups = 0;
  driveState.getFilesCalls = 0;
  driveState.createFolderCalls = 0;
  driveState.sharingCalls = 0;
  driveState.trashCalls = 0;
  driveState.seq = 0;
  driveState.folders['parent-1'] = {
    id: 'parent-1', name: 'Chapter', parentIds: [], fileIds: ['test-sheet'], folderIds: [],
  };
  driveState.folders['parent-2'] = {
    id: 'parent-2', name: 'Other', parentIds: [], fileIds: ['test-sheet'], folderIds: [],
  };
  driveState.files['test-sheet'] = {
    id: 'test-sheet',
    name: 'Recruitment Tracker',
    mime: 'application/vnd.google-apps.spreadsheet',
    bytes: [],
    parentIds: ['parent-1', 'parent-2'],
  };
}

function iterator(items) {
  let index = 0;
  return {
    hasNext() { return index < items.length; },
    next() {
      if (index >= items.length) throw new Error('no more');
      return items[index++];
    },
  };
}

function noteSharing() { driveState.sharingCalls += 1; }
function noteTrash() { driveState.trashCalls += 1; }

function fileApi(record) {
  return {
    getId() { return record.id; },
    getName() { return record.name; },
    getMimeType() { return record.mime; },
    getBlob() {
      driveState.blobReads += 1;
      return {
        getBytes() { return record.bytes; },
        getContentType() { return record.mime || 'image/jpeg'; },
        getName() { return record.name; },
      };
    },
    getParents() {
      return iterator(record.parentIds.map(id => folderApi(driveState.folders[id])));
    },
    setSharing: noteSharing,
    addViewer: noteSharing,
    setTrashed: noteTrash,
  };
}

function folderApi(record) {
  return {
    getId() { return record.id; },
    getName() { return record.name; },
    getFiles() {
      driveState.getFilesCalls += 1;
      return iterator(record.fileIds.map(id => fileApi(driveState.files[id])));
    },
    getFoldersByName(name) {
      const kids = record.folderIds
        .map(id => driveState.folders[id])
        .filter(folder => folder && folder.name === name);
      return iterator(kids.map(folderApi));
    },
    createFolder(name) {
      driveState.createFolderCalls += 1;
      driveState.seq += 1;
      const id = 'folder-' + driveState.seq;
      const folder = { id, name, parentIds: [record.id], fileIds: [], folderIds: [] };
      driveState.folders[id] = folder;
      record.folderIds.push(id);
      return folderApi(folder);
    },
    createFile(blob) {
      driveState.seq += 1;
      const id = 'upload-' + driveState.seq;
      const file = {
        id,
        name: blob.getName(),
        mime: blob.getContentType(),
        bytes: blob.getBytes(),
        parentIds: [record.id],
      };
      driveState.files[id] = file;
      record.fileIds.push(id);
      return fileApi(file);
    },
    setSharing: noteSharing,
  };
}

function seedPhotoFolder() {
  resetDrive();
  const folder = {
    id: 'photos-1',
    name: 'Recruit Photos',
    parentIds: ['parent-1'],
    fileIds: [],
    folderIds: [],
  };
  driveState.folders['photos-1'] = folder;
  driveState.folders['parent-1'].folderIds.push('photos-1');
  driveState.props.PHOTO_FOLDER_ID = 'photos-1';
  return folder;
}

function addDriveFile(parentId, name, mime, bytes) {
  driveState.seq += 1;
  const id = 'drv-' + driveState.seq;
  const file = {
    id,
    name,
    mime: mime || 'image/jpeg',
    bytes: bytes || [1, 2, 3, 4],
    parentIds: [parentId],
  };
  driveState.files[id] = file;
  const parent = driveState.folders[parentId];
  if (parent) parent.fileIds.push(id);
  return id;
}

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
    newBlob(data, mime, name) {
      return {
        getBytes() { return data; },
        getContentType() { return mime; },
        getName() { return name; },
      };
    },
    base64Decode(value) {
      return Array.from(Buffer.from(String(value), 'base64'));
    },
    base64Encode(bytes) {
      return Buffer.from(bytes).toString('base64');
    },
  },
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(key) {
          return Object.prototype.hasOwnProperty.call(driveState.props, key) ? driveState.props[key] : null;
        },
        setProperty(key, value) {
          driveState.props[key] = String(value);
        },
      };
    },
  },
  DriveApp: {
    getFileById(id) {
      driveState.fileLookups += 1;
      const record = driveState.files[id];
      if (!record) throw new Error('file not found');
      return fileApi(record);
    },
    getFolderById(id) {
      const record = driveState.folders[id];
      if (!record) throw new Error('folder not found');
      return folderApi(record);
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

const RECRUIT_HEADER = ['id', 'name', 'major', 'secondMajor', 'gradYear', 'photoFileId', 'photoSource'];
const OLD_RECRUIT_HEADER = ['id', 'name', 'major', 'photoUrl', 'secondMajor', 'minor', 'programLevel', 'gradTerm'];

test('ensureSheets rewrites an empty Recruits header and leaves rows that have data', () => {
  const ss = makeSs({}, { Recruits: OLD_RECRUIT_HEADER });
  api.ensureSheets(ss);
  const sheet = ss.getSheetByName('Recruits');
  let values = sheet.getDataRange().getValues();
  assert.deepEqual(values[0], [...RECRUIT_HEADER, '']);

  const before = JSON.parse(JSON.stringify(values));
  api.ensureSheets(ss);
  values = sheet.getDataRange().getValues();
  assert.deepEqual(values, before);

  const blanks = makeSs(
    { Recruits: [[' ', '', '', '', '', '', '', '']] },
    { Recruits: OLD_RECRUIT_HEADER },
  );
  api.ensureSheets(blanks);
  const blankHeader = blanks.getSheetByName('Recruits').getDataRange().getValues()[0];
  assert.deepEqual(blankHeader.slice(0, RECRUIT_HEADER.length), RECRUIT_HEADER);
  assert.ok(blankHeader.slice(RECRUIT_HEADER.length).every(cell => cell === ''));

  const kept = makeSs(
    { Recruits: [['r1', 'Ada', 'Finance (BSBA)', 'http://photo', 'Economics (BA)', 'Accounting', 'Undergraduate', 'Spring 2027']] },
    { Recruits: OLD_RECRUIT_HEADER },
  );
  api.ensureSheets(kept);
  const keptValues = kept.getSheetByName('Recruits').getDataRange().getValues();
  assert.deepEqual(keptValues[0], OLD_RECRUIT_HEADER);
  assert.equal(keptValues[1][1], 'Ada');
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
    secondMajor: ' Economics (BA) ',
    gradYear: ' 2027 ',
  });
  let values = ss.getSheetByName('Recruits').getDataRange().getValues();
  assert.deepEqual(values[0], RECRUIT_HEADER);
  assert.deepEqual(values[1], [
    created.id,
    'Ada Lovelace',
    'Finance (BSBA)',
    'Economics (BA)',
    '2027',
    '',
    '',
  ]);

  const blank = api.addRecruit(ss, { name: '  Bea  ', secondMajor: '  ', gradYear: '   ' });
  values = ss.getSheetByName('Recruits').getDataRange().getValues();
  assert.deepEqual(values[2], [blank.id, 'Bea', '', '', '', '', '']);

  const shifted = makeSs(
    { Recruits: [['Ada', 'r1', 'Finance (BSBA)']] },
    { Recruits: ['name', 'id', 'major', 'secondMajor', 'gradYear', 'photoFileId', 'photoSource'] },
  );
  api.ensureSheets(shifted);
  const extra = api.addRecruit(shifted, {
    name: 'Cyd',
    major: 'Marketing (BSBA)',
    secondMajor: 'Economics (BA)',
    gradYear: '2030',
  });
  const shiftedRows = shifted.getSheetByName('Recruits').getDataRange().getValues();
  assert.deepEqual(shiftedRows[0], ['name', 'id', 'major', 'secondMajor', 'gradYear', 'photoFileId', 'photoSource']);
  assert.deepEqual(shiftedRows[2], [
    'Cyd',
    extra.id,
    'Marketing (BSBA)',
    'Economics (BA)',
    '2030',
    '',
    '',
  ]);

  const admin = plain(api.getAdminData(ss));
  const ada = admin.recruits.find(recruit => recruit.id === created.id);
  assert.equal(ada.major, 'Finance (BSBA)');
  assert.equal(ada.secondMajor, 'Economics (BA)');
  assert.equal(ada.gradYear, '2027');
  assert.equal(ada.photoFileId, '');
  assert.equal(ada.photoSource, '');
  assert.equal(admin.recruits.find(recruit => recruit.id === blank.id).secondMajor, '');

  const vote = plain(api.getVoteData(ss, { email: 'Ada@chapter.org' }));
  const voted = vote.recruits.find(recruit => recruit.id === created.id);
  assert.equal(voted.major, 'Finance (BSBA)');
  assert.equal(voted.secondMajor, 'Economics (BA)');
  assert.equal(voted.gradYear, '2027');
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

function chapterSs(recruitRows) {
  return makeSs({
    Users: [
      ['ada@chapter.org', 'Ada', 'admin', 'yes'],
      ['bea@chapter.org', 'Bea', 'brother', 'yes'],
    ],
    Recruits: recruitRows || [],
  });
}

test('addRecruit stores an optional upload and deleteRecruit leaves the Drive file', () => {
  resetDrive();
  const ss = chapterSs();
  const bytes = Buffer.from('grace-photo');
  const created = api.addRecruit(ss, {
    name: 'Grace/Hopper',
    major: 'Marketing (BSBA)',
    gradYear: '2028',
    photoDataBase64: bytes.toString('base64'),
    photoMimeType: 'image/jpeg',
  });
  assert.equal(created.photoSource, 'upload');
  const file = driveState.files[created.photoFileId];
  assert.equal(file.name, 'Grace Hopper.jpg');
  assert.equal(file.mime, 'image/jpeg');
  assert.equal(Buffer.from(file.bytes).toString(), 'grace-photo');
  assert.equal(driveState.sharingCalls, 0);
  assert.equal(driveState.trashCalls, 0);
  const row = ss.getSheetByName('Recruits').getDataRange().getValues()[1];
  assert.equal(row[5], created.photoFileId);
  assert.equal(row[6], 'upload');

  api.deleteRecruit(ss, { id: created.id });
  assert.equal(ss.getSheetByName('Recruits').getLastRow(), 1);
  assert.ok(driveState.files[created.photoFileId]);
  assert.equal(driveState.trashCalls, 0);

  assert.throws(
    () => api.addRecruit(ss, { name: 'Big', major: 'X', photoDataBase64: 'a'.repeat(500001) }),
    /too large/,
  );
  assert.equal(ss.getSheetByName('Recruits').getLastRow(), 1);
});

test('uploadPhoto is admin-only and getPhotos will not read arbitrary files', () => {
  seedPhotoFolder();
  const ss = chapterSs([['r1', 'Ada Lovelace', 'Finance (BSBA)', '', '2027', '', '']]);
  const payload = Buffer.from('ada-photo').toString('base64');
  const uploaded = api.uploadPhoto(ss, { recruitId: 'r1', dataBase64: payload, mimeType: 'image/jpeg' });
  assert.equal(uploaded.photoSource, 'upload');
  assert.equal(driveState.files[uploaded.photoFileId].name, 'Ada Lovelace.jpg');
  const row = ss.getSheetByName('Recruits').getDataRange().getValues()[1];
  assert.equal(row[5], uploaded.photoFileId);
  assert.equal(row[6], 'upload');

  const missing = api.uploadPhoto(ss, { recruitId: 'nope', dataBase64: payload });
  assert.equal(missing.error, 'Recruit not found');

  const loose = addDriveFile('photos-1', 'mystery.png', 'image/png', [9, 8, 7]);
  driveState.files.outside = {
    id: 'outside',
    name: 'secret.png',
    mime: 'image/png',
    bytes: [5],
    parentIds: ['parent-2'],
  };
  driveState.blobReads = 0;
  driveState.fileLookups = 0;

  const brother = api.getPhotos(ss, { email: 'bea@chapter.org' }, {
    ids: [uploaded.photoFileId, loose, 'outside', uploaded.photoFileId],
  });
  assert.deepEqual(Object.keys(brother.photos), [uploaded.photoFileId]);
  assert.ok(brother.photos[uploaded.photoFileId].startsWith('data:image/jpeg;base64,'));
  assert.equal(Buffer.from(brother.photos[uploaded.photoFileId].split(',')[1], 'base64').toString(), 'ada-photo');
  assert.equal(driveState.blobReads, 1);

  const blocked = api.getPhotos(ss, { email: 'bea@chapter.org' }, { ids: [loose, 'outside'] });
  assert.deepEqual(plain(blocked.photos), {});
  assert.equal(driveState.blobReads, 1);

  const stranger = api.getPhotos(ss, { email: 'stranger@chapter.org' }, { ids: [uploaded.photoFileId] });
  assert.equal(stranger.error, 'Not authorized');
  assert.equal(driveState.blobReads, 1);

  const admin = api.getPhotos(ss, { email: 'ada@chapter.org' }, { ids: [loose] });
  assert.ok(admin.photos[loose].startsWith('data:image/png;base64,'));

  const ids = [];
  const recruitRows = [['r1', 'Ada Lovelace', 'Finance (BSBA)', '', '2027', uploaded.photoFileId, 'upload']];
  for (let i = 0; i < 24; i++) {
    const id = addDriveFile('photos-1', 'n' + i + '.jpg', 'image/jpeg', [i]);
    ids.push(id);
    recruitRows.push(['r' + i, 'Name ' + i, '', '', '', id, 'upload']);
  }
  const many = chapterSs(recruitRows);
  driveState.blobReads = 0;
  const capped = api.getPhotos(many, { email: 'bea@chapter.org' }, { ids: ids });
  assert.equal(Object.keys(capped.photos).length, 20);
  assert.equal(driveState.blobReads, 20);
  assert.equal(capped.photos[ids[20]], undefined);

  tokenUsers.bea = { email: 'bea@chapter.org', email_verified: 'true', name: 'Bea' };
  currentSs = ss;
  const denied = post('uploadPhoto', 'bea', { recruitId: 'r1', dataBase64: payload, mimeType: 'image/jpeg' });
  assert.equal(denied.error, 'Admin only');
  const syncDenied = post('syncPhotoFolder', 'bea');
  assert.equal(syncDenied.error, 'Admin only');
});

test('syncPhotoFolder auto-links a clear typo, reviews Smith versus Smyth, and skips uploads', () => {
  const folder = seedPhotoFolder();
  const ss = chapterSs([
    ['r-jane', 'Jane Smith', 'Finance (BSBA)', '', '2027', '', ''],
    ['r-smyth', 'Jane Smyth', 'Marketing (BSBA)', '', '2028', '', ''],
    ['r-ada', 'Ada Lovelace', 'Finance (BSBA)', '', '2027', 'keep-me', 'upload'],
  ]);
  addDriveFile(folder.id, 'Jane Smtih.jpg');
  addDriveFile(folder.id, 'Ada Lovelace.jpg');
  addDriveFile(folder.id, 'notes.pdf', 'application/pdf', [1]);
  driveState.files['keep-me'] = {
    id: 'keep-me', name: 'Ada Lovelace.jpg', mime: 'image/jpeg', bytes: [4], parentIds: [folder.id],
  };
  folder.fileIds.push('keep-me');

  driveState.blobReads = 0;
  driveState.getFilesCalls = 0;
  const first = plain(api.syncPhotoFolder(ss));
  assert.equal(driveState.blobReads, 0);
  assert.equal(driveState.getFilesCalls, 1);
  assert.equal(driveState.sharingCalls, 0);
  assert.equal(first.linked.length, 0);
  const janeFile = first.unmatched.find(item => item.fileName === 'Jane Smtih.jpg');
  assert.ok(janeFile);
  assert.deepEqual(janeFile.suggestions.map(item => item.name).sort(), ['Jane Smith', 'Jane Smyth']);
  assert.equal(first.unmatched.some(item => item.fileName === 'notes.pdf'), false);
  assert.equal(first.unmatched.some(item => item.fileId === 'keep-me'), false);
  const ada = ss.getSheetByName('Recruits').getDataRange().getValues().find(row => row[0] === 'r-ada');
  assert.equal(ada[5], 'keep-me');
  assert.equal(ada[6], 'upload');

  const clear = chapterSs([['r-jane', 'Jane Smith', 'Finance (BSBA)', '', '2027', '', '']]);
  const clearFolder = seedPhotoFolder();
  const typoId = addDriveFile(clearFolder.id, 'Jane Smtih.jpg');
  driveState.getFilesCalls = 0;
  const linked = plain(api.syncPhotoFolder(clear));
  assert.equal(linked.linked.length, 1);
  assert.equal(linked.linked[0].recruitId, 'r-jane');
  assert.equal(linked.linked[0].fileId, typoId);
  assert.ok(linked.linked[0].score >= 0.85);
  const jane = clear.getSheetByName('Recruits').getDataRange().getValues()[1];
  assert.equal(jane[5], typoId);
  assert.equal(jane[6], 'folder');
  assert.equal(driveState.getFilesCalls, 1);

  const again = api.syncPhotoFolder(clear);
  assert.equal(again.linked.length, 0);
  assert.equal(again.unmatched.length, 0);
  assert.equal(driveState.createFolderCalls, 0);
});

test('linkPhoto attaches a folder image and refuses files outside it or recruits who have a photo', () => {
  const folder = seedPhotoFolder();
  const ss = chapterSs([
    ['r-jane', 'Jane Smith', 'Finance (BSBA)', '', '2027', '', ''],
    ['r-ada', 'Ada Lovelace', 'Finance (BSBA)', '', '2027', 'old', 'upload'],
  ]);
  const fileId = addDriveFile(folder.id, 'portrait.png', 'image/png', [3, 3]);
  const linked = api.linkPhoto(ss, { fileId, recruitId: 'r-jane' });
  assert.deepEqual(plain(linked), { ok: true, photoFileId: fileId, photoSource: 'folder' });
  const jane = ss.getSheetByName('Recruits').getDataRange().getValues().find(row => row[0] === 'r-jane');
  assert.equal(jane[5], fileId);
  assert.equal(jane[6], 'folder');

  const again = api.linkPhoto(ss, { fileId, recruitId: 'r-jane' });
  assert.equal(again.error, 'Recruit already has a photo');
  const blocked = api.linkPhoto(ss, { fileId, recruitId: 'r-ada' });
  assert.equal(blocked.error, 'Recruit already has a photo');
  assert.equal(ss.getSheetByName('Recruits').getDataRange().getValues().find(row => row[0] === 'r-ada')[5], 'old');

  driveState.files.outside = {
    id: 'outside', name: 'Jane.jpg', mime: 'image/jpeg', bytes: [1], parentIds: ['parent-2'],
  };
  const outside = api.linkPhoto(ss, { fileId: 'outside', recruitId: 'r-jane' });
  assert.equal(outside.error, 'Photo is not in the Recruit Photos folder');
  assert.equal(driveState.trashCalls, 0);
  assert.equal(driveState.sharingCalls, 0);
});

test('getPhotoFolder creates Recruit Photos beside the spreadsheet and then reuses the id', () => {
  resetDrive();
  const ss = chapterSs();
  const created = plain(api.syncPhotoFolder(ss));
  assert.deepEqual(created, { linked: [], unmatched: [] });
  assert.equal(driveState.createFolderCalls, 1);
  const folder = Object.values(driveState.folders).find(item => item.name === 'Recruit Photos');
  assert.ok(folder);
  assert.deepEqual(folder.parentIds, ['parent-1']);
  assert.equal(driveState.props.PHOTO_FOLDER_ID, folder.id);
  const lookups = driveState.fileLookups;
  api.syncPhotoFolder(ss);
  assert.equal(driveState.createFolderCalls, 1);
  assert.equal(driveState.fileLookups, lookups);
});
