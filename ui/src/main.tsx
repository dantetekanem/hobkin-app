import './integration/loaded.ts'

// The app's modules read the integrations' window parts when they load, so they load only once the parts are in.
await import('./start.tsx')
