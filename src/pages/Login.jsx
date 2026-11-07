import { GoogleLogin } from '@react-oauth/google'
import { useState } from 'react'
import { BrandMark } from '../components/ui'

export default function Login({ onToken, message }) {
  const [localError, setLocalError] = useState('')
  return (
    <main className="page page-narrow" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center' }}>
      <div className="card" style={{ width: '100%', padding: 28, textAlign: 'center' }}>
        <div className="row" style={{ justifyContent: 'center', marginBottom: 12 }}><BrandMark /></div>
        <h1>Recruitment Tracker</h1>
        <p className="lede" style={{ marginBottom: 20 }}>Sign in with the Google account your chapter admin added.</p>
        {(message || localError) && <p className="banner banner-error" role="alert">{message || localError}</p>}
        <div className="row" style={{ justifyContent: 'center' }}>
          <GoogleLogin
            onSuccess={cred => { setLocalError(''); onToken(cred.credential) }}
            onError={() => setLocalError('Google sign-in did not complete. Please try again.')}
          />
        </div>
        <p className="small muted" style={{ marginTop: 20 }}>Not on the member list? Ask an admin to add your email.</p>
      </div>
    </main>
  )
}
