// Editor-only consent helper: requests only the existing Drive scope and
// touches no Drive, Spreadsheet, properties, cache or lock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { api, post, token, workspace, current, configure, OWNER, driveState, resetDrive, props, stats, lockLog, cacheLog, scriptAppLog, scriptAppState } from './helpers/gsHarness.mjs';

const DRIVE = 'https://www.googleapis.com/auth/drive';

test('manifest already lists the Drive scope the helper requests', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../apps-script/appsscript.json', import.meta.url)));
  assert.ok(manifest.oauthScopes.includes(DRIVE));
});

test('authorizeDrive requests only the existing Drive scope and touches nothing else', () => {
  resetDrive(); scriptAppLog.length = 0; scriptAppState.missing = false; lockLog.length = 0;
  current.ss = null;
  const propsBefore = JSON.stringify(props);
  const statsBefore = JSON.stringify(stats);
  const cacheBefore = cacheLog.length;
  assert.equal(api.authorizeDrive(), 'Drive access granted');
  assert.deepEqual(scriptAppLog, [['FULL', [DRIVE]]]);
  assert.equal(driveState.fileLookups, 0);
  assert.equal(driveState.createFolderCalls, 0);
  assert.equal(JSON.stringify(props), propsBefore);
  assert.equal(JSON.stringify(stats), statsBefore);
  assert.equal(cacheLog.length, cacheBefore);
  assert.equal(lockLog.length, 0);
});

test('when consent is missing, requireScopes stops the run before anything else', () => {
  resetDrive(); scriptAppLog.length = 0; scriptAppState.missing = true;
  assert.throws(() => api.authorizeDrive(), /Authorization is required/);
  assert.equal(scriptAppLog.length, 1);
  assert.equal(driveState.fileLookups, 0);
  scriptAppState.missing = false;
});

test('authorizeDrive is not reachable through the web app', () => {
  configure(); resetDrive(); current.ss = workspace(); token('owner', OWNER);
  scriptAppLog.length = 0;
  assert.equal(post('authorizeDrive', 'owner').code, 'UNKNOWN_ACTION');
  assert.equal(scriptAppLog.length, 0);
});
