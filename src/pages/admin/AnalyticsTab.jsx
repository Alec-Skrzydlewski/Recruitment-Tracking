import { useMemo, useState } from 'react'
import {
  buildAnalytics, sortRows, filterOptions, filtersActive, rankCsv, fmt, EMPTY_FILTERS, SMALL_SAMPLE,
} from '../../lib/analytics'

const pct = x => (x == null ? '—' : Math.round(x * 1000) / 10 + '%')
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'))

function Histogram({ counts, label, id }) {
  const max = Math.max(1, ...counts)
  const total = counts.reduce((a, b) => a + b, 0)
  const W = 300
  const H = 120
  const bw = W / 10
  return (
    <figure className="hist" aria-labelledby={id + '-cap'}>
      <figcaption id={id + '-cap'} className="small muted">{label} ({plural(total, 'ballot')})</figcaption>
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="presentation" aria-hidden="true" focusable="false">
        {counts.map((c, i) => {
          const h = c ? Math.max(2, (c / max) * H) : 0
          return (
            <g key={i}>
              <rect x={i * bw + 3} y={H - h} width={bw - 6} height={h} rx="3" className={c ? 'hist-bar' : 'hist-empty'} />
              <text x={i * bw + bw / 2} y={H + 14} textAnchor="middle" className="hist-axis">{i + 1}</text>
            </g>
          )
        })}
      </svg>
      <div className="table-wrap" role="region" aria-label={label + ' counts'} tabIndex={0}>
        <table className="data-table compact">
          <thead><tr><th scope="row">Score</th>{counts.map((_, i) => <th key={i} scope="col">{i + 1}</th>)}</tr></thead>
          <tbody><tr><th scope="row">Ballots</th>{counts.map((c, i) => <td key={i}>{c}</td>)}</tr></tbody>
        </table>
      </div>
    </figure>
  )
}

const COLUMNS = [
  ['rank', 'Rank'], ['name', 'Recruit'], ['mean', 'Mean'], ['median', 'Median'], ['n', 'Ballots'], ['voters', 'Voters'],
  ['sd', 'SD'], ['range', 'Range'], ['eventsAttended', 'Attended'], ['eventsRated', 'Rated at'], ['equalEventMean', 'Equal-event mean'],
]

function Toggle({ checked, onChange, children }) {
  return (
    <label className={'chip' + (checked ? ' chip-on' : '')}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {children}
    </label>
  )
}

export default function AnalyticsTab({ data }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [sort, setSort] = useState({ by: 'rank', dir: 'asc' })
  const [selected, setSelected] = useState('')
  const options = useMemo(() => filterOptions(data), [data])
  const a = useMemo(() => buildAnalytics(data, filters), [data, filters])
  const rows = useMemo(() => sortRows(a.rows, sort.by, sort.dir), [a.rows, sort])
  const ranked = a.rows.filter(r => r.rank != null).sort((x, y) => x.rank - y.rank)
  const detail = a.rows.find(r => r.id === selected) || ranked[0] || a.rows[0] || null
  const active = filtersActive(filters)

  const toggleIn = (field, value) => setFilters(f => ({
    ...f, [field]: f[field].includes(value) ? f[field].filter(x => x !== value) : f[field].concat([value]),
  }))
  const sortBy = by => setSort(s => ({ by, dir: s.by === by ? (s.dir === 'asc' ? 'desc' : 'asc') : (by === 'name' || by === 'rank' ? 'asc' : 'desc') }))

  function exportCsv() {
    const blob = new Blob([rankCsv(rows)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'recruit-analytics.csv'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const p = a.participation
  return (
    <div className="stack analytics">
      <section className="card" aria-labelledby="an-filters">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="an-filters">Filters</h2>
          <button type="button" className="btn-sm" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!active}>Reset filters</button>
        </div>
        <div className="form-grid two" style={{ marginTop: 10 }}>
          <div>
            <label className="field-label" htmlFor="an-search">Recruit name</label>
            <input id="an-search" type="search" value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} placeholder="Search by name" />
          </div>
          <div>
            <label className="field-label" htmlFor="an-major">Major (first or second)</label>
            <select id="an-major" value={filters.majors[0] || ''} onChange={e => setFilters(f => ({ ...f, majors: e.target.value ? [e.target.value] : [] }))}>
              <option value="">All majors</option>
              {options.majors.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <fieldset className="chips" style={{ marginTop: 12 }}>
          <legend className="field-label">Events <span className="muted">(none checked = all events)</span></legend>
          {options.events.map(e => (
            <Toggle key={e.id} checked={filters.eventIds.includes(e.id)} onChange={() => toggleIn('eventIds', e.id)}>{e.name}</Toggle>
          ))}
        </fieldset>
        <fieldset className="chips" style={{ marginTop: 8 }}>
          <legend className="field-label">Graduation year <span className="muted">(none checked = all)</span></legend>
          {options.gradYears.map(y => (
            <Toggle key={y || 'none'} checked={filters.gradYears.includes(y)} onChange={() => toggleIn('gradYears', y)}>{y || 'Not recorded'}</Toggle>
          ))}
        </fieldset>
        <p className="small muted" role="status" style={{ marginTop: 10 }}>
          Showing {a.poolSize} of {plural(a.totalRecruits, 'recruit')} across {plural(a.events.length, 'event')} · {plural(a.overall.n, 'valid ballot')}.
          {active ? ' Filters are on.' : ' No filters: the whole pool is shown.'}
        </p>
      </section>

      <div className="stats">
        <div className="stat"><div className="stat-value">{a.overall.n}</div><div className="stat-label">Ballots</div></div>
        <div className="stat"><div className="stat-value">{p.uniqueVoters}</div><div className="stat-label">Unique voters</div></div>
        <div className="stat"><div className="stat-value">{fmt(a.overall.mean)}</div><div className="stat-label">Mean score</div></div>
        <div className="stat"><div className="stat-value">{pct(p.completion)}</div><div className="stat-label">Completion</div></div>
      </div>

      <section className="card" aria-labelledby="an-rank">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="an-rank">Recruit comparison</h2>
          <button type="button" className="btn-sm" onClick={exportCsv} disabled={!rows.length}>Export CSV (aggregates)</button>
        </div>
        <p className="small muted" style={{ margin: '4px 0 10px' }}>
          Ranked by mean score. Equal means share a rank and are marked “tied”. Recruits with no ballots in scope are unranked.
          Rows marked “small” have fewer than {SMALL_SAMPLE} ballots.
        </p>
        {rows.length === 0 ? <p className="small">No recruits match these filters.</p> : (
          <div className="table-wrap" role="region" aria-label="Recruit comparison table" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  {COLUMNS.map(([id, label]) => (
                    <th key={id} scope="col" aria-sort={sort.by === id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" className="th-sort" onClick={() => sortBy(id)}>{label}</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className={detail && detail.id === r.id ? 'is-selected' : ''}>
                    <td>{r.rank == null ? <span className="muted">Unranked</span> : <>{r.rank}{r.tied && <span className="badge badge-gold">tied</span>}</>}</td>
                    <th scope="row">
                      <button type="button" className="link-btn" onClick={() => setSelected(r.id)} aria-label={'Show details for ' + r.name}>{r.name}</button>
                      {r.overall.n > 0 && r.overall.small && <span className="badge">small</span>}
                    </th>
                    <td>{fmt(r.overall.mean)}</td>
                    <td>{fmt(r.overall.median, 1)}</td>
                    <td>{r.overall.n}</td>
                    <td>{r.voters}</td>
                    <td>{fmt(r.overall.sd)}</td>
                    <td>{r.overall.n ? `${r.overall.min}–${r.overall.max}` : '—'}</td>
                    <td>{r.eventsAttended}</td>
                    <td>{r.eventsRated}</td>
                    <td>{fmt(r.equalEventMean)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detail && (
        <section className="card" aria-labelledby="an-detail">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 id="an-detail">Recruit detail: {detail.name}</h2>
            <div>
              <label className="sr-only" htmlFor="an-recruit">Recruit</label>
              <select id="an-recruit" value={detail.id} onChange={e => setSelected(e.target.value)}>
                {a.rows.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>
          <p className="small muted" style={{ margin: '4px 0 12px' }}>
            {[detail.major, detail.secondMajor].filter(Boolean).join(' / ')}{detail.gradYear ? ' · Class of ' + detail.gradYear : ' · Graduation year not recorded'}
          </p>
          {detail.overall.n === 0 ? (
            <p className="small">No valid ballots for {detail.name} in the current scope, so there is nothing to compare.</p>
          ) : (
            <>
              <p className="small">
                {plural(detail.overall.n, 'ballot')} from {plural(detail.voters, 'voter')}: mean {fmt(detail.overall.mean)}, median {fmt(detail.overall.median, 1)}
                {detail.overall.sd != null ? `, SD ${fmt(detail.overall.sd)}` : ''}, range {detail.overall.min}–{detail.overall.max}.
                Equal-event mean {fmt(detail.equalEventMean)} over {plural(detail.eventsRated, 'rated event')}.
              </p>
              <p className="small muted" style={{ marginTop: 6 }}>
                {detail.overall.n < SMALL_SAMPLE
                  ? `With ${plural(detail.overall.n, 'ballot')} this is an anecdote, not a pattern; one more ballot could move the mean a lot.`
                  : 'The spread (SD and range) shows how much voters disagreed. These are descriptive numbers for this group of voters, not a prediction.'}
              </p>
              <Histogram counts={detail.overall.histogram} label={'Score distribution for ' + detail.name} id={'h-' + detail.id} />
              <h3 style={{ marginTop: 14 }}>By event</h3>
              <div className="table-wrap" role="region" aria-label={'Per-event results for ' + detail.name} tabIndex={0}>
                <table className="data-table">
                  <thead>
                    <tr><th scope="col">Event</th><th scope="col">Present</th><th scope="col">Ballots</th><th scope="col">Mean</th><th scope="col">Median</th><th scope="col">SD</th><th scope="col">Range</th><th scope="col">vs overall mean</th><th scope="col">Scores 1–10</th></tr>
                  </thead>
                  <tbody>
                    {detail.perEvent.map(e => (
                      <tr key={e.eventId}>
                        <th scope="row">{e.name}{e.n > 0 && e.small && <span className="badge">small</span>}</th>
                        <td>{e.attended ? 'Yes' : 'No'}</td>
                        <td>{e.n}</td>
                        <td>{fmt(e.mean)}</td>
                        <td>{fmt(e.median, 1)}</td>
                        <td>{fmt(e.sd)}</td>
                        <td>{e.n ? `${e.min}–${e.max}` : '—'}</td>
                        <td>{e.n ? (e.mean - detail.overall.mean >= 0 ? '+' : '') + fmt(e.mean - detail.overall.mean) : '—'}</td>
                        <td className="mono">{e.n ? e.histogram.join(' ') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      <section className="card" aria-labelledby="an-events">
        <h2 id="an-events">Event comparison</h2>
        <p className="small muted" style={{ margin: '4px 0 10px' }}>
          Events are listed in the order they appear in the sheet. Events have no date, so this is a side-by-side comparison, not a timeline.
        </p>
        {a.events.length === 0 ? <p className="small">No events in scope.</p> : (
          <div className="table-wrap" role="region" aria-label="Event comparison table" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr><th scope="col">Event</th><th scope="col">Recruits present</th><th scope="col">Rated</th><th scope="col">Ballots</th><th scope="col">Voters</th><th scope="col">Mean</th><th scope="col">Median</th><th scope="col">SD</th><th scope="col">Completion</th></tr>
              </thead>
              <tbody>
                {a.events.map(e => (
                  <tr key={e.eventId}>
                    <th scope="row">{e.name}</th>
                    <td>{e.attendees}</td>
                    <td>{e.ratedRecruits}</td>
                    <td>{e.n}</td>
                    <td>{e.voters}</td>
                    <td>{fmt(e.mean)}</td>
                    <td>{fmt(e.median, 1)}</td>
                    <td>{fmt(e.sd)}</td>
                    <td>{e.opportunities ? `${pct(e.completion)} (${e.completed}/${e.opportunities})` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Histogram counts={a.overall.histogram} label="All ballots in scope" id="h-all" />
      </section>

      <section className="card" aria-labelledby="an-part">
        <h2 id="an-part">Voter participation</h2>
        <ul className="small" style={{ paddingLeft: 18, marginTop: 8 }}>
          <li>{plural(p.ballots, 'valid ballot')} from {plural(p.uniqueVoters, 'unique voter')}.</li>
          <li>Current active members: {p.rosterSize}; {p.rosterVoters} of them voted in scope.</li>
          {p.nonRosterVoters > 0 && <li>{plural(p.nonRosterVoters, 'voter')} not on the current active list cast {plural(p.nonRosterBallots, 'ballot')}. Those ballots count in every score above but not in completion.</li>}
          <li>
            Completion: {p.opportunities ? `${pct(p.completion)} (${p.completed} of ${p.opportunities} possible ratings)` : 'not available (no active members or no recruits present in scope)'}.
          </li>
        </ul>
        <p className="small muted" style={{ marginTop: 6 }}>
          Possible ratings = current active members × recruits marked present at each event in scope. The current list is a stand-in:
          it does not show who was a member, or at the event, when votes were cast, and attendance of voters is not recorded.
          Each (voter, event, recruit) counts once, so completion cannot exceed 100%. Individual ballots are not shown here.
        </p>
      </section>

      <details className="card">
        <summary id="an-method"><strong>Methodology and definitions</strong></summary>
        <ul className="small" style={{ paddingLeft: 18, marginTop: 8 }}>
          <li><strong>Valid ballot:</strong> an integer score 1–10 for a recruit and event that exist, with the recruit marked present at that event — the same rule as the dashboard. Nothing else is counted.</li>
          <li><strong>Mean:</strong> every ballot weighs the same. <strong>Equal-event mean:</strong> the average of a recruit’s per-event means, so each rated event weighs the same. They differ when events have different numbers of ballots; neither is adjusted or blended.</li>
          <li><strong>Median:</strong> middle ballot (average of the two middle ballots for an even count). <strong>SD:</strong> sample standard deviation (n − 1), shown with 2+ ballots. <strong>Range:</strong> lowest–highest score.</li>
          <li><strong>Rank:</strong> by mean only. Equal means share a rank. There is no composite score or cut-off.</li>
          <li><strong>Small sample:</strong> fewer than {SMALL_SAMPLE} ballots. This is a reading aid, not a statistical test.</li>
          <li><strong>Voters:</strong> distinct voter emails. Ballots by members later removed or demoted still count. Repeat rows for the same voter, event and recruit each count in scores (as on the dashboard) but once in completion.</li>
          <li><strong>No trends:</strong> events have no dates and a vote’s timestamp is when it was last changed, so nothing here shows change over time.</li>
          <li><strong>Filters</strong> narrow which recruits and events are included; with nothing selected, everything is included.</li>
        </ul>
      </details>
    </div>
  )
}
