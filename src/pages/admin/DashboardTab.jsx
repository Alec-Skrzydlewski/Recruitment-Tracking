import { useMemo } from 'react'
import RecruitAvatar from '../../components/RecruitAvatar'
import { EmptyState } from '../../components/ui'
import { formatAverage } from '../../lib/tally'

function summary(r) {
  const majors = [r.major, r.secondMajor].filter(Boolean).join(' / ')
  return [majors, r.gradYear ? 'Class of ' + r.gradYear : ''].filter(Boolean).join(' · ')
}

export default function DashboardTab({ data, tally, ctl }) {
  const eventName = useMemo(() => {
    const map = {}
    data.events.forEach(e => { map[e.id] = e.name })
    return map
  }, [data.events])

  const ranked = useMemo(() => data.recruits.slice().sort((a, b) => {
    const av = tally.byRecruit[a.id] && tally.byRecruit[a.id].average
    const bv = tally.byRecruit[b.id] && tally.byRecruit[b.id].average
    if (av == null && bv == null) return String(a.name).localeCompare(String(b.name))
    if (av == null) return 1
    if (bv == null) return -1
    return bv - av
  }), [data.recruits, tally])

  const ex = tally.excluded
  return (
    <div>
      <div className="stats">
        <div className="stat"><div className="stat-value">{data.recruits.length}</div><div className="stat-label">Recruits</div></div>
        <div className="stat"><div className="stat-value">{data.events.length}</div><div className="stat-label">Events</div></div>
        <div className="stat"><div className="stat-value">{tally.activeVotes}</div><div className="stat-label">Counted votes</div></div>
        <div className="stat"><div className="stat-value">{tally.totalExcluded}</div><div className="stat-label">Excluded votes</div></div>
      </div>
      {tally.totalExcluded > 0 && (
        <p className="small muted" style={{ marginBottom: 16 }}>
          Averages count only votes for current recruits at current events they attended.
          Excluded: {ex.deletedEvent} from deleted events, {ex.deletedRecruit} for removed recruits, {ex.notPresent} where attendance was removed, {ex.invalidScore} invalid.
          They stay in the Sheet as history.
        </p>
      )}
      {ranked.length === 0 ? (
        <EmptyState title="No recruits yet">Add recruits on the Recruits tab to start tracking.</EmptyState>
      ) : (
        <div className="stack">
          {ranked.map((r, index) => {
            const t = tally.byRecruit[r.id] || { average: null, activeCount: 0, voterCount: 0, byEvent: {}, excludedCount: 0 }
            const status = ctl.noteStatus[r.id]
            const dirty = (ctl.noteDrafts[r.id] || '') !== (ctl.savedNotes[r.id] || '')
            const noteId = 'note-' + r.id
            return (
              <article key={r.id} className="card" aria-labelledby={'name-' + r.id}>
                <div className="recruit" style={{ marginBottom: 12 }}>
                  <RecruitAvatar name={r.name} src={ctl.photoFor(r)} />
                  <div className="grow">
                    <div className="recruit-name" id={'name-' + r.id}>
                      {t.average != null && <span className="muted small" aria-label={'Rank ' + (index + 1)}>#{index + 1} </span>}
                      {r.name} {ctl.isTempId(r.id) && <span className="badge">Saving…</span>}
                    </div>
                    {summary(r) && <div className="recruit-meta">{summary(r)}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="score" aria-label={'Average score ' + formatAverage(t.average)}>{formatAverage(t.average)}</div>
                    <div className="small muted">{t.activeCount} vote{t.activeCount === 1 ? '' : 's'} · {t.voterCount} voter{t.voterCount === 1 ? '' : 's'}</div>
                  </div>
                </div>
                {Object.keys(t.byEvent).length > 0 && (
                  <div className="row" style={{ marginBottom: 12 }}>
                    {Object.keys(t.byEvent).map(eid => (
                      <span key={eid} className="badge badge-purple">{eventName[eid]}: {formatAverage(t.byEvent[eid].average)} ({t.byEvent[eid].count})</span>
                    ))}
                    {t.excludedCount > 0 && <span className="badge">{t.excludedCount} excluded</span>}
                  </div>
                )}
                <label className="field-label" htmlFor={noteId}>Notes on {r.name}</label>
                <textarea
                  id={noteId}
                  value={ctl.noteDrafts[r.id] || ''}
                  onChange={e => ctl.editNote(r.id, e.target.value)}
                  rows={3}
                  maxLength={5000}
                  disabled={ctl.isTempId(r.id)}
                />
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={() => ctl.saveNote(r.id)}
                    disabled={ctl.isTempId(r.id) || !!ctl.saving['note:' + r.id] || !dirty || ctl.wiping}
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
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
