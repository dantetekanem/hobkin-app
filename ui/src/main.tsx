import { createRoot } from 'react-dom/client'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/inter'
import '@fontsource-variable/geist'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/figtree'
import '@fontsource-variable/jetbrains-mono'
import './styles/globals.css'
import { App } from './app/App.tsx'
import { strictWhenAsked } from './app/strict.ts'
import { startLearningCodeHosts } from './features/review/code-hosts-start.ts'

// The window learns the code hosts the home names, so their pull request pages open as reviews.
startLearningCodeHosts()

// StrictMode only with VITE_STRICT=1: in the development build it draws every component twice.
createRoot(document.getElementById('root')!).render(strictWhenAsked(<App />))
