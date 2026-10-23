// Pure route gate. A token without a loaded user must stay on the loading
// screen so /login and / never Navigate into each other.

export function authView({ token, me, loading }) {
  if (loading || (token && !me)) return 'loading'
  return 'routes'
}
