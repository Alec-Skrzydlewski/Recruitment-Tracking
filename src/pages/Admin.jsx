import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ── Note editor (local state, saves on blur or button) ─────────────────────
function NoteEditor({ recruitId, initialValue, onSaved }) {
  const [value, setValue] = useState(initialValue || '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!dirty) return
    setSaving(true)
    await supabase
      .from('notes')
      .upsert({ recruit_id: recruitId, content: value, updated_at: new Date().toISOString() }, { onConflict: 'recruit_id' })
    setSaving(false)
    setDirty(false)
    onSaved(value)
  }

  return (
    <div style={{ marginTop: '10px' }}>
      <textarea
        value={value}
        onChange={e => { setValue(e.target.value); setDirty(true) }}
        onBlur={save}
        placeholder="Add comprehensive notes about this recruit..."
        rows={4}
        style={{ marginBottom: '8px', fontSize: '13px' }}
      />
      {dirty && (
        <button
          className="btn-primary"
          onClick={save}
          disabled={saving}
          style={{ fontSize: '13px', padding: '6px 14px' }}
        >
          {saving ? 'Saving...' : 'Save notes'}
        </button>
      )}
    </div>
  )
}

// ── Main admin component ────────────────────────────────────────────────────
export default function Admin({ session }) {
  const [tab, setTab] = useState('dashboard')
  const [recruits, setRecruits] = useState([])
  const [events, setEvents] = useState([])
  const [votes, setVotes] = useState([])
  const [notes, setNotes] = useState({}) // recruitId -> string
  const [loading, setLoading] = useState(true)
  const [expandedNotes, setExpandedNotes] = useState({})

  // Add-form state
  const [newName, setNewName] = useState('')
  const [newMajor, setNewMajor] = useState('')
  const [newEvent, setNewEvent] = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [
      { data: recs },
      { data: evs },
      { data: vs },
      { data: ns },
    ] = await Promise.all([
      supabase.from('recruits').select('*').order('name'),
      supabase.from('events').select('*').order('created_at'),
      supabase.from('votes').select('recruit_id, event_id, vote'),
      supabase.from('notes').select('recruit_id, content'),
    ])
    setRecruits(recs || [])
    setEvents(evs || [])
    setVotes(vs || [])
    const nm = {}
    ns?.forEach(n => { nm[n.recruit_id] = n.content })
    setNotes(nm)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Recruits ──
  async function addRecruit(e) {
    e.preventDefault()
    if (!newName.trim()) return
    const { data } = await supabase
      .from('recruits')
      .insert({ name: newName.trim(), major: newMajor.trim() || null })
      .select()
      .single()
    if (data) setRecruits(r => [...r, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewName(''); setNewMajor('')
  }

  async function deleteRecruit(r) {
    if (!confirm(`Remove ${r.name}? This also deletes their votes and notes.`)) return
    await supabase.from('recruits').delete().eq('id', r.id)
    setRecruits(list => list.filter(x => x.id !== r.id))
    setVotes(list => list.filter(v => v.recruit_id !== r.id))
    setNotes(n => { const c = { ...n }; delete c[r.id]; return c })
  }

  // ── Events ──
  async function addEvent(e) {
    e.preventDefault()
    if (!newEvent.trim()) return
    const { data } = await supabase
      .from('events')
      .insert({ name: newEvent.trim() })
      .select()
      .single()
    if (data) setEvents(ev => [...ev, data])
    setNewEvent('')
  }

  async function deleteEvent(ev) {
    if (!confirm(`Remove "${ev.name}"? This also deletes all votes for this event.`)) return
    await supabase.from('events').delete().eq('id', ev.id)
    setEvents(list => list.filter(x => x.id !== ev.id))
    setVotes(list => list.filter(v => v.event_id !== ev.id))
  }

  // ── Vote helpers ──
  function totalsFor(rid) {
    const rv = votes.filter(v => v.recruit_id === rid)
    return { good: rv.filter(v => v.vote === 'good').length, bad: rv.filter(v => v.vote === 'bad').length }
  }

  function eventTotalsFor(rid, eid) {
    const rv = votes.filter(v => v.recruit_id === rid && v.event_id === eid)
    return { good: rv.filter(v => v.vote === 'good').length, bad: rv.filter(v => v.vote === 'bad').length }
  }

  const sortedByScore = [...recruits].sort((a, b) => {
    const sa = totalsFor(a.id); const sb = totalsFor(b.id)
    return (sb.good - sb.bad) - (sa.good - sa.bad)
  })

  const TABS = ['dashboard', 'recruits', 'events']

  return (
    <div style={{ maxWidth: '780px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '500' }}>Admin</h1>
        <button
          onClick={() => supabase.auth.signOut()}
          style={{ fontSize: '13px', color: '#aaa', background: 'none', border: 'none', padding: 0 }}
        >
          Sign out
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e8e8e5', marginBottom: '1.5rem' }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid #1a1a1a' : '2px solid transparent',
              borderRadius: 0,
              padding: '8px 18px',
              fontWeight: tab === t ? '500' : '400',
              color: tab === t ? '#1a1a1a' : '#999',
              marginBottom: '-1px',
              fontSize: '14px',
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: '#aaa', fontSize: '14px' }}>Loading...</p>
      ) : (
        <>
          {/* ── DASHBOARD ── */}
          {tab === 'dashboard' && (
            <div>
              {recruits.length === 0 ? (
                <div className="card">
                  <p style={{ color: '#888', fontSize: '14px' }}>No recruits yet — add them in the Recruits tab.</p>
                </div>
              ) : (
                sortedByScore.map(r => {
                  const { good, bad } = totalsFor(r.id)
                  const net = good - bad
                  const noteExpanded = expandedNotes[r.id]
                  return (
                    <div key={r.id} className="card" style={{ marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: '500', fontSize: '15px' }}>{r.name}</div>
                          {r.major && <div style={{ fontSize: '13px', color: '#999' }}>{r.major}</div>}

                          {/* Vote badges */}
                          <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                            {good > 0 && <span className="badge badge-good">+{good} good</span>}
                            {bad > 0 && <span className="badge badge-bad">−{bad} bad</span>}
                            {good === 0 && bad === 0 && <span className="badge badge-gray">no votes</span>}
                          </div>

                          {/* Per-event breakdown */}
                          {events.length > 0 && (
                            <div style={{ display: 'flex', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
                              {events.map(ev => {
                                const et = eventTotalsFor(r.id, ev.id)
                                if (et.good === 0 && et.bad === 0) return null
                                return (
                                  <span key={ev.id} style={{ fontSize: '12px', color: '#aaa' }}>
                                    {ev.name}:
                                    {et.good > 0 && <span style={{ color: '#2d7a2d', marginLeft: '3px' }}>+{et.good}</span>}
                                    {et.bad > 0 && <span style={{ color: '#b83232', marginLeft: '3px' }}>−{et.bad}</span>}
                                  </span>
                                )
                              })}
                            </div>
                          )}
                        </div>

                        {/* Net score */}
                        <div style={{
                          fontSize: '24px',
                          fontWeight: '500',
                          color: net > 0 ? '#2d7a2d' : net < 0 ? '#b83232' : '#ccc',
                          flexShrink: 0,
                        }}>
                          {net > 0 ? '+' : ''}{net}
                        </div>
                      </div>

                      {/* Notes toggle */}
                      <div style={{ marginTop: '12px', borderTop: '1px solid #f0efe8', paddingTop: '10px' }}>
                        <button
                          onClick={() => setExpandedNotes(n => ({ ...n, [r.id]: !n[r.id] }))}
                          style={{ fontSize: '12px', color: '#aaa', background: 'none', border: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer' }}
                        >
                          {noteExpanded ? 'hide notes' : notes[r.id] ? 'view / edit notes' : 'add notes'}
                        </button>
                        {notes[r.id] && !noteExpanded && (
                          <p style={{ fontSize: '13px', color: '#888', marginTop: '6px', whiteSpace: 'pre-wrap' }}>
                            {notes[r.id].length > 120 ? notes[r.id].slice(0, 120) + '…' : notes[r.id]}
                          </p>
                        )}
                        {noteExpanded && (
                          <NoteEditor
                            recruitId={r.id}
                            initialValue={notes[r.id]}
                            onSaved={val => setNotes(n => ({ ...n, [r.id]: val }))}
                          />
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}

          {/* ── RECRUITS ── */}
          {tab === 'recruits' && (
            <div>
              <form onSubmit={addRecruit} style={{ display: 'flex', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Full name"
                  style={{ flex: '2 1 140px' }}
                  required
                />
                <input
                  value={newMajor}
                  onChange={e => setNewMajor(e.target.value)}
                  placeholder="Major / year (optional)"
                  style={{ flex: '2 1 140px' }}
                />
                <button type="submit" className="btn-primary" style={{ whiteSpace: 'nowrap' }}>
                  Add recruit
                </button>
              </form>

              {recruits.length === 0 ? (
                <div className="card">
                  <p style={{ color: '#888', fontSize: '14px' }}>No recruits added yet.</p>
                </div>
              ) : (
                recruits.map(r => (
                  <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '500' }}>{r.name}</div>
                      {r.major && <div style={{ fontSize: '13px', color: '#999' }}>{r.major}</div>}
                    </div>
                    <button
                      onClick={() => deleteRecruit(r)}
                      style={{ color: '#ccc', background: 'none', border: 'none', fontSize: '20px', padding: '2px 6px', lineHeight: 1 }}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── EVENTS ── */}
          {tab === 'events' && (
            <div>
              <form onSubmit={addEvent} style={{ display: 'flex', gap: '8px', marginBottom: '1rem' }}>
                <input
                  value={newEvent}
                  onChange={e => setNewEvent(e.target.value)}
                  placeholder="Event name (e.g. Coffee Chat, Info Night)"
                  required
                />
                <button type="submit" className="btn-primary" style={{ whiteSpace: 'nowrap' }}>
                  Add event
                </button>
              </form>

              {events.length === 0 ? (
                <div className="card">
                  <p style={{ color: '#888', fontSize: '14px' }}>No events added yet.</p>
                </div>
              ) : (
                events.map(ev => (
                  <div key={ev.id} className="card" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ flex: 1, fontWeight: '500' }}>{ev.name}</span>
                    <button
                      onClick={() => deleteEvent(ev)}
                      style={{ color: '#ccc', background: 'none', border: 'none', fontSize: '20px', padding: '2px 6px', lineHeight: 1 }}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
