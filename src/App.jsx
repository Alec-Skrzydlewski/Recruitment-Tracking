import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google'
import { callApi } from './lib/api'
import Login from './pages/Login'
import Vote from './pages/Vote'
import Admin from './pages/Admin'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

function AppInner() {
  const [token, setToken] = useState(localStorage.getItem('google_token') || null)
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) { setLoading(false); return }
    callApi('bootstrap', token)
      .then(data => { setMe(data); setLoading(false) })
      .catch(() => { setToken(null); localStorage.removeItem('google_token'); setLoading(false) })
  }, [token])

  const login = useGoogleLogin({
    onSuccess: (res) => {
      // res.access_token is for userinfo; for ID token use flow: 'auth-code' or credential response
      // Simpler path: use GoogleLogin component which gives credential (ID token)
    },
    flow: 'implicit',
  })

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={!token ? <Login onToken={t => { setToken(t); localStorage.setItem('google_token', t) }} /> : <Navigate to="/" /> } />
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
