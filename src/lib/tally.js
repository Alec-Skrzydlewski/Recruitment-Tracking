// One canonical tally used by the admin dashboard (live and demo).
//
// Active vote: score 1–10 for a recruit and event that both still exist and
// where the recruit is marked present at that event. Active averages use only
// active votes. Votes that reference a deleted event/recruit or an attendance
// row that was removed are kept in the Sheet as history but excluded here, and
// the dashboard shows how many were excluded so nothing disappears silently.

function key(a, b) {
  return String(a) + '\u0000' + String(b);
}

function validScore(score) {
  const n = Number(score);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

export function buildTally(data) {
  const recruits = (data && data.recruits) || [];
  const events = (data && data.events) || [];
  const recruitIds = new Set(recruits.map(r => String(r.id)));
  const eventIds = new Set(events.map(e => String(e.id)));
  const present = new Set(((data && data.attendance) || []).map(a => key(a.eventId, a.recruitId)));
  const byRecruit = {};
  recruits.forEach(r => {
    byRecruit[String(r.id)] = { sum: 0, activeCount: 0, average: null, excludedCount: 0, voters: new Set(), byEvent: {} };
  });
  const excluded = { deletedRecruit: 0, deletedEvent: 0, notPresent: 0, invalidScore: 0 };
  ((data && data.votes) || []).forEach(v => {
    const rid = String(v.recruitId);
    const eid = String(v.eventId);
    const score = validScore(v.score);
    if (!recruitIds.has(rid)) { excluded.deletedRecruit += 1; return; }
    const entry = byRecruit[rid];
    if (score === null) { excluded.invalidScore += 1; entry.excludedCount += 1; return; }
    if (!eventIds.has(eid)) { excluded.deletedEvent += 1; entry.excludedCount += 1; return; }
    if (!present.has(key(eid, rid))) { excluded.notPresent += 1; entry.excludedCount += 1; return; }
    entry.sum += score;
    entry.activeCount += 1;
    entry.voters.add(String(v.userEmail || '').toLowerCase());
    const ev = entry.byEvent[eid] || (entry.byEvent[eid] = { sum: 0, count: 0 });
    ev.sum += score;
    ev.count += 1;
  });
  Object.keys(byRecruit).forEach(id => {
    const entry = byRecruit[id];
    entry.average = entry.activeCount ? entry.sum / entry.activeCount : null;
    entry.voterCount = entry.voters.size;
    delete entry.voters;
    Object.keys(entry.byEvent).forEach(eid => {
      const ev = entry.byEvent[eid];
      ev.average = ev.sum / ev.count;
    });
  });
  const totalExcluded = excluded.deletedRecruit + excluded.deletedEvent + excluded.notPresent + excluded.invalidScore;
  const activeVotes = Object.values(byRecruit).reduce((s, e) => s + e.activeCount, 0);
  return { byRecruit, excluded, totalExcluded, activeVotes };
}

export function formatAverage(avg) {
  return avg == null ? '—' : avg.toFixed(1);
}
