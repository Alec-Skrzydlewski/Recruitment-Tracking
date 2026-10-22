import { useState, useEffect } from 'react'
import { callApi } from '../lib/api'

export default function Admin({ token, me }) {
  const [tab, setTab] = useState('dashboard')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newMajor, setNewMajor] = useState('')
  const [newEvent, setNewEvent] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [noteDrafts, setNoteDrafts] = useState({})

  async function load() {
    setLoading(true)
    const d = await callApi('getAdminData', token)
    setData(d)
    const drafts = {}
    ;(d.notes || []).forEach(n => { drafts[n.recruitId] = n.content || '' })
    setNoteDrafts(drafts)
    setLoading(false)
  }

  useEffect(() => { load() }, [token])

  async function addRecruit(e) {
    e.preventDefault()
    if (!newName.trim()) return
    await callApi('addRecruit', token, { name: newName.trim(), major: newMajor.trim() })
    setNewName(''); setNewMajor(''); load()
  }

  async function addEvent(e) {
    e.preventDefault()
    if (!newEvent.trim()) return
    await callApi('addEvent', token, { name: newEvent.trim() })
    setNewEvent(''); load()
  }

  async function addUser(e) {
    e.preventDefault()
    if (!newEmail.trim()) return
    await callApi('manageUser', token, { op: 'add', email: newEmail.trim(), role: 'brother' })
    setNewEmail(''); load()
  }

  async function saveNote(recruitId) {
    await callApi('saveNote', token, { recruitId, content: noteDrafts[recruitId] || '' })
    alert('Note saved')
  }

  async function wipe() {
    if (!confirm('Wipe all recruits, events, votes, and notes for this cycle? Users will be kept.')) return
    await callApi('wipeCycle', token)
    load()
    alert('Cycle wiped.')
  }

  if (loading || !data) return <div style={{ padding: '2rem' }}>Loading...</div>

  const scoreFor = (recruitId) => {
    const vs = data.votes.filter(v => v.recruitId === recruitId)
    if (!vs.length) return null
    return (vs.reduce((s, v) => s + Number(v.score), 0) / vs.length).toFixed(1)
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 20 }}>Admin</h1>
        <div>
          <button onClick={wipe} style={{ marginRight: 12, fontSize: 13, color: '#b83232' }}>Wipe Cycle</button>
          <button onClick={() => { localStorage.removeItem('google_token'); location.reload() }} style={{ fontSize: 13, color: '#aaa', background: 'none', border: 'none' }}>
            Sign out
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #e8e8e5', marginBottom: 20 }}>
        {['dashboard', 'recruits', 'events', 'users'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'none', border: 'none',
            borderBottom: tab === t ? '2px solid #1a1a1a' : '2px solid transparent',
            padding: '8px 16px', fontWeight: tab === t ? 500 : 400,
            color: tab === t ? '#1a1a1a' : '#999',
          }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <div>
          {data.recruits.length === 0 ? <div className="card"><p style={{ color: '#888' }}>No recruits yet.</p></div> :
            data.recruits.map(r => (
              <div key={r.id} className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <strong>{r.name}</strong>
                    {r.major && <span style={{ color: '#999' }}> · {r.major}</span>}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 500 }}>{scoreFor(r.id) ?? '—'}</div>
                </div>
                <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
                  {data.votes.filter(v => v.recruitId === r.id).length} votes
                </div>
                <textarea
                  value={noteDrafts[r.id] || ''}
                  onChange={e => setNoteDrafts(d => ({ ...d, [r.id]: e.target.value }))}
                  placeholder="Notes about this recruit..."
                  rows={3}
                  style={{ width: '100%', marginBottom: 8, fontSize: 13 }}
                />
                <button onClick={() => saveNote(r.id)} className="btn-primary" style={{ fontSize: 13, padding: '6px 12px' }}>Save note</button>
              </div>
            ))}
        </div>
      )}

      {tab === 'recruits' && (
        <div>
          <form onSubmit={addRecruit} style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name" required style={{ flex: 1 }} />
            <input value={newMajor} onChange={e => setNewMajor(e.target.value)} placeholder="Major (optional)" style={{ flex: 1 }} />
            <button type="submit" className="btn-primary">Add</button>
          </form>
          {data.recruits.map(r => (
            <div key={r.id} className="card" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{r.name} {r.major && <span style={{ color: '#999' }}>· {r.major}</span>}</span>
              <button onClick={async () => { await callApi('deleteRecruit', token, { id: r.id }); load() }} style={{ color: '#ccc', background: 'none', border: 'none', fontSize: 18 }}>×</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'events' && (
        <div>
          <form onSubmit={addEvent} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input value={newEvent} onChange={e => setNewEvent(e.target.value)} placeholder="Event name" required style={{ flex: 1 }} />
            <button type="submit" className="btn-primary">Add</button>
          </form>
          {data.events.map(ev => (
            <div key={ev.id} className="card" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{ev.name}</strong>
                <button onClick={async () => { await callApi('deleteEvent', token, { id: ev.id }); load() }} style={{ color: '#ccc', background: 'none', border: 'none', fontSize: 18 }}>×</button>
              </div>
              <div style={{ marginTop: 8, fontSize: 13 }}>
                {data.recruits.map(r => {
                  const present = data.attendance.some(a => a.eventId === ev.id && a.recruitId === r.id)
                  return (
                    <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <input type="checkbox" checked={present} onChange={async () => {
                        await callApi('toggleAttendance', token, { eventId: ev.id, recruitId: r.id })
                        load()
                      }} />
                      {r.name}
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'users' && (
        <div>
          <form onSubmit={addUser} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email to add" type="email" required style={{ flex: 1 }} />
            <button type="submit" className="btn-primary">Add brother</button>
          </form>
          {data.users.map(u => (
            <div key={u.email} className="card" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div>{u.name || u.email}</div>
                <div style={{ fontSize: 12, color: '#999' }}>{u.email} · {u.role}</div>
              </div>
              <div>
                {u.role !== 'admin' && (
                  <button onClick={async () => { await callApi('manageUser', token, { op: 'setRole', email: u.email, role: 'admin' }); load() }} style={{ fontSize: 12, marginRight: 8 }}>Make admin</button>
                )}
                {String(u.email || '').toLowerCase() !== String(me.email || '').toLowerCase() && (
                  <button onClick={async () => { if (confirm('Remove ' + u.email + '?')) { await callApi('manageUser', token, { op: 'remove', email: u.email }); load() } }} style={{ fontSize: 12, color: '#b83232' }}>Remove</button>
                )}
              </div>
            </div>
          ))}
          <p style={{ fontSize: 12, color: '#aaa', marginTop: 16 }}>
            Password resets are handled by Google. Users click “Forgot password” on the Google login screen.
          </p>
        </div>
      )}
    </div>
  )
}
