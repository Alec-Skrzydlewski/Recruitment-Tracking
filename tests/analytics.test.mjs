// Exact-value tests for the admin Analytics aggregation (src/lib/analytics.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnalytics, sortRows, csvCell, mean, median, sampleSd, histogram, rankCsv, filterOptions, filtersActive, EMPTY_FILTERS,
} from '../src/lib/analytics.js';
import { buildTally } from '../src/lib/tally.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);
const V = (eventId, recruitId, userEmail, score) => ({ eventId, recruitId, userEmail, score, timestamp: 't' });

function fixture() {
  return {
    recruits: [
      { id: 'r1', name: 'Ada', major: 'Finance', secondMajor: 'Accounting', gradYear: '2027' },
      { id: 'r2', name: 'Ben', major: 'Marketing', secondMajor: '', gradYear: '2028' },
      { id: 'r3', name: 'Cy', major: 'Accounting', secondMajor: '', gradYear: '2028' },
      { id: 'r4', name: 'Dee', major: 'Finance', secondMajor: '', gradYear: '' }, // legacy, no year, unrated
    ],
    events: [{ id: 'e1', name: 'One' }, { id: 'e2', name: 'Two' }],
    attendance: [
      { eventId: 'e1', recruitId: 'r1' }, { eventId: 'e2', recruitId: 'r1' },
      { eventId: 'e1', recruitId: 'r2' }, { eventId: 'e1', recruitId: 'r3' }, { eventId: 'e1', recruitId: 'r4' },
    ],
    users: [
      { email: 'a@x.test', active: 'yes' }, { email: 'b@x.test', active: 'yes' }, { email: 'c@x.test', active: 'yes' },
      { email: 'gone@x.test', active: 'no' },
    ],
    votes: [
      // Ada: e1 = 10, 8, 6 ; e2 = 4  -> unequal counts per event
      V('e1', 'r1', 'a@x.test', 10), V('e1', 'r1', 'B@x.test', 8), V('e1', 'r1', 'c@x.test', 6), V('e2', 'r1', 'a@x.test', 4),
      // Ben: 7 and a duplicate row from the same voter (legacy) -> counted twice in scores, once in completion
      V('e1', 'r2', 'a@x.test', 7), V('e1', 'r2', 'a@x.test', 7),
      // Cy: one ballot from an inactive former member -> retained
      V('e1', 'r3', 'gone@x.test', 7),
      // Invalid rows: never counted anywhere
      V('e2', 'r2', 'a@x.test', 9), // Ben not present at e2
      V('e9', 'r1', 'a@x.test', 9), // missing event
      V('e1', 'r9', 'a@x.test', 9), // missing recruit
      V('e1', 'r1', 'b@x.test', 11), V('e1', 'r1', 'b@x.test', 0), V('e1', 'r1', 'b@x.test', '7.5'),
      V('e1', 'r1', 'b@x.test', true), V('e1', 'r1', 'b@x.test', ''), V('e1', 'r1', 'b@x.test', null),
    ],
  };
}

test('formulas: mean, median (odd/even), sample SD, histogram', () => {
  assert.equal(mean([]), null);
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(sampleSd([5]), null);
  near(sampleSd([10, 8, 6, 4]), Math.sqrt(20 / 3), 'sd');
  assert.deepEqual(histogram([1, 10, 10, 5]), [1, 0, 0, 0, 1, 0, 0, 0, 0, 2]);
});

test('per-recruit statistics with unequal event counts', () => {
  const a = buildAnalytics(fixture());
  const ada = a.rows.find(r => r.id === 'r1');
  assert.equal(ada.overall.n, 4);
  near(ada.overall.mean, 7, 'all-ballot mean');
  assert.equal(ada.overall.median, 7);
  near(ada.overall.sd, Math.sqrt(20 / 3), 'sd');
  assert.equal(ada.overall.range, 6);
  assert.equal(ada.voters, 3, 'emails are case-normalized');
  assert.equal(ada.eventsAttended, 2);
  assert.equal(ada.eventsRated, 2);
  near(ada.equalEventMean, (8 + 4) / 2, 'equal-event mean differs from all-ballot mean');
  const e1 = ada.perEvent.find(p => p.eventId === 'e1');
  assert.deepEqual([e1.n, e1.mean, e1.median, e1.min, e1.max], [3, 8, 8, 6, 10]);
  assert.equal(e1.sd, 2);
  assert.equal(ada.perEvent.find(p => p.eventId === 'e2').small, true);
  assert.deepEqual(ada.overall.histogram, [0, 0, 0, 1, 0, 1, 0, 1, 0, 1]);
});

test('invalid rows are never counted; matches the canonical tally', () => {
  const data = fixture();
  const a = buildAnalytics(data);
  const t = buildTally(data);
  assert.equal(a.overall.n, 7);
  assert.equal(t.activeVotes, 7);
  for (const r of a.rows) {
    const tr = t.byRecruit[r.id];
    assert.equal(r.overall.n, tr.activeCount, r.name);
    if (r.overall.n) near(r.overall.mean, tr.average, r.name);
  }
  assert.equal(JSON.stringify(a).includes('xclud'), false);
});

test('duplicates count as ballots but once in completion; inactive voters retained', () => {
  const a = buildAnalytics(fixture());
  const ben = a.rows.find(r => r.id === 'r2');
  assert.equal(ben.overall.n, 2);
  assert.equal(ben.voters, 1);
  const cy = a.rows.find(r => r.id === 'r3');
  assert.equal(cy.overall.n, 1);
  assert.equal(cy.overall.mean, 7);
  const p = a.participation;
  assert.equal(p.rosterSize, 3);
  assert.equal(p.uniqueVoters, 4);
  assert.equal(p.nonRosterVoters, 1);
  assert.equal(p.nonRosterBallots, 1);
  // e1: 3 active × 4 present = 12 opportunities; completed triples: r1×(a,b,c) + r2×a = 4.
  // e2: 3 × 1 = 3; completed: r1×a = 1.
  const [e1, e2] = a.events;
  assert.deepEqual([e1.completed, e1.opportunities, e2.completed, e2.opportunities], [4, 12, 1, 3]);
  assert.equal(p.completed, 5);
  assert.equal(p.opportunities, 15);
  near(p.completion, 5 / 15, 'completion');
  assert.ok(a.events.every(e => e.completion <= 1));
});

test('completion is null, not 0% or NaN, without a denominator', () => {
  const data = fixture();
  data.users = [{ email: 'x@x.test', active: 'no' }];
  const a = buildAnalytics(data);
  assert.equal(a.participation.opportunities, 0);
  assert.equal(a.participation.completion, null);
  const empty = buildAnalytics({});
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.overall.n, 0);
  assert.equal(empty.overall.mean, null);
  assert.equal(empty.participation.completion, null);
});

test('ranking: ties share a rank and are flagged; unrated recruits are unranked', () => {
  const a = buildAnalytics(fixture());
  const by = Object.fromEntries(a.rows.map(r => [r.id, r]));
  // Ada 7, Ben 7, Cy 7 -> all tied at rank 1; Dee unrated
  assert.deepEqual([by.r1.rank, by.r2.rank, by.r3.rank, by.r4.rank], [1, 1, 1, null]);
  assert.ok(by.r1.tied && by.r2.tied && by.r3.tied);
  assert.equal(by.r4.tied, false);
  const data = fixture();
  data.votes.push(V('e1', 'r3', 'a@x.test', 10)); // Cy -> 8.5
  const b = buildAnalytics(data);
  const rk = Object.fromEntries(b.rows.map(r => [r.id, r.rank]));
  assert.deepEqual([rk.r3, rk.r1, rk.r2, rk.r4], [1, 2, 2, null], 'competition ranking 1,2,2');
});

test('sorting keeps missing values last in both directions', () => {
  const a = buildAnalytics(fixture());
  for (const dir of ['asc', 'desc']) {
    assert.equal(sortRows(a.rows, 'mean', dir).at(-1).id, 'r4');
    assert.equal(sortRows(a.rows, 'sd', dir).at(-1).overall.sd, null);
  }
  assert.deepEqual(sortRows(a.rows, 'name', 'desc').map(r => r.name), ['Dee', 'Cy', 'Ben', 'Ada']);
  assert.deepEqual(sortRows(a.rows, 'n', 'desc').map(r => r.id).slice(0, 2), ['r1', 'r2']);
});

test('filter semantics: events, name search, grad year, major (first or second)', () => {
  const data = fixture();
  assert.equal(filtersActive(EMPTY_FILTERS), false);
  const ev = buildAnalytics(data, { eventIds: ['e2'] });
  assert.equal(ev.events.length, 1);
  assert.equal(ev.overall.n, 1);
  assert.equal(ev.rows.find(r => r.id === 'r1').overall.mean, 4);
  assert.equal(ev.poolSize, 4, 'event filter does not hide recruits');
  assert.deepEqual(buildAnalytics(data, { search: ' ad' }).rows.map(r => r.id), ['r1']);
  assert.deepEqual(buildAnalytics(data, { gradYears: ['2028'] }).rows.map(r => r.id), ['r2', 'r3']);
  assert.deepEqual(buildAnalytics(data, { gradYears: [''] }).rows.map(r => r.id), ['r4'], 'legacy rows without a year are selectable');
  assert.deepEqual(buildAnalytics(data, { majors: ['Accounting'] }).rows.map(r => r.id), ['r1', 'r3']);
  const scoped = buildAnalytics(data, { gradYears: ['2028'] });
  assert.equal(scoped.participation.opportunities, 3 * 2, 'completion denominator follows the recruit filter');
  const opts = filterOptions(data);
  assert.deepEqual(opts.gradYears, ['2027', '2028', '']);
  assert.deepEqual(opts.majors, ['Accounting', 'Finance', 'Marketing']);
});

test('CSV export is aggregate-only and formula-safe', () => {
  const data = fixture();
  data.recruits[0].name = '=HYPERLINK("x")';
  const csv = rankCsv(buildAnalytics(data).rows);
  assert.ok(csv.startsWith('rank,tied,name,'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.equal(/@x\.test/.test(csv), false, 'no voter identities');
  assert.ok(csv.split('\n').find(l => l.includes('Dee')).startsWith(',,Dee,'), 'unrated: no rank');
});

// Minimal RFC 4180 parser for round-trip checks.
function parseCsv(text) {
  const rows = [[]];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { rows.at(-1).push(cell); cell = ''; }
    else if (c === '\n') { rows.at(-1).push(cell); cell = ''; rows.push([]); }
    else cell += c;
  }
  if (cell || rows.at(-1).length) rows.at(-1).push(cell);
  return rows.filter(r => r.length);
}

test('CSV: bare CR, LF, quotes and commas round-trip as one cell', () => {
  for (const name of ['a\rb', 'a\nb', 'a\r\nb', 'say "hi", ok']) {
    const data = fixture();
    data.recruits[0].name = name;
    const rows = parseCsv(rankCsv(buildAnalytics(data).rows));
    const header = rows[0];
    assert.ok(rows.slice(1).every(r => r.length === header.length), JSON.stringify(name));
    assert.ok(rows.some(r => r[header.indexOf('name')] === name), JSON.stringify(name));
  }
  assert.equal(csvCell('a\rb'), '"a\rb"');
});

test('CSV: formula prefixes behind spaces, tabs and NBSP are neutralized, data preserved', () => {
  for (const v of ['=1+1', ' =1+1', '\u00a0=1+1', '\u00a0 @SUM(A1)', '  +7', '\t-3', '\u3000=x', '\r=1']) {
    const out = csvCell(v);
    const parsed = parseCsv(out + '\n')[0][0];
    assert.equal(parsed, "'" + v, JSON.stringify(v));
  }
  for (const v of ['Avery Quill', 'Finance (BSBA)', '2028', '7.50', 'a=b', 'x-y', '']) {
    assert.equal(csvCell(v), v, JSON.stringify(v));
  }
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(7), '7');
});
