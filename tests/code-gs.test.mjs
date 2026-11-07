// Behavior/parity tests for apps-script/Code.gs against synthetic mocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  api, makeSs, workspace, post, token, plain, rowsOf, lockLog, current, OWNER,
  driveState, resetDrive, seedPhotoFolder, addDriveFile, SPEC,
} from './helpers/gsHarness.mjs';

const ADMIN = { email: OWNER };

test('loading Code.gs does not touch SpreadsheetApp', () => {
  assert.equal(typeof api.doPost, 'function');
  assert.equal(lockLog.length, 0);
});

test('notes with only recruitId read back and saveNote upserts by name-indexed columns', () => {
  const ss = workspace({ Notes: [['', '', ''], ['rec-1', 'Asked good questions', '2026-01-01']] });
  const saved = api.saveNote(ss, { recruitId: 'rec-2', content: 'Follow up Monday' });
  assert.equal(saved.ok, true);
  const notes = plain(api.getAdminData(ss).notes);
  assert.equal(notes.length, 2);
  assert.equal(notes.find(n => n.recruitId === 'rec-2').content, 'Follow up Monday');
  api.saveNote(ss, { recruitId: 'rec-1', content: 'Updated' });
  assert.equal(plain(api.getAdminData(ss).notes).find(n => n.recruitId === 'rec-1').content, 'Updated');
  const missing = api.saveNote(ss, { recruitId: 'rec-404', content: 'x' });
  assert.equal(missing.code, 'NOT_FOUND');
});

test('castVote updates the existing row, deletes duplicates and holds one lock', () => {
  const ss = workspace({
    EventRecruits: [['evt-1', 'rec-1'], ['evt-1', 'rec-2']],
    Votes: [
      ['evt-1', 'rec-1', 'member@example.test', 3, 't1'],
      ['evt-1', 'rec-2', 'member@example.test', 5, 't2'],
      ['evt-1', 'rec-1', 'Member@example.test', 4, 't3'],
    ],
  });
  assert.equal(api.castVote(ss, { email: 'member@example.test' }, { eventId: 'evt-1', recruitId: 'rec-1', score: 3.5 }).error, 'Invalid vote');
  lockLog.length = 0;
  const result = plain(api.castVote(ss, { email: 'member@example.test' }, { eventId: 'evt-1', recruitId: 'rec-1', score: '9' }));
  assert.equal(result.ok, true);
  const votes = plain(api.getAdminData(ss).votes);
  assert.equal(votes.length, 2);
  const kept = votes.filter(v => v.recruitId === 'rec-1');
  assert.equal(kept.length, 1);
  assert.equal(kept[0].score, 9);
  assert.equal(votes.find(v => v.recruitId === 'rec-2').score, 5);
  assert.deepEqual(lockLog.filter(e => e[0] === 'wait'), [['wait', 10000]]);
  assert.equal(lockLog.filter(e => e[0] === 'release').length, 1);
});

test('manageUser add rejects an existing email, validates input and role', () => {
  const ss = workspace();
  assert.equal(api.manageUser(ss, ADMIN, { op: 'add', email: 'MEMBER@example.test' }).error, 'User already exists');
  assert.equal(api.manageUser(ss, ADMIN, { op: 'add', email: 'not-an-email' }).code, 'INVALID');
  assert.equal(api.manageUser(ss, ADMIN, { op: 'add', email: 'x@example.test', role: 'owner' }).code, 'INVALID');
  assert.throws(() => api.manageUser(ss, ADMIN, { op: 'add', email: 'x@example.test', name: 'n'.repeat(121) }), /too long/);
  assert.equal(api.manageUser(ss, ADMIN, { op: 'setRole', email: 'member@example.test', role: 'superuser' }).code, 'INVALID');
  assert.equal(rowsOf(ss, 'Users').length, 4);
  assert.equal(api.manageUser(ss, ADMIN, { op: 'add', email: 'New@Example.test' }).ok, true);
  assert.deepEqual(rowsOf(ss, 'Users')[4], ['new@example.test', 'new@example.test', 'brother', 'yes']);
});

test('manageUser refuses self-removal and protects the last active admin', () => {
  const ss = workspace();
  assert.equal(api.manageUser(ss, { email: 'Owner@example.test' }, { op: 'remove', email: OWNER }).error, 'You cannot remove yourself');
  assert.equal(api.manageUser(ss, { email: 'member@example.test' }, { op: 'remove', email: OWNER }).error, 'Cannot remove the last admin');
  assert.equal(api.manageUser(ss, ADMIN, { op: 'setRole', email: OWNER, role: 'brother' }).error, 'Cannot demote the last admin');
  assert.equal(rowsOf(ss, 'Users')[1][2], 'admin');
  assert.equal(api.manageUser(ss, ADMIN, { op: 'setRole', email: 'member@example.test', role: 'admin' }).ok, true);
  assert.equal(api.manageUser(ss, ADMIN, { op: 'setRole', email: 'member@example.test', role: 'brother' }).ok, true);
  assert.equal(api.manageUser(ss, ADMIN, { op: 'remove', email: 'former@example.test' }).ok, true);
  assert.equal(rowsOf(ss, 'Users').length, 3);
});

const RECRUIT_HEADER = SPEC.Recruits;
const OLD_RECRUIT_HEADER = ['id', 'name', 'major', 'photoUrl', 'secondMajor', 'minor', 'programLevel', 'gradTerm'];

test('setupSchema rewrites an empty legacy Recruits header and leaves sheets with data alone', () => {
  const ss = makeSs({}, { Recruits: OLD_RECRUIT_HEADER });
  api.setupSchema(ss);
  let values = rowsOf(ss, 'Recruits');
  assert.deepEqual(values[0], [...RECRUIT_HEADER, '']);
  const before = plain(values);
  api.setupSchema(ss);
  assert.deepEqual(rowsOf(ss, 'Recruits'), before);

  const kept = makeSs(
    { Recruits: [['r1', 'Avery', 'Finance (BSBA)', 'http://photo', 'Economics (BA)', 'Accounting', 'Undergraduate', 'Spring 2027']] },
    { Recruits: OLD_RECRUIT_HEADER },
  );
  api.setupSchema(kept);
  const keptValues = rowsOf(kept, 'Recruits');
  // Data rows are never rewritten; missing columns are appended after the old ones.
  assert.deepEqual(keptValues[0], [...OLD_RECRUIT_HEADER, 'gradYear', 'photoFileId', 'photoSource']);
  assert.equal(keptValues[1][1], 'Avery');
});

test('setupSchema creates every missing sheet with the current header', () => {
  const sheets = {};
  const ss = {
    getSheetByName(name) { return sheets[name] || null; },
    insertSheet(name) { sheets[name] = { rows: [], appendRow(r) { this.rows.push(r); }, getLastRow() { return this.rows.length; } }; return sheets[name]; },
  };
  const result = plain(api.setupSchema(ss));
  assert.deepEqual(result.created.sort(), Object.keys(SPEC).sort());
  assert.deepEqual(plain(sheets.Recruits.rows[0]), RECRUIT_HEADER);
  assert.deepEqual(plain(sheets.Users.rows[0]), SPEC.Users);
});

test('addRecruit writes trimmed fields by header name, including reordered headers', () => {
  const ss = workspace();
  const created = api.addRecruit(ss, { name: '  Casey Lark ', major: ' Finance (BSBA) ', secondMajor: ' Economics (BA) ', gradYear: ' 2027 ' });
  const values = rowsOf(ss, 'Recruits');
  assert.deepEqual(values[3], [created.id, 'Casey Lark', 'Finance (BSBA)', 'Economics (BA)', '2027', '', '']);

  const shifted = makeSs(
    { Recruits: [['Dana', 'r1', 'Finance (BSBA)']] },
    { Recruits: ['name', 'id', 'major', 'secondMajor', 'gradYear', 'photoFileId', 'photoSource', 'legacy'] },
  );
  const extra = api.addRecruit(shifted, { name: 'Cyd', major: 'Marketing (BSBA)', gradYear: '2030' });
  assert.deepEqual(rowsOf(shifted, 'Recruits')[2], ['Cyd', extra.id, 'Marketing (BSBA)', '', '2030', '', '', '']);
  const read = plain(api.getAdminData(shifted).recruits);
  assert.equal(read.find(r => r.id === 'r1').name, 'Dana');
});

test('addRecruit rejects invalid fields without writing', () => {
  const ss = workspace();
  const before = rowsOf(ss, 'Recruits');
  assert.throws(() => api.addRecruit(ss, { name: '', major: 'X' }), /Name is required/);
  assert.throws(() => api.addRecruit(ss, { name: 'A', major: '' }), /Major is required/);
  assert.throws(() => api.addRecruit(ss, { name: 'A'.repeat(121), major: 'X' }), /too long/);
  assert.throws(() => api.addRecruit(ss, { name: 'A', major: 'X', gradYear: '27' }), /4-digit/);
  assert.equal(api.addRecruit(ss, { name: 'A', major: 'Finance', secondMajor: 'finance' }).code, 'INVALID');
  assert.deepEqual(rowsOf(ss, 'Recruits'), before);
});

test('addRecruit stores an optional upload and deleteRecruit leaves the Drive file', () => {
  resetDrive();
  const ss = workspace();
  const created = api.addRecruit(ss, { name: 'Grace/Hopper', major: 'Marketing (BSBA)', gradYear: '2028', photoDataBase64: Buffer.from('photo').toString('base64') });
  assert.equal(created.photoSource, 'upload');
  const file = driveState.files[created.photoFileId];
  assert.equal(file.name, 'Grace Hopper.jpg');
  assert.equal(Buffer.from(file.bytes).toString(), 'photo');
  assert.equal(driveState.sharingCalls, 0);
  api.deleteRecruit(ss, { id: created.id });
  assert.equal(rowsOf(ss, 'Recruits').length, 3);
  assert.ok(driveState.files[created.photoFileId]);
  assert.equal(driveState.trashCalls, 0);
  assert.throws(() => api.addRecruit(ss, { name: 'Big', major: 'X', photoDataBase64: 'a'.repeat(500001) }), /too large/);
  assert.equal(rowsOf(ss, 'Recruits').length, 3);
});

test('uploadPhoto is admin-only and getPhotos will not read arbitrary files', () => {
  seedPhotoFolder();
  const ss = workspace();
  const payload = Buffer.from('avery-photo').toString('base64');
  const uploaded = api.uploadPhoto(ss, { recruitId: 'rec-1', dataBase64: payload });
  assert.equal(uploaded.photoSource, 'upload');
  assert.equal(driveState.files[uploaded.photoFileId].name, 'Avery Quill.jpg');
  assert.equal(api.uploadPhoto(ss, { recruitId: 'nope', dataBase64: payload }).error, 'Recruit not found');

  const loose = addDriveFile('photos-1', 'mystery.png', 'image/png', [9, 8, 7]);
  driveState.files.outside = { id: 'outside', name: 'secret.png', mime: 'image/png', bytes: [5], parentIds: ['parent-2'] };
  driveState.blobReads = 0;
  const member = { email: 'member@example.test', role: 'brother' };
  const brother = api.getPhotos(ss, member, { ids: [uploaded.photoFileId, loose, 'outside', uploaded.photoFileId] });
  assert.deepEqual(Object.keys(brother.photos), [uploaded.photoFileId]);
  assert.equal(Buffer.from(brother.photos[uploaded.photoFileId].split(',')[1], 'base64').toString(), 'avery-photo');
  assert.equal(driveState.blobReads, 1);
  const admin = api.getPhotos(ss, { email: OWNER, role: 'admin' }, { ids: [loose, 'outside'] });
  assert.ok(admin.photos[loose].startsWith('data:image/png;base64,'));
  assert.equal(admin.photos.outside, undefined);

  const ids = [];
  const rows = [];
  for (let i = 0; i < 24; i++) {
    const id = addDriveFile('photos-1', 'n' + i + '.jpg');
    ids.push(id);
    rows.push(['r' + i, 'Name ' + i, 'X', '', '', id, 'upload']);
  }
  const many = workspace({ Recruits: rows });
  driveState.blobReads = 0;
  const capped = api.getPhotos(many, member, { ids });
  assert.equal(Object.keys(capped.photos).length, 20);
  assert.equal(driveState.blobReads, 20);

  current.ss = ss;
  token('member', 'member@example.test');
  assert.equal(post('uploadPhoto', 'member', { recruitId: 'rec-1', dataBase64: payload }).error, 'Admin only');
  assert.equal(post('syncPhotoFolder', 'member').error, 'Admin only');
});

test('syncPhotoFolder auto-links a clear typo, reviews Smith versus Smyth, and skips uploads', () => {
  const folder = seedPhotoFolder();
  const ss = workspace({ Recruits: [
    ['r-jane', 'Jane Smith', 'Finance (BSBA)', '', '2027', '', ''],
    ['r-smyth', 'Jane Smyth', 'Marketing (BSBA)', '', '2028', '', ''],
    ['r-ada', 'Ada Lovelace', 'Finance (BSBA)', '', '2027', 'keep-me', 'upload'],
  ] });
  addDriveFile(folder.id, 'Jane Smtih.jpg');
  addDriveFile(folder.id, 'notes.pdf', 'application/pdf', [1]);
  driveState.files['keep-me'] = { id: 'keep-me', name: 'Ada Lovelace.jpg', mime: 'image/jpeg', bytes: [4], parentIds: [folder.id] };
  folder.fileIds.push('keep-me');
  driveState.blobReads = 0;
  driveState.getFilesCalls = 0;
  const first = plain(api.syncPhotoFolder(ss));
  assert.equal(driveState.blobReads, 0);
  assert.equal(driveState.getFilesCalls, 1);
  assert.equal(first.linked.length, 0);
  const janeFile = first.unmatched.find(item => item.fileName === 'Jane Smtih.jpg');
  assert.deepEqual(janeFile.suggestions.map(item => item.name).sort(), ['Jane Smith', 'Jane Smyth']);
  assert.equal(first.unmatched.some(item => item.fileName === 'notes.pdf'), false);
  assert.equal(first.unmatched.some(item => item.fileId === 'keep-me'), false);

  const clearFolder = seedPhotoFolder();
  const clear = workspace({ Recruits: [['r-jane', 'Jane Smith', 'Finance (BSBA)', '', '2027', '', '']] });
  const typoId = addDriveFile(clearFolder.id, 'Jane Smtih.jpg');
  const linked = plain(api.syncPhotoFolder(clear));
  assert.equal(linked.linked.length, 1);
  assert.equal(linked.linked[0].fileId, typoId);
  const jane = rowsOf(clear, 'Recruits')[1];
  assert.equal(jane[5], typoId);
  assert.equal(jane[6], 'folder');
  const again = api.syncPhotoFolder(clear);
  assert.equal(again.linked.length, 0);
  assert.equal(driveState.createFolderCalls, 0);
});

test('linkPhoto attaches a folder image and refuses files outside it or recruits who have a photo', () => {
  const folder = seedPhotoFolder();
  const ss = workspace({ Recruits: [
    ['r-jane', 'Jane Smith', 'Finance (BSBA)', '', '2027', '', ''],
    ['r-ada', 'Ada Lovelace', 'Finance (BSBA)', '', '2027', 'old', 'upload'],
  ] });
  const fileId = addDriveFile(folder.id, 'portrait.png', 'image/png', [3, 3]);
  assert.deepEqual(plain(api.linkPhoto(ss, { fileId, recruitId: 'r-jane' })), { ok: true, photoFileId: fileId, photoSource: 'folder' });
  assert.equal(api.linkPhoto(ss, { fileId, recruitId: 'r-jane' }).error, 'Recruit already has a photo');
  assert.equal(api.linkPhoto(ss, { fileId, recruitId: 'r-ada' }).error, 'Recruit already has a photo');
  driveState.files.outside = { id: 'outside', name: 'Jane.jpg', mime: 'image/jpeg', bytes: [1], parentIds: ['parent-2'] };
  assert.equal(api.linkPhoto(ss, { fileId: 'outside', recruitId: 'r-jane' }).error, 'Photo is not in the Recruit Photos folder');
  assert.equal(driveState.trashCalls + driveState.sharingCalls, 0);
});

test('explicit sync creates Recruit Photos beside the spreadsheet once; photo reads never create it', () => {
  resetDrive();
  const ss = workspace({ Recruits: [] });
  const read = api.getPhotos(ss, { email: OWNER, role: 'admin' }, { ids: ['drv-x'] });
  assert.deepEqual(plain(read.photos), {});
  assert.equal(driveState.createFolderCalls, 0);
  assert.deepEqual(plain(api.syncPhotoFolder(ss)), { linked: [], unmatched: [] });
  assert.equal(driveState.createFolderCalls, 1);
  const folder = Object.values(driveState.folders).find(item => item.name === 'Recruit Photos');
  assert.deepEqual(folder.parentIds, ['parent-1']);
  const lookups = driveState.fileLookups;
  api.syncPhotoFolder(ss);
  assert.equal(driveState.createFolderCalls, 1);
  assert.equal(driveState.fileLookups, lookups);
});
