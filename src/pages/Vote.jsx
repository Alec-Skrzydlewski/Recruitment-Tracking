import { formatEventDate } from '../lib/eventDate'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRuntime } from '../runtime'
import { usePhotoMap } from '../lib/usePhotoMap'
import { createWriteQueue } from '../lib/voteQueue'
import RecruitAvatar from '../components/RecruitAvatar'
import { Banner, EmptyState, ErrorState, LoadingState, errorText } from '../components/ui'

const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

function voteKey(eventId, recruitId) {
  return eventId + '::' + recruitId
}

export default function Vote() {
  const { api, me, loadPhotos } = useRuntime()
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [eventId, setEventId] = useState('')
  // Optimistic scores the person picked, and the last score the server confirmed.
  const [picked, setPicked] = useState({})
  const confirmed = useRef({})
  const [status, setStatus] = useState({})

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    setData(null)
    api('getVoteData').then(d => {
      if (cancelled) return
      const saved = {}
      ;(d.myVotes || []).forEach(v => { saved[voteKey(v.eventId, v.recruitId)] = Number(v.score) })
      confirmed.current = saved
      setPicked(saved)
      setData(d)
      setEventId(current => {
        if (current && (d.events || []).some(e => e.id === current)) return current
        return d.events && d.events.length ? d.events[d.events.length - 1].id : ''
      })
    }).catch(err => {
      if (!cancelled) setLoadError(errorText(err))
    })
    return () => { cancelled = true }
  }, [api, attempt])

  const queue = useMemo(() => createWriteQueue((key, value) => {
    const [ev, rec] = key.split('::')
    return api('castVote', { eventId: ev, recruitId: rec, score: value })
  }), [api])

  const vote = useCallback(async (recruitId, score) => {
    const key = voteKey(eventId, recruitId)
    setPicked(p => ({ ...p, [key]: score }))
    setStatus(s => ({ ...s, [key]: { state: 'saving' } }))
    const outcome = await queue.push(key, score)
    if (outcome.superseded) return
    if (outcome.ok) {
      confirmed.current = { ...confirmed.current, [key]: score }
      setStatus(s => ({ ...s, [key]: { state: 'saved' } }))
    } else {
      setPicked(p => {
        const next = { ...p }
        if (confirmed.current[key] == null) delete next[key]
        else next[key] = confirmed.current[key]
        return next
      })
      setStatus(s => ({ ...s, [key]: { state: 'error', message: errorText(outcome.error), retry: score } }))
    }
  }, [eventId, queue])

  const recruits = useMemo(() => {
    if (!data) return []
    const present = new Set((data.attendance || []).filter(a => a.eventId === eventId).map(a => a.recruitId))
    return (data.recruits || []).filter(r => present.has(r.id))
  }, [data, eventId])

  // Only photos for recruits shown at the selected event are requested.
  const { photos, failed: photosFailed, retry: retryPhotos } = usePhotoMap(loadPhotos, recruits.map(r => r.photoFileId))

  if (loadError) return <ErrorState title="Couldn't load voting" message={loadError} onRetry={() => setAttempt(n => n + 1)} />
  if (!data) return <LoadingState label="Loading events…" />

  const events = data.events || []
  const rated = recruits.filter(r => picked[voteKey(eventId, r.id)] != null).length
  const pct = recruits.length ? Math.round((rated / recruits.length) * 100) : 0

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <div className="eyebrow">Vote</div>
          <h1>Rate recruits</h1>
          <p className="lede">Signed in as {me.name || me.email}. Scores save as you tap; only you and admins see them.</p>
        </div>
      </div>

      {events.length === 0 ? (
        <EmptyState title="No events yet">An admin needs to add an event and take attendance first.</EmptyState>
      ) : (
        <div className="stack">
          <div className="card">
            <label className="field-label" htmlFor="vote-event">Event</label>
            <select id="vote-event" value={eventId} onChange={e => setEventId(e.target.value)}>
              {events.map(ev => <option key={ev.id} value={ev.id}>{formatEventDate(ev.date) ? ev.name + ' — ' + formatEventDate(ev.date) : ev.name}</option>)}
            </select>
            {recruits.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="row small muted" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <span>{rated} of {recruits.length} rated</span>
                  <span>{pct}%</span>
                </div>
                <div className="progress" role="progressbar" aria-label="Rating progress" aria-valuemin={0} aria-valuemax={recruits.length} aria-valuenow={rated}>
                  <span style={{ width: pct + '%' }} />
                </div>
              </div>
            )}
          </div>

          {photosFailed && (
            <Banner kind="warn" action={<button type="button" className="btn-sm" onClick={retryPhotos}>Retry photos</button>}>
              Photos couldn&apos;t load. Initials are shown instead; voting still works.
            </Banner>
          )}

          {recruits.length === 0 ? (
            <EmptyState title="Nobody checked in">No recruits are marked present for this event yet.</EmptyState>
          ) : recruits.map(r => {
            const key = voteKey(eventId, r.id)
            const majorLine = [r.major, r.secondMajor].filter(Boolean).join(' / ')
            const detail = [majorLine, r.gradYear ? 'Class of ' + r.gradYear : ''].filter(Boolean).join(' · ')
            const st = status[key]
            const legendId = 'legend-' + r.id
            return (
              <div key={r.id} className="card">
                <div className="recruit" style={{ marginBottom: 12 }}>
                  <RecruitAvatar name={r.name} src={r.photoFileId && photos[r.photoFileId]} />
                  <div className="grow">
                    <div className="recruit-name" id={legendId + '-name'}>{r.name}</div>
                    {detail && <div className="recruit-meta">{detail}</div>}
                  </div>
                  <span aria-live="polite" className="small">
                    {st && st.state === 'saving' && <span className="status status-saving">Saving…</span>}
                    {st && st.state === 'saved' && <span className="status status-saved">✓ Saved</span>}
                  </span>
                </div>
                <fieldset className="rating">
                  <legend id={legendId}>Score for {r.name} (1 low – 10 high)</legend>
                  <div className="rating-options">
                    {SCORES.map(n => (
                      <label key={n} className="rating-option">
                        <input
                          type="radio"
                          name={'score-' + key}
                          value={n}
                          checked={picked[key] === n}
                          onChange={() => vote(r.id, n)}
                          aria-label={`${n} for ${r.name}`}
                        />
                        <span aria-hidden="true">{n}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {st && st.state === 'error' && (
                  <div className="row status status-error" role="alert" style={{ marginTop: 10 }}>
                    <span className="grow">Not saved: {st.message}</span>
                    <button type="button" className="btn-sm" onClick={() => vote(r.id, st.retry)}>Retry {st.retry}</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
