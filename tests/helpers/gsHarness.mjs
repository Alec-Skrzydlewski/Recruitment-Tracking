// Synthetic Apps Script runtime for Code.gs. Every Google service is an
// in-memory mock; nothing here can reach a real Sheet, Drive or Google API.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const codePath = require.resolve('../../apps-script/Code.gs');
const code = fs.readFileSync(codePath, 'utf8');

export const CLIENT_ID = 'test-client.apps.googleusercontent.com';
export const OWNER = 'owner@example.test';

export const SPEC = {
  Users: ['email', 'name', 'role', 'active'],
  Recruits: ['id', 'name', 'major', 'secondMajor', 'gradYear', 'photoFileId', 'photoSource'],
  Events: ['id', 'name'],
  EventRecruits: ['eventId', 'recruitId'],
  Votes: ['eventId', 'recruitId', 'userEmail', 'score', 'timestamp'],
  Notes: ['recruitId', 'content', 'updatedAt'],
};

export const stats = { formulaWrites: 0, writes: 0, reads: 0, cacheHits: 0 };

// Mimics Sheets: a string starting with "=" is stored as a formula unless it
// carries the leading apostrophe, which Sheets strips from the stored text.
function store(value) {
  stats.writes += 1;
  if (typeof value === 'string') {
    if (value.charAt(0) === "'") return value.slice(1);
    // Real Sheets turns a bare date-looking string into a Date cell.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T00:00:00Z');
    if (/^[=+\-@]/.test(value)) {
      stats.formulaWrites += 1;
      return { formula: value };
    }
  }
  return value;
}

export function makeSheet(rows) {
  return {
    rows,
    appendRow(row) { rows.push(Array.from(row).map(store)); },
    deleteRow(rowIndex) { rows.splice(rowIndex - 1, 1); },
    getLastRow() { return rows.length; },
    getLastColumn() { return rows.reduce((max, row) => Math.max(max, row.length), 0); },
    getDataRange() {
      return { getValues() { stats.reads += 1; return rows.map(row => row.slice()); } };
    },
    getRange(row, col, numRows, numCols) {
      const height = numRows == null ? 1 : numRows;
      const width = numCols == null ? 1 : numCols;
      return {
        setValue(value) {
          const target = rows[row - 1];
          while (target.length < col) target.push('');
          target[col - 1] = store(value);
        },
        setValues(values) {
          if (values.length !== height || values.some(v => v.length !== width)) throw new Error('range size mismatch');
          for (let r = 0; r < height; r++) {
            const target = rows[row - 1 + r];
            while (target.length < col - 1 + width) target.push('');
            for (let c = 0; c < width; c++) target[col - 1 + c] = store(values[r][c]);
          }
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

export function makeSs(seed = {}, headerOverrides = {}, omit = []) {
  const sheets = {};
  Object.keys(SPEC).forEach(name => {
    if (omit.includes(name)) return;
    const header = headerOverrides[name] || SPEC[name];
    sheets[name] = makeSheet([header.slice(), ...(seed[name] || []).map(row => row.slice())]);
  });
  return {
    sheets,
    getId() { return 'test-sheet'; },
    tz: 'America/Denver',
    getSpreadsheetTimeZone() { return this.tz; },
    getSheetByName(name) { return sheets[name] || null; },
    insertSheet(name) {
      sheets[name] = makeSheet([]);
      return sheets[name];
    },
  };
}

export const tokenClaims = {};
export const lockLog = [];
export const fetchLog = [];
export const cache = new Map();
export const props = {};
export const current = { ss: null, lockFails: false, tokeninfoDown: false, lockHeld: false, onLock: null };
export const cacheLog = [];

export const driveState = {
  files: {}, folders: {}, blobReads: 0, fileLookups: 0, getFilesCalls: 0,
  createFolderCalls: 0, sharingCalls: 0, trashCalls: 0, seq: 0, deny: false,
};

export function resetDrive() {
  Object.assign(driveState, {
    files: {}, folders: {}, blobReads: 0, fileLookups: 0, getFilesCalls: 0,
    createFolderCalls: 0, sharingCalls: 0, trashCalls: 0, seq: 0, deny: false,
  });
  delete props.PHOTO_FOLDER_ID;
  driveState.folders['parent-1'] = { id: 'parent-1', name: 'Workspace', parentIds: [], fileIds: ['test-sheet'], folderIds: [] };
  driveState.folders['parent-2'] = { id: 'parent-2', name: 'Other', parentIds: [], fileIds: ['test-sheet'], folderIds: [] };
  driveState.files['test-sheet'] = {
    id: 'test-sheet', name: 'Recruitment Tracker', mime: 'application/vnd.google-apps.spreadsheet', bytes: [], parentIds: ['parent-1', 'parent-2'],
  };
}

function iterator(items) {
  let index = 0;
  return {
    hasNext() { return index < items.length; },
    next() { if (index >= items.length) throw new Error('no more'); return items[index++]; },
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
      return { getBytes() { return record.bytes; }, getContentType() { return record.mime || 'image/jpeg'; }, getName() { return record.name; } };
    },
    getParents() { return iterator(record.parentIds.map(id => folderApi(driveState.folders[id]))); },
    setSharing: noteSharing, addViewer: noteSharing, setTrashed: noteTrash,
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
      return iterator(record.folderIds.map(id => driveState.folders[id]).filter(f => f && f.name === name).map(folderApi));
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
      driveState.files[id] = { id, name: blob.getName(), mime: blob.getContentType(), bytes: blob.getBytes(), parentIds: [record.id] };
      record.fileIds.push(id);
      return fileApi(driveState.files[id]);
    },
    setSharing: noteSharing,
  };
}

export function seedPhotoFolder() {
  resetDrive();
  const folder = { id: 'photos-1', name: 'Recruit Photos', parentIds: ['parent-1'], fileIds: [], folderIds: [] };
  driveState.folders['photos-1'] = folder;
  driveState.folders['parent-1'].folderIds.push('photos-1');
  props.PHOTO_FOLDER_ID = 'photos-1';
  return folder;
}

export function addDriveFile(parentId, name, mime, bytes) {
  driveState.seq += 1;
  const id = 'drv-' + driveState.seq;
  driveState.files[id] = { id, name, mime: mime || 'image/jpeg', bytes: bytes || [1, 2, 3, 4], parentIds: [parentId] };
  const parent = driveState.folders[parentId];
  if (parent) parent.fileIds.push(id);
  return id;
}

let uuidN = 0;

const sandbox = {
  module: { exports: {} },
  console: { error() {}, log() {} },
  SpreadsheetApp: {
    getActiveSpreadsheet() {
      if (!current.ss) throw new Error('no active spreadsheet');
      return current.ss;
    },
  },
  LockService: {
    getScriptLock() {
      return {
        waitLock(ms) {
          if (current.lockFails) throw new Error('Lock timeout: another process was holding the lock');
          if (current.lockHeld) throw new Error('nested lock: Apps Script locks are not reentrant');
          // Hook runs "while waiting": simulates another request committing first.
          const hook = current.onLock;
          current.onLock = null;
          if (hook) hook();
          current.lockHeld = true;
          lockLog.push(['wait', ms]);
        },
        releaseLock() { current.lockHeld = false; lockLog.push(['release']); },
      };
    },
  },
  UrlFetchApp: {
    fetch(url, options) {
      fetchLog.push({ url, options });
      if (current.tokeninfoDown) throw new Error('Address unavailable');
      const token = decodeURIComponent(String(url).split('id_token=')[1] || '');
      const claims = tokenClaims[token];
      return {
        getResponseCode() { return claims ? 200 : 400; },
        getContentText() { return JSON.stringify(claims || { error: 'invalid_token' }); },
      };
    },
  },
  CacheService: {
    getScriptCache() {
      return {
        get(key) { cacheLog.push(['get', key, current.lockHeld]); const v = cache.has(key) ? cache.get(key) : null; if (v) stats.cacheHits += 1; return v; },
        put(key, value) { cacheLog.push(['put', key, current.lockHeld]); cache.set(key, value); },
      };
    },
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput(text) { const out = { text, setMimeType() { return out; } }; return out; },
  },
  Utilities: {
    formatDate(date, tz, pattern) {
      if (pattern !== 'yyyy-MM-dd') throw new Error('unsupported pattern ' + pattern);
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    },
    getUuid() { uuidN += 1; return `uuid-${uuidN}`; },
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest(alg, value) {
      return Array.from(crypto.createHash(alg).update(String(value), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b));
    },
    newBlob(data, mime, name) { return { getBytes() { return data; }, getContentType() { return mime; }, getName() { return name; } }; },
    base64Decode(value) { return Array.from(Buffer.from(String(value), 'base64')); },
    base64Encode(bytes) { return Buffer.from(bytes).toString('base64'); },
  },
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(key) { return Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null; },
        setProperty(key, value) { props[key] = String(value); },
      };
    },
  },
  DriveApp: {
    getFileById(id) {
      driveState.fileLookups += 1;
      if (driveState.deny) throw new Error('Exception: You do not have permission to call DriveApp.getFileById. Required permissions: https://www.googleapis.com/auth/drive');
      const record = driveState.files[id];
      if (!record) throw new Error('file not found');
      return fileApi(record);
    },
    getFolderById(id) {
      if (driveState.deny) throw new Error('Exception: You do not have permission to call DriveApp.getFolderById.');
      const record = driveState.folders[id];
      if (!record) throw new Error('folder not found');
      return folderApi(record);
    },
  },
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: codePath });
export const api = sandbox.module.exports;

export function configure({ clientId = CLIENT_ID, owner = OWNER } = {}) {
  if (clientId == null) delete props.GOOGLE_CLIENT_ID; else props.GOOGLE_CLIENT_ID = clientId;
  if (owner == null) delete props.OWNER_EMAIL; else props.OWNER_EMAIL = owner;
}
configure();

export function claims(email, extra = {}) {
  return {
    aud: CLIENT_ID,
    iss: 'https://accounts.google.com',
    email,
    email_verified: 'true',
    exp: String(Math.floor(Date.now() / 1000) + 3600),
    name: email.split('@')[0],
    ...extra,
  };
}

export function token(name, email, extra) {
  tokenClaims[name] = claims(email, extra);
  return name;
}

export function post(action, tok, extra = {}) {
  const out = api.doPost({
    postData: { contents: JSON.stringify({ apiVersion: api.API_VERSION, action, token: tok, ...extra }) },
  });
  return JSON.parse(out.text);
}

export function rawPost(body) {
  return JSON.parse(api.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);
}

export function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

export function rowsOf(ss, name) {
  return plain(ss.getSheetByName(name).rows);
}

export function snapshot(ss) {
  const out = {};
  Object.keys(ss.sheets).forEach(name => { out[name] = rowsOf(ss, name); });
  return out;
}

// A small, fully fictional workspace.
export function workspace(extra = {}) {
  const seed = {
    Users: [
      [OWNER, 'Owner', 'admin', 'yes'],
      ['member@example.test', 'Member', 'brother', 'yes'],
      ['former@example.test', 'Former', 'brother', 'no'],
    ],
    Recruits: [
      ['rec-1', 'Avery Quill', 'Accountancy (BSAcc)', '', '2028', '', ''],
      ['rec-2', 'Blake Ember', 'Finance (BSBA)', '', '2027', '', ''],
    ],
    Events: [['evt-1', 'Info Night'], ['evt-2', 'Case Night']],
    EventRecruits: [['evt-1', 'rec-1'], ['evt-2', 'rec-2']],
    Votes: [],
    Notes: [],
    ...extra,
  };
  return makeSs(seed);
}
