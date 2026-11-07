// One canonical tally used by the admin dashboard (live and demo).
//
// A vote counts when its score is an integer 1–10 for a recruit and event
// that both exist and the recruit is marked present at that event. Deletes
// and absences permanently delete the affected votes on the server, so valid
// data never contains anything else. The checks below are only a defensive
// guard against malformed or stale snapshots: such rows are never counted
// and are not reported as a category. Existing malformed rows are removed by
// the admin's explicit invalid-vote cleanup (Settings).

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
    byRecruit[String(r.id)] = { sum: 0, activeCount: 0, average: null, voters: new Set(), byEvent: {} };
  });
  ((data && data.votes) || []).forEach(v => {
    const rid = String(v.recruitId);
    const eid = String(v.eventId);
    const score = validScore(v.score);
    if (!recruitIds.has(rid) || score === null || !eventIds.has(eid) || !present.has(key(eid, rid))) return;
    const entry = byRecruit[rid];
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
  const activeVotes = Object.values(byRecruit).reduce((s, e) => s + e.activeCount, 0);
  return { byRecruit, activeVotes };
}

export function formatAverage(avg) {
  return avg == null ? '—' : avg.toFixed(1);
}
