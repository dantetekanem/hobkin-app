import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const out = path.resolve('.auto/out')
await mkdir(out, { recursive: true })
const baseSources = new Map()
if (process.env.BASE_REV) {
  const files = execFileSync('git', ['diff', '--name-only', process.env.BASE_REV, '--', 'ui/src'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  for (const file of files) baseSources.set(path.resolve(file), execFileSync('git', ['show', `${process.env.BASE_REV}:${file}`], { encoding: 'utf8' }))
}
await build({
  configFile: false, root: process.cwd(), logLevel: 'error', plugins: [
    { name: 'benchmark-base-sources', enforce: 'pre', load: (id) => baseSources.get(id) }, react(), tailwindcss(),
  ],
  resolve: { alias: { '@': path.resolve('ui/src') } },
  define: { 'process.env.NODE_ENV': '"production"', __HOBKIN_VERSION__: '"benchmark"', __HOBKIN_CORE_VERSION__: '"benchmark"' },
  build: { outDir: path.join(out, 'bundle'), emptyOutDir: true, minify: process.env.PROFILE !== '1',
    lib: { entry: path.resolve('.auto/render-bench.tsx'), name: 'RenderBenchmark', formats: ['iife'], fileName: () => 'bench.js', cssFileName: 'bench' } },
})
await writeFile(path.join(out, 'bundle/index.html'), `<!doctype html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' file: data:; connect-src 'none'; script-src 'self' 'unsafe-eval' file:; style-src 'self' 'unsafe-inline' file:; img-src data:; font-src 'self' file: data:">
<link rel="stylesheet" href="bench.css"></head><body><div id="app" style="height:800px"></div><script src="bench.js"></script></body></html>`)

// A short-lived headless browser with a private profile and a pipe: no server, no signed-in browser.
const profile = await mkdtemp(path.join(out, 'chrome-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=1440,1000', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
let stderr = ''
chrome.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000) })
let sequence = 0
let buffer = ''
const pending = new Map()
const events = []
let pageLoaded
chrome.stdio[4].setEncoding('utf8')
chrome.stdio[4].on('data', (chunk) => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end))
    buffer = buffer.slice(end + 1)
    if (message.method === 'Page.loadEventFired') pageLoaded?.()
    if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded') events.push(message)
    const request = pending.get(message.id)
    if (!request) continue
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  }
})
function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}\n${stderr}`)) }, 180000)
    pending.set(id, { resolve, reject, timer })
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
  })
}
chrome.on('exit', (code) => {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(`Chrome exited ${code}: ${stderr}`)) }
  pending.clear()
})
try {
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
  await call('Page.enable', {}, sessionId)
  await call('Runtime.enable', {}, sessionId)
  await call('Log.enable', {}, sessionId)
  const loaded = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Page did not load')), 30000)
    pageLoaded = () => { clearTimeout(timeout); resolve() }
  })
  const url = pathToFileURL(path.join(out, 'bundle/index.html')).href
  await call('Page.navigate', { url }, sessionId)
  await loaded
  if (process.env.PROFILE === '1') {
    await call('Profiler.enable', {}, sessionId)
    await call('Profiler.start', {}, sessionId)
  }
  const result = await call('Runtime.evaluate', {
    expression: `new Promise((resolve, reject) => {
      const run = () => { try { resolve(window.runBenchmark(${process.env.HOLDOUT === '1'})) } catch (error) { reject(error) } };
      if (document.readyState === 'complete') run(); else window.addEventListener('load', run, { once: true });
    })`, awaitPromise: true, returnByValue: true,
  }, sessionId)
  if (result.exceptionDetails) throw new Error((result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails)) + '\nPage events: ' + JSON.stringify(events))
  if (process.env.PROFILE === '1') {
    const { profile } = await call('Profiler.stop', {}, sessionId)
    await writeFile(path.join(out, 'profile.json'), JSON.stringify(profile))
  }
  const report = result.result.value
  if (!report?.metrics || !Number.isFinite(report.metrics.render_ms) || report.metrics.render_ms <= 0) throw new Error('Missing benchmark result')
  await writeFile(path.join(out, process.env.HOLDOUT === '1' ? 'holdout.json' : 'latest.json'), JSON.stringify(report, null, 2) + '\n')
  for (const [name, value] of Object.entries(report.metrics)) console.log(`METRIC ${name}=${Number(value).toFixed(3)}`)
  console.log(`Browser: ${report.userAgent}; holdout=${report.holdout}; 3 repetitions, median per workload`)
  console.log(`Motion checks: ${report.motionChecks.join(', ')}`)
} finally {
  await call('Browser.close').catch(() => chrome.kill())
  if (chrome.exitCode === null) await new Promise((resolve) => chrome.once('exit', resolve))
  await rm(profile, { recursive: true, force: true })
}
