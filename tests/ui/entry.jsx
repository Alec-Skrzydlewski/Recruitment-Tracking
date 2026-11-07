// Bundled by tests/ui-flows.test.mjs with esbuild for jsdom.
export { createElement } from 'react'
export { createRoot } from 'react-dom/client'
export { act } from 'react'
export { default as DemoApp } from '../../src/demo/DemoApp.jsx'
export { default as LiveApp } from '../../src/live/LiveApp.jsx'
import { createDemoBackend as createBackend } from '../../src/demo/demoBackend.js'
import { demoSeed } from '../helpers/legacyDemoSeed.js'
export const createDemoBackend = options => createBackend({ ...options, seed: demoSeed })
