// Drive failure diagnostics: step label + bounded category in the server log,
// never the raw message, IDs, names or emails; UI error stays generic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, post, token, rowsOf, snapshot, workspace, current, configure, OWNER, driveState, resetDrive, seedPhotoFolder, warnLog, props } from './helpers/gsHarness.mjs';

const GENERIC = 'Recruit photos are unavailable right now. The script owner may need to re-authorize Drive access. Everything else still works.';
const SECRETY = 'secret-folder-XYZ member@example.test /My Drive/Private';

function fresh() {
  configure(); resetDrive();
  current.ss = workspace();
  current.lockFails = false; current.tokeninfoDown = false; current.onLock = null; current.lockHeld = false;
  token('owner', OWNER); token('member', 'member@example.test');
  return current.ss;
}

function assertClean(res) {
  assert.equal(res.code, 'PHOTO_UNAVAILABLE');
  assert.equal(res.error, GENERIC);
  for (const line of warnLog) {
    assert.match(line, /^PHOTO_DRIVE_FAILURE op=[A-Za-z]+ category=[A-Z_]+$/);
    assert.doesNotMatch(line, /secret|example\.test|My Drive|test-sheet|parent-1|DriveApp|googleapis/);
  }
}

test('missing Drive grant on sync logs openSheetFile / SCOPE_NOT_GRANTED, generic UI, no writes', () => {
  const ss = fresh();
  driveState.deny = true;
  const before = snapshot(ss);
  const res = post('syncPhotoFolder', 'owner');
  assertClean(res);
  assert.deepEqual(warnLog, ['PHOTO_DRIVE_FAILURE op=openSheetFile category=SCOPE_NOT_GRANTED']);
  assert.deepEqual(snapshot(ss), before);
  assert.equal(driveState.createFolderCalls, 0);
  assert.equal(props.PHOTO_FOLDER_ID, undefined);
});

test('each Drive step is labelled; raw messages with private values are never logged', () => {
  const cases = [
    ['getParents', 'Access denied: DriveApp. ' + SECRETY, 'listSheetParents', 'ACCESS_DENIED'],
    ['getFoldersByName', 'Service error: Drive ' + SECRETY, 'findPhotoFolder', 'SERVICE_ERROR'],
    ['createFolder', 'Access denied: DriveApp. ' + SECRETY, 'createPhotoFolder', 'ACCESS_DENIED'],
    ['createFolder', 'Service invoked too many times for one day: driveapp. ' + SECRETY, 'createPhotoFolder', 'QUOTA'],
    ['createFolder', 'weird ' + SECRETY, 'createPhotoFolder', 'OTHER'],
  ];
  for (const [where, msg, op, cat] of cases) {
    const ss = fresh();
    driveState.throwOn = { [where]: msg };
    const before = snapshot(ss);
    const res = post('syncPhotoFolder', 'owner');
    assertClean(res);
    assert.deepEqual(warnLog, [`PHOTO_DRIVE_FAILURE op=${op} category=${cat}`], where + ' ' + cat);
    assert.deepEqual(snapshot(ss), before);
  }
});

test('listing files and upload create are labelled', () => {
  let ss = fresh(); seedPhotoFolder(); driveState.throwOn = { getFiles: 'Exception: Unexpected error ' + SECRETY };
  assertClean(post('syncPhotoFolder', 'owner'));
  assert.deepEqual(warnLog, ['PHOTO_DRIVE_FAILURE op=listPhotoFiles category=OTHER']);
  ss = fresh(); seedPhotoFolder(); driveState.throwOn = { createFile: 'Exception: Access denied ' + SECRETY };
  const before = snapshot(ss);
  const res = post('uploadPhoto', 'owner', { recruitId: 'rec-1', dataBase64: 'AAAA', mimeType: 'image/jpeg' });
  assertClean(res);
  assert.deepEqual(warnLog, ['PHOTO_DRIVE_FAILURE op=createPhotoFile category=ACCESS_DENIED']);
  assert.deepEqual(rowsOf(ss, 'Recruits'), before.Recruits);
});

test('stale cached folder id is logged without blocking the fallback lookup', () => {
  fresh(); seedPhotoFolder();
  props.PHOTO_FOLDER_ID = 'gone-folder';
  const res = post('syncPhotoFolder', 'owner');
  assert.equal(res.error, undefined, JSON.stringify(res));
  assert.deepEqual(warnLog, ['PHOTO_DRIVE_FAILURE op=openCachedFolder category=NOT_FOUND']);
  assert.equal(props.PHOTO_FOLDER_ID, 'photos-1');
});

test('reads stay read-only and do not create a folder; healthy sync logs nothing', () => {
  const ss = fresh();
  const before = snapshot(ss);
  post('getAdminData', 'owner');
  post('getPhotos', 'owner', { ids: ['x1'] });
  assert.equal(driveState.createFolderCalls, 0);
  assert.deepEqual(snapshot(ss), before);
  assert.equal(post('syncPhotoFolder', 'owner').error, undefined);
  assert.deepEqual(warnLog, []);
});

test('non-admins cannot trigger the Drive steps', () => {
  fresh(); driveState.deny = true;
  const res = post('syncPhotoFolder', 'member');
  assert.notEqual(res.code, 'PHOTO_UNAVAILABLE');
  assert.deepEqual(warnLog, []);
});

test('classifier is bounded', () => {
  assert.equal(api.classifyDriveError(new Error('You do not have permission to call DriveApp.getFileById. Required permissions: https://www.googleapis.com/auth/drive')), 'SCOPE_NOT_GRANTED');
  assert.equal(api.classifyDriveError(null), 'OTHER');
  assert.equal(api.classifyDriveError({ get message() { throw new Error('x'); } }), 'OTHER');
});
