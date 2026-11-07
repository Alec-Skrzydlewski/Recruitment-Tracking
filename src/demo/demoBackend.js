import { isValidEventDate } from '../lib/eventDate.js'
// In-memory backend for the public demo. It implements the same actions and
// the same authorization/validation rules as apps-script/Code.gs, against
// example seed data, with no live backend access. Headshots are local assets.
import { demoSeed, abstractAvatar } from './seed.js';

const ROLES = ['admin', 'brother'];
const WIPE_CONFIRMATION = 'WIPE CYCLE';
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function text(value, max, label, required) {
  const t = value == null ? '' : String(value).trim();
  if (t.length > max) throw fail(label + ' is too long (max ' + max + ' characters).', 'INVALID');
  if (required && !t) throw fail(label + ' is required.', 'INVALID');
  return t;
}

function id(value, label) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!ID_RE.test(v)) throw fail('Invalid ' + label, 'INVALID');
  return v;
}

export function createDemoBackend({ latencyMs = 120, seed = demoSeed, photoUrls = {} } = {}) {
  let db = clone(seed());
  let seq = 0;
  const seenRequests = new Map();

  const lower = s => String(s || '').toLowerCase();
  const activeUser = email => db.users.find(u => lower(u.email) === lower(email) && u.active === 'yes') || null;
  const requireMember = email => {
    const me = activeUser(email);
    if (!me) throw fail('Not authorized', 'FORBIDDEN');
    return { email: me.email, name: me.name, role: me.role };
  };
  const requireAdmin = email => {
    const me = activeUser(email);
    if (!me || me.role !== 'admin') throw fail('Admin only', 'FORBIDDEN');
    return me;
  };
  const newId = prefix => prefix + '-' + Date.now().toString(36) + '-' + (++seq);
  const once = (requestId, fn) => {
    if (requestId && seenRequests.has(requestId)) return seenRequests.get(requestId);
    const out = fn();
    if (requestId) seenRequests.set(requestId, out);
    return out;
  };
  const counts = () => ({
    Recruits: db.recruits.length, Events: db.events.length, EventRecruits: db.attendance.length, Votes: db.votes.length, Notes: db.notes.length,
  });

  // Content fingerprint of the cycle data (demo stand-in for the server's
  // SHA-256): changes on any edit, even when row counts stay the same.
  const fingerprint = () => {
    const json = JSON.stringify([db.recruits, db.events, db.attendance, db.votes, db.notes]);
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < json.length; i++) {
      const c = json.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822507) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + ':' + json.length;
  };

  const invalidVotes = () => {
    const recruits = new Set(db.recruits.map(r => r.id));
    const events = new Set(db.events.map(e => e.id));
    const present = new Set(db.attendance.map(a => a.eventId + '\u0000' + a.recruitId));
    const counts = { missingRecruit: 0, missingEvent: 0, notPresent: 0, invalidScore: 0 };
    const indexes = [];
    db.votes.forEach((v, i) => {
      const n = Number(v.score);
      const reason = !recruits.has(v.recruitId) ? 'missingRecruit'
        : !events.has(v.eventId) ? 'missingEvent'
          : !present.has(v.eventId + '\u0000' + v.recruitId) ? 'notPresent'
            : (!Number.isInteger(n) || n < 1 || n > 10 || typeof v.score === 'boolean' || v.score === '' || v.score == null) ? 'invalidScore' : '';
      if (reason) { counts[reason] += 1; indexes.push(i); }
    });
    return { indexes, counts };
  };

  const handlers = {
    bootstrap: email => requireMember(email),
    getMe: email => requireMember(email),
    getVoteData(email) {
      const me = requireMember(email);
      return {
        me,
        recruits: db.recruits.map(r => ({ id: r.id, name: r.name, major: r.major, secondMajor: r.secondMajor, gradYear: r.gradYear, photoFileId: r.photoFileId })),
        events: db.events,
        attendance: db.attendance,
        myVotes: db.votes.filter(v => lower(v.userEmail) === lower(email)).map(v => ({ eventId: v.eventId, recruitId: v.recruitId, score: v.score })),
      };
    },
    castVote(email, body) {
      requireMember(email);
      const eventId = typeof body.eventId === 'string' && ID_RE.test(body.eventId) ? body.eventId : '';
      const recruitId = typeof body.recruitId === 'string' && ID_RE.test(body.recruitId) ? body.recruitId : '';
      const score = Number(body.score);
      if (!eventId || !recruitId || typeof body.score === 'boolean' || !Number.isInteger(score) || score < 1 || score > 10) throw fail('Invalid vote', 'INVALID');
      if (!db.events.some(e => e.id === eventId) || !db.recruits.some(r => r.id === recruitId)) throw fail('Invalid vote', 'INVALID');
      if (!db.attendance.some(a => a.eventId === eventId && a.recruitId === recruitId)) throw fail('Invalid vote', 'INVALID');
      const existing = db.votes.find(v => v.eventId === eventId && v.recruitId === recruitId && lower(v.userEmail) === lower(email));
      const timestamp = new Date().toISOString();
      if (existing) Object.assign(existing, { score, timestamp });
      else db.votes.push({ eventId, recruitId, userEmail: lower(email), score, timestamp });
      return { ok: true, eventId, recruitId, score };
    },
    getPhotos(email, body) {
      requireMember(email);
      const photos = {};
      (Array.isArray(body.ids) ? body.ids : []).slice(0, 20).forEach(pid => {
        const recruit = db.recruits.find(r => r.photoFileId === pid);
        if (recruit) photos[pid] = recruit.photoPath ? (photoUrls[recruit.photoPath] || recruit.photoPath) : abstractAvatar(pid);
      });
      return { photos, missing: [] };
    },
    getAdminData(email) {
      requireAdmin(email);
      return clone({ schemaVersion: 2, cycleFingerprint: fingerprint(), ...db });
    },
    addRecruit(email, body) {
      requireAdmin(email);
      const name = text(body.name, 120, 'Name', true);
      const major = text(body.major, 120, 'Major', true);
      const secondMajor = text(body.secondMajor, 120, 'Second major', false);
      const gradYear = String(body.gradYear == null ? '' : body.gradYear).trim();
      if (!gradYear) throw fail('Graduation year is required.', 'INVALID');
      if (!/^\d{4}$/.test(gradYear)) throw fail('Graduation year must be a 4-digit year.', 'INVALID');
      if (Number(gradYear) < 2000 || Number(gradYear) > 2100) throw fail('Graduation year is out of range.', 'INVALID');
      if (secondMajor && lower(secondMajor) === lower(major)) throw fail('Second major must be different from the major.', 'INVALID');
      return once(body.requestId, () => {
        const rid = newId('r');
        const photoFileId = body.photoDataBase64 ? 'demo-photo-' + rid : '';
        db.recruits.push({ id: rid, name, major, secondMajor, gradYear, photoFileId, photoSource: photoFileId ? 'upload' : '' });
        return photoFileId ? { id: rid, photoFileId, photoSource: 'upload' } : { id: rid };
      });
    },
    deleteRecruit(email, body) {
      requireAdmin(email);
      const rid = id(body.id, 'id');
      const before = db.votes.length;
      db.recruits = db.recruits.filter(r => r.id !== rid);
      db.votes = db.votes.filter(v => v.recruitId !== rid);
      db.attendance = db.attendance.filter(a => a.recruitId !== rid);
      db.notes = db.notes.filter(n => n.recruitId !== rid);
      return { ok: true, votesDeleted: before - db.votes.length };
    },
    uploadPhoto(email, body) {
      requireAdmin(email);
      const rid = id(body.recruitId, 'recruit');
      const recruit = db.recruits.find(r => r.id === rid);
      if (!recruit) throw fail('Recruit not found', 'NOT_FOUND');
      recruit.photoFileId = 'demo-photo-' + rid + '-' + (++seq);
      recruit.photoSource = 'upload';
      return { ok: true, photoFileId: recruit.photoFileId, photoSource: 'upload' };
    },
    checkPhotoAccess(email) {
      requireAdmin(email);
      return { ok: true, sheetFile: true, parentFolder: true, photoFolder: false, imageCount: 0, demo: true };
    },
    syncPhotoFolder(email) {
      requireAdmin(email);
      return { linked: [], unmatched: [], demo: true };
    },
    linkPhoto(email) {
      requireAdmin(email);
      throw fail('The demo has no photo folder.', 'INVALID');
    },
    addEvent(email, body) {
      requireAdmin(email);
      const name = text(body.name, 120, 'Event name', true);
      const raw = body.date;
      const date = raw === undefined || raw === null || raw === '' ? '' : raw;
      if (date !== '' && !isValidEventDate(date)) throw fail('Event date must be a real calendar date like 2026-09-15.', 'INVALID');
      return once(body.requestId, () => {
        const eid = newId('e');
        db.events.push({ id: eid, name, date });
        return date ? { id: eid, date } : { id: eid };
      });
    },
    deleteEvent(email, body) {
      requireAdmin(email);
      const eid = id(body.id, 'id');
      const before = db.votes.length;
      db.events = db.events.filter(e => e.id !== eid);
      db.votes = db.votes.filter(v => v.eventId !== eid);
      db.attendance = db.attendance.filter(a => a.eventId !== eid);
      return { ok: true, votesDeleted: before - db.votes.length };
    },
    setAttendance(email, body) {
      requireAdmin(email);
      const eventId = id(body.eventId, 'event');
      const recruitId = id(body.recruitId, 'recruit');
      if (typeof body.present !== 'boolean') throw fail('Invalid attendance', 'INVALID');
      if (!db.events.some(e => e.id === eventId)) throw fail('Event not found', 'NOT_FOUND');
      if (!db.recruits.some(r => r.id === recruitId)) throw fail('Recruit not found', 'NOT_FOUND');
      db.attendance = db.attendance.filter(a => !(a.eventId === eventId && a.recruitId === recruitId));
      const before = db.votes.length;
      if (body.present) db.attendance.push({ eventId, recruitId });
      else db.votes = db.votes.filter(v => !(v.eventId === eventId && v.recruitId === recruitId));
      return { ok: true, present: body.present, votesDeleted: before - db.votes.length };
    },
    saveNote(email, body) {
      requireAdmin(email);
      const recruitId = id(body.recruitId, 'recruit');
      const content = text(body.content, 5000, 'Note', false);
      if (!db.recruits.some(r => r.id === recruitId)) throw fail('Recruit not found', 'NOT_FOUND');
      const updatedAt = new Date().toISOString();
      const note = db.notes.find(n => n.recruitId === recruitId);
      if (note) Object.assign(note, { content, updatedAt });
      else db.notes.push({ recruitId, content, updatedAt });
      return { ok: true, updatedAt };
    },
    manageUser(email, body) {
      requireAdmin(email);
      const target = lower(String(body.email || '').trim());
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) || target.length > 254) throw fail('Enter a valid email address.', 'INVALID');
      const admins = db.users.filter(u => u.role === 'admin' && u.active === 'yes').map(u => lower(u.email));
      if (body.op === 'add') {
        const role = body.role == null ? 'brother' : body.role;
        if (!ROLES.includes(role)) throw fail('Invalid role', 'INVALID');
        if (db.users.some(u => lower(u.email) === target)) throw fail('User already exists', 'CONFLICT');
        db.users.push({ email: target, name: text(body.name, 120, 'Name', false) || target, role, active: 'yes' });
        return { ok: true };
      }
      if (body.op === 'remove') {
        if (target === lower(email)) throw fail('You cannot remove yourself', 'FORBIDDEN');
        if (admins.length === 1 && admins[0] === target) throw fail('Cannot remove the last admin', 'FORBIDDEN');
        db.users = db.users.filter(u => lower(u.email) !== target);
        return { ok: true };
      }
      if (body.op === 'setRole') {
        if (!ROLES.includes(body.role)) throw fail('Invalid role', 'INVALID');
        if (body.role !== 'admin' && admins.length === 1 && admins[0] === target) throw fail('Cannot demote the last admin', 'FORBIDDEN');
        const user = db.users.find(u => lower(u.email) === target);
        if (!user) throw fail('User not found', 'NOT_FOUND');
        user.role = body.role;
        return { ok: true };
      }
      throw fail('Unknown user operation', 'INVALID');
    },
    // Mirrors Code.gs findInvalidVotes: criteria are fixed here, never sent.
    getVoteCleanup(email) {
      requireAdmin(email);
      const found = invalidVotes();
      return { count: found.indexes.length, byReason: found.counts, cycleFingerprint: fingerprint() };
    },
    cleanupInvalidVotes(email, body) {
      requireAdmin(email);
      if (body.confirm !== 'DELETE INVALID VOTES') throw fail('Confirm the invalid-vote cleanup.', 'INVALID');
      if (!body.expectedFingerprint || !Number.isInteger(body.expectedCount) || body.expectedCount < 1) throw fail('Review the cleanup preview first.', 'INVALID');
      const found = invalidVotes();
      if (body.expectedFingerprint !== fingerprint() || found.indexes.length !== body.expectedCount) {
        throw fail('Vote data changed since the preview. Review it again.', 'CONFLICT');
      }
      const drop = new Set(found.indexes);
      db.votes = db.votes.filter((v, i) => !drop.has(i));
      return { ok: true, deleted: drop.size, byReason: found.counts };
    },
    wipeCycle(email, body) {
      requireAdmin(email);
      if (body.confirm !== WIPE_CONFIRMATION) throw fail('Type ' + WIPE_CONFIRMATION + ' to confirm.', 'INVALID');
      const now = counts();
      if (!body.expectedFingerprint || body.expectedFingerprint !== fingerprint()) {
        throw fail('Cycle data changed since this page loaded. Reload and review before wiping.', 'CONFLICT');
      }
      db = { ...db, recruits: [], events: [], attendance: [], votes: [], notes: [] };
      return { ok: true, cleared: now, message: 'Cycle wiped. Users preserved.' };
    },
  };

  return {
    async call(email, action, extra = {}) {
      if (latencyMs) await new Promise(resolve => setTimeout(resolve, latencyMs));
      const handler = handlers[action];
      if (!handler) throw fail('Unknown action', 'UNKNOWN_ACTION');
      return clone(handler(email, extra || {}));
    },
    reset() {
      db = clone(seed());
      seenRequests.clear();
    },
    snapshot() {
      return clone(db);
    },
  };
}
