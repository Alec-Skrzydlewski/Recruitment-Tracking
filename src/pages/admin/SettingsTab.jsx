import { useState } from 'react'
import { SavingPill } from '../../components/ui'

const PHRASE = 'WIPE CYCLE'

export default function SettingsTab({ data, ctl }) {
  const [typed, setTyped] = useState('')
  const busy = Object.keys(ctl.saving).some(k => k !== 'wipe' && k !== 'cleanup')
  const cleaning = !!ctl.saving.cleanup
  const preview = ctl.cleanup

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
          <li>Deleting a recruit permanently deletes their votes, attendance and note (their Drive photo file is kept). Deleting an event permanently deletes its votes and attendance. Marking a recruit absent permanently deletes their votes at that event.</li>
          <li>Photos stay private in Drive and are served only to signed-in members.</li>
        </ul>
      </section>
      <section className="card" aria-labelledby="cleanup-title">
        <h2 id="cleanup-title">Invalid-vote cleanup</h2>
        <p className="small muted" style={{ margin: '6px 0 12px' }}>
          Finds stored votes for a recruit or event that no longer exists, for a recruit not marked present at that event, or with a score outside 1–10. Checking changes nothing. Deleting is permanent.
        </p>
        <div className="row">
          <button type="button" onClick={() => ctl.previewCleanup()} disabled={cleaning}>Check for invalid votes</button>
        </div>
        {preview && (
          <div style={{ marginTop: 12 }} role="status">
            {preview.count === 0 ? (
              <p className="small">No invalid votes found.</p>
            ) : (
              <>
                <p className="small">
                  {preview.count} invalid vote{preview.count === 1 ? '' : 's'}: {preview.byReason.missingRecruit} for a missing recruit, {preview.byReason.missingEvent} for a missing event, {preview.byReason.notPresent} without attendance, {preview.byReason.invalidScore} with an invalid score.
                </p>
                <div className="row" style={{ marginTop: 8 }}>
                  <button type="button" className="btn-danger" onClick={() => ctl.runCleanup()} disabled={busy || cleaning || ctl.wiping}>
                    Permanently delete {preview.count} invalid vote{preview.count === 1 ? '' : 's'}
                  </button>
                  {cleaning && <SavingPill label="Deleting…" />}
                </div>
              </>
            )}
          </div>
        )}
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
          <button type="submit" className="btn-danger" disabled={typed !== PHRASE || busy || ctl.wiping || cleaning}>Wipe cycle data</button>
          {ctl.wiping && <SavingPill label="Wiping…" />}
          {busy && <span className="small muted">Waiting for other changes to finish…</span>}
        </div>
      </form>
    </div>
  )
}
