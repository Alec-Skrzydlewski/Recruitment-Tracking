import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { callApi, readStoredSession, EXPIRED_SIGN_IN_MESSAGE } from './lib/api'
import { authView } from './lib/authView'
import Login from './pages/Login'
import Vote from './pages/Vote'
import Admin from './pages/Admin'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const UNAUTHORIZED_MESSAGE = 'Not authorized. Ask an admin to add you.'

function readFlashMessage() {
  try {
    const msg = sessionStorage.getItem('login_message')
    if (msg) sessionStorage.removeItem('login_message')
    return msg || ''
  } catch {
    return ''
  }
}

function startingSession() {
  const flashed = readFlashMessage()
  const stored = readStoredSession()
  let message = flashed
  if (!message && stored.expired) message = EXPIRED_SIGN_IN_MESSAGE
  return { token: stored.token, message }
}

function AppInner() {
  const [start] = useState(startingSession)
  const [token, setToken] = useState(start.token)
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(Boolean(start.token))
  const [loginMessage, setLoginMessage] = useState(start.message)

  useEffect(() => {
    if (!token) { setLoading(false); return }
    let cancelled = false
    callApi('bootstrap', token)
      .then(data => {
        if (cancelled) return
        setMe(data)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        try { localStorage.removeItem('google_token') } catch { /* ignore */ }
        setToken(null)
        setMe(null)
        const raw = err && err.message
        if (raw === UNAUTHORIZED_MESSAGE) setLoginMessage(raw)
        else if (raw === 'Invalid or expired login' || raw === EXPIRED_SIGN_IN_MESSAGE) setLoginMessage(EXPIRED_SIGN_IN_MESSAGE)
        else setLoginMessage(err.message || 'Sign-in failed, please try again.')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [token])

  if (authView({ token, me, loading }) === 'loading') return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={!token ? <Login message={loginMessage} onToken={t => { setLoginMessage(''); setLoading(true); setToken(t); localStorage.setItem('google_token', t) }} /> : <Navigate to="/" /> } />
        <Route path="/" element={token && me ? (me.role === 'admin' ? <Navigate to="/admin" /> : <Navigate to="/vote" />) : <Navigate to="/login" />} />
        <Route path="/vote" element={token && me ? <Vote token={token} me={me} /> : <Navigate to="/login" />} />
        <Route path="/admin" element={token && me?.role === 'admin' ? <Admin token={token} me={me} /> : <Navigate to="/vote" />} />
      </Routes>
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <GoogleOAuthProvider clientId={CLIENT_ID || 'missing'}>
      <AppInner />
    </GoogleOAuthProvider>
  )
}
