import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const OPTIONS = [
  { value: 'good',     label: 'Good',         color: '#2d7a2d', bg: '#f0faf0', score: 2  },
  { value: 'meh',      label: 'Meh',           color: '#92700a', bg: '#fdf8e8', score: 1  },
  { value: 'terrible', label: 'Terrible',      color: '#b83232', bg: '#fdf0f0', score: -1 },
  { value: 'unknown',  label: "Don't Remember", color: '#666',   bg: '#f5f5f5', score: 0  },
]

function NoteEditor({ recruitId, initialValue, onSaved }) {
  const [value, setValue] = useState(initialValue || '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!dirty) return
    setSaving(true)
    await supabase.from('notes').upsert(
      { recruit_id: recruitId, content: value, updated_at: new Date().toISOString() },
      { onConflict: 'recruit_id' }
    )
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
        <button className="btn-primary" onClick={save} disabled={saving} style={{ fontSize: '13px', padding: '6px 14px' }}>
          {saving ? 'Saving...' : 'Save notes'}
        </button>
      )}
    </div>
  )
}

export default function Admin({ session }) {
  const [tab, setTab] = useState('dashboard')
  const [recruits, setRecruits] = useState([])
  const [events, setEvents] = useState([])
  const [votes, setVotes] = useState([])
  const [notes, setNotes] = useState({})
  const [loading, setLoading] = useState(true)
  const [expandedNotes, setExpandedNotes] = useState({})
  const [newName, setNewName] = useState('')
  const [newMajor, setNewMajor] = useState('')
  const [newEvent, setNewEvent] = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [{ data: recs }, { data: evs }, { data: vs }, { data: ns }] = await Promise.all([
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

  async function addRecruit(e) {
    e.preventDefault()
    if (!newName.trim()) return
    const { data } = await supabase.from('recruits')
      .insert({ name: newName.trim(), major: newMajor.trim() || null })
      .select().single()
    if (data) setRecruits(r => [...r, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewName(''); setNewMajor('')
  }

  async function deleteRecruit(r) {
    if (!confirm(`Remove ${r.name}?`)) return
    await supabase.from('recruits').delete().eq('id', r.id)
    setRecruits(list => list.filter(x => x.id !== r.id))
  }

  async function addEvent(e) {
    e.preventDefault()
    if (!newEvent.trim()) return
    const { data } = await supabase.from('events')
      .insert({ name: newEvent.trim() })
      .select().single()
    if (data) setEvents(ev => [...ev, data])
    setNewEvent('')
  }

  async function deleteEvent(ev) {
    if (!confirm(`Remove "${ev.name}"?`)) return
    await supabase.from('events').delete().eq('id', ev.id)
    setEvents(list => list.filter(x => x.id !== ev.id))
  }

  function scoreFor(rid) {
    return votes
      .filter(v => v.recruit_id === rid)
      .reduce((sum, v) => sum + (OPTIONS.find(o => o.value === v.vote)?.score || 0), 0)
  }

  function countsFor(rid, eid) {
    const filtered = eid
      ? votes.filter(v => v.recruit_id === rid && v.event_id === eid)
      : votes.filter(v => v.recruit_id === rid)
    const counts = {}
    OPTIONS.forEach(o => { counts[o.value] = filtered.filter(v => v.vote === o.value).length })
    return counts
  }

  const sortedByScore = [...recruits].sort((a, b) => scoreFor(b.id) - scoreFor(a.id))
  const TABS = ['dashboard', 'recruits', 'events']

  return (
    <div style={{ maxWidth: '780px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '500' }}>Admin</h1>
        <button onClick={() => supabase.auth.signOut()} style={{ fontSize: '13px', color: '#aaa', background: 'none', border: 'none', padding: 0 }}>
          Sign out
        </button>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #e8e8e5', marginBottom: '1.5rem' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'none', border: 'none',
            borderBottom: tab === t ? '2px solid #1a1a1a' : '2px solid transparent',
            borderRadius: 0, padding: '8px 18px',
            fontWeight: tab === t ? '500' : '400',
            color: tab === t ? '#1a1a1a' : '#999',
            marginBottom: '-1px', fontSize: '14px',
          }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {loading ? <p style={{ color: '#aaa', fontSize: '14px' }}>Loading...</p> : (
        <>
          {/* DASHBOARD */}
          {tab === 'dashboard' && (
            <div>
              {recruits.length === 0 ? (
                <div className="card"><p style={{ color: '#888', fontSize: '14px' }}>No recruits yet.</p></div>
              ) : sortedByScore.map(r => {
                const score = scoreFor(r.id)
                const counts = countsFor(r.id)
                const noteExpanded = expandedNotes[r.id]
                return (
                  <div key={r.id} className="card" style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: '500', fontSize: '15px' }}>{r.name}</div>
                        {r.major && <div style={{ fontSize: '13px', color: '#999' }}>{r.major}</div>}
                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                          {OPTIONS.map(opt => counts[opt.value] > 0 && (
                            <span key={opt.value} style={{
                              fontSize: '11px', fontWeight: '600', padding: '2px 8px',
                              borderRadius: '999px', background: opt.bg, color: opt.color,
                            }}>
                              {counts[opt.value]} {opt.label}
                            </span>
                          ))}
                          {Object.values(counts).every(c => c === 0) && (
                            <span className="badge badge-gray">no votes</span>
                          )}
                        </div>

                        {/* Per-event breakdown */}
                        {events.length > 0 && (
                          <div style={{ display: 'flex', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
                            {events.map(ev => {
                              const ec = countsFor(r.id, ev.id)
                              const hasVotes = Object.values(ec).some(c => c > 0)
                              if (!hasVotes) return null
                              return (
                                <span key={ev.id} style={{ fontSize: '12px', color: '#aaa' }}>
                                  {ev.name}: {OPTIONS.filter(o => ec[o.value] > 0).map(o => `${ec[o.value]} ${o.label}`).join(', ')}
                                </span>
                              )
                            })}
                          </div>
                        )}
                      </div>
                      <div style={{
                        fontSize: '24px', fontWeight: '500', flexShrink: 0,
                        color: score > 0 ? '#2d7a2d' : score < 0 ? '#b83232' : '#ccc',
                      }}>
                        {score > 0 ? '+' : ''}{score}
                      </div>
                    </div>

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
              })}
            </div>
          )}

          {/* RECRUITS */}
          {tab === 'recruits' && (
            <div>
              <form onSubmit={addRecruit} style={{ display: 'flex', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full name" style={{ flex: '2 1 140px' }} required />
                <input value={newMajor} onChange={e => setNewMajor(e.target.value)} placeholder="Major / year (optional)" style={{ flex: '2 1 140px' }} />
                <button type="submit" className="btn-primary">Add recruit</button>
              </form>
              {recruits.length === 0 ? (
                <div className="card"><p style={{ color: '#888', fontSize: '14px' }}>No recruits yet.</p></div>
              ) : recruits.map(r => (
                <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '500' }}>{r.name}</div>
                    {r.major && <div style={{ fontSize: '13px', color: '#999' }}>{r.major}</div>}
                  </div>
                  <button onClick={() => deleteRecruit(r)} style={{ color: '#ccc', background: 'none', border: 'none', fontSize: '20px', padding: '2px 6px', lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* EVENTS */}
          {tab === 'events' && (
            <div>
              <form onSubmit={addEvent} style={{ display: 'flex', gap: '8px', marginBottom: '1rem' }}>
                <input value={newEvent} onChange={e => setNewEvent(e.target.value)} placeholder="Event name (e.g. Coffee Chat)" required />
                <button type="submit" className="btn-primary">Add event</button>
              </form>
              {events.length === 0 ? (
                <div className="card"><p style={{ color: '#888', fontSize: '14px' }}>No events yet.</p></div>
              ) : events.map(ev => (
                <div key={ev.id} className="card" style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ flex: 1, fontWeight: '500' }}>{ev.name}</span>
                  <button onClick={() => deleteEvent(ev)} style={{ color: '#ccc', background: 'none', border: 'none', fontSize: '20px', padding: '2px 6px', lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
