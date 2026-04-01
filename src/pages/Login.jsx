import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: window.location.origin },
    })

    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
    }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '500', marginBottom: '4px' }}>
          Recruitment Tracker
        </h1>
        <p style={{ fontSize: '14px', color: '#888', marginBottom: '1.5rem' }}>
          Only invited members can sign in.
        </p>

        {sent ? (
          <div className="card">
            <p style={{ fontWeight: '500', marginBottom: '6px' }}>Check your email</p>
            <p style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>
              We sent a login link to <strong>{email}</strong>. Click it to sign in — no password needed.
            </p>
            <button
              onClick={() => setSent(false)}
              style={{ fontSize: '13px', color: '#888', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="card">
              <label style={{ fontSize: '13px', color: '#666', display: 'block', marginBottom: '6px' }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
              />
              {error && (
                <p style={{ color: '#b83232', fontSize: '13px', marginTop: '8px' }}>{error}</p>
              )}
              <button
                type="submit"
                className="btn-primary"
                style={{ width: '100%', marginTop: '12px' }}
                disabled={loading}
              >
                {loading ? 'Sending...' : 'Send login link'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
