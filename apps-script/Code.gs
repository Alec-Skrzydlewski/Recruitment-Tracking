// Recruitment Tracker — Google Apps Script Backend
// Deploy as Web App from the sheet (Extensions → Apps Script): Execute as Me, Who has access: Anyone
// SHEET_ID is read inside doPost so this file can load in tests without SpreadsheetApp.

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const token = body.token;
    const user = verifyToken(token);
    if (!user) return json({ error: 'Invalid or expired login' });

    const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
    const ss = SpreadsheetApp.openById(SHEET_ID);
    ensureSheets(ss);

    let result;
    switch (action) {
      case 'bootstrap': result = bootstrap(ss, user); break;
      case 'getMe': result = getMe(ss, user); break;
      case 'getVoteData': result = getVoteData(ss, user); break;
      case 'castVote': result = castVote(ss, user, body); break;
      case 'getAdminData': result = requireAdmin(ss, user) && getAdminData(ss); break;
      case 'addRecruit': result = requireAdmin(ss, user) && addRecruit(ss, body); break;
      case 'deleteRecruit': result = requireAdmin(ss, user) && deleteRecruit(ss, body); break;
      case 'uploadPhoto': result = requireAdmin(ss, user) && uploadPhoto(ss, body); break;
      case 'getPhotos': result = getPhotos(ss, user, body); break;
      case 'syncPhotoFolder': result = requireAdmin(ss, user) && syncPhotoFolder(ss); break;
      case 'linkPhoto': result = requireAdmin(ss, user) && linkPhoto(ss, body); break;
      case 'addEvent': result = requireAdmin(ss, user) && addEvent(ss, body); break;
      case 'deleteEvent': result = requireAdmin(ss, user) && deleteEvent(ss, body); break;
      case 'toggleAttendance': result = requireAdmin(ss, user) && toggleAttendance(ss, body); break;
      case 'saveNote': result = requireAdmin(ss, user) && saveNote(ss, body); break;
      case 'manageUser': result = requireAdmin(ss, user) && manageUser(ss, user, body); break;
      case 'wipeCycle': result = requireAdmin(ss, user) && wipeCycle(ss); break;
      default: result = { error: 'Unknown action' };
    }
    return json(result || { ok: true });
  } catch (err) {
    return json({ error: err.message });
  }
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token));
    const data = JSON.parse(res.getContentText());
    if (data.email && data.email_verified === 'true') {
      return { email: String(data.email).toLowerCase(), name: data.name || data.email };
    }
  } catch (e) {}
  return null;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

const RECRUIT_COLUMNS = ['id', 'name', 'major', 'secondMajor', 'gradYear', 'photoFileId', 'photoSource'];

function ensureSheets(ss) {
  const needed = {
    Users: ['email', 'name', 'role', 'active'],
    Events: ['id', 'name'],
    EventRecruits: ['eventId', 'recruitId'],
    Votes: ['eventId', 'recruitId', 'userEmail', 'score', 'timestamp'],
    Notes: ['recruitId', 'content', 'updatedAt']
  };
  ensureRecruitColumns(ss);
  Object.keys(needed).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(needed[name]);
      return;
    }
    // Append missing header cells. Never reorder or delete existing columns.
    appendMissingHeaders(sheet, needed[name]);
  });
}

function meaningfulHeader(header) {
  const copy = header.slice();
  while (copy.length && copy[copy.length - 1] === '') copy.pop();
  return copy;
}

function sameHeader(header, columns) {
  const got = meaningfulHeader(header);
  if (got.length !== columns.length) return false;
  for (let i = 0; i < columns.length; i++) {
    if (got[i] !== columns[i]) return false;
  }
  return true;
}

// Empty recruit sheets (the tracker is wiped) get the current columns.
// A sheet that still has recruit rows is left alone.
function ensureRecruitColumns(ss) {
  let sheet = ss.getSheetByName('Recruits');
  if (!sheet) {
    sheet = ss.insertSheet('Recruits');
    sheet.appendRow(RECRUIT_COLUMNS);
    return;
  }
  if (sheet.getLastRow() < 1) {
    sheet.appendRow(RECRUIT_COLUMNS);
    return;
  }
  const values = sheet.getDataRange().getValues();
  const header = values[0].map(cell => String(cell == null ? '' : cell).trim());
  if (sameHeader(header, RECRUIT_COLUMNS)) return;
  for (let r = 1; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (cellNonEmpty(values[r][c])) return;
    }
  }
  const width = Math.max(sheet.getLastColumn(), RECRUIT_COLUMNS.length);
  for (let i = 0; i < RECRUIT_COLUMNS.length; i++) {
    sheet.getRange(1, i + 1).setValue(RECRUIT_COLUMNS[i]);
  }
  if (width > RECRUIT_COLUMNS.length) {
    sheet.getRange(1, RECRUIT_COLUMNS.length + 1, 1, width - RECRUIT_COLUMNS.length).clearContent();
  }
}

function appendMissingHeaders(sheet, columns) {
  if (sheet.getLastRow() < 1) {
    sheet.appendRow(columns);
    return;
  }
  const header = sheet.getDataRange().getValues()[0].map(cell => String(cell == null ? '' : cell).trim());
  const present = {};
  header.forEach(name => {
    if (name) present[name] = true;
  });
  const missing = columns.filter(name => !present[name]);
  if (!missing.length) return;
  let col = header.length;
  missing.forEach(name => {
    col += 1;
    sheet.getRange(1, col).setValue(name);
  });
}

function getSheet(ss, name) {
  return ss.getSheetByName(name);
}

function cellNonEmpty(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

function rowsToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  }).filter(row => Object.keys(row).some(key => cellNonEmpty(row[key])));
}

function emailsEqual(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function publicUser(row) {
  return {
    email: String(row.email).toLowerCase(),
    name: row.name,
    role: row.role
  };
}

function findActiveUser(users, email) {
  return users.find(u => emailsEqual(u.email, email) && String(u.active) === 'yes') || null;
}

function bootstrap(ss, user) {
  const usersSheet = getSheet(ss, 'Users');
  const existing = rowsToObjects(usersSheet);
  if (existing.length === 0) {
    return withLock(() => {
      const again = rowsToObjects(usersSheet);
      if (again.length === 0) {
        const email = String(user.email).toLowerCase();
        usersSheet.appendRow([email, user.name, 'admin', 'yes']);
        return { email: email, name: user.name, role: 'admin', bootstrapped: true };
      }
      const me = findActiveUser(again, user.email);
      return me ? publicUser(me) : { error: 'Not authorized. Ask an admin to add you.' };
    });
  }
  const me = findActiveUser(existing, user.email);
  return me ? publicUser(me) : { error: 'Not authorized. Ask an admin to add you.' };
}

function getMe(ss, user) {
  const users = rowsToObjects(getSheet(ss, 'Users'));
  const me = findActiveUser(users, user.email);
  if (!me) return { error: 'Not authorized' };
  return publicUser(me);
}

function requireAdmin(ss, user) {
  const me = getMe(ss, user);
  if (me.error || me.role !== 'admin') throw new Error('Admin only');
  return true;
}

function getVoteData(ss, user) {
  const me = getMe(ss, user);
  if (me.error) return me;
  const recruits = rowsToObjects(getSheet(ss, 'Recruits'));
  const events = rowsToObjects(getSheet(ss, 'Events'));
  const attendance = rowsToObjects(getSheet(ss, 'EventRecruits'));
  const votes = rowsToObjects(getSheet(ss, 'Votes')).filter(v => emailsEqual(v.userEmail, user.email));
  return { me, recruits, events, attendance, myVotes: votes };
}

function scoreValue(score) {
  if (typeof score === 'boolean' || score === null || score === undefined || score === '') return null;
  const n = Number(score);
  if (!Number.isInteger(n) || n < 1 || n > 10) return null;
  return n;
}

function castVote(ss, user, body) {
  const eventId = body.eventId;
  const recruitId = body.recruitId;
  const score = scoreValue(body.score);
  if (!eventId || !recruitId || score === null) return { error: 'Invalid vote' };
  return withLock(() => {
    const email = String(user.email || '').toLowerCase();
    const sheet = getSheet(ss, 'Votes');
    const data = sheet.getDataRange().getValues();
    const matches = [];
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(eventId) && String(data[i][1]) === String(recruitId) && emailsEqual(data[i][2], email)) {
        matches.push(i);
      }
    }
    if (matches.length === 0) {
      sheet.appendRow([eventId, recruitId, email, score, new Date().toISOString()]);
    } else {
      const keep = matches[0];
      sheet.getRange(keep + 1, 3).setValue(email);
      sheet.getRange(keep + 1, 4).setValue(score);
      sheet.getRange(keep + 1, 5).setValue(new Date().toISOString());
      for (let m = matches.length - 1; m >= 1; m--) {
        sheet.deleteRow(matches[m] + 1);
      }
    }
    return { ok: true };
  });
}

function getAdminData(ss) {
  return {
    recruits: rowsToObjects(getSheet(ss, 'Recruits')),
    events: rowsToObjects(getSheet(ss, 'Events')),
    attendance: rowsToObjects(getSheet(ss, 'EventRecruits')),
    votes: rowsToObjects(getSheet(ss, 'Votes')),
    notes: rowsToObjects(getSheet(ss, 'Notes')),
    users: rowsToObjects(getSheet(ss, 'Users'))
  };
}

function textField(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function addRecruit(ss, body) {
  return withLock(() => {
    const sheet = getSheet(ss, 'Recruits');
    const header = sheet.getDataRange().getValues()[0].map(cell => String(cell == null ? '' : cell).trim());
    const id = Utilities.getUuid();
    const source = body || {};
    const values = {
      id: id,
      name: textField(source.name),
      major: textField(source.major),
      secondMajor: textField(source.secondMajor),
      gradYear: textField(source.gradYear),
      photoFileId: '',
      photoSource: ''
    };
    const rawPhoto = source.photoDataBase64;
    if (rawPhoto != null && textField(rawPhoto) !== '') {
      const bytes = decodePhoto(rawPhoto);
      values.photoFileId = savePhotoFile(ss, values.name, bytes);
      values.photoSource = 'upload';
    }
    const row = header.map(key => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '');
    sheet.appendRow(row);
    const result = { id: id };
    if (values.photoFileId) {
      result.photoFileId = values.photoFileId;
      result.photoSource = 'upload';
    }
    return result;
  });
}

function deleteRecruit(ss, body) {
  return withLock(() => {
    const sheet = getSheet(ss, 'Recruits');
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === body.id) sheet.deleteRow(i + 1);
    }
    return { ok: true };
  });
}

function addEvent(ss, body) {
  return withLock(() => {
    const id = Utilities.getUuid();
    getSheet(ss, 'Events').appendRow([id, body.name || '']);
    return { id };
  });
}

function deleteEvent(ss, body) {
  return withLock(() => {
    const sheet = getSheet(ss, 'Events');
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === body.id) sheet.deleteRow(i + 1);
    }
    return { ok: true };
  });
}

function toggleAttendance(ss, body) {
  return withLock(() => {
    const sheet = getSheet(ss, 'EventRecruits');
    const data = sheet.getDataRange().getValues();
    let exists = false;
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === body.eventId && data[i][1] === body.recruitId) {
        sheet.deleteRow(i + 1);
        exists = true;
      }
    }
    if (!exists) sheet.appendRow([body.eventId, body.recruitId]);
    return { ok: true };
  });
}

function saveNote(ss, body) {
  return withLock(() => {
    const sheet = getSheet(ss, 'Notes');
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === body.recruitId) {
        sheet.getRange(i + 1, 2).setValue(body.content);
        sheet.getRange(i + 1, 3).setValue(new Date().toISOString());
        return { ok: true };
      }
    }
    sheet.appendRow([body.recruitId, body.content, new Date().toISOString()]);
    return { ok: true };
  });
}

function isLastActiveAdmin(data, email) {
  const admins = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) === 'admin' && String(data[i][3]) === 'yes') {
      admins.push(String(data[i][0] || '').toLowerCase());
    }
  }
  return admins.length === 1 && admins[0] === String(email || '').toLowerCase();
}

function manageUser(ss, user, body) {
  return withLock(() => {
    const sheet = getSheet(ss, 'Users');
    const email = String(body.email || '').toLowerCase();
    const actor = String((user && user.email) || '').toLowerCase();
    const data = sheet.getDataRange().getValues();

    if (body.op === 'add') {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0] || '').toLowerCase() === email) {
          return { error: 'User already exists' };
        }
      }
      sheet.appendRow([email, body.name || body.email || email, body.role || 'brother', 'yes']);
      return { ok: true };
    }

    if (body.op === 'remove') {
      if (email && email === actor) return { error: 'You cannot remove yourself' };
      if (isLastActiveAdmin(data, email)) return { error: 'Cannot remove the last admin' };
      for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][0] || '').toLowerCase() === email) sheet.deleteRow(i + 1);
      }
      return { ok: true };
    }

    if (body.op === 'setRole') {
      if (body.role !== 'admin' && isLastActiveAdmin(data, email)) {
        return { error: 'Cannot demote the last admin' };
      }
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0] || '').toLowerCase() === email) {
          sheet.getRange(i + 1, 3).setValue(body.role);
        }
      }
      return { ok: true };
    }

    return { error: 'Unknown user operation' };
  });
}

function wipeCycle(ss) {
  return withLock(() => {
    ['Recruits', 'Events', 'EventRecruits', 'Votes', 'Notes'].forEach(name => {
      const sheet = getSheet(ss, name);
      if (sheet && sheet.getLastRow() > 1) {
        sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
      }
    });
    return { ok: true, message: 'Cycle wiped. Users preserved.' };
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

const PHOTO_FOLDER_NAME = 'Recruit Photos';
const PHOTO_FOLDER_PROP = 'PHOTO_FOLDER_ID';
const PHOTO_FETCH_LIMIT = 20;

function getPhotoFolder(ss) {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty(PHOTO_FOLDER_PROP);
  if (cached) {
    try {
      const existing = DriveApp.getFolderById(cached);
      if (existing && existing.getName() === PHOTO_FOLDER_NAME) return existing;
    } catch (err) {}
  }
  const file = DriveApp.getFileById(ss.getId());
  const parents = file.getParents();
  if (!parents.hasNext()) throw new Error('Spreadsheet has no parent folder');
  const parent = parents.next();
  const found = parent.getFoldersByName(PHOTO_FOLDER_NAME);
  const folder = found.hasNext() ? found.next() : parent.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty(PHOTO_FOLDER_PROP, folder.getId());
  return folder;
}

function listImageFiles(folder) {
  const files = [];
  const iterator = folder.getFiles();
  while (iterator.hasNext()) {
    const file = iterator.next();
    const mime = String(file.getMimeType() || '');
    if (mime.indexOf('image/') !== 0) continue;
    files.push({ fileId: file.getId(), fileName: file.getName() });
  }
  return files;
}

function decodePhoto(dataBase64) {
  let raw = String(dataBase64 == null ? '' : dataBase64).trim();
  const marker = raw.indexOf('base64,');
  if (marker !== -1) raw = raw.slice(marker + 'base64,'.length);
  raw = raw.replace(/\s/g, '');
  if (!raw) throw new Error('Missing photo data');
  if (raw.length > 500000) throw new Error('Photo is too large');
  return Utilities.base64Decode(raw);
}

function savePhotoFile(ss, recruitName, bytes) {
  const folder = getPhotoFolder(ss);
  const safe = textField(recruitName).replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim() || 'Recruit';
  const blob = Utilities.newBlob(bytes, 'image/jpeg', safe + '.jpg');
  const file = folder.createFile(blob);
  return file.getId();
}

function headerOf(values) {
  return (values[0] || []).map(cell => String(cell == null ? '' : cell).trim());
}

function columnIndex(header, name) {
  return header.indexOf(name);
}

function recruitRow(values, header, recruitId) {
  const idCol = columnIndex(header, 'id');
  const nameCol = columnIndex(header, 'name');
  const fileCol = columnIndex(header, 'photoFileId');
  const sourceCol = columnIndex(header, 'photoSource');
  if (idCol < 0 || fileCol < 0 || sourceCol < 0) throw new Error('Recruits sheet is missing photo columns');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(recruitId)) {
      return {
        row: i,
        name: nameCol < 0 ? '' : textField(values[i][nameCol]),
        photoFileId: textField(values[i][fileCol]),
        photoSource: textField(values[i][sourceCol]),
        fileCol: fileCol,
        sourceCol: sourceCol,
      };
    }
  }
  return null;
}

function uploadPhoto(ss, body) {
  return withLock(() => {
    const recruitId = textField(body && body.recruitId);
    if (!recruitId) return { error: 'Missing recruit' };
    const bytes = decodePhoto(body && body.dataBase64);
    const sheet = getSheet(ss, 'Recruits');
    const values = sheet.getDataRange().getValues();
    const located = recruitRow(values, headerOf(values), recruitId);
    if (!located) return { error: 'Recruit not found' };
    const fileId = savePhotoFile(ss, located.name, bytes);
    sheet.getRange(located.row + 1, located.fileCol + 1).setValue(fileId);
    sheet.getRange(located.row + 1, located.sourceCol + 1).setValue('upload');
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

function getPhotos(ss, user, body) {
  const me = getMe(ss, user);
  if (me.error) return me;
  const requested = Array.isArray(body && body.ids) ? body.ids : [];
  const ids = [];
  const seen = {};
  for (let i = 0; i < requested.length && ids.length < PHOTO_FETCH_LIMIT; i++) {
    const id = textField(requested[i]);
    if (!id || seen[id]) continue;
    seen[id] = true;
    ids.push(id);
  }
  if (!ids.length) return { photos: {} };
  const recruits = rowsToObjects(getSheet(ss, 'Recruits'));
  const allowed = {};
  recruits.forEach(recruit => {
    const id = textField(recruit.photoFileId);
    if (id) allowed[id] = true;
  });
  const isAdmin = me.role === 'admin';
  let folder = null;
  const photos = {};
  ids.forEach(id => {
    let file = null;
    if (allowed[id]) {
      file = openDriveFile(id);
    } else if (isAdmin) {
      if (!folder) {
        try { folder = getPhotoFolder(ss); } catch (err) { folder = null; }
      }
      file = openDriveFile(id);
      if (!fileInPhotoFolder(file, folder)) file = null;
    }
    if (!file) return;
    try {
      const blob = file.getBlob();
      const mime = blob.getContentType() || file.getMimeType() || 'image/jpeg';
      photos[id] = 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes());
    } catch (err) {}
  });
  return { photos: photos };
}

function recruitsFromValues(values) {
  const header = headerOf(values);
  const recruits = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    let any = false;
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      if (!header[c]) continue;
      obj[header[c]] = row[c];
      if (cellNonEmpty(row[c])) any = true;
    }
    if (any) recruits.push(obj);
  }
  return { header: header, recruits: recruits };
}

function writeFolderLinks(sheet, values, header, linked) {
  if (!linked || !linked.length) return;
  const idCol = columnIndex(header, 'id');
  const fileCol = columnIndex(header, 'photoFileId');
  const sourceCol = columnIndex(header, 'photoSource');
  if (idCol < 0 || fileCol < 0 || sourceCol < 0) throw new Error('Recruits sheet is missing photo columns');
  const rowById = {};
  for (let i = 1; i < values.length; i++) rowById[String(values[i][idCol])] = i;
  linked.forEach(item => {
    const row = rowById[String(item.recruitId)];
    if (row == null) return;
    if (textField(values[row][fileCol]) || textField(values[row][sourceCol])) return;
    sheet.getRange(row + 1, fileCol + 1).setValue(item.fileId);
    sheet.getRange(row + 1, sourceCol + 1).setValue('folder');
  });
}

function syncPhotoFolder(ss) {
  return withLock(() => {
    const folder = getPhotoFolder(ss);
    const files = listImageFiles(folder);
    const sheet = getSheet(ss, 'Recruits');
    const values = sheet.getDataRange().getValues();
    const parsed = recruitsFromValues(values);
    const plan = planPhotoLinks(files, parsed.recruits);
    writeFolderLinks(sheet, values, parsed.header, plan.linked);
    return plan;
  });
}

function linkPhoto(ss, body) {
  return withLock(() => {
    const fileId = textField(body && body.fileId);
    const recruitId = textField(body && body.recruitId);
    if (!fileId || !recruitId) return { error: 'Missing photo link' };
    const folder = getPhotoFolder(ss);
    const file = openDriveFile(fileId);
    if (!fileInPhotoFolder(file, folder)) return { error: 'Photo is not in the Recruit Photos folder' };
    const sheet = getSheet(ss, 'Recruits');
    const values = sheet.getDataRange().getValues();
    const located = recruitRow(values, headerOf(values), recruitId);
    if (!located) return { error: 'Recruit not found' };
    if (located.photoFileId || located.photoSource) return { error: 'Recruit already has a photo' };
    sheet.getRange(located.row + 1, located.fileCol + 1).setValue(fileId);
    sheet.getRange(located.row + 1, located.sourceCol + 1).setValue('folder');
    return { ok: true, photoFileId: fileId, photoSource: 'folder' };
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    doPost: doPost,
    rowsToObjects: rowsToObjects,
    castVote: castVote,
    manageUser: manageUser,
    bootstrap: bootstrap,
    getMe: getMe,
    saveNote: saveNote,
    getAdminData: getAdminData,
    getVoteData: getVoteData,
    addRecruit: addRecruit,
    ensureSheets: ensureSheets,
    deleteRecruit: deleteRecruit,
    uploadPhoto: uploadPhoto,
    getPhotos: getPhotos,
    syncPhotoFolder: syncPhotoFolder,
    linkPhoto: linkPhoto,
    normalizeName: normalizeName,
    similarity: similarity,
    planPhotoLinks: planPhotoLinks,
  };
}
