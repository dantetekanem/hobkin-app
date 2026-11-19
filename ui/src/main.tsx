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
import { startLearningCodeHosts } from './features/review/code-hosts-start.ts'

// The window learns the code hosts the home names, so their pull request pages open as reviews.
startLearningCodeHosts()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
