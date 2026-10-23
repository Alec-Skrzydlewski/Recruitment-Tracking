import { GoogleLogin } from '@react-oauth/google'

export default function Login({ onToken, message }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 8 }}>Recruitment Tracker</h1>
        <p style={{ color: '#888', marginBottom: 24, fontSize: 14 }}>Sign in with your Google account</p>
        {message ? <p style={{ color: '#b83232', fontSize: 14, marginBottom: 16 }}>{message}</p> : null}
        <div className="card" style={{ padding: 24 }}>
          <GoogleLogin
            onSuccess={cred => onToken(cred.credential)}
            onError={() => alert('Login failed')}
          />
        </div>
        <p style={{ fontSize: 12, color: '#aaa', marginTop: 16 }}>
          First person to sign in becomes admin.
        </p>
      </div>
    </div>
  )
}
