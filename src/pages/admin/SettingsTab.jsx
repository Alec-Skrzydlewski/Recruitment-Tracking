import { useState } from 'react'
import { SavingPill } from '../../components/ui'

const PHRASE = 'WIPE CYCLE'

export default function SettingsTab({ data, ctl }) {
  const [typed, setTyped] = useState('')
  const busy = Object.keys(ctl.saving).some(k => k !== 'wipe')

  async function wipe(e) {
    e.preventDefault()
    if (typed !== PHRASE) return
    if (await ctl.wipe(typed)) setTyped('')
  }

  return (
    <div className="stack">
      <section className="card" aria-labelledby="about-title">
        <h2 id="about-title">How data is handled</h2>
        <ul className="small muted" style={{ paddingLeft: 18, marginTop: 8 }}>
          <li>Every request is verified with Google and must come from an active member on the list.</li>
          <li>Members see only their own scores. Admins see all scores to run deliberations.</li>
          <li>Deleting a recruit or event keeps its past votes as history; averages exclude them.</li>
          <li>Photos stay private in Drive and are served only to signed-in members.</li>
        </ul>
      </section>
      <form className="card" onSubmit={wipe} aria-labelledby="wipe-title" style={{ borderColor: '#efc9c9' }}>
        <h2 id="wipe-title">End of cycle: wipe data</h2>
        <p className="small muted" style={{ margin: '6px 0 12px' }}>
          Clears {data.recruits.length} recruits, {data.events.length} events, {data.attendance.length} attendance marks, {data.votes.length} votes and {data.notes.length} notes.
          Members and Drive photos are kept. If any recruits, events, attendance, votes or notes changed since this page loaded, including your own edits, nothing is wiped and the page reloads so you can review and confirm again.
        </p>
        <label className="field-label" htmlFor="wipe-confirm">Type <span className="kbd">{PHRASE}</span> to confirm</label>
        <input id="wipe-confirm" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        <div className="row" style={{ marginTop: 12 }}>
          <button type="submit" className="btn-danger" disabled={typed !== PHRASE || busy || ctl.wiping}>Wipe cycle data</button>
          {ctl.wiping && <SavingPill label="Wiping…" />}
          {busy && <span className="small muted">Waiting for other changes to finish…</span>}
        </div>
      </form>
    </div>
  )
}
