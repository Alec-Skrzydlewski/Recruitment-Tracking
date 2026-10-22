import { useState, useEffect, useRef } from 'react'
import { callApi } from '../lib/api'
import {
  apply,
  rollback,
  replaceId,
  replaceIdInMap,
  nextTempId,
  isTempId,
  createInflightGuard,
} from '../lib/adminState'

function SavingPill() {
  return <span className="badge badge-gray" style={{ marginLeft: 8 }}>Saving…</span>
}

export default function Admin({ token, me }) {
  const [tab, setTab] = useState('dashboard')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newName, setNewName] = useState('')
  const [newMajor, setNewMajor] = useState('')
  const [newEvent, setNewEvent] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [noteDrafts, setNoteDrafts] = useState({})
  const [saving, setSaving] = useState({})

  const dataRef = useRef(null)
  const inflight = useRef(createInflightGuard())

  function commit(next) {
    dataRef.current = next
    setData(next)
  }

  function applyAction(action) {
    const result = apply(dataRef.current, action)
    commit(result.data)
    return result.inverse
  }

  function rollbackAction(inverse) {
    if (!inverse || !dataRef.current) return
    commit(rollback(dataRef.current, inverse))
  }

  function begin(key) {
    if (!inflight.current.begin(key)) return false
    setSaving(s => ({ ...s, [key]: true }))
    return true
  }

  function end(key) {
    inflight.current.end(key)
    setSaving(s => {
      if (!s[key]) return s
      const next = { ...s }
      delete next[key]
      return next
    })
  }

  function fail(err) {
    setError(err && err.message ? err.message : String(err))
  }

  useEffect(() => {
    let cancelled = false
    callApi('getAdminData', token)
      .then(d => {
        if (cancelled) return
        dataRef.current = d
        setData(d)
        const drafts = {}
        ;(d.notes || []).forEach(n => { drafts[n.recruitId] = n.content || '' })
        setNoteDrafts(drafts)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        fail(err)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [token])

  async function addRecruit(e) {
    e.preventDefault()
    const name = newName.trim()
    const major = newMajor.trim()
    if (!name) return
    if (!begin('add-recruit')) return
    setNewName('')
    setNewMajor('')
    const tempId = nextTempId()
    const inverse = applyAction({
      type: 'addTemp',
      collection: 'recruits',
      tempId,
      item: { name, major },
    })
    try {
      const res = await callApi('addRecruit', token, { name, major })
      const realId = res && res.id
      if (realId && dataRef.current) {
        commit(replaceId(dataRef.current, tempId, realId))
        setNoteDrafts(d => replaceIdInMap(d, tempId, realId))
      }
    } catch (err) {
      rollbackAction(inverse)
      fail(err)
    } finally {
      end('add-recruit')
    }
  }

  async function addEvent(e) {
    e.preventDefault()
    const name = newEvent.trim()
    if (!name) return
    if (!begin('add-event')) return
    setNewEvent('')
    const tempId = nextTempId()
    const inverse = applyAction({
      type: 'addTemp',
      collection: 'events',
      tempId,
      item: { name },
    })
    try {
      const res = await callApi('addEvent', token, { name })
      const realId = res && res.id
      if (realId && dataRef.current) {
        commit(replaceId(dataRef.current, tempId, realId))
      }
    } catch (err) {
      rollbackAction(inverse)
      fail(err)
    } finally {
      end('add-event')
    }
  }

  async function addUser(e) {
    e.preventDefault()
    const email = newEmail.trim()
    if (!email) return
    if (!begin('add-user')) return
    setNewEmail('')
    const inverse = applyAction({ type: 'addUser', email })
    try {
      await callApi('manageUser', token, { op: 'add', email, role: 'brother' })
    } catch (err) {
      rollbackAction(inverse)
      fail(err)
    } finally {
      end('add-user')
    }
  }

  async function onDeleteRecruit(id) {
    if (isTempId(id)) return
    const key = `del-recruit:${id}`
    if (!begin(key)) return
    const inverse = applyAction({ type: 'removeById', collection: 'recruits', id })
    try {
      await callApi('deleteRecruit', token, { id })
    } catch (err) {
      rollbackAction(inverse)
      fail(err)
    } finally {
      end(key)
    }
  }

  async function onDeleteEvent(id) {
    if (isTempId(id)) return
    const key = `del-event:${id}`
    if (!begin(key)) return
    const inverse = applyAction({ type: 'removeById', collection: 'events', id })
    try {
      await callApi('deleteEvent', token, { id })
    } catch (err) {
      rollbackAction(inverse)
      fail(err)
    } finally {
      end(key)
    }
  }

  async function onToggleAttendance(eventId, recruitId) {
    if (isTempId(eventId) || isTempId(recruitId)) return
    const key = `att:${eventId}:${recruitId}`
    if (!begin(key)) return
    const inverse = applyAction({ type: 'toggleAttendance', eventId, recruitId })
    try {
      await callApi('toggleAttendance', token, { eventId, recruitId })
    } catch (err) {
      rollbackAction(inverse)
      fail(err)
    } finally {
      end(key)
    }
  }

  async function onMakeAdmin(email) {
    const key = `role:${email}`
    if (!begin(key)) return
    const inverse = applyAction({ type: 'setUserRole', email, role: 'admin' })
    try {
      await callApi('manageUser', token, { op: 'setRole', email, role: 'admin' })
    } catch (err) {
      rollbackAction(inverse)
      fail(err)
    } finally {
      end(key)
    }
  }

  async function onRemoveUser(email) {
    if (!confirm('Remove ' + email + '?')) return
    const key = `user-remove:${email}`
    if (!begin(key)) return
    const inverse = applyAction({ type: 'removeUser', email })
    try {
      await callApi('manageUser', token, { op: 'remove', email })
    } catch (err) {
      rollbackAction(inverse)
      fail(err)
    } finally {
      end(key)
    }
  }

  async function saveNote(recruitId) {
    if (isTempId(recruitId)) return
    await callApi('saveNote', token, { recruitId, content: noteDrafts[recruitId] || '' })
    alert('Note saved')
  }

  async function wipe() {
    if (!confirm('Wipe all recruits, events, votes, and notes for this cycle? Users will be kept.')) return
    if (!begin('wipe')) return
    try {
      await callApi('wipeCycle', token)
      const d = await callApi('getAdminData', token)
      dataRef.current = d
      setData(d)
      const drafts = {}
      ;(d.notes || []).forEach(n => { drafts[n.recruitId] = n.content || '' })
      setNoteDrafts(drafts)
      alert('Cycle wiped.')
    } catch (err) {
      fail(err)
    } finally {
      end('wipe')
    }
  }

  const errorBanner = error ? (
    <div role="alert" style={{
      background: '#fde8e8',
      color: '#b83232',
      padding: '10px 12px',
      borderRadius: 8,
      marginBottom: 16,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
      fontSize: 13,
    }}>
      <span>{error}</span>
      <button
        type="button"
        onClick={() => setError(null)}
        style={{ background: 'none', border: 'none', color: '#b83232', fontSize: 18, padding: '0 4px' }}
        aria-label="Dismiss error"
      >×</button>
    </div>
  ) : null

  if (!data) {
    if (error && !loading) return <div style={{ padding: '2rem', maxWidth: 800, margin: '0 auto' }}>{errorBanner}</div>
    return <div style={{ padding: '2rem' }}>Loading...</div>
  }

  const scoreFor = (recruitId) => {
    const vs = data.votes.filter(v => v.recruitId === recruitId)
    if (!vs.length) return null
    return (vs.reduce((s, v) => s + Number(v.score), 0) / vs.length).toFixed(1)
  }

  const deletingRecruits = Object.keys(saving).some(k => k.startsWith('del-recruit:'))
  const deletingEvents = Object.keys(saving).some(k => k.startsWith('del-event:'))
  const removingUsers = Object.keys(saving).some(k => k.startsWith('user-remove:'))

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 20 }}>Admin</h1>
        <div>
          <button onClick={wipe} disabled={!!saving.wipe} style={{ marginRight: 12, fontSize: 13, color: '#b83232' }}>
            Wipe Cycle
          </button>
          {saving.wipe && <SavingPill />}
          <button onClick={() => { localStorage.removeItem('google_token'); location.reload() }} style={{ fontSize: 13, color: '#aaa', background: 'none', border: 'none' }}>
            Sign out
          </button>
        </div>
      </div>

      {errorBanner}

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
                    {isTempId(r.id) && <SavingPill />}
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
                <button onClick={() => saveNote(r.id)} disabled={isTempId(r.id)} className="btn-primary" style={{ fontSize: 13, padding: '6px 12px' }}>Save note</button>
              </div>
            ))}
        </div>
      )}

      {tab === 'recruits' && (
        <div>
          <form onSubmit={addRecruit} style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name" required style={{ flex: 1 }} />
            <input value={newMajor} onChange={e => setNewMajor(e.target.value)} placeholder="Major (optional)" style={{ flex: 1 }} />
            <button type="submit" className="btn-primary" disabled={!!saving['add-recruit']}>Add</button>
            {saving['add-recruit'] && <SavingPill />}
          </form>
          {deletingRecruits && <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Saving…</div>}
          {data.recruits.map(r => (
            <div key={r.id} className="card" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                {r.name} {r.major && <span style={{ color: '#999' }}>· {r.major}</span>}
                {isTempId(r.id) && <SavingPill />}
              </span>
              <button
                onClick={() => onDeleteRecruit(r.id)}
                disabled={isTempId(r.id)}
                style={{ color: '#ccc', background: 'none', border: 'none', fontSize: 18 }}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'events' && (
        <div>
          <form onSubmit={addEvent} style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
            <input value={newEvent} onChange={e => setNewEvent(e.target.value)} placeholder="Event name" required style={{ flex: 1 }} />
            <button type="submit" className="btn-primary" disabled={!!saving['add-event']}>Add</button>
            {saving['add-event'] && <SavingPill />}
          </form>
          {deletingEvents && <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Saving…</div>}
          {data.events.map(ev => {
            const eventPending = isTempId(ev.id)
            return (
              <div key={ev.id} className="card" style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>
                    {ev.name}
                    {eventPending && <SavingPill />}
                  </strong>
                  <button
                    onClick={() => onDeleteEvent(ev.id)}
                    disabled={eventPending}
                    style={{ color: '#ccc', background: 'none', border: 'none', fontSize: 18 }}
                  >×</button>
                </div>
                <div style={{ marginTop: 8, fontSize: 13 }}>
                  {data.recruits.map(r => {
                    const present = data.attendance.some(a => a.eventId === ev.id && a.recruitId === r.id)
                    const attKey = `att:${ev.id}:${r.id}`
                    const pending = eventPending || isTempId(r.id) || !!saving[attKey]
                    return (
                      <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <input
                          type="checkbox"
                          checked={present}
                          disabled={pending}
                          onChange={() => onToggleAttendance(ev.id, r.id)}
                        />
                        {r.name}
                        {saving[attKey] && <SavingPill />}
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'users' && (
        <div>
          <form onSubmit={addUser} style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
            <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email to add" type="email" required style={{ flex: 1 }} />
            <button type="submit" className="btn-primary" disabled={!!saving['add-user']}>Add brother</button>
            {saving['add-user'] && <SavingPill />}
          </form>
          {removingUsers && <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Saving…</div>}
          {data.users.map(u => (
            <div key={u.email} className="card" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div>{u.name || u.email}</div>
                <div style={{ fontSize: 12, color: '#999' }}>{u.email} · {u.role}</div>
              </div>
              <div>
                {u.role !== 'admin' && (
                  <button
                    onClick={() => onMakeAdmin(u.email)}
                    disabled={!!saving[`role:${u.email}`]}
                    style={{ fontSize: 12, marginRight: 8 }}
                  >
                    Make admin
                  </button>
                )}
                {saving[`role:${u.email}`] && <SavingPill />}
                {String(u.email || '').toLowerCase() !== String(me.email || '').toLowerCase() && (
                  <button
                    onClick={() => onRemoveUser(u.email)}
                    disabled={!!saving[`user-remove:${u.email}`]}
                    style={{ fontSize: 12, color: '#b83232' }}
                  >Remove</button>
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
