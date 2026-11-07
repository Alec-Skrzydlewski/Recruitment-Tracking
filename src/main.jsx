import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

// The build mode picks exactly one runtime. Vite replaces VITE_APP_MODE with
// a literal, so the demo bundle contains no Google sign-in or API code and
// the live bundle contains no demo data (verified by scripts/check-bundle.mjs).
const loadApp = import.meta.env.VITE_APP_MODE === 'demo'
  ? () => import('./demo/DemoApp.jsx')
  : () => import('./live/LiveApp.jsx')

loadApp().then(({ default: App }) => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
