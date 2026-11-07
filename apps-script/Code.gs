// Recruitment Tracker — Google Apps Script backend.
//
// Deploy from the bound Sheet (Extensions → Apps Script) as a Web app:
// Execute as: Me · Who has access: Anyone. "Anyone" only means the endpoint is
// reachable; every action below still requires a Google ID token that was
// issued to THIS app's OAuth client (aud check) for an active Users row.
//
// Required Script Properties (Project Settings → Script properties):
//   GOOGLE_CLIENT_ID  OAuth web client ID the frontend signs in with (expected aud)
//   OWNER_EMAIL       Google account allowed to initialize the schema and become
//                     the first admin. Nobody else can claim an empty deployment.
// The backend fails closed when either is missing. See README "Backend setup".

const API_VERSION = 2;
const SCHEMA_VERSION = 2;
const LOCK_WAIT_MS = 10000;
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const MAX_TOKEN_LENGTH = 4096;

const SCHEMA = {
  Users: ['email', 'name', 'role', 'active'],
  Recruits: ['id', 'name', 'major', 'secondMajor', 'gradYear', 'photoFileId', 'photoSource'],
  Events: ['id', 'name'],
  EventRecruits: ['eventId', 'recruitId'],
  Votes: ['eventId', 'recruitId', 'userEmail', 'score', 'timestamp'],
  Notes: ['recruitId', 'content', 'updatedAt'],
};
// Optional columns: read when the header has them, never required, never
// added by setup or by a read. Events.date (YYYY-MM-DD) is added to the
// header only when an admin saves the first dated event (under the lock).
const OPTIONAL = { Events: ['date'] };
const ROLES = ['admin', 'brother'];
const LIMITS = { name: 120, major: 120, note: 5000, email: 254, id: 64 };

// ---------- errors ----------

// Errors with a public message and stable code. Anything else is reported as
// a generic server error so stack details and Google service text never reach
// the browser.
function appError(code, message) {
  const err = new Error(message);
  err.publicCode = code;
  return err;
}

function errorResult(code, message) {
  return { error: message, code: code };
}

// ---------- entry point ----------

const MEMBER_ACTIONS = {
  getMe: true, getVoteData: true, castVote: true, getPhotos: true,
};
const ADMIN_ACTIONS = {
  getAdminData: true, addRecruit: true, deleteRecruit: true, uploadPhoto: true,
  syncPhotoFolder: true, linkPhoto: true, addEvent: true, deleteEvent: true,
  setAttendance: true, saveNote: true, manageUser: true, wipeCycle: true,
  getVoteCleanup: true, cleanupInvalidVotes: true, checkPhotoAccess: true,
};

function doPost(e) {
  try {
    let body;
    try {
      body = JSON.parse(e && e.postData ? e.postData.contents : '');
    } catch (parseErr) {
      return json(errorResult('BAD_REQUEST', 'Malformed request'));
    }
    if (!body || typeof body !== 'object') return json(errorResult('BAD_REQUEST', 'Malformed request'));
    if (body.apiVersion !== API_VERSION) {
      return json(errorResult('VERSION', 'This page is out of date. Refresh to load the current version.'));
    }
    const config = readConfig();
    const user = verifyToken(body.token, config.clientId);
    if (!user) return json(errorResult('AUTH', 'Invalid or expired login'));
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return json(dispatch(ss, user, config, String(body.action || ''), body) || { ok: true });
  } catch (err) {
    if (err && err.publicCode) {
      const out = errorResult(err.publicCode, err.message);
      // Bounded tokens only (step label + category), never raw Google text.
      if (err.photoDiagnostic) out.diagnostic = err.photoDiagnostic;
      return json(out);
    }
    try { console.error(err && err.stack ? err.stack : err); } catch (logErr) { /* ignore */ }
    return json(errorResult('INTERNAL', 'Something went wrong on the server. Try again.'));
  }
}

function dispatch(ss, user, config, action, body) {
  if (action === 'bootstrap') return bootstrap(ss, user, config);
  if (action === 'setupSchema') {
    requireOwner(user, config);
    return setupSchema(ss);
  }
  if (MEMBER_ACTIONS[action]) {
    const me = requireMember(ss, user);
    switch (action) {
      case 'getMe': return me;
      case 'getVoteData': return getVoteData(ss, me);
      case 'castVote': return castVote(ss, user, body);
      case 'getPhotos': return getPhotos(ss, me, body);
    }
  }
  if (ADMIN_ACTIONS[action]) {
    requireAdmin(ss, user);
    switch (action) {
      case 'getAdminData': return getAdminData(ss);
      case 'getVoteCleanup': return getVoteCleanup(ss);
      case 'cleanupInvalidVotes': return cleanupInvalidVotes(ss, user, body);
      case 'addRecruit': return addRecruit(ss, user, body);
      case 'deleteRecruit': return deleteRecruit(ss, user, body);
      case 'uploadPhoto': return uploadPhoto(ss, user, body);
      case 'syncPhotoFolder': return syncPhotoFolder(ss, user);
      case 'checkPhotoAccess': return checkPhotoAccess(ss);
      case 'linkPhoto': return linkPhoto(ss, user, body);
      case 'addEvent': return addEvent(ss, user, body);
      case 'deleteEvent': return deleteEvent(ss, user, body);
      case 'setAttendance': return setAttendance(ss, user, body);
      case 'saveNote': return saveNote(ss, user, body);
      case 'manageUser': return manageUser(ss, user, body);
      case 'wipeCycle': return wipeCycle(ss, user, body);
    }
  }
  return errorResult('UNKNOWN_ACTION', 'Unknown action');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- configuration and identity ----------

function readConfig() {
  const props = PropertiesService.getScriptProperties();
  const clientId = String(props.getProperty('GOOGLE_CLIENT_ID') || '').trim();
  const ownerEmail = String(props.getProperty('OWNER_EMAIL') || '').trim().toLowerCase();
  if (!clientId) throw appError('NOT_CONFIGURED', 'The server is not configured yet (GOOGLE_CLIENT_ID).');
  return { clientId: clientId, ownerEmail: ownerEmail };
}

// Google's tokeninfo endpoint verifies the signature and expiry. We then bind
// the token to this app (aud), require a Google issuer, a verified email and
// an unexpired exp. A valid Google token minted for another app is rejected.
function verifyToken(token, expectedAud, nowMs) {
  if (!token || typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  if (!expectedAud) return null;
  let res;
  try {
    res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
  } catch (err) {
    throw appError('AUTH_UNAVAILABLE', 'Sign-in could not be verified right now. Try again.');
  }
  const status = typeof res.getResponseCode === 'function' ? res.getResponseCode() : 200;
  if (status >= 500) throw appError('AUTH_UNAVAILABLE', 'Sign-in could not be verified right now. Try again.');
  if (status !== 200) return null;
  let data;
  try {
    data = JSON.parse(res.getContentText());
  } catch (err) {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  if (String(data.aud || '') !== String(expectedAud)) return null;
  if (GOOGLE_ISSUERS.indexOf(String(data.iss || '')) === -1) return null;
  if (!(data.email_verified === 'true' || data.email_verified === true)) return null;
  const exp = Number(data.exp);
  const now = nowMs == null ? Date.now() : nowMs;
  if (!Number.isFinite(exp) || exp * 1000 <= now) return null;
  const email = normalizeEmail(data.email);
  if (!email) return null;
  return { email: email, name: cleanText(data.name, LIMITS.name) || email };
}

function requireOwner(user, config) {
  if (!config.ownerEmail) throw appError('NOT_CONFIGURED', 'The server is not configured yet (OWNER_EMAIL).');
  if (user.email !== config.ownerEmail) throw appError('FORBIDDEN', 'Only the configured owner can do that.');
}

function requireMember(ss, user) {
  const me = getMe(ss, user);
  if (me.error) throw appError('FORBIDDEN', 'Not authorized');
  return me;
}

function requireAdmin(ss, user) {
  const me = getMe(ss, user);
  if (me.error || me.role !== 'admin') throw appError('FORBIDDEN', 'Admin only');
  return me;
}

// ---------- validation and safe writes ----------

function cleanText(value, max) {
  if (value === null || value === undefined) return '';
  // Drop control characters except newline/tab, then trim.
  // eslint-disable-next-line no-control-regex
  const text = String(value).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
  return text.length > max ? null : text;
}

function requireText(value, max, label, required) {
  const text = cleanText(value, max);
  if (text === null) throw appError('INVALID', label + ' is too long (max ' + max + ' characters).');
  if (required && !text) throw appError('INVALID', label + ' is required.');
  return text;
}

function validId(value) {
  const id = typeof value === 'string' ? value.trim() : (typeof value === 'number' ? String(value) : '');
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : '';
}

function requireId(value, label) {
  const id = validId(value);
  if (!id) throw appError('INVALID', 'Invalid ' + label);
  return id;
}

function normalizeEmail(value) {
  const email = String(value == null ? '' : value).trim().toLowerCase();
  if (!email || email.length > LIMITS.email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

// Required for new recruits. Range 2000–2100 is the pre-existing bound.
// Existing rows without a year are still read as-is (never backfilled).
function validGradYear(value) {
  const text = cleanText(value, 4);
  if (text === '') throw appError('INVALID', 'Graduation year is required.');
  if (!/^\d{4}$/.test(text)) throw appError('INVALID', 'Graduation year must be a 4-digit year.');
  const n = Number(text);
  if (n < 2000 || n > 2100) throw appError('INVALID', 'Graduation year is out of range.');
  return text;
}

// Sheets treats strings starting with = + - @ (and tab/CR) as formulas. A
// leading apostrophe stores them as literal text; Sheets hides the apostrophe
// and getValues() returns the original string.
function safeCell(value) {
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) return "'" + value;
  return value;
}

// ---------- tables (name-indexed) ----------

function headerOf(values) {
  return (values[0] || []).map(cell => String(cell == null ? '' : cell).trim());
}

function cellNonEmpty(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

// Reads one sheet once and validates that every required column exists
// exactly once. Never mutates the sheet: a missing sheet or column is a
// setup error the owner fixes with setupSchema.
function readTable(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw appError('SETUP_REQUIRED', 'The "' + name + '" sheet is missing. The owner needs to run setup.');
  const values = sheet.getLastRow() < 1 ? [[]] : sheet.getDataRange().getValues();
  const header = headerOf(values);
  const col = {};
  SCHEMA[name].forEach(key => {
    const first = header.indexOf(key);
    if (first === -1) throw appError('SETUP_REQUIRED', 'The "' + name + '" sheet is missing the "' + key + '" column. The owner needs to run setup.');
    if (header.indexOf(key, first + 1) !== -1) throw appError('SCHEMA', 'The "' + name + '" sheet has a duplicate "' + key + '" column.');
    col[key] = first;
  });
  (OPTIONAL[name] || []).forEach(key => {
    const first = header.indexOf(key);
    if (first === -1) return;
    if (header.indexOf(key, first + 1) !== -1) throw appError('SCHEMA', 'The "' + name + '" sheet has a duplicate "' + key + '" column.');
    col[key] = first;
  });
  return { name: name, sheet: sheet, values: values, header: header, col: col, ss: ss };
}

function columnsOf(name) {
  return SCHEMA[name].concat(OPTIONAL[name] || []);
}

// ---------- event dates (date-only, YYYY-MM-DD) ----------

function isRealDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days;
}

// Request payload: absent, null or '' means no date. Otherwise a string
// exactly YYYY-MM-DD for a real calendar day, year 2000-2100. No coercion.
function validEventDate(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw appError('INVALID', 'Event date must be a date like 2026-09-15.');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw appError('INVALID', 'Event date must be a date like 2026-09-15.');
  const y = Number(m[1]);
  if (y < 2000 || y > 2100 || !isRealDate(y, Number(m[2]), Number(m[3]))) throw appError('INVALID', 'Event date is not a real calendar date.');
  return value;
}

// Stored cell -> 'YYYY-MM-DD' or '' (not recorded). Text is accepted only in
// the exact form. A Date cell (e.g. typed in the Sheet by hand) is read in
// the spreadsheet's own time zone so it never shifts a day. Anything else
// reads as not recorded; nothing is guessed or written back.
function readEventDate(value, ss) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' || (value && typeof value.getTime === 'function' && typeof value !== 'string')) {
    if (isNaN(value.getTime())) return '';
    const tz = ss && typeof ss.getSpreadsheetTimeZone === 'function' ? ss.getSpreadsheetTimeZone() : 'UTC';
    const text = Utilities.formatDate(value, tz, 'yyyy-MM-dd');
    try { return validEventDate(text); } catch (err) { return ''; }
  }
  try { return validEventDate(String(value).trim()); } catch (err) { return ''; }
}

// Adds the optional column header once, in a new column after the sheet's
// full used range, without touching any existing cell. Only called under the admin lock.
function ensureOptionalColumn(table, key) {
  if (table.col[key] !== undefined) return;
  // Append strictly beyond everything the sheet uses: blank-looking header
  // cells may hold legacy data below or a formula that evaluates to empty.
  let width = table.header.length;
  table.values.forEach(row => { if (row && row.length > width) width = row.length; });
  const last = Number(table.sheet.getLastColumn()) || 0;
  if (last > width) width = last;
  table.sheet.getRange(1, width + 1).setValue(key);
  table.header[width] = key;
  if (!table.values[0]) table.values[0] = [];
  table.values[0][width] = key;
  table.col[key] = width;
}

function rowObject(table, r) {
  const row = table.values[r] || [];
  const obj = {};
  SCHEMA[table.name].forEach(key => {
    const v = row[table.col[key]];
    obj[key] = v === undefined ? '' : v;
  });
  (OPTIONAL[table.name] || []).forEach(key => {
    const v = table.col[key] === undefined ? '' : row[table.col[key]];
    obj[key] = key === 'date' ? readEventDate(v, table.ss) : (v === undefined ? '' : v);
  });
  return obj;
}

function tableRows(table) {
  const out = [];
  for (let r = 1; r < table.values.length; r++) {
    const row = table.values[r] || [];
    if (!row.some(cellNonEmpty)) continue;
    out.push(rowObject(table, r));
  }
  return out;
}

function findRows(table, predicate) {
  const hits = [];
  for (let r = 1; r < table.values.length; r++) {
    if (predicate(rowObject(table, r), r)) hits.push(r);
  }
  return hits;
}

function appendObject(table, obj) {
  const width = Math.max(table.header.length, 1);
  const row = [];
  for (let c = 0; c < width; c++) {
    const key = table.header[c];
    row.push(Object.prototype.hasOwnProperty.call(obj, key) && columnsOf(table.name).indexOf(key) !== -1 ? safeCell(obj[key]) : '');
  }
  table.sheet.appendRow(row);
  table.values.push(row.map(v => (typeof v === 'string' && v.charAt(0) === "'" ? v.slice(1) : v)));
}

// One range write per row update. Only the span between the first and last
// changed schema column is written, so unrelated legacy columns are untouched.
function updateObject(table, r, changes) {
  const keys = Object.keys(changes).filter(key => table.col[key] !== undefined);
  if (!keys.length) return;
  const cols = keys.map(key => table.col[key]);
  const start = Math.min.apply(null, cols);
  const end = Math.max.apply(null, cols);
  const current = (table.values[r] || []).slice();
  const out = [];
  for (let c = start; c <= end; c++) {
    const key = table.header[c];
    const changed = keys.indexOf(key) !== -1;
    const value = changed ? changes[key] : (current[c] === undefined ? '' : current[c]);
    out.push(safeCell(value));
    current[c] = value;
  }
  table.sheet.getRange(r + 1, start + 1, 1, end - start + 1).setValues([out]);
  table.values[r] = current;
}

function deleteRowIndexes(table, indexes) {
  indexes.slice().sort((a, b) => b - a).forEach(r => {
    table.sheet.deleteRow(r + 1);
    table.values.splice(r, 1);
  });
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_WAIT_MS);
  } catch (err) {
    throw appError('BUSY', 'The server is busy. Try again in a moment.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Every admin mutation runs inside ONE script lock that first re-reads the
// Users sheet, so an admin demoted or removed while a request was in flight
// (or waiting for the lock) cannot complete the write. Apps Script locks are
// not reentrant: never call withLock/withAdminLock from inside either.
function withAdminLock(ss, user, fn) {
  return withLock(() => {
    const me = findActiveUser(tableRows(readTable(ss, 'Users')), user && user.email);
    if (!me || me.role !== 'admin') throw appError('FORBIDDEN', 'Admin only');
    return fn(me);
  });
}

// Idempotency for creates. The key binds action + canonical caller email +
// requestId, so one id reused for a different action or by a different admin
// is a different request. idempotentLocked must be called inside
// withAdminLock: the lookup and the store happen while the lock is held (two
// concurrent requests cannot both miss and create twice) and only after the
// caller's admin role was re-checked (a replay cannot bypass a revocation).
// Without CacheService or a valid requestId the call simply runs once.
function requestCacheKey(action, user, requestId) {
  const id = validId(requestId);
  const email = normalizeEmail(user && user.email);
  if (!id || !email || typeof CacheService === 'undefined') return '';
  return 'req:' + action + ':' + email + ':' + id;
}

function cachedResult(key) {
  if (!key) return null;
  const hit = CacheService.getScriptCache().get(key);
  return hit ? JSON.parse(hit) : null;
}

function idempotentLocked(key, fn) {
  const hit = cachedResult(key);
  if (hit) return hit;
  const result = fn();
  if (key && result && !result.error) CacheService.getScriptCache().put(key, JSON.stringify(result), 600);
  return result;
}

// ---------- schema setup (owner only, explicit) ----------

function setupSchema(ss) {
  return withLock(() => {
    const created = [];
    const added = [];
    Object.keys(SCHEMA).forEach(name => {
      const columns = SCHEMA[name];
      let sheet = ss.getSheetByName(name);
      if (!sheet) {
        sheet = ss.insertSheet(name);
        sheet.appendRow(columns);
        created.push(name);
        return;
      }
      if (sheet.getLastRow() < 1) {
        sheet.appendRow(columns);
        added.push(name + ': ' + columns.join(', '));
        return;
      }
      const values = sheet.getDataRange().getValues();
      const header = headerOf(values);
      if (name === 'Recruits' && !sameHeader(header, columns) && !hasDataRows(values)) {
        // An empty legacy Recruits sheet gets the current header in place.
        sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
        const width = header.length;
        if (width > columns.length) sheet.getRange(1, columns.length + 1, 1, width - columns.length).clearContent();
        added.push('Recruits: reset empty legacy header');
        return;
      }
      // Never reorder or delete existing columns; append any missing ones.
      const missing = columns.filter(key => header.indexOf(key) === -1);
      if (!missing.length) return;
      let width = header.length;
      while (width > 0 && header[width - 1] === '') width -= 1;
      sheet.getRange(1, width + 1, 1, missing.length).setValues([missing]);
      added.push(name + ': ' + missing.join(', '));
    });
    return { ok: true, schemaVersion: SCHEMA_VERSION, created: created, added: added };
  });
}

function sameHeader(header, columns) {
  const got = header.slice();
  while (got.length && got[got.length - 1] === '') got.pop();
  return got.length === columns.length && columns.every((c, i) => got[i] === c);
}

function hasDataRows(values) {
  for (let r = 1; r < values.length; r++) {
    if ((values[r] || []).some(cellNonEmpty)) return true;
  }
  return false;
}

// ---------- users ----------

function emailsEqual(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function publicUser(row) {
  return { email: String(row.email).trim().toLowerCase(), name: row.name, role: row.role };
}

function isActive(row) {
  return String(row.active).trim().toLowerCase() === 'yes';
}

function findActiveUser(users, email) {
  return users.find(u => emailsEqual(u.email, email) && isActive(u)) || null;
}

function bootstrap(ss, user, config) {
  const users = tableRows(readTable(ss, 'Users'));
  if (users.length === 0) {
    if (!config.ownerEmail || user.email !== config.ownerEmail) {
      return errorResult('FORBIDDEN', 'Not authorized. Ask an admin to add you.');
    }
    return withLock(() => {
      const table = readTable(ss, 'Users');
      const again = tableRows(table);
      if (again.length === 0) {
        const name = cleanText(user.name, LIMITS.name) || user.email;
        appendObject(table, { email: user.email, name: name, role: 'admin', active: 'yes' });
        return { email: user.email, name: name, role: 'admin', bootstrapped: true };
      }
      const me = findActiveUser(again, user.email);
      return me ? publicUser(me) : errorResult('FORBIDDEN', 'Not authorized. Ask an admin to add you.');
    });
  }
  const me = findActiveUser(users, user.email);
  return me ? publicUser(me) : errorResult('FORBIDDEN', 'Not authorized. Ask an admin to add you.');
}

function getMe(ss, user) {
  const me = findActiveUser(tableRows(readTable(ss, 'Users')), user.email);
  if (!me) return errorResult('FORBIDDEN', 'Not authorized');
  return publicUser(me);
}

function activeAdminEmails(rows) {
  return rows.filter(u => String(u.role) === 'admin' && isActive(u)).map(u => String(u.email).trim().toLowerCase());
}

function manageUser(ss, user, body) {
  const op = String(body && body.op || '');
  const email = normalizeEmail(body && body.email);
  if (!email) return errorResult('INVALID', 'Enter a valid email address.');
  const actor = String(user && user.email || '').toLowerCase();
  if (op === 'add') {
    const role = body.role == null ? 'brother' : String(body.role);
    if (ROLES.indexOf(role) === -1) return errorResult('INVALID', 'Invalid role');
    const name = requireText(body.name, LIMITS.name, 'Name', false) || email;
    return withAdminLock(ss, user, () => {
      const table = readTable(ss, 'Users');
      if (findRows(table, row => emailsEqual(row.email, email)).length) return errorResult('CONFLICT', 'User already exists');
      appendObject(table, { email: email, name: name, role: role, active: 'yes' });
      return { ok: true };
    });
  }
  if (op === 'remove') {
    if (email === actor) return errorResult('FORBIDDEN', 'You cannot remove yourself');
    return withAdminLock(ss, user, () => {
      const table = readTable(ss, 'Users');
      const admins = activeAdminEmails(tableRows(table));
      if (admins.length === 1 && admins[0] === email) return errorResult('FORBIDDEN', 'Cannot remove the last admin');
      deleteRowIndexes(table, findRows(table, row => emailsEqual(row.email, email)));
      return { ok: true };
    });
  }
  if (op === 'setRole') {
    const role = String(body.role || '');
    if (ROLES.indexOf(role) === -1) return errorResult('INVALID', 'Invalid role');
    return withAdminLock(ss, user, () => {
      const table = readTable(ss, 'Users');
      const admins = activeAdminEmails(tableRows(table));
      if (role !== 'admin' && admins.length === 1 && admins[0] === email) {
        return errorResult('FORBIDDEN', 'Cannot demote the last admin');
      }
      const hits = findRows(table, row => emailsEqual(row.email, email));
      if (!hits.length) return errorResult('NOT_FOUND', 'User not found');
      hits.forEach(r => updateObject(table, r, { role: role }));
      return { ok: true };
    });
  }
  return errorResult('INVALID', 'Unknown user operation');
}

// ---------- reads ----------

function getVoteData(ss, me) {
  const recruits = tableRows(readTable(ss, 'Recruits')).map(r => ({
    id: r.id, name: r.name, major: r.major, secondMajor: r.secondMajor, gradYear: r.gradYear, photoFileId: r.photoFileId,
  }));
  const events = tableRows(readTable(ss, 'Events'));
  const attendance = tableRows(readTable(ss, 'EventRecruits'));
  const myVotes = tableRows(readTable(ss, 'Votes'))
    .filter(v => emailsEqual(v.userEmail, me.email))
    .map(v => ({ eventId: v.eventId, recruitId: v.recruitId, score: v.score }));
  return { me: me, recruits: recruits, events: events, attendance: attendance, myVotes: myVotes };
}

function getAdminData(ss) {
  const tables = readCycleTables(ss);
  const byName = {};
  tables.forEach(t => { byName[t.name] = tableRows(t); });
  return {
    schemaVersion: SCHEMA_VERSION,
    cycleFingerprint: cycleFingerprint(tables),
    recruits: byName.Recruits,
    events: byName.Events,
    attendance: byName.EventRecruits,
    votes: byName.Votes,
    notes: byName.Notes,
    users: tableRows(readTable(ss, 'Users')).map(u => ({
      email: String(u.email).trim().toLowerCase(), name: u.name, role: u.role, active: u.active,
    })),
  };
}

// ---------- votes ----------

function scoreValue(score) {
  if (typeof score === 'boolean' || score === null || score === undefined || score === '') return null;
  const n = Number(score);
  if (!Number.isInteger(n) || n < 1 || n > 10) return null;
  return n;
}

function idExists(table, id) {
  return findRows(table, row => String(row.id) === id).length > 0;
}

function attended(table, eventId, recruitId) {
  return findRows(table, row => String(row.eventId) === eventId && String(row.recruitId) === recruitId).length > 0;
}

// Authorization and relationship checks run inside the lock so a member
// removed (or a recruit/event deleted, or attendance unchecked) after the page
// loaded cannot write. Any failure returns before a single cell is written.
function castVote(ss, user, body) {
  const eventId = validId(body && body.eventId);
  const recruitId = validId(body && body.recruitId);
  const score = scoreValue(body && body.score);
  if (!eventId || !recruitId || score === null) return errorResult('INVALID', 'Invalid vote');
  return withLock(() => {
    const me = findActiveUser(tableRows(readTable(ss, 'Users')), user.email);
    if (!me) return errorResult('FORBIDDEN', 'Not authorized');
    if (!idExists(readTable(ss, 'Events'), eventId)) return errorResult('INVALID', 'Invalid vote');
    if (!idExists(readTable(ss, 'Recruits'), recruitId)) return errorResult('INVALID', 'Invalid vote');
    if (!attended(readTable(ss, 'EventRecruits'), eventId, recruitId)) return errorResult('INVALID', 'Invalid vote');
    const email = String(user.email).toLowerCase();
    const table = readTable(ss, 'Votes');
    const matches = findRows(table, row => String(row.eventId) === eventId && String(row.recruitId) === recruitId && emailsEqual(row.userEmail, email));
    const timestamp = new Date().toISOString();
    if (matches.length === 0) {
      appendObject(table, { eventId: eventId, recruitId: recruitId, userEmail: email, score: score, timestamp: timestamp });
    } else {
      updateObject(table, matches[0], { userEmail: email, score: score, timestamp: timestamp });
      deleteRowIndexes(table, matches.slice(1));
    }
    return { ok: true, eventId: eventId, recruitId: recruitId, score: score };
  });
}

// ---------- recruits, events, attendance, notes ----------

function recruitFields(source) {
  return {
    name: requireText(source.name, LIMITS.name, 'Name', true),
    major: requireText(source.major, LIMITS.major, 'Major', true),
    secondMajor: requireText(source.secondMajor, LIMITS.major, 'Second major', false),
    gradYear: validGradYear(source.gradYear),
  };
}

function addRecruit(ss, user, body) {
  const source = body || {};
  const fields = recruitFields(source);
  if (fields.secondMajor && fields.secondMajor.toLowerCase() === fields.major.toLowerCase()) {
    return errorResult('INVALID', 'Second major must be different from the major.');
  }
  const key = requestCacheKey('addRecruit', user, source.requestId);
  // Drive writes happen outside the Sheet lock. A cache hit seen here only
  // skips a duplicate Drive upload; the authoritative check is under the lock.
  let photoFileId = '';
  const rawPhoto = source.photoDataBase64;
  if (!cachedResult(key) && rawPhoto != null && String(rawPhoto).trim() !== '') {
    photoFileId = savePhotoFile(ss, fields.name, decodePhoto(rawPhoto));
  }
  return withAdminLock(ss, user, () => idempotentLocked(key, () => {
    const table = readTable(ss, 'Recruits');
    const id = Utilities.getUuid();
    appendObject(table, {
      id: id, name: fields.name, major: fields.major, secondMajor: fields.secondMajor, gradYear: fields.gradYear,
      photoFileId: photoFileId, photoSource: photoFileId ? 'upload' : '',
    });
    const result = { id: id };
    if (photoFileId) {
      result.photoFileId = photoFileId;
      result.photoSource = 'upload';
    }
    return result;
  }));
}

// Deleting a recruit or event permanently deletes the votes that reference
// it and its attendance rows; deleting a recruit also deletes that recruit's
// note. Drive photo files are never deleted. Nothing is kept as history.
function deleteWhere(ss, sheetName, pred) {
  const table = readTable(ss, sheetName);
  const hits = findRows(table, pred);
  deleteRowIndexes(table, hits);
  return hits.length;
}

function deleteRecruit(ss, user, body) {
  const id = requireId(body && body.id, 'id');
  return withAdminLock(ss, user, () => {
    const removed = deleteWhere(ss, 'Recruits', row => String(row.id) === id);
    const votes = deleteWhere(ss, 'Votes', row => String(row.recruitId) === id);
    deleteWhere(ss, 'EventRecruits', row => String(row.recruitId) === id);
    deleteWhere(ss, 'Notes', row => String(row.recruitId) === id);
    return { ok: true, removed: removed, votesDeleted: votes };
  });
}

function deleteEvent(ss, user, body) {
  const id = requireId(body && body.id, 'id');
  return withAdminLock(ss, user, () => {
    const removed = deleteWhere(ss, 'Events', row => String(row.id) === id);
    const votes = deleteWhere(ss, 'Votes', row => String(row.eventId) === id);
    deleteWhere(ss, 'EventRecruits', row => String(row.eventId) === id);
    return { ok: true, removed: removed, votesDeleted: votes };
  });
}

function addEvent(ss, user, body) {
  const name = requireText(body && body.name, LIMITS.name, 'Event name', true);
  const date = validEventDate(body && body.date);
  const key = requestCacheKey('addEvent', user, body && body.requestId);
  return withAdminLock(ss, user, () => idempotentLocked(key, () => {
    const table = readTable(ss, 'Events');
    const id = Utilities.getUuid();
    const row = { id: id, name: name };
    if (date) {
      ensureOptionalColumn(table, 'date');
      // Leading apostrophe stores literal text so Sheets never converts it
      // to a Date (which could shift by time zone).
      row.date = "'" + date;
    }
    appendObject(table, row);
    return date ? { id: id, date: date } : { id: id };
  }));
}

// Desired-state attendance: replaying the same request is harmless, unlike a
// toggle that flips back on a retry.
function setAttendance(ss, user, body) {
  const eventId = requireId(body && body.eventId, 'event');
  const recruitId = requireId(body && body.recruitId, 'recruit');
  if (typeof body.present !== 'boolean') return errorResult('INVALID', 'Invalid attendance');
  return withAdminLock(ss, user, () => {
    if (!idExists(readTable(ss, 'Events'), eventId)) return errorResult('NOT_FOUND', 'Event not found');
    if (!idExists(readTable(ss, 'Recruits'), recruitId)) return errorResult('NOT_FOUND', 'Recruit not found');
    const table = readTable(ss, 'EventRecruits');
    const hits = findRows(table, row => String(row.eventId) === eventId && String(row.recruitId) === recruitId);
    if (body.present && hits.length === 0) appendObject(table, { eventId: eventId, recruitId: recruitId });
    let votesDeleted = 0;
    if (!body.present) {
      if (hits.length) deleteRowIndexes(table, hits);
      // Votes require attendance: marking a recruit absent permanently deletes
      // every vote for that recruit at that event.
      votesDeleted = deleteWhere(ss, 'Votes', row => String(row.eventId) === eventId && String(row.recruitId) === recruitId);
    }
    if (body.present && hits.length > 1) deleteRowIndexes(table, hits.slice(1));
    return { ok: true, present: body.present, votesDeleted: votesDeleted };
  });
}

function saveNote(ss, user, body) {
  const recruitId = requireId(body && body.recruitId, 'recruit');
  const content = requireText(body && body.content, LIMITS.note, 'Note', false);
  return withAdminLock(ss, user, () => {
    if (!idExists(readTable(ss, 'Recruits'), recruitId)) return errorResult('NOT_FOUND', 'Recruit not found');
    const table = readTable(ss, 'Notes');
    const updatedAt = new Date().toISOString();
    const hits = findRows(table, row => String(row.recruitId) === recruitId);
    if (hits.length) updateObject(table, hits[0], { content: content, updatedAt: updatedAt });
    else appendObject(table, { recruitId: recruitId, content: content, updatedAt: updatedAt });
    return { ok: true, updatedAt: updatedAt };
  });
}

// ---------- invalid-vote repair ----------
// Votes written before deletes cascaded can reference a missing recruit or
// event, lack attendance, or carry an invalid score. The criteria live here
// only; the browser cannot supply a predicate. Reading the preview never
// writes. Cleanup is explicit, admin-only, under the lock, and bound to the
// fingerprint and count the admin reviewed. It never runs automatically.

const CLEANUP_CONFIRMATION = 'DELETE INVALID VOTES';

function invalidVoteReason(vote, recruitIds, eventIds, present) {
  if (SCHEMA.Votes.every(k => String(vote[k] == null ? '' : vote[k]).trim() === '')) return '';
  const rid = String(vote.recruitId);
  const eid = String(vote.eventId);
  if (!recruitIds[rid]) return 'missingRecruit';
  if (!eventIds[eid]) return 'missingEvent';
  if (!present[eid + '\u0000' + rid]) return 'notPresent';
  if (scoreValue(vote.score) === null) return 'invalidScore';
  return '';
}

function findInvalidVotes(tables) {
  const byName = {};
  tables.forEach(t => { byName[t.name] = t; });
  const recruitIds = {}, eventIds = {}, present = {};
  tableRows(byName.Recruits).forEach(r => { recruitIds[String(r.id)] = true; });
  tableRows(byName.Events).forEach(e => { eventIds[String(e.id)] = true; });
  tableRows(byName.EventRecruits).forEach(a => { present[String(a.eventId) + '\u0000' + String(a.recruitId)] = true; });
  const votes = byName.Votes;
  const counts = { missingRecruit: 0, missingEvent: 0, notPresent: 0, invalidScore: 0 };
  const indexes = findRows(votes, row => {
    const reason = invalidVoteReason(row, recruitIds, eventIds, present);
    if (reason) counts[reason] += 1;
    return !!reason;
  });
  return { table: votes, indexes: indexes, counts: counts };
}

function getVoteCleanup(ss) {
  const tables = readCycleTables(ss);
  const found = findInvalidVotes(tables);
  return { count: found.indexes.length, byReason: found.counts, cycleFingerprint: cycleFingerprint(tables) };
}

function cleanupInvalidVotes(ss, user, body) {
  if (!body || body.confirm !== CLEANUP_CONFIRMATION) return errorResult('INVALID', 'Confirm the invalid-vote cleanup.');
  const expected = String(body.expectedFingerprint || '');
  const expectedCount = body.expectedCount;
  if (!/^[0-9a-f]{64}$/.test(expected) || !Number.isInteger(expectedCount) || expectedCount < 1) {
    return errorResult('INVALID', 'Review the cleanup preview first.');
  }
  return withAdminLock(ss, user, () => {
    const tables = readCycleTables(ss);
    if (cycleFingerprint(tables) !== expected) {
      return errorResult('CONFLICT', 'Vote data changed since the preview. Review it again.');
    }
    const found = findInvalidVotes(tables);
    if (found.indexes.length !== expectedCount) {
      return errorResult('CONFLICT', 'Vote data changed since the preview. Review it again.');
    }
    deleteRowIndexes(found.table, found.indexes);
    return { ok: true, deleted: found.indexes.length, byReason: found.counts };
  });
}

// ---------- cycle fingerprint and wipe ----------

const WIPE_CONFIRMATION = 'WIPE CYCLE';
const WIPE_SHEETS = ['Recruits', 'Events', 'EventRecruits', 'Votes', 'Notes'];

function canonicalCell(value) {
  if (value instanceof Date || (value && typeof value.toISOString === 'function')) return value.toISOString();
  return value === null || value === undefined ? '' : String(value);
}

// SHA-256 over the canonical content of every cycle sheet: schema columns in
// schema order, rows in sheet order, values as text. ANY change to cycle data
// changes it, including a re-scored vote, an edited note, or a delete plus an
// add that leaves row counts unchanged.
function cycleFingerprint(tables) {
  const canonical = tables.map(t => [t.name, tableRows(t).map(row => columnsOf(t.name).map(k => canonicalCell(row[k])))]);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(canonical), Utilities.Charset.UTF_8);
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function readCycleTables(ss) {
  return WIPE_SHEETS.map(name => readTable(ss, name));
}

// Wipe requires the typed confirmation and the fingerprint of the data the
// admin was looking at. If anything in the cycle sheets changed since then
// (by anyone, including the admin's own later edits), nothing is cleared.
function wipeCycle(ss, user, body) {
  if (!body || body.confirm !== WIPE_CONFIRMATION) return errorResult('INVALID', 'Type ' + WIPE_CONFIRMATION + ' to confirm.');
  const expected = String(body.expectedFingerprint || '');
  if (!/^[0-9a-f]{64}$/.test(expected)) return errorResult('INVALID', 'Reload the page before wiping.');
  return withAdminLock(ss, user, () => {
    const tables = readCycleTables(ss);
    if (cycleFingerprint(tables) !== expected) {
      return errorResult('CONFLICT', 'Cycle data changed since this page loaded. Reload and review before wiping.');
    }
    const counts = {};
    tables.forEach(t => {
      counts[t.name] = tableRows(t).length;
      const last = t.sheet.getLastRow();
      if (last > 1) t.sheet.getRange(2, 1, last - 1, Math.max(t.sheet.getLastColumn(), 1)).clearContent();
    });
    return { ok: true, cleared: counts, message: 'Cycle wiped. Users preserved.' };
  });
}

// Photo filename matching. Keep identical to src/lib/photoMatch.js.
const AUTO_LINK_SCORE = 0.85;
const AUTO_LINK_MARGIN = 0.1;
const REVIEW_SCORE = 0.6;
const MAX_SUGGESTIONS = 3;

function normalizeName(filename) {
  let name = String(filename == null ? '' : filename).trim();
  name = name.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  let previous = name;
  do {
    previous = name;
    name = name.replace(/\s*\(\d+\)\s*$/, '');
    name = name.replace(/\s*-\s*copy\s*$/i, '');
  } while (name !== previous);
  const comma = name.match(/^\s*([^,]+),\s*([^,]+?)\s*$/);
  if (comma) name = (comma[2] + ' ' + comma[1]).trim();
  name = name.toLowerCase();
  name = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  name = name.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return name;
}

// Adjacent transposition counts as one edit so "Smtih" stays within the auto-link band.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const rows = new Array(m + 1);
  for (let i = 0; i <= m; i++) {
    rows[i] = new Array(n + 1);
    rows[i][0] = i;
  }
  for (let j = 0; j <= n; j++) rows[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let best = rows[i - 1][j] + 1;
      const del = rows[i][j - 1] + 1;
      if (del < best) best = del;
      const sub = rows[i - 1][j - 1] + cost;
      if (sub < best) best = sub;
      if (
        i > 1 && j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        const swap = rows[i - 2][j - 2] + 1;
        if (swap < best) best = swap;
      }
      rows[i][j] = best;
    }
  }
  return rows[m][n];
}

function tokenKey(normalized) {
  return normalized.split(' ').filter(Boolean).sort().join(' ');
}

function ratio(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function similarity(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  const direct = ratio(left, right);
  const tokens = ratio(tokenKey(left), tokenKey(right));
  return direct > tokens ? direct : tokens;
}

function fieldText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function hasPhoto(recruit) {
  return !!(fieldText(recruit.photoFileId) || fieldText(recruit.photoSource));
}

function planPhotoLinks(files, recruits) {
  const people = (recruits || []).map(recruit => ({
    id: fieldText(recruit && recruit.id),
    name: fieldText(recruit && recruit.name),
    photoFileId: fieldText(recruit && recruit.photoFileId),
    photoSource: fieldText(recruit && recruit.photoSource),
  })).filter(recruit => recruit.id);

  const takenFiles = new Set(people.map(recruit => recruit.photoFileId).filter(Boolean));
  const pending = [];
  const seenFiles = new Set();
  (files || []).forEach(file => {
    const fileId = fieldText(file && file.fileId);
    if (!fileId || seenFiles.has(fileId) || takenFiles.has(fileId)) return;
    seenFiles.add(fileId);
    pending.push({
      fileId: fileId,
      fileName: file && file.fileName != null ? String(file.fileName) : '',
    });
  });

  const takenRecruits = new Set(people.filter(hasPhoto).map(recruit => recruit.id));
  const decisions = pending.map(file => {
    const ranked = people.map(recruit => ({
      recruitId: recruit.id,
      name: recruit.name,
      score: similarity(file.fileName, recruit.name),
    })).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.recruitId < b.recruitId) return -1;
      if (a.recruitId > b.recruitId) return 1;
      return 0;
    });
    const suggestions = [];
    for (let i = 0; i < ranked.length && suggestions.length < MAX_SUGGESTIONS; i++) {
      if (ranked[i].score >= REVIEW_SCORE) suggestions.push(ranked[i]);
    }
    const best = ranked[0] || null;
    const secondScore = ranked.length > 1 ? ranked[1].score : 0;
    const margin = best ? best.score - secondScore : 0;
    return { file: file, best: best, margin: margin, suggestions: suggestions };
  });

  const auto = decisions.filter(item => (
    item.best &&
    item.best.score >= AUTO_LINK_SCORE &&
    item.margin >= AUTO_LINK_MARGIN &&
    !takenRecruits.has(item.best.recruitId)
  ));
  auto.sort((a, b) => {
    if (b.best.score !== a.best.score) return b.best.score - a.best.score;
    if (a.file.fileName < b.file.fileName) return -1;
    if (a.file.fileName > b.file.fileName) return 1;
    return 0;
  });

  const linked = [];
  const linkedFiles = new Set();
  auto.forEach(item => {
    const recruitId = item.best.recruitId;
    if (takenRecruits.has(recruitId)) return;
    takenRecruits.add(recruitId);
    linkedFiles.add(item.file.fileId);
    linked.push({
      fileId: item.file.fileId,
      fileName: item.file.fileName,
      recruitId: recruitId,
      name: item.best.name,
      score: item.best.score,
    });
  });

  const unmatched = [];
  decisions.forEach(item => {
    if (linkedFiles.has(item.file.fileId)) return;
    const bestScore = item.best ? item.best.score : 0;
    unmatched.push({
      fileId: item.file.fileId,
      fileName: item.file.fileName,
      suggestions: bestScore >= REVIEW_SCORE ? item.suggestions : [],
    });
  });

  return { linked: linked, unmatched: unmatched };
}

// ---------- photos ----------

const PHOTO_FOLDER_NAME = 'Recruit Photos';
const PHOTO_FOLDER_PROP = 'PHOTO_FOLDER_ID';
const PHOTO_FETCH_LIMIT = 20;
const PHOTO_UNAVAILABLE = 'Recruit photos are unavailable right now. The script owner may need to re-authorize Drive access. Everything else still works.';

function textField(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// Drive access is wrapped so a missing grant or folder becomes one stable,
// photo-scoped error instead of a raw Google exception. The failing step and a
// bounded category are written to the server log (Executions) for the owner;
// the raw message, IDs, names, emails and stacks are never logged or returned.
// Editor-only helper: run once from the Apps Script editor as the script owner.
// ScriptApp.requireScopes shows Google's consent screen for the EXISTING
// manifest Drive scope if it has not been granted (granular consent) and ends
// the execution; otherwise it returns. It reads and writes nothing and is not
// reachable from doPost. Web-app behavior is unchanged.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
/* global ScriptApp */
function authorizeDrive() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, [DRIVE_SCOPE]);
  return 'Drive access granted';
}

const DRIVE_OPS = ['openCachedFolder', 'openSheetFile', 'listSheetParents', 'findPhotoFolder',
  'createPhotoFolder', 'cacheFolderId', 'listPhotoFiles', 'createPhotoFile'];
const DRIVE_ERROR_CATEGORIES = [
  ['SCOPE_NOT_GRANTED', /you do not have permission to call|required permissions|authorization is required/i],
  ['ACCESS_DENIED', /access denied|forbidden|insufficient permission|do not have permission|not have access/i],
  ['NOT_FOUND', /not found|no item with the given id|does not exist|is trashed/i],
  ['QUOTA', /quota|rate limit|too many|limit exceeded|invoked too many times/i],
  ['TIMEOUT', /timed? ?out|deadline/i],
  ['SERVICE_ERROR', /server error|service error|backend error|temporarily unavailable|internal error|service unavailable/i],
];

function classifyDriveError(err) {
  let message = '';
  try { message = String(err && err.message !== undefined ? err.message : err); } catch (e) { message = ''; }
  for (let i = 0; i < DRIVE_ERROR_CATEGORIES.length; i++) {
    if (DRIVE_ERROR_CATEGORIES[i][1].test(message)) return DRIVE_ERROR_CATEGORIES[i][0];
  }
  return 'OTHER';
}

function logDriveFailure(op, err) {
  const label = DRIVE_OPS.indexOf(op) === -1 ? 'unknown' : op;
  const category = classifyDriveError(err);
  try { console.warn('PHOTO_DRIVE_FAILURE op=' + label + ' category=' + category); } catch (e) { /* ignore */ }
  return label + '/' + category;
}

function driveCall(op, fn) {
  try {
    return fn();
  } catch (err) {
    if (err && err.publicCode) throw err;
    const failure = appError('PHOTO_UNAVAILABLE', PHOTO_UNAVAILABLE);
    failure.photoDiagnostic = logDriveFailure(op, err);
    throw failure;
  }
}

// create=false never creates anything (used by reads). Only explicit admin
// actions (sync, upload) may create the folder beside the spreadsheet.
function getPhotoFolder(ss, create) {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty(PHOTO_FOLDER_PROP);
  if (cached) {
    let existing = null;
    try { existing = DriveApp.getFolderById(cached); } catch (err) { existing = null; logDriveFailure('openCachedFolder', err); }
    if (existing && existing.getName() === PHOTO_FOLDER_NAME) return existing;
  }
  const file = driveCall('openSheetFile', () => DriveApp.getFileById(ss.getId()));
  const parent = driveCall('listSheetParents', () => {
    const parents = file.getParents();
    return parents.hasNext() ? parents.next() : null;
  });
  if (!parent) throw appError('PHOTO_UNAVAILABLE', 'The spreadsheet has no parent folder for photos.');
  const found = driveCall('findPhotoFolder', () => {
    const it = parent.getFoldersByName(PHOTO_FOLDER_NAME);
    return it.hasNext() ? it.next() : null;
  });
  if (!found && !create) return null;
  const folder = found || driveCall('createPhotoFolder', () => parent.createFolder(PHOTO_FOLDER_NAME));
  driveCall('cacheFolderId', () => props.setProperty(PHOTO_FOLDER_PROP, folder.getId()));
  return folder;
}

// Admin-only, read-only Drive check: the same lookups sync uses, but it never
// creates the folder, never caches its id and never touches the Sheet.
function checkPhotoAccess(ss) {
  const file = driveCall('openSheetFile', () => DriveApp.getFileById(ss.getId()));
  const parent = driveCall('listSheetParents', () => {
    const parents = file.getParents();
    return parents.hasNext() ? parents.next() : null;
  });
  if (!parent) return { ok: true, sheetFile: true, parentFolder: false, photoFolder: false, imageCount: 0 };
  const found = driveCall('findPhotoFolder', () => {
    const it = parent.getFoldersByName(PHOTO_FOLDER_NAME);
    return it.hasNext() ? it.next() : null;
  });
  if (!found) return { ok: true, sheetFile: true, parentFolder: true, photoFolder: false, imageCount: 0 };
  return { ok: true, sheetFile: true, parentFolder: true, photoFolder: true, imageCount: listImageFiles(found).length };
}

function listImageFiles(folder) {
  return driveCall('listPhotoFiles', () => {
    const files = [];
    const iterator = folder.getFiles();
    while (iterator.hasNext()) {
      const file = iterator.next();
      const mime = String(file.getMimeType() || '');
      if (mime.indexOf('image/') !== 0) continue;
      files.push({ fileId: file.getId(), fileName: file.getName() });
    }
    return files;
  });
}

function decodePhoto(dataBase64) {
  let raw = String(dataBase64 == null ? '' : dataBase64).trim();
  const marker = raw.indexOf('base64,');
  if (marker !== -1) raw = raw.slice(marker + 'base64,'.length);
  raw = raw.replace(/\s/g, '');
  if (!raw) throw appError('INVALID', 'Missing photo data');
  if (raw.length > 500000) throw appError('INVALID', 'Photo is too large');
  if (!/^[A-Za-z0-9+/=]+$/.test(raw)) throw appError('INVALID', 'Photo data is not valid');
  return Utilities.base64Decode(raw);
}

function savePhotoFile(ss, recruitName, bytes) {
  const folder = getPhotoFolder(ss, true);
  const safe = textField(recruitName).replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim() || 'Recruit';
  return driveCall('createPhotoFile', () => {
    const blob = Utilities.newBlob(bytes, 'image/jpeg', safe + '.jpg');
    return folder.createFile(blob).getId();
  });
}

function findRecruit(table, recruitId) {
  const hits = findRows(table, row => String(row.id) === String(recruitId));
  if (!hits.length) return null;
  const row = rowObject(table, hits[0]);
  return { r: hits[0], name: textField(row.name), photoFileId: textField(row.photoFileId), photoSource: textField(row.photoSource) };
}

function uploadPhoto(ss, user, body) {
  const recruitId = requireId(body && body.recruitId, 'recruit');
  const bytes = decodePhoto(body && body.dataBase64);
  const before = findRecruit(readTable(ss, 'Recruits'), recruitId);
  if (!before) return errorResult('NOT_FOUND', 'Recruit not found');
  const fileId = savePhotoFile(ss, before.name, bytes);
  return withAdminLock(ss, user, () => {
    const table = readTable(ss, 'Recruits');
    const located = findRecruit(table, recruitId);
    if (!located) return errorResult('NOT_FOUND', 'Recruit not found');
    updateObject(table, located.r, { photoFileId: fileId, photoSource: 'upload' });
    return { ok: true, photoFileId: fileId, photoSource: 'upload' };
  });
}

function fileInPhotoFolder(file, folder) {
  if (!file || !folder) return false;
  const mime = String(file.getMimeType() || '');
  if (mime.indexOf('image/') !== 0) return false;
  const parents = file.getParents();
  const folderId = folder.getId();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) return true;
  }
  return false;
}

function openDriveFile(fileId) {
  try {
    return DriveApp.getFileById(fileId);
  } catch (err) {
    return null;
  }
}

// Members can read only photos linked to a recruit row. Admins can also
// preview unlinked images inside the Recruit Photos folder (for matching).
// Reads never create the folder.
function getPhotos(ss, me, body) {
  const requested = Array.isArray(body && body.ids) ? body.ids : [];
  const ids = [];
  const seen = {};
  for (let i = 0; i < requested.length && ids.length < PHOTO_FETCH_LIMIT; i++) {
    const id = validId(requested[i]);
    if (!id || seen[id]) continue;
    seen[id] = true;
    ids.push(id);
  }
  if (!ids.length) return { photos: {} };
  const allowed = {};
  tableRows(readTable(ss, 'Recruits')).forEach(recruit => {
    const id = textField(recruit.photoFileId);
    if (id) allowed[id] = true;
  });
  const isAdmin = me.role === 'admin';
  let folder;
  const photos = {};
  const missing = [];
  ids.forEach(id => {
    let file = null;
    if (allowed[id]) {
      file = openDriveFile(id);
    } else if (isAdmin) {
      if (folder === undefined) {
        try { folder = getPhotoFolder(ss, false); } catch (err) { folder = null; }
      }
      file = openDriveFile(id);
      if (!fileInPhotoFolder(file, folder)) file = null;
    }
    if (!file) { missing.push(id); return; }
    try {
      const blob = file.getBlob();
      const mime = blob.getContentType() || file.getMimeType() || 'image/jpeg';
      if (String(mime).indexOf('image/') !== 0) { missing.push(id); return; }
      photos[id] = 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes());
    } catch (err) {
      missing.push(id);
    }
  });
  return { photos: photos, missing: missing };
}

// Folder listing and fuzzy matching run OUTSIDE the lock so votes are never
// blocked by Drive. The write phase re-reads Recruits under the lock and only
// links rows that still exist and still have no photo.
function syncPhotoFolder(ss, user) {
  const folder = getPhotoFolder(ss, true);
  const files = listImageFiles(folder);
  const plan = planPhotoLinks(files, tableRows(readTable(ss, 'Recruits')));
  return withAdminLock(ss, user, () => {
    const table = readTable(ss, 'Recruits');
    const taken = {};
    tableRows(table).forEach(r => { if (textField(r.photoFileId)) taken[textField(r.photoFileId)] = true; });
    const linked = [];
    plan.linked.forEach(item => {
      const located = findRecruit(table, item.recruitId);
      if (!located || located.photoFileId || located.photoSource || taken[item.fileId]) return;
      updateObject(table, located.r, { photoFileId: item.fileId, photoSource: 'folder' });
      taken[item.fileId] = true;
      linked.push(item);
    });
    return { linked: linked, unmatched: plan.unmatched };
  });
}

function linkPhoto(ss, user, body) {
  const fileId = validId(body && body.fileId);
  const recruitId = validId(body && body.recruitId);
  if (!fileId || !recruitId) return errorResult('INVALID', 'Missing photo link');
  const folder = getPhotoFolder(ss, false);
  const file = openDriveFile(fileId);
  if (!fileInPhotoFolder(file, folder)) return errorResult('INVALID', 'Photo is not in the Recruit Photos folder');
  return withAdminLock(ss, user, () => {
    const table = readTable(ss, 'Recruits');
    const located = findRecruit(table, recruitId);
    if (!located) return errorResult('NOT_FOUND', 'Recruit not found');
    if (located.photoFileId || located.photoSource) return errorResult('CONFLICT', 'Recruit already has a photo');
    updateObject(table, located.r, { photoFileId: fileId, photoSource: 'folder' });
    return { ok: true, photoFileId: fileId, photoSource: 'folder' };
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    API_VERSION: API_VERSION,
    doPost: doPost,
    verifyToken: verifyToken,
    safeCell: safeCell,
    readTable: readTable,
    tableRows: tableRows,
    setupSchema: setupSchema,
    castVote: castVote,
    getVoteCleanup: getVoteCleanup,
    cleanupInvalidVotes: cleanupInvalidVotes,
    manageUser: manageUser,
    bootstrap: bootstrap,
    getMe: getMe,
    saveNote: saveNote,
    getAdminData: getAdminData,
    getVoteData: getVoteData,
    addRecruit: addRecruit,
    addEvent: addEvent,
    setAttendance: setAttendance,
    deleteRecruit: deleteRecruit,
    deleteEvent: deleteEvent,
    wipeCycle: wipeCycle,
    uploadPhoto: uploadPhoto,
    getPhotos: getPhotos,
    classifyDriveError: classifyDriveError,
    authorizeDrive: authorizeDrive,
    syncPhotoFolder: syncPhotoFolder,
    linkPhoto: linkPhoto,
    normalizeName: normalizeName,
    similarity: similarity,
    planPhotoLinks: planPhotoLinks,
  };
}
