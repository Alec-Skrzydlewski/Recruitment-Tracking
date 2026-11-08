import { formatEventDate } from '../../lib/eventDate'
import { useMemo, useState } from 'react'
import { buildRecruitAnalytics, recruitChoices, resolveSelection, recruitCsv, fmt } from '../../lib/analytics'

// Individual results: one recruit at a time, chosen from a single dropdown.
function RecruitNote({ recruit, ctl }) {
  const id = recruit.id
  const status = ctl.noteStatus[id]
  const dirty = (ctl.noteDrafts[id] || '') !== (ctl.savedNotes[id] || '')
  const noteId = 'note-' + id
  return (
    <section className="card" aria-labelledby="an-notes">
      <h2 id="an-notes">Notes</h2>
      <label className="field-label" htmlFor={noteId} style={{ marginTop: 8 }}>Notes on {recruit.name}</label>
      <textarea
        id={noteId}
        value={ctl.noteDrafts[id] || ''}
        onChange={e => ctl.editNote(id, e.target.value)}
        rows={4}
        maxLength={5000}
        disabled={ctl.isTempId(id)}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => ctl.saveNote(id)}
          disabled={ctl.isTempId(id) || !!ctl.saving['note:' + id] || !dirty || ctl.wiping}
        >Save note</button>
        <span aria-live="polite" className="small">
          {status === 'saving' && <span className="status status-saving">Saving…</span>}
          {status === 'saved' && !dirty && <span className="status status-saved">✓ Saved</span>}
          {dirty && status !== 'saving' && !String(status || '').startsWith('error:') && <span className="muted">Unsaved changes</span>}
        </span>
      </div>
      {String(status || '').startsWith('error:') && (
        <p className="status status-error" role="alert" style={{ marginTop: 6 }}>Note not saved: {status.slice(6)} Your text is still here.</p>
      )}
    </section>
  )
}

export default function AnalyticsTab({ data, ctl }) {
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
  const byEvent = new Map(d.perEvent.map(e => [String(e.eventId), e]))
  const events = ((data && data.events) || []).map(ev => {
    const e = byEvent.get(String(ev.id))
    return { id: ev.id, name: ev.name, date: ev.date, attended: !!(e && e.attended), n: e ? e.n : 0, mean: e ? e.mean : null }
  })
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

        <div className="stats stats-simple">
          <div className="stat"><div className="stat-value">{o.n ? fmt(o.mean, 1) : '—'}{o.n > 0 && <span className="stat-unit"> /10</span>}</div><div className="stat-label">Average score</div></div>
          <div className="stat"><div className="stat-value">{d.voters}</div><div className="stat-label">Members who voted</div></div>
          <div className="stat"><div className="stat-value">{d.eventsAttended}</div><div className="stat-label">Events attended</div></div>
        </div>
        <p className="small muted" style={{ marginTop: 4 }}>
          {o.n === 0
            ? `No ratings for ${d.name} yet. Members can rate a recruit once they are checked in at an event.`
            : `The average of every 1–10 rating members gave ${d.name}. It reflects members’ impressions, not a prediction.`}
        </p>
      </section>

      <section className="card" aria-labelledby="an-events">
        <h2 id="an-events">Events</h2>
        {events.length === 0 ? <p className="small" style={{ marginTop: 6 }}>No events yet.</p> : (
          <ul className="event-results" aria-label={'Event results for ' + d.name}>
            {events.map(e => (
              <li key={e.id} className="event-result">
                <div>
                  <strong>{e.name}</strong>
                  <span className="small muted" style={{ display: 'block' }}>{formatEventDate(e.date) || 'Date not set'}</span>
                </div>
                <span className={'badge ' + (e.attended ? 'badge-yes' : 'badge-no')}>{e.attended ? 'Attended' : 'Absent'}</span>
                <span className="event-avg">
                  {e.n > 0 ? <><strong>{fmt(e.mean, 1)}</strong>/10 <span className="small muted">· {e.n === 1 ? '1 rating' : e.n + ' ratings'}</span></> : <span className="small muted">{e.attended ? 'No ratings yet' : '—'}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ctl && <RecruitNote key={d.id} recruit={d} ctl={ctl} />}
    </div>
  )
}
