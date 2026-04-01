import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthConfirm() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    const tokenHash = params.get('token_hash')
    const type = params.get('type')

    if (tokenHash) {
      supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(() => {
        navigate('/', { replace: true })
      })
    }
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#999' }}>
      Signing you in...
    </div>
  )
}
