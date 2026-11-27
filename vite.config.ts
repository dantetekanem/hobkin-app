import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { restartOnBump, VERSION_FILES, versionOf } from './ui/build-info.ts'

// The UI lives in ui/. Tauri loads this dev server, so the port is fixed.
// 5187, not Vite's usual 5173, so it never collides with another project's dev server.
export const DEV_PORT = 5187

export default defineConfig({
  root: 'ui',
  // The last one restarts the dev server on a version bump, so the versions below never go stale.
  plugins: [react(), tailwindcss(), { name: 'hobkin-versions', configureServer: restartOnBump }],
  // Most text uses fixed px, including Tailwind's text-[15px] utilities. Scale those sizes,
  // not the whole window; relative sizes like inline code's 0.87em already follow their parent.
  css: {
    postcss: { plugins: [{
      postcssPlugin: 'hobkin-font-size',
      Declaration: {
        'font-size'(declaration) {
          if (/^(?:[\d.]+(?:px|rem)|var\(--text-[\w-]+\))$/.test(declaration.value)) {
            declaration.value = `calc(${declaration.value} * var(--hb-font-scale, 1))`
          }
        },
      },
    }] },
  },
  define: {
    __HOBKIN_VERSION__: JSON.stringify(versionOf(VERSION_FILES.app)),
    __HOBKIN_CORE_VERSION__: JSON.stringify(versionOf(VERSION_FILES.core)),
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
