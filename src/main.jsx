import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

// Resolve only one runtime at build time, including its photo assets.
// The other runtime never enters the module graph.
const loadApp = () => import('@app-runtime')

loadApp().then(({ default: App }) => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
