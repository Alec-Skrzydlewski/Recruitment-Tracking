// In-memory backend for the public demo. It implements the same actions and
// the same authorization/validation rules as apps-script/Code.gs, against
// fictional seed data, with no network access of any kind.
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

export function createDemoBackend({ latencyMs = 120, seed = demoSeed } = {}) {
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
        if (db.recruits.some(r => r.photoFileId === pid)) photos[pid] = abstractAvatar(pid);
      });
      return { photos, missing: [] };
    },
    getAdminData(email) {
      requireAdmin(email);
      return clone({ schemaVersion: 2, ...db });
    },
    addRecruit(email, body) {
      requireAdmin(email);
      const name = text(body.name, 120, 'Name', true);
      const major = text(body.major, 120, 'Major', true);
      const secondMajor = text(body.secondMajor, 120, 'Second major', false);
      const gradYear = text(body.gradYear, 4, 'Graduation year', false);
      if (gradYear && !/^\d{4}$/.test(gradYear)) throw fail('Graduation year must be a 4-digit year.', 'INVALID');
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
      db.recruits = db.recruits.filter(r => r.id !== rid);
      return { ok: true };
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
      return once(body.requestId, () => {
        const eid = newId('e');
        db.events.push({ id: eid, name });
        return { id: eid };
      });
    },
    deleteEvent(email, body) {
      requireAdmin(email);
      const eid = id(body.id, 'id');
      db.events = db.events.filter(e => e.id !== eid);
      return { ok: true };
    },
    setAttendance(email, body) {
      requireAdmin(email);
      const eventId = id(body.eventId, 'event');
      const recruitId = id(body.recruitId, 'recruit');
      if (typeof body.present !== 'boolean') throw fail('Invalid attendance', 'INVALID');
      if (!db.events.some(e => e.id === eventId)) throw fail('Event not found', 'NOT_FOUND');
      if (!db.recruits.some(r => r.id === recruitId)) throw fail('Recruit not found', 'NOT_FOUND');
      db.attendance = db.attendance.filter(a => !(a.eventId === eventId && a.recruitId === recruitId));
      if (body.present) db.attendance.push({ eventId, recruitId });
      return { ok: true, present: body.present };
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
    wipeCycle(email, body) {
      requireAdmin(email);
      if (body.confirm !== WIPE_CONFIRMATION) throw fail('Type ' + WIPE_CONFIRMATION + ' to confirm.', 'INVALID');
      const now = counts();
      const expected = body.expected || {};
      if (Object.keys(now).some(k => Number(expected[k]) !== now[k])) throw fail('Data changed since you opened this page. Reload and try again.', 'CONFLICT');
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
