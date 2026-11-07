import { createContext, useContext } from 'react'

// What a page needs from its runtime. Live mode wires these to the Apps
// Script API with a Google token; demo mode wires them to the in-memory
// fictional backend. Pages never know which one they have.
//   mode: 'live' | 'demo'
//   me: { email, name, role }
//   api(action, extra) -> Promise<data>
//   loadPhotos(ids) -> Promise<{ photos }>
//   signOut()
export const RuntimeContext = createContext(null)

export function useRuntime() {
  const value = useContext(RuntimeContext)
  if (!value) throw new Error('RuntimeContext missing')
  return value
}
