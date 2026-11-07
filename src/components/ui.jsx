import { NavLink } from 'react-router-dom'

export function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">RT</span>
}

export function AppHeader({ me, onSignOut, showNav = true }) {
  const isAdmin = me && me.role === 'admin'
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <span className="brand">
          <BrandMark />
          <span className="brand-name">Recruitment Tracker</span>
        </span>
        {showNav && isAdmin && (
          <nav className="header-nav" aria-label="Primary">
            <NavLink to="/admin">Admin</NavLink>
            <NavLink to="/vote">Vote</NavLink>
          </nav>
        )}
        <span className="header-spacer" />
        {me && <span className="user-chip" title={me.email}>{me.name || me.email}</span>}
        {onSignOut && <button type="button" className="btn-ghost btn-sm" onClick={onSignOut}>Sign out</button>}
      </div>
    </header>
  )
}

export function Banner({ kind = 'error', children, onDismiss, action }) {
  return (
    <div className={'banner banner-' + kind} role={kind === 'error' ? 'alert' : 'status'}>
      <span className="grow">{children}</span>
      {action}
      {onDismiss && (
        <button type="button" className="btn-ghost btn-sm" onClick={onDismiss} aria-label="Dismiss message">Dismiss</button>
      )}
    </div>
  )
}

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }) {
  return (
    <div className="state" role="alert">
      <h2>{title}</h2>
      {message && <p style={{ marginBottom: 16 }}>{message}</p>}
      {onRetry && <button type="button" className="btn-primary" onClick={onRetry}>Try again</button>}
    </div>
  )
}

export function EmptyState({ title, children }) {
  return (
    <div className="card state">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  )
}

export function SavingPill({ label = 'Saving…' }) {
  return <span className="badge" role="status">{label}</span>
}

export function errorText(err) {
  return err && err.message ? err.message : String(err || 'Something went wrong')
}
