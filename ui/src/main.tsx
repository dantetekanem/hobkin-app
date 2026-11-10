import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/inter'
import '@fontsource-variable/geist'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/figtree'
import '@fontsource-variable/jetbrains-mono'
import './styles/globals.css'
import { App } from './app/App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
