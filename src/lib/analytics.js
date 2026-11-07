// Results analytics for the admin Analytics tab (one recruit at a time).
// Pure functions over the admin snapshot (getAdminData); no I/O, no new
// permissions, no writes. buildAnalytics is the shared engine; the tab only
// uses buildRecruitAnalytics, which scopes it to a single recruit.
//
// Definitions (also shown on the page):
// - Valid ballot: the canonical tally rule (src/lib/tally.js): integer score
//   1–10 for a recruit and event that exist, with the recruit marked present
//   at that event. Anything else in a snapshot is ignored, never counted.
// - Votes by members later removed or demoted are kept and counted, the same
//   as the dashboard. Repeated rows for one (voter, event, recruit) each count
//   as a ballot in score statistics (as the dashboard does) but only once in
//   completion.
// - Mean = all-ballot mean (each ballot weighs the same). Equal-event mean =
//   mean of the recruit's per-event means (each rated event weighs the same).
//   They differ when events have different numbers of ballots.
// - SD = sample standard deviation (n − 1); shown only with 2+ ballots.
// - Events have no date in the schema, so nothing here is a time trend.
//   Vote timestamps record the last edit of a ballot, not a history.

import { validScore, key } from './tally.js'

export const SMALL_SAMPLE = 3 // heuristic flag only, not a statistical threshold

const lower = v => String(v == null ? '' : v).trim().toLowerCase()

export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

export function median(xs) {
  if (!xs.length) return null
  const s = xs.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function sampleSd(xs) {
  if (xs.length < 2) return null
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1))
}

export function histogram(xs) {
  const h = Array(10).fill(0)
  xs.forEach(x => { h[x - 1] += 1 })
  return h
}

export function summarize(xs) {
  return {
    n: xs.length,
    mean: mean(xs),
    median: median(xs),
    sd: sampleSd(xs),
    min: xs.length ? Math.min(...xs) : null,
    max: xs.length ? Math.max(...xs) : null,
    range: xs.length ? Math.max(...xs) - Math.min(...xs) : null,
    histogram: histogram(xs),
    small: xs.length < SMALL_SAMPLE,
  }
}

export const EMPTY_FILTERS = Object.freeze({ eventIds: [], search: '', gradYears: [], majors: [] })

function recruitMatches(r, f) {
  if (f.search.trim() && !lower(r.name).includes(lower(f.search))) return false
  if (f.gradYears.length && !f.gradYears.includes(String(r.gradYear || '').trim())) return false
  if (f.majors.length && !f.majors.some(m => m === String(r.major || '').trim() || m === String(r.secondMajor || '').trim())) return false
  return true
}

// Rank by all-ballot mean, highest first. Equal means share a rank
// (competition ranking 1, 2, 2, 4) and are flagged as tied. Unrated
// recruits get no rank.
export function rankRows(rows) {
  const rated = rows.filter(r => r.overall.n > 0).slice().sort((a, b) => b.overall.mean - a.overall.mean)
  const ranks = {}
  rated.forEach((r, i) => {
    const prev = rated[i - 1]
    ranks[r.id] = prev && prev.overall.mean === r.overall.mean ? ranks[prev.id] : i + 1
  })
  const count = {}
  Object.values(ranks).forEach(k => { count[k] = (count[k] || 0) + 1 })
  return rows.map(r => ({ ...r, rank: ranks[r.id] || null, tied: !!(ranks[r.id] && count[ranks[r.id]] > 1) }))
}

export function buildAnalytics(data, filters = EMPTY_FILTERS) {
  const f = { ...EMPTY_FILTERS, ...filters }
  const recruits = (data && data.recruits) || []
  const events = (data && data.events) || []
  const users = (data && data.users) || []
  const eventIds = new Set(events.map(e => String(e.id)))
  const recruitIds = new Set(recruits.map(r => String(r.id)))
  const present = new Set()
  ;((data && data.attendance) || []).forEach(a => {
    if (eventIds.has(String(a.eventId)) && recruitIds.has(String(a.recruitId))) present.add(key(a.eventId, a.recruitId))
  })
  const selectedEvents = f.eventIds.length ? events.filter(e => f.eventIds.includes(String(e.id))) : events
  const selEventIds = new Set(selectedEvents.map(e => String(e.id)))
  const pool = recruits.filter(r => recruitMatches(r, f))
  const poolIds = new Set(pool.map(r => String(r.id)))
  const roster = new Set(users.filter(u => lower(u.active) === 'yes').map(u => lower(u.email)))

  // Valid ballots within scope (selected events × filtered recruits).
  const ballots = []
  ;((data && data.votes) || []).forEach(v => {
    const rid = String(v.recruitId)
    const eid = String(v.eventId)
    const score = validScore(v.score)
    if (score === null || !recruitIds.has(rid) || !eventIds.has(eid) || !present.has(key(eid, rid))) return
    if (!selEventIds.has(eid) || !poolIds.has(rid)) return
    ballots.push({ rid, eid, voter: lower(v.userEmail), score })
  })

  const byRecruit = {}
  pool.forEach(r => { byRecruit[String(r.id)] = [] })
  ballots.forEach(b => byRecruit[b.rid].push(b))

  const rows = pool.map(r => {
    const id = String(r.id)
    const mine = byRecruit[id]
    const scores = mine.map(b => b.score)
    const perEvent = selectedEvents.map(e => {
      const eid = String(e.id)
      const at = mine.filter(b => b.eid === eid)
      return { eventId: eid, name: e.name, date: e.date || '', attended: present.has(key(eid, id)), voters: new Set(at.map(b => b.voter)).size, ...summarize(at.map(b => b.score)) }
    })
    const rated = perEvent.filter(p => p.n > 0)
    return {
      id,
      name: r.name,
      gradYear: String(r.gradYear || '').trim(),
      major: r.major || '',
      secondMajor: r.secondMajor || '',
      overall: summarize(scores),
      voters: new Set(mine.map(b => b.voter)).size,
      eventsAttended: perEvent.filter(p => p.attended).length,
      eventsRated: rated.length,
      equalEventMean: rated.length ? mean(rated.map(p => p.mean)) : null,
      perEvent,
    }
  })

  // Event comparison (listed order; not chronological).
  const eventRows = selectedEvents.map(e => {
    const eid = String(e.id)
    const attendees = pool.filter(r => present.has(key(eid, String(r.id))))
    const mine = ballots.filter(b => b.eid === eid)
    const triples = new Set(mine.filter(b => roster.has(b.voter)).map(b => b.voter + '\u0000' + b.rid))
    const opportunities = roster.size * attendees.length
    return {
      eventId: eid,
      name: e.name,
      date: e.date || '',
      attendees: attendees.length,
      ratedRecruits: new Set(mine.map(b => b.rid)).size,
      voters: new Set(mine.map(b => b.voter)).size,
      ...summarize(mine.map(b => b.score)),
      completed: triples.size,
      opportunities,
      completion: opportunities ? triples.size / opportunities : null,
    }
  })

  const completed = eventRows.reduce((s, e) => s + e.completed, 0)
  const opportunities = eventRows.reduce((s, e) => s + e.opportunities, 0)
  const allVoters = new Set(ballots.map(b => b.voter))
  const participation = {
    rosterSize: roster.size,
    ballots: ballots.length,
    uniqueVoters: allVoters.size,
    rosterVoters: [...allVoters].filter(v => roster.has(v)).length,
    nonRosterVoters: [...allVoters].filter(v => !roster.has(v)).length,
    nonRosterBallots: ballots.filter(b => !roster.has(b.voter)).length,
    completed,
    opportunities,
    completion: opportunities ? completed / opportunities : null,
  }

  return {
    filters: f,
    rows: rankRows(rows),
    events: eventRows,
    overall: summarize(ballots.map(b => b.score)),
    participation,
    poolSize: pool.length,
    totalRecruits: recruits.length,
  }
}

export function fmt(x, digits = 2) {
  return x == null || Number.isNaN(x) ? '—' : Number(x).toFixed(digits)
}

// Spreadsheet formula guard: if the first non-whitespace character
// (spaces, tabs, CR/LF, NBSP and other Unicode spaces) is = + - @, or the
// value starts with a tab/CR, prefix an apostrophe. The original text is kept
// after the prefix. This reduces, but cannot guarantee against, formula
// evaluation in every spreadsheet program.
const FORMULA_START = /^[\s\u00a0\u2000-\u200b\u202f\u205f\u3000\ufeff]*[=+\-@]|^[\t\r]/

export function csvCell(v) {
  const s = v == null ? '' : String(v)
  const safe = FORMULA_START.test(s) ? "'" + s : s
  return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe
}

const num = (x, d = 2) => (x == null || Number.isNaN(x) ? '' : Number(x).toFixed(d))

// ---------- Individual recruit view (the Analytics tab) ----------

// Alphabetical recruit list for the selector. Option values are the stable
// recruit IDs. Duplicate names get the class year (or "no year"), and if
// still ambiguous a short ID suffix, so every label is distinct.
export function recruitChoices(data) {
  const recruits = ((data && data.recruits) || []).filter(r => r && r.id != null && String(r.id) !== '')
  const base = r => String(r.name || '').trim() || 'Unnamed recruit'
  const withYear = r => base(r) + ' (' + (String(r.gradYear || '').trim() ? 'Class of ' + String(r.gradYear).trim() : 'no year') + ')'
  const count = (list, fn) => list.reduce((m, r) => { m[fn(r)] = (m[fn(r)] || 0) + 1; return m }, {})
  const byName = count(recruits, r => lower(base(r)))
  const byYear = count(recruits, r => lower(withYear(r)))
  return recruits
    .map(r => {
      let label = base(r)
      if (byName[lower(label)] > 1) label = withYear(r)
      if (byYear[lower(withYear(r))] > 1) label = withYear(r) + ' · ' + String(r.id).slice(0, 6)
      return { id: String(r.id), label }
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
}

// The selected id if it still exists, otherwise the first alphabetical
// recruit (e.g. after the selected recruit was deleted), or '' when none.
export function resolveSelection(choices, selectedId) {
  if (choices.some(c => c.id === String(selectedId))) return String(selectedId)
  return choices.length ? choices[0].id : ''
}

// Results for ONE recruit. Only that recruit's ballots feed these numbers;
// nothing about other recruits is returned.
export function buildRecruitAnalytics(data, recruitId) {
  const recruit = ((data && data.recruits) || []).find(r => String(r.id) === String(recruitId))
  if (!recruit) return null
  const scoped = { ...data, recruits: [recruit] }
  const row = buildAnalytics(scoped).rows[0]
  const attendedOrRated = row.perEvent.filter(e => e.attended || e.n > 0)
  return {
    id: row.id,
    name: row.name,
    gradYear: row.gradYear,
    major: row.major,
    secondMajor: row.secondMajor,
    overall: row.overall,
    voters: row.voters,
    eventsAttended: row.eventsAttended,
    eventsRated: row.eventsRated,
    equalEventMean: row.equalEventMean,
    perEvent: attendedOrRated,
  }
}

// CSV for the selected recruit only: one overall row plus one row per
// attended event. Aggregates only, no voter identities.
export function recruitCsv(detail) {
  if (!detail) return ''
  const head = ['scope', 'recruit', 'gradYear', 'event', 'ballots', 'uniqueVoters', 'mean', 'median', 'sd', 'min', 'max',
    'score1', 'score2', 'score3', 'score4', 'score5', 'score6', 'score7', 'score8', 'score9', 'score10']
  const line = (scope, event, s, voters) => [
    scope, detail.name, detail.gradYear, event, s.n, voters, num(s.mean), num(s.median, 1), num(s.sd),
    s.min == null ? '' : s.min, s.max == null ? '' : s.max, ...s.histogram,
  ].map(csvCell).join(',')
  const lines = [line('overall', '', detail.overall, detail.voters)]
    .concat(detail.perEvent.map(e => line('event', e.name, e, e.voters)))
  return [head.join(',')].concat(lines).join('\n') + '\n'
}
