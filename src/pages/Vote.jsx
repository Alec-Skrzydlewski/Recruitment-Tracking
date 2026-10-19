import { useState, useEffect } from 'react'
import { callApi } from '../lib/api'

export default function Vote({ token, me }) {
  const [data, setData] = useState(null)
  const [eventId, setEventId] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    callApi('getVoteData', token).then(d => {
      setData(d)
      if (d.events?.length) setEventId(d.events[d.events.length - 1].id)
      setLoading(false)
    }).catch(err => { alert(err.message); setLoading(false) })
  }, [token])

  async function vote(recruitId, score) {
    await callApi('castVote', token, { eventId, recruitId, score })
    setData(prev => {
      const myVotes = prev.myVotes.filter(v => !(v.eventId === eventId && v.recruitId === recruitId))
      myVotes.push({ eventId, recruitId, score })
      return { ...prev, myVotes }
    })
  }

  if (loading || !data) return <div style={{ padding: '2rem' }}>Loading...</div>

  const attended = new Set(
    (data.attendance || []).filter(a => a.eventId === eventId).map(a => a.recruitId)
  )
  const recruits = (data.recruits || []).filter(r => attended.has(r.id))
  const myVoteMap = {}
  ;(data.myVotes || []).filter(v => v.eventId === eventId).forEach(v => { myVoteMap[v.recruitId] = v.score })

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20 }}>Vote</h1>
        <button onClick={() => { localStorage.removeItem('google_token'); location.reload() }} style={{ fontSize: 13, color: '#aaa', background: 'none', border: 'none' }}>
          Sign out
        </button>
      </div>

      {data.events?.length === 0 ? (
        <div className="card"><p style={{ color: '#888' }}>No events yet.</p></div>
      ) : (
        <>
          <label style={{ fontSize: 13, color: '#777', display: 'block', marginBottom: 6 }}>Event</label>
          <select value={eventId} onChange={e => setEventId(e.target.value)} style={{ marginBottom: 16 }}>
            {data.events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>

          {recruits.length === 0 ? (
            <div className="card"><p style={{ color: '#888' }}>No recruits checked in for this event.</p></div>
          ) : recruits.map(r => (
            <div key={r.id} className="card" style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 500, marginBottom: 8 }}>{r.name} {r.major && <span style={{ color: '#999', fontWeight: 400 }}>· {r.major}</span>}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[1,2,3,4,5,6,7,8,9,10].map(n => (
                  <button
                    key={n}
                    onClick={() => vote(r.id, n)}
                    style={{
                      width: 36, height: 36, borderRadius: 8,
                      background: myVoteMap[r.id] === n ? '#1a1a1a' : '#fff',
                      color: myVoteMap[r.id] === n ? '#fff' : '#1a1a1a',
                      border: '1px solid #ddd', fontWeight: 500,
                    }}
                  >{n}</button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
