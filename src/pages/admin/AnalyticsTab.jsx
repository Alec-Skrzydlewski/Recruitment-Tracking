import { formatEventDate } from '../../lib/eventDate'
import { useMemo, useState } from 'react'
import { buildRecruitAnalytics, recruitChoices, resolveSelection, recruitCsv, fmt, SMALL_SAMPLE } from '../../lib/analytics'

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

// Individual results: one recruit at a time, chosen from a single dropdown.
export default function AnalyticsTab({ data }) {
  const choices = useMemo(() => recruitChoices(data), [data])
  const [picked, setPicked] = useState('')
  const selectedId = resolveSelection(choices, picked)
  const d = useMemo(() => (selectedId ? buildRecruitAnalytics(data, selectedId) : null), [data, selectedId])

  function exportCsv() {
    const blob = new Blob([recruitCsv(d)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'recruit-' + String(d.name || 'results').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() + '.csv'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  if (!choices.length) {
    return (
      <section className="card analytics" aria-labelledby="an-empty">
        <h2 id="an-empty">Recruit results</h2>
        <p className="small" style={{ marginTop: 6 }}>No recruits yet. Add recruits on the Recruits tab to see their results here.</p>
      </section>
    )
  }

  const o = d.overall
  return (
    <div className="stack analytics">
      <section className="card" aria-labelledby="an-pick">
        <h2 id="an-pick">Recruit results</h2>
        <label className="field-label" htmlFor="an-recruit" style={{ marginTop: 10 }}>Recruit</label>
        <select id="an-recruit" value={selectedId} onChange={e => setPicked(e.target.value)}>
          {choices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </section>

      <section className="card" aria-labelledby="an-detail" aria-live="polite">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="an-detail">{d.name}</h2>
          <button type="button" className="btn-sm" onClick={exportCsv}>Export {d.name}’s results (CSV)</button>
        </div>
        <p className="small muted" style={{ margin: '4px 0 12px' }}>
          {[[d.major, d.secondMajor].filter(Boolean).join(' / '), d.gradYear ? 'Class of ' + d.gradYear : 'Graduation year not recorded'].filter(Boolean).join(' · ')}
        </p>

        <div className="stats">
          <div className="stat"><div className="stat-value">{fmt(o.mean)}</div><div className="stat-label">Mean</div></div>
          <div className="stat"><div className="stat-value">{fmt(o.median, 1)}</div><div className="stat-label">Median</div></div>
          <div className="stat"><div className="stat-value">{o.n}</div><div className="stat-label">Ballots</div></div>
          <div className="stat"><div className="stat-value">{d.voters}</div><div className="stat-label">Unique voters</div></div>
        </div>

        {o.n === 0 ? (
          <p className="small">
            No valid ballots for {d.name} yet. Attended {plural(d.eventsAttended, 'event')}.
            Ballots count once the recruit is marked present at an event and members rate them 1–10.
          </p>
        ) : (
          <>
            <ul className="small" style={{ paddingLeft: 18 }}>
              <li>Spread: {o.sd != null ? `sample SD ${fmt(o.sd)}, ` : 'SD needs 2+ ballots, '}range {o.min}–{o.max}.</li>
              <li>Attended {plural(d.eventsAttended, 'event')}; rated at {d.eventsRated}. Equal-event mean {fmt(d.equalEventMean)}.</li>
            </ul>
            <p className="small muted" style={{ marginTop: 6 }}>
              {o.n < SMALL_SAMPLE
                ? `Only ${plural(o.n, 'ballot')}: treat this as an early impression; one more ballot could move the mean a lot.`
                : 'These numbers describe how these voters scored this recruit. They are not a prediction or a recommendation.'}
            </p>
            <Histogram counts={o.histogram} label={'Score distribution for ' + d.name} id={'h-' + d.id} />
          </>
        )}
      </section>

      <section className="card" aria-labelledby="an-events">
        <h2 id="an-events">By event</h2>
        <p className="small muted" style={{ margin: '4px 0 10px' }}>
          Events {d.name} attended or was rated at, in sheet order (not sorted by date; older events may have no date).
        </p>
        {d.perEvent.length === 0 ? <p className="small">Not marked present at any event.</p> : (
          <div className="table-wrap" role="region" aria-label={'Per-event results for ' + d.name} tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr><th scope="col">Event</th><th scope="col">Present</th><th scope="col">Ballots</th><th scope="col">Voters</th><th scope="col">Mean</th><th scope="col">Median</th><th scope="col">SD</th><th scope="col">Range</th><th scope="col">Scores 1–10</th></tr>
              </thead>
              <tbody>
                {d.perEvent.map(e => (
                  <tr key={e.eventId}>
                    <th scope="row">{e.name}<span className="small muted" style={{ display: 'block', fontWeight: 'normal' }}>{formatEventDate(e.date) || 'Date not set'}</span>{e.n > 0 && e.small && <span className="badge">small</span>}</th>
                    <td>{e.attended ? 'Yes' : 'No'}</td>
                    <td>{e.n}</td>
                    <td>{e.voters}</td>
                    <td>{fmt(e.mean)}</td>
                    <td>{fmt(e.median, 1)}</td>
                    <td>{fmt(e.sd)}</td>
                    <td>{e.n ? `${e.min}–${e.max}` : '—'}</td>
                    <td className="mono" aria-label={e.n ? 'Counts for scores 1 to 10: ' + e.histogram.join(', ') : 'No ballots'}>{e.n ? e.histogram.join(' ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details className="card">
        <summary><strong>How these numbers are calculated</strong></summary>
        <ul className="small" style={{ paddingLeft: 18, marginTop: 8 }}>
          <li><strong>Valid ballot:</strong> an integer score 1–10 for this recruit at an event they were marked present at — the same rule as the dashboard.</li>
          <li><strong>Mean</strong> weighs every ballot the same; <strong>equal-event mean</strong> averages the per-event means so each rated event counts once.</li>
          <li><strong>Median:</strong> the middle ballot (average of the two middle ones for an even count). <strong>SD:</strong> sample standard deviation (n − 1), shown with 2+ ballots.</li>
          <li><strong>Small:</strong> fewer than {SMALL_SAMPLE} ballots — a reading aid, not a statistical test.</li>
          <li>Ballots by members later removed or demoted still count. Individual voters and their scores are not shown.</li>
          <li>No trends: events have no dates, and a vote’s timestamp is only when it was last changed.</li>
          <li>The CSV contains only this recruit’s aggregate results (no voter identities). It is still private chapter data. A guard against spreadsheet formulas is applied but cannot be guaranteed for every program.</li>
        </ul>
      </details>
    </div>
  )
}
