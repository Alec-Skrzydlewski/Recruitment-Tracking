import { useState } from 'react'
import { SavingPill } from '../../components/ui'

export default function UsersTab({ data, ctl }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')

  async function submit(e) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    if (await ctl.addUser(trimmed, name.trim())) { setEmail(''); setName('') }
  }

  const me = String(ctl.me.email || '').toLowerCase()
  const adminCount = data.users.filter(u => u.role === 'admin').length
  return (
    <div className="stack">
      <form className="card" onSubmit={submit}>
        <h2 style={{ marginBottom: 12 }}>Add a member</h2>
        <div className="form-grid two">
          <div>
            <label className="field-label" htmlFor="member-email">Google account email</label>
            <input id="member-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} autoComplete="off" />
          </div>
          <div>
            <label className="field-label" htmlFor="member-name">Display name <span className="muted">(optional)</span></label>
            <input id="member-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="off" />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="submit" className="btn-primary" disabled={!!ctl.saving['add-user'] || ctl.wiping}>Add member</button>
          {ctl.saving['add-user'] && <SavingPill />}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>Only listed, active members can sign in and vote. Sign-in and passwords are handled by Google.</p>
      </form>
      <ul className="stack" style={{ listStyle: 'none' }} aria-label="Members">
        {data.users.map(u => {
          const isMe = String(u.email || '').toLowerCase() === me
          const lastAdmin = u.role === 'admin' && adminCount === 1
          return (
            <li key={u.email} className="card row">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{u.name || u.email} {isMe && <span className="badge">You</span>}</div>
                <div className="small muted">{u.email}</div>
              </div>
              <span className={u.role === 'admin' ? 'badge badge-gold' : 'badge'}>{u.role === 'admin' ? 'Admin' : 'Member'}</span>
              {u.role !== 'admin'
                ? <button type="button" className="btn-sm" onClick={() => ctl.setRole(u.email, 'admin')} disabled={!!ctl.saving['role:' + u.email] || ctl.wiping}>Make admin</button>
                : !isMe && !lastAdmin && <button type="button" className="btn-sm" onClick={() => ctl.setRole(u.email, 'brother')} disabled={!!ctl.saving['role:' + u.email] || ctl.wiping}>Make member</button>}
              {!isMe && !lastAdmin && (
                <button type="button" className="btn-sm btn-danger" onClick={() => ctl.removeUser(u.email)} disabled={!!ctl.saving['user-remove:' + u.email] || ctl.wiping} aria-label={'Remove ' + (u.name || u.email)}>Remove</button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
