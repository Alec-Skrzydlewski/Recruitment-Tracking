import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Vote({ session }) {
  const [events, setEvents] = useState([])
  const [recruits, setRecruits] = useState([])
  const [selectedEventId, setSelectedEventId] = useState('')
  const [myVotes, setMyVotes] = useState({}) // recruitId -> 'good' | 'bad' | null
  const [saving, setSaving] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (selectedEventId) fetchMyVotes(selectedEventId)
    else setMyVotes({})
  }, [selectedEventId])

  async function fetchData() {
    setLoading(true)
    const [{ data: evs }, { data: recs }] = await Promise.all([
      supabase.from('events').select('*').order('created_at', { ascending: true }),
      supabase.from('recruits').select('*').order('name', { ascending: true }),
    ])
    setEvents(evs || [])
    setRecruits(recs || [])
    if (evs?.length) setSelectedEventId(evs[evs.length - 1].id)
    setLoading(false)
  }

  async function fetchMyVotes(eventId) {
    const { data } = await supabase
      .from('votes')
      .select('recruit_id, vote')
      .eq('event_id', eventId)
      .eq('user_id', session.user.id)
    const map = {}
    data?.forEach(v => { map[v.recruit_id] = v.vote })
    setMyVotes(map)
  }

  async function castVote(recruitId, vote) {
    const current = myVotes[recruitId]
    const newVote = current === vote ? null : vote // tap same = toggle off

    // Optimistic update
    setMyVotes(v => ({ ...v, [recruitId]: newVote }))
    setSaving(s => ({ ...s, [recruitId]: true }))

    if (newVote === null) {
      await supabase
        .from('votes')
        .delete()
        .eq('recruit_id', recruitId)
        .eq('event_id', selectedEventId)
        .eq('user_id', session.user.id)
    } else {
      await supabase.from('votes').upsert(
        {
          recruit_id: recruitId,
          event_id: selectedEventId,
          user_id: session.user.id,
          vote: newVote,
        },
        { onConflict: 'recruit_id,event_id,user_id' }
      )
    }

    setSaving(s => ({ ...s, [recruitId]: false }))
  }

  const votedCount = Object.values(myVotes).filter(Boolean).length

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '500' }}>Vote</h1>
        <button
          onClick={() => supabase.auth.signOut()}
          style={{ fontSize: '13px', color: '#aaa', background: 'none', border: 'none', padding: 0 }}
        >
          Sign out
        </button>
      </div>

      {loading ? (
        <p style={{ color: '#aaa', fontSize: '14px' }}>Loading...</p>
      ) : events.length === 0 ? (
        <div className="card">
          <p style={{ color: '#888', fontSize: '14px' }}>No events have been added yet. Check back soon.</p>
        </div>
      ) : (
        <>
          {/* Event selector */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ fontSize: '13px', color: '#777', display: 'block', marginBottom: '6px' }}>Event</label>
            <select value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)}>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
          </div>

          {recruits.length === 0 ? (
            <div className="card">
              <p style={{ color: '#888', fontSize: '14px' }}>No recruits added yet.</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <p style={{ fontSize: '13px', color: '#888' }}>{recruits.length} recruits</p>
                <span className="badge badge-gray">{votedCount} / {recruits.length} voted</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {recruits.map(r => (
                  <div
                    key={r.id}
                    className="card"
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: '500', fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.name}
                      </div>
                      {r.major && (
                        <div style={{ fontSize: '13px', color: '#999' }}>{r.major}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      <button
                        className={`btn-good${myVotes[r.id] === 'good' ? ' active' : ''}`}
                        onClick={() => castVote(r.id, 'good')}
                        disabled={saving[r.id]}
                        style={{ padding: '8px 16px', fontSize: '16px', lineHeight: 1 }}
                        aria-label="Good"
                      >
                        ✓
                      </button>
                      <button
                        className={`btn-bad${myVotes[r.id] === 'bad' ? ' active' : ''}`}
                        onClick={() => castVote(r.id, 'bad')}
                        disabled={saving[r.id]}
                        style={{ padding: '8px 16px', fontSize: '16px', lineHeight: 1 }}
                        aria-label="Bad"
                      >
                        ✗
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: '12px', color: '#bbb', textAlign: 'center', marginTop: '1.5rem' }}>
                Votes are saved automatically. Tap again to undo.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}
