import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password })

    if (error) setError(error.message)
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
          Alpha-Nu Recruitment
        </h1>
        <p style={{ fontSize: '14px', color: '#888', marginBottom: '1.5rem' }}>
          {isSignUp ? 'Create your account.' : 'Sign in to your account.'}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="card">
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '13px', color: '#666', display: 'block', marginBottom: '6px' }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
              />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '13px', color: '#666', display: 'block', marginBottom: '6px' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>

            {error && (
              <p style={{ color: '#b83232', fontSize: '13px', marginBottom: '8px' }}>{error}</p>
            )}

            <button
              type="submit"
              className="btn-primary"
              style={{ width: '100%', marginBottom: '12px' }}
              disabled={loading}
            >
              {loading ? 'Please wait...' : isSignUp ? 'Create account' : 'Sign in'}
            </button>

            <p style={{ fontSize: '13px', color: '#888', textAlign: 'center' }}>
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                type="button"
                onClick={() => { setIsSignUp(!isSignUp); setError('') }}
                style={{ background: 'none', border: 'none', padding: 0, color: '#1a1a1a', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }}
              >
                {isSignUp ? 'Sign in' : 'Register'}
              </button>
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
