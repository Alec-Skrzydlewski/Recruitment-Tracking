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

function ensureSheets(ss) {
  const needed = {
    Users: ['email', 'name', 'role', 'active'],
    Recruits: ['id', 'name', 'major', 'photoUrl', 'secondMajor', 'minor', 'programLevel', 'gradTerm'],
    Events: ['id', 'name'],
    EventRecruits: ['eventId', 'recruitId'],
    Votes: ['eventId', 'recruitId', 'userEmail', 'score', 'timestamp'],
    Notes: ['recruitId', 'content', 'updatedAt']
  };
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
      photoUrl: textField(source.photoUrl),
      secondMajor: textField(source.secondMajor),
      minor: textField(source.minor),
      programLevel: textField(source.programLevel),
      gradTerm: textField(source.gradTerm)
    };
    const row = header.map(key => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '');
    sheet.appendRow(row);
    return { id: id };
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

if (typeof module !== 'undefined') { module.exports = { doPost, rowsToObjects, castVote, manageUser, bootstrap, getMe, saveNote, getAdminData, getVoteData, addRecruit, ensureSheets }; }
