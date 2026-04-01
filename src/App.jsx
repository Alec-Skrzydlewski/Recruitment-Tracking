import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Vote from './pages/Vote'
import Admin from './pages/Admin'

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [role, setRole] = useState(null)
  const [loadingRole, setLoadingRole] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) setRole(null)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    setLoadingRole(true)
    supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        setRole(data?.role || 'brother')
        setLoadingRole(false)
      })
  }, [session])

  if (session === undefined || (session && loadingRole)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#999' }}>
        Loading...
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={session ? <Navigate to="/" replace /> : <Login />}
        />
        <Route
          path="/"
          element={
            !session ? <Navigate to="/login" replace /> :
            role === 'admin' ? <Navigate to="/admin" replace /> :
            <Navigate to="/vote" replace />
          }
        />
        <Route
          path="/vote"
          element={!session ? <Navigate to="/login" replace /> : <Vote session={session} />}
        />
        <Route
          path="/admin"
          element={
            !session ? <Navigate to="/login" replace /> :
            role !== 'admin' ? <Navigate to="/vote" replace /> :
            <Admin session={session} />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
