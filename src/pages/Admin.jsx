import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const OPTIONS = [
  { value: 'good',     label: 'Good',          color: '#2d7a2d', bg: '#f0faf0', score: 2  },
  { value: 'meh',      label: 'Meh',            color: '#92700a', bg: '#fdf8e8', score: 1  },
  { value: 'terrible', label: 'Terrible',       color: '#b83232', bg: '#fdf0f0', score: -1 },
  { value: 'unknown',  label: "Don't Remember", color: '#666',    bg: '#f5f5f5', score: 0  },
]

function Avatar({ recruit, size = 48 }) {
  return recruit.photo_url ? (
    <img src={recruit.photo_url} alt={recruit.name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '1px solid #e8e8e5', flexShrink: 0 }} />
  ) : (
    <div style={{ width: size, height: size, borderRadius: '50%', background: '#f0efe8', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.35, fontWeight: '500', color: '#aaa' }}>
      {recruit.name.charAt(0).toUpperCase()}
    </div>
  )
}

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
    <div>
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

function PhotoUpload({ recruit, onUpdated }) {
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef()

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${recruit.id}.${ext}`
    if (recruit.photo_url) {
      const oldPath = recruit.photo_url.split('/recruit-photos/')[1]
      if (oldPath) await supabase.storage.from('recruit-photos').remove([oldPath])
    }
    const { error: uploadError } = await supabase.storage.from('recruit-photos').upload(path, file, { upsert: true })
    if (!uploadError) {
      const { data } = supabase.storage.from('recruit-photos').getPublicUrl(path)
      await supabase.from('recruits').update({ photo_url: data.publicUrl }).eq('id', recruit.id)
      onUpdated({ ...recruit, photo_url: data.publicUrl })
    }
    setUploading(false)
    e.target.value = ''
  }

  async function removePhoto() {
    if (!confirm('Remove this photo?')) return
    const path = recruit.photo_url.split('/recruit-photos/')[1]
    if (path) await supabase.storage.from('recruit-photos').remove([path])
    await supabase.from('recruits').update({ photo_url: null }).eq('id', recruit.id)
    onUpdated({ ...recruit, photo_url: null })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
      {recruit.photo_url ? (
        <>
          <button onClick={() => fileRef.current.click()} style={{ fontSize: '12px', padding: '4px 10px' }}>
            {uploading ? 'Uploading...' : 'Change photo'}
          </button>
          <button onClick={removePhoto} style={{ fontSize: '12px', padding: '4px 10px', color: '#b83232', borderColor: '#b83232' }}>
            Remove
          </button>
        </>
      ) : (
        <button onClick={() => fileRef.current.click()} style={{ fontSize: '12px', padding: '4px 10px' }}>
          {uploading ? 'Uploading...' : '+ Add photo'}
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
    </div>
  )
}

// Vertical stacked bar for a single event
function VerticalEventBar({ eventName, counts, total, maxTotal }) {
  const BAR_HEIGHT = 160
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flex: '1 1 80px', minWidth: '60px' }}>
      {/* Bar */}
      <div style={{ width: '100%', height: BAR_HEIGHT, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', borderRadius: '6px', overflow: 'hidden', background: '#f5f5f3' }}>
        {total === 0 ? null : OPTIONS.slice().reverse().map(opt => {
          const count = counts[opt.value] || 0
          if (count === 0) return null
          const heightPct = (count / maxTotal) * 100
          return (
            <div
              key={opt.value}
              title={`${opt.label}: ${count}`}
              style={{
                width: '100%',
                height: `${(count / total) * (total / maxTotal) * 100}%`,
                background: opt.color,
                transition: 'height 0.3s',
              }}
            />
          )
        })}
      </div>
      {/* Total label */}
      <span style={{ fontSize: '12px', fontWeight: '500', color: '#555' }}>{total}</span>
      {/* Event name */}
      <span style={{ fontSize: '11px', color: '#aaa', textAlign: 'center', lineHeight: 1.3, maxWidth: '80px', wordBreak: 'break-word' }}>{eventName}</span>
    </div>
  )
}

function RecruitDashboard({ recruit, votes, events, notes, onNotesSaved }) {
  const recruitVotes = votes.filter(v => v.recruit_id === recruit.id)
  const total = recruitVotes.length

  const counts = {}
  OPTIONS.forEach(o => { counts[o.value] = recruitVotes.filter(v => v.vote === o.value).length })
  const score = OPTIONS.reduce((sum, o) => sum + (counts[o.value] || 0) * o.score, 0)

  // Per-event data for vertical bars
  const eventData = events.map(ev => {
    const evVotes = recruitVotes.filter(v => v.event_id === ev.id)
    const evCounts = {}
    OPTIONS.forEach(o => { evCounts[o.value] = evVotes.filter(v => v.vote === o.value).length })
    return { ev, evCounts, evTotal: evVotes.length }
  })
  const maxEventTotal = Math.max(...eventData.map(d => d.evTotal), 1)

  return (
    <div>
      {/* Large hero photo + name */}
      <div className="card" style={{ marginBottom: '12px', textAlign: 'center', padding: '2rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          {recruit.photo_url ? (
            <img
              src={recruit.photo_url}
              alt={recruit.name}
              style={{ width: '160px', height: '160px', borderRadius: '50%', objectFit: 'cover', border: '3px solid #e8e8e5' }}
            />
          ) : (
            <div style={{ width: '160px', height: '160px', borderRadius: '50%', background: '#f0efe8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '56px', fontWeight: '500', color: '#ccc' }}>
              {recruit.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div style={{ fontSize: '22px', fontWeight: '500' }}>{recruit.name}</div>
        {recruit.major && <div style={{ fontSize: '14px', color: '#999', marginTop: '4px' }}>{recruit.major}</div>}
        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center', gap: '2rem' }}>
          <div>
            <div style={{ fontSize: '36px', fontWeight: '500', color: score > 0 ? '#2d7a2d' : score < 0 ? '#b83232' : '#ccc', lineHeight: 1 }}>
              {score > 0 ? '+' : ''}{score}
            </div>
            <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>net score</div>
          </div>
          <div>
            <div style={{ fontSize: '36px', fontWeight: '500', color: '#555', lineHeight: 1 }}>{total}</div>
            <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>total votes</div>
          </div>
        </div>
      </div>

      {/* Vote breakdown horizontal bars */}
      <div className="card" style={{ marginBottom: '12px' }}>
        <div style={{ fontWeight: '500', fontSize: '14px', marginBottom: '16px' }}>Vote breakdown</div>
        {total === 0 ? (
          <p style={{ color: '#aaa', fontSize: '14px' }}>No votes yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {OPTIONS.map(opt => {
              const count = counts[opt.value] || 0
              const pct = total > 0 ? Math.round(count / total * 100) : 0
              return (
                <div key={opt.value}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                    <span style={{ fontSize: '13px', color: opt.color, fontWeight: '500' }}>{opt.label}</span>
                    <span style={{ fontSize: '13px', color: '#888' }}>{count} vote{count !== 1 ? 's' : ''} · {pct}%</span>
                  </div>
                  <div style={{ height: '10px', borderRadius: '5px', background: '#f5f5f3', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: opt.color, borderRadius: '5px', transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Per-event vertical stacked bar chart */}
      {events.length > 0 && (
        <div className="card" style={{ marginBottom: '12px' }}>
          <div style={{ fontWeight: '500', fontSize: '14px', marginBottom: '20px' }}>By event</div>
          {eventData.every(d => d.evTotal === 0) ? (
            <p style={{ color: '#aaa', fontSize: '14px' }}>No event votes yet.</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', overflowX: 'auto', paddingBottom: '4px' }}>
                {eventData.map(({ ev, evCounts, evTotal }) => (
                  <VerticalEventBar
                    key={ev.id}
                    eventName={ev.name}
                    counts={evCounts}
                    total={evTotal}
                    maxTotal={maxEventTotal}
                  />
                ))}
              </div>
              {/* Legend */}
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #f0efe8' }}>
                {OPTIONS.map(o => (
                  <div key={o.value} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: o.color }} />
                    <span style={{ fontSize: '11px', color: '#888' }}>{o.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Notes */}
      <div className="card">
        <div style={{ fontWeight: '500', fontSize: '14px', marginBottom: '12px' }}>Notes</div>
        <NoteEditor
          recruitId={recruit.id}
          initialValue={notes[recruit.id]}
          onSaved={val => onNotesSaved(recruit.id, val)}
        />
      </div>
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
  const [selectedRecruitId, setSelectedRecruitId] = useState('')
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
    if (recs?.length) setSelectedRecruitId(prev => prev || recs[0].id)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function addRecruit(e) {
    e.preventDefault()
    if (!newName.trim()) return
    const { data } = await supabase.from('recruits')
      .insert({ name: newName.trim(), major: newMajor.trim() || null })
      .select().single()
    if (data) {
      setRecruits(r => [...r, data].sort((a, b) => a.name.localeCompare(b.name)))
      if (!selectedRecruitId) setSelectedRecruitId(data.id)
    }
    setNewName(''); setNewMajor('')
  }

  async function deleteRecruit(r) {
    if (!confirm(`Remove ${r.name}?`)) return
    if (r.photo_url) {
      const path = r.photo_url.split('/recruit-photos/')[1]
      if (path) await supabase.storage.from('recruit-photos').remove([path])
    }
    await supabase.from('recruits').delete().eq('id', r.id)
    const remaining = recruits.filter(x => x.id !== r.id)
    setRecruits(remaining)
    if (selectedRecruitId === r.id) setSelectedRecruitId(remaining[0]?.id || '')
  }

  async function addEvent(e) {
    e.preventDefault()
    if (!newEvent.trim()) return
    const { data } = await supabase.from('events').insert({ name: newEvent.trim() }).select().single()
    if (data) setEvents(ev => [...ev, data])
    setNewEvent('')
  }

  async function deleteEvent(ev) {
    if (!confirm(`Remove "${ev.name}"?`)) return
    await supabase.from('events').delete().eq('id', ev.id)
    setEvents(list => list.filter(x => x.id !== ev.id))
  }

  const selectedRecruit = recruits.find(r => r.id === selectedRecruitId)
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
            whiteSpace: 'nowrap',
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
                <div className="card"><p style={{ color: '#888', fontSize: '14px' }}>No recruits yet — add them in the Recruits tab.</p></div>
              ) : (
                <>
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ fontSize: '13px', color: '#777', display: 'block', marginBottom: '6px' }}>Select recruit</label>
                    <select value={selectedRecruitId} onChange={e => setSelectedRecruitId(e.target.value)} style={{ maxWidth: '320px' }}>
                      {recruits.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  {selectedRecruit && (
                    <RecruitDashboard
                      recruit={selectedRecruit}
                      votes={votes}
                      events={events}
                      notes={notes}
                      onNotesSaved={(rid, val) => setNotes(n => ({ ...n, [rid]: val }))}
                    />
                  )}
                </>
              )}
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
                <div key={r.id} className="card" style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Avatar recruit={r} size={44} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '500' }}>{r.name}</div>
                      {r.major && <div style={{ fontSize: '13px', color: '#999' }}>{r.major}</div>}
                      <PhotoUpload
                        recruit={r}
                        onUpdated={updated => setRecruits(list => list.map(x => x.id === updated.id ? updated : x))}
                      />
                    </div>
                    <button onClick={() => deleteRecruit(r)} style={{ color: '#ccc', background: 'none', border: 'none', fontSize: '20px', padding: '2px 6px', lineHeight: 1 }}>×</button>
                  </div>
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
