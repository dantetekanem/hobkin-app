import { readFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The UI lives in ui/. Tauri loads this dev server, so the port is fixed.
// 5187, not Vite's usual 5173, so it never collides with another project's dev server.
export const DEV_PORT = 5187

/** A package's version, read at build time for the About line in Settings. */
function versionOf(file: string): string {
  try {
    return (JSON.parse(readFileSync(path.resolve(import.meta.dirname, file), 'utf8')) as { version?: string }).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  root: 'ui',
  plugins: [react(), tailwindcss()],
  define: {
    __HOBKIN_VERSION__: JSON.stringify(versionOf('package.json')),
    __HOBKIN_CORE_VERSION__: JSON.stringify(versionOf('node_modules/hobkin/package.json')),
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'ui/src') },
  },
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: DEV_PORT,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/.dev-home/**'] },
  },
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
  },
})
