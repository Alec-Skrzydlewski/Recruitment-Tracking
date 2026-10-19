// Recruitment Tracker — Google Apps Script Backend
// Deploy as Web App: Execute as Me, Who has access: Anyone

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const token = body.token;
    const user = verifyToken(token);
    if (!user) return json({ error: 'Invalid or expired login' });

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
      case 'manageUser': result = requireAdmin(ss, user) && manageUser(ss, body); break;
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
      return { email: data.email.toLowerCase(), name: data.name || data.email };
    }
  } catch (e) {}
  return null;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ensureSheets(ss) {
  const needed = {
    Users: ['email', 'name', 'role', 'active'],
    Recruits: ['id', 'name', 'major', 'photoUrl'],
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
    }
  });
}

function getSheet(ss, name) {
  return ss.getSheetByName(name);
}

function rowsToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  }).filter(o => o.email || o.id || o.eventId);
}

function bootstrap(ss, user) {
  const usersSheet = getSheet(ss, 'Users');
  const existing = rowsToObjects(usersSheet);
  if (existing.length === 0) {
    usersSheet.appendRow([user.email, user.name, 'admin', 'yes']);
    return { role: 'admin', bootstrapped: true };
  }
  const me = existing.find(u => u.email === user.email && u.active === 'yes');
  return me ? { role: me.role } : { error: 'Not authorized. Ask an admin to add you.' };
}

function getMe(ss, user) {
  const users = rowsToObjects(getSheet(ss, 'Users'));
  const me = users.find(u => u.email === user.email && u.active === 'yes');
  if (!me) return { error: 'Not authorized' };
  return { email: me.email, name: me.name, role: me.role };
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
  const votes = rowsToObjects(getSheet(ss, 'Votes')).filter(v => v.userEmail === user.email);
  return { me, recruits, events, attendance, myVotes: votes };
}

function castVote(ss, user, body) {
  const { eventId, recruitId, score } = body;
  if (!eventId || !recruitId || score < 1 || score > 10) return { error: 'Invalid vote' };
  const sheet = getSheet(ss, 'Votes');
  const data = sheet.getDataRange().getValues();
  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === eventId && data[i][1] === recruitId && data[i][2] === user.email) {
      sheet.getRange(i + 1, 4).setValue(score);
      sheet.getRange(i + 1, 5).setValue(new Date().toISOString());
      found = true;
      break;
    }
  }
  if (!found) {
    sheet.appendRow([eventId, recruitId, user.email, score, new Date().toISOString()]);
  }
  return { ok: true };
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

function addRecruit(ss, body) {
  const id = Utilities.getUuid();
  getSheet(ss, 'Recruits').appendRow([id, body.name || '', body.major || '', body.photoUrl || '']);
  return { id };
}

function deleteRecruit(ss, body) {
  // Simple: clear by filtering (for production you'd delete the row)
  const sheet = getSheet(ss, 'Recruits');
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === body.id) sheet.deleteRow(i + 1);
  }
  return { ok: true };
}

function addEvent(ss, body) {
  const id = Utilities.getUuid();
  getSheet(ss, 'Events').appendRow([id, body.name || '']);
  return { id };
}

function deleteEvent(ss, body) {
  const sheet = getSheet(ss, 'Events');
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === body.id) sheet.deleteRow(i + 1);
  }
  return { ok: true };
}

function toggleAttendance(ss, body) {
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
}

function saveNote(ss, body) {
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
}

function manageUser(ss, body) {
  const sheet = getSheet(ss, 'Users');
  const data = sheet.getDataRange().getValues();
  if (body.op === 'add') {
    sheet.appendRow([body.email.toLowerCase(), body.name || body.email, body.role || 'brother', 'yes']);
  } else if (body.op === 'remove') {
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === body.email.toLowerCase()) sheet.deleteRow(i + 1);
    }
  } else if (body.op === 'setRole') {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === body.email.toLowerCase()) {
        sheet.getRange(i + 1, 3).setValue(body.role);
      }
    }
  }
  return { ok: true };
}

function wipeCycle(ss) {
  ['Recruits', 'Events', 'EventRecruits', 'Votes', 'Notes'].forEach(name => {
    const sheet = getSheet(ss, name);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }
  });
  return { ok: true, message: 'Cycle wiped. Users preserved.' };
}
