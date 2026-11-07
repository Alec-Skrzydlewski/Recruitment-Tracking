import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { GoogleOAuthProvider, googleLogout } from '@react-oauth/google'
import {
  callApi, readStoredSession, storeToken, forgetToken, onSessionEnded, EXPIRED_SIGN_IN_MESSAGE,
} from '../lib/api'
import { clearPhotoCache, setPhotoScope } from '../lib/photoCache'
import { authView } from '../lib/authView'
import { RuntimeContext } from '../runtime'
import { MemberRoutes } from '../routes'
import { AppHeader, LoadingState, errorText } from '../components/ui'
import Login from '../pages/Login'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const API_URL = import.meta.env.VITE_APPS_SCRIPT_URL

function ConfigMissing() {
  return (
    <div className="page page-narrow">
      <div className="card state" role="alert">
        <h2>App not configured</h2>
        <p>Set VITE_GOOGLE_CLIENT_ID and VITE_APPS_SCRIPT_URL for the live build, or run the fictional demo with <span className="kbd">npm run dev:demo</span>.</p>
      </div>
    </div>
  )
}

function LiveInner() {
  const [start] = useState(() => {
    const stored = readStoredSession()
    return { token: stored.token, message: stored.expired ? EXPIRED_SIGN_IN_MESSAGE : '' }
  })
  const [token, setToken] = useState(start.token)
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(Boolean(start.token))
  const [message, setMessage] = useState(start.message)
  const [setup, setSetup] = useState(null)

  const endLocalSession = useCallback(msg => {
    forgetToken()
    clearPhotoCache()
    try { googleLogout() } catch { /* ignore */ }
    setToken(null)
    setMe(null)
    setSetup(null)
    setLoading(false)
    setMessage(msg || '')
  }, [])

  useEffect(() => onSessionEnded(msg => endLocalSession(msg)), [endLocalSession])

  useEffect(() => {
    if (!token) { setLoading(false); return undefined }
    let cancelled = false
    setLoading(true)
    callApi('bootstrap', token).then(data => {
      if (cancelled) return
      setPhotoScope('live:' + data.email)
      setMe(data)
      setSetup(null)
      setLoading(false)
    }).catch(err => {
      if (cancelled) return
      if (err && err.code === 'SETUP_REQUIRED') {
        setSetup({ message: errorText(err) })
        setLoading(false)
        return
      }
      if (err && err.code === 'AUTH') return
      endLocalSession(errorText(err))
    })
    return () => { cancelled = true }
  }, [token, endLocalSession])

  const api = useCallback((action, extra) => callApi(action, token, extra), [token])
  const loadPhotos = useCallback(ids => callApi('getPhotos', token, { ids }), [token])
  const runtime = useMemo(() => ({
    mode: 'live', me, api, loadPhotos, signOut: () => endLocalSession(''),
  }), [me, api, loadPhotos, endLocalSession])

  async function runSetup() {
    setSetup(s => ({ ...s, busy: true }))
    try {
      await callApi('setupSchema', token)
      setSetup(null)
      setLoading(true)
      const data = await callApi('bootstrap', token)
      setPhotoScope('live:' + data.email)
      setMe(data)
      setLoading(false)
    } catch (err) {
      setSetup({ message: errorText(err), busy: false })
      setLoading(false)
    }
  }

  if (setup) {
    return (
      <div className="page page-narrow">
        <div className="card state">
          <h2>Workspace setup needed</h2>
          <p style={{ marginBottom: 16 }}>{setup.message}</p>
          <p className="small" style={{ marginBottom: 16 }}>Only the account configured as OWNER_EMAIL on the backend can initialize the Sheet. Existing columns and rows are never reordered or deleted.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn-primary" onClick={runSetup} disabled={setup.busy}>Initialize sheets</button>
            <button type="button" onClick={() => endLocalSession('')}>Sign out</button>
          </div>
        </div>
      </div>
    )
  }

  if (authView({ token, me, loading }) === 'loading') return <LoadingState label="Signing you in…" />

  return (
    <BrowserRouter>
      {me && <AppHeader me={me} onSignOut={runtime.signOut} />}
      <RuntimeContext.Provider value={runtime}>
        {token && me ? (
          <MemberRoutes me={me} home={<Route path="/login" element={<Navigate to="/" replace />} />} />
        ) : (
          <Routes>
            <Route path="/login" element={<Login message={message} onToken={t => { setMessage(''); storeToken(t); setToken(t) }} />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        )}
      </RuntimeContext.Provider>
    </BrowserRouter>
  )
}

export default function LiveApp() {
  if (!CLIENT_ID || !API_URL) return <ConfigMissing />
  return (
    <GoogleOAuthProvider clientId={CLIENT_ID}>
      <LiveInner />
    </GoogleOAuthProvider>
  )
}
