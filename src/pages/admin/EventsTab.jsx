import { useState } from 'react'
import { EmptyState, SavingPill } from '../../components/ui'

export default function EventsTab({ data, ctl }) {
  const [name, setName] = useState('')

  async function submit(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    if (await ctl.addEvent(trimmed)) setName('')
  }

  const presentSet = new Set(data.attendance.map(a => a.eventId + '::' + a.recruitId))
  return (
    <div className="stack">
      <form className="card" onSubmit={submit}>
        <label className="field-label" htmlFor="event-name">New event</label>
        <div className="row">
          <input id="event-name" className="grow" value={name} onChange={e => setName(e.target.value)} required maxLength={120} placeholder="e.g. Info Session" style={{ flex: 1 }} />
          <button type="submit" className="btn-primary" disabled={!!ctl.saving['add-event'] || ctl.wiping}>Add event</button>
        </div>
      </form>
      {data.events.length === 0 ? (
        <EmptyState title="No events yet">Add an event, then check off who attended so members can vote.</EmptyState>
      ) : data.events.slice().reverse().map(ev => {
        const pendingEvent = ctl.isTempId(ev.id)
        const count = data.recruits.filter(r => presentSet.has(ev.id + '::' + r.id)).length
        return (
          <section key={ev.id} className="card" aria-labelledby={'ev-' + ev.id}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <h2 id={'ev-' + ev.id}>{ev.name} {pendingEvent && <SavingPill />}</h2>
                <div className="small muted">{count} of {data.recruits.length} recruits present</div>
              </div>
              <button type="button" className="icon-btn" onClick={() => ctl.deleteEvent(ev)} disabled={pendingEvent || ctl.wiping} aria-label={'Delete event ' + ev.name} title={'Delete ' + ev.name}>×</button>
            </div>
            <fieldset style={{ border: 'none' }}>
              <legend className="sr-only">Attendance for {ev.name}</legend>
              {data.recruits.length === 0 ? <p className="small muted">Add recruits to take attendance.</p> : data.recruits.map(r => {
                const present = presentSet.has(ev.id + '::' + r.id)
                const key = `att:${ev.id}:${r.id}`
                return (
                  <label key={r.id} className="row" style={{ padding: '6px 0', minHeight: 40 }}>
                    <input
                      type="checkbox"
                      checked={present}
                      disabled={pendingEvent || ctl.isTempId(r.id) || !!ctl.saving[key] || ctl.wiping}
                      onChange={() => ctl.setAttendance(ev.id, r.id, !present)}
                    />
                    <span>{r.name}</span>
                    {ctl.saving[key] && <SavingPill />}
                  </label>
                )
              })}
            </fieldset>
          </section>
        )
      })}
    </div>
  )
}
