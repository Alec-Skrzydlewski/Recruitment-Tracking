import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Navigate, Route } from 'react-router-dom'
import { createDemoBackend } from './demoBackend'
import { DEMO_USER } from './seed'
import { DEMO_PHOTO_URLS } from './photoAssets'
import { clearPhotoCache, setPhotoScope } from '../lib/photoCache'
import { RuntimeContext } from '../runtime'
import { MemberRoutes } from '../routes'
import { AppHeader } from '../components/ui'

function DemoRibbon({ onReset }) {
  return (
    <div className="demo-ribbon" role="note">
      <strong>Demo</strong> · example data; members, attendance, votes and education are fictional · changes stay in this tab
      <button type="button" onClick={onReset}>Reset</button>
    </div>
  )
}

// Opens straight into the real app as a fixed, isolated demo identity — no
// sign-in, no chooser, no landing page. `user` is injectable for tests only.
function DemoShell({ backend, user }) {
  const [version, setVersion] = useState(0)
  useEffect(() => { setPhotoScope('demo:' + user.email) }, [user.email])

  const reset = useCallback(() => {
    backend.reset()
    clearPhotoCache()
    setPhotoScope('demo:' + user.email)
    setVersion(v => v + 1)
  }, [backend, user.email])

  const email = user.email
  const api = useCallback((action, extra) => backend.call(email, action, extra), [backend, email, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const loadPhotos = useCallback(ids => backend.call(email, 'getPhotos', { ids }), [backend, email, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const me = useMemo(() => ({ email: user.email, name: user.name, role: user.role }), [user])
  const runtime = useMemo(() => ({ mode: 'demo', me, api, loadPhotos, signOut: reset }), [me, api, loadPhotos, reset])
  const home = me.role === 'admin' ? '/admin' : '/vote'

  return (
    <>
      <DemoRibbon onReset={reset} />
      <AppHeader me={me} />
      <RuntimeContext.Provider value={runtime}>
        <div key={version}>
          <MemberRoutes me={me} home={<Route path="/" element={<Navigate to={home} replace />} />} />
        </div>
      </RuntimeContext.Provider>
    </>
  )
}

export default function DemoApp({ backend: injected, user = DEMO_USER }) {
  const backend = useMemo(() => injected || createDemoBackend({ photoUrls: DEMO_PHOTO_URLS }), [injected])
  return (
    <BrowserRouter>
      <DemoShell backend={backend} user={user} />
    </BrowserRouter>
  )
}
