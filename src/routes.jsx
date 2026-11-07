import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Vote from './pages/Vote'
import { LoadingState } from './components/ui'

// Admin is code-split: voters never download the admin bundle.
const Admin = lazy(() => import('./pages/Admin'))

export function MemberRoutes({ me, home }) {
  const isAdmin = me && me.role === 'admin'
  return (
    <Routes>
      <Route path="/vote" element={<Vote />} />
      <Route
        path="/admin"
        element={isAdmin ? <Suspense fallback={<LoadingState label="Loading admin…" />}><Admin /></Suspense> : <Navigate to="/vote" replace />}
      />
      {home}
      <Route path="*" element={<Navigate to={isAdmin ? '/admin' : '/vote'} replace />} />
    </Routes>
  )
}
