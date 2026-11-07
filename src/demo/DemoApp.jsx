import { useCallback, useMemo, useState } from 'react'
import { BrowserRouter, Route, useNavigate } from 'react-router-dom'
import { createDemoBackend } from './demoBackend'
import { DEMO_PERSONAS } from './seed'
import { clearPhotoCache, setPhotoScope } from '../lib/photoCache'
import { RuntimeContext } from '../runtime'
import { MemberRoutes } from '../routes'
import { AppHeader } from '../components/ui'
import DemoLanding from './DemoLanding'

function DemoRibbon({ onReset, onSwitch, persona }) {
  return (
    <div className="demo-ribbon" role="note">
      <strong>Portfolio demo</strong> · fictional data, stored only in this tab · no sign-in, no server
      {persona && <button type="button" onClick={onSwitch}>Switch persona</button>}
      <button type="button" onClick={onReset}>Reset demo data</button>
    </div>
  )
}

function DemoShell({ backend }) {
  const navigate = useNavigate()
  const [persona, setPersona] = useState(null)
  const [version, setVersion] = useState(0)

  const choose = useCallback(p => {
    setPhotoScope('demo:' + p.email)
    setPersona(p)
    navigate(p.role === 'admin' ? '/admin' : '/vote')
  }, [navigate])

  const leave = useCallback(() => {
    clearPhotoCache()
    setPersona(null)
    navigate('/')
  }, [navigate])

  const reset = useCallback(() => {
    backend.reset()
    clearPhotoCache()
    if (persona) setPhotoScope('demo:' + persona.email)
    setVersion(v => v + 1)
  }, [backend, persona])

  const email = persona && persona.email
  const api = useCallback((action, extra) => backend.call(email, action, extra), [backend, email, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const loadPhotos = useCallback(ids => backend.call(email, 'getPhotos', { ids }), [backend, email, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const me = useMemo(() => (persona ? { email: persona.email, name: persona.name, role: persona.role } : null), [persona])
  const runtime = useMemo(() => ({ mode: 'demo', me, api, loadPhotos, signOut: leave }), [me, api, loadPhotos, leave])

  return (
    <>
      <DemoRibbon onReset={reset} onSwitch={leave} persona={persona} />
      {persona && <AppHeader me={me} onSignOut={leave} />}
      <RuntimeContext.Provider value={runtime}>
        {persona ? (
          <div key={version + ':' + persona.email}>
            <MemberRoutes me={me} home={<Route path="/" element={<DemoLanding personas={DEMO_PERSONAS} onChoose={choose} />} />} />
          </div>
        ) : (
          <DemoLanding personas={DEMO_PERSONAS} onChoose={choose} />
        )}
      </RuntimeContext.Provider>
    </>
  )
}

export default function DemoApp({ backend: injected }) {
  const backend = useMemo(() => injected || createDemoBackend(), [injected])
  return (
    <BrowserRouter>
      <DemoShell backend={backend} />
    </BrowserRouter>
  )
}
