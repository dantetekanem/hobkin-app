/**
 * Takes the demo shots in the Safari window `shoot.sh prepare` opened and filled the screen with. The window is never
 * sized here: each shot loads its page, is captured whole at the screen's own size (`<n>-<name>-full.png`), and then
 * cut, never scaled: an 8:3 band the page's full width (`<n>-<name>.png`) and a 4:5 phone cut from the same band
 * (`-m.png`), each also as WebP. A shot's page comes from its address (`page/hook.ts`): the theme, the place in the
 * window, and whether the made-up agents are on. Host commands, such as a custom theme, go to the scripted host first.
 *
 *   node scripts/demo/capture.ts <demo folder> <out folder> [shot names...]      capture, then cut
 *   node scripts/demo/capture.ts <demo folder> <out folder> --cut [shot names...] cut the kept full captures again
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import WebSocket from 'ws'

const [DEMO, OUT, ...rest] = process.argv.slice(2)
if (!DEMO || !OUT) throw Error('Usage: node scripts/demo/capture.ts <demo folder> <out folder> [--cut] [shot names...]')
const CUT_ONLY = rest.includes('--cut')
const WANTED = rest.filter((name) => name !== '--cut')
const STATE = join(DEMO, 'state')
const PAGE = 'http://127.0.0.1:5291'
const HOME = join(DEMO, 'home')

interface Cut {
  /** Where the 8:3 band starts, in CSS pixels from the page's top. */
  bandY: number
  /** Where the 4:5 phone cut starts, in CSS pixels from the page's left. It is as tall as the band. */
  phoneX: number
  /** Where the phone cut starts from the top, when not where the band does. */
  phoneY?: number
  /** How wide the phone cut is, in CSS pixels; it is 5/4 as tall. As tall as the band when not given. */
  phoneW?: number
}

interface Shot extends Cut {
  n: number
  name: string
  caption: string
  /** The page's address after `?`, without the place. */
  query?: string
  place?: Record<string, unknown>
  /** Host commands to send before the page loads. */
  before?: (host: Host) => Promise<void>
  /** A picture taken elsewhere, used as this shot's full capture. */
  picture?: string
  seconds?: number
}

const SHOTS: Shot[] = [
  { n: 1, name: 'hero', caption: 'Hero (dark): a durable hobkin mid-run, with its tasks, its loaded skill and its steps, beside the chat and every agent hobkin runs', query: 'theme=dark', place: { screen: 'agent', openAgent: 'hobkin:a3f19c42' }, bandY: 0, phoneX: 0, phoneY: 378 },
  { n: 2, name: 'engines', caption: 'Pi and Claude Code (light): a durable hobkin on Claude Code (the crab pal beside its face) mid-run, beside agents on Pi', query: 'theme=light', place: { screen: 'agent', openAgent: 'hobkin:7c2e90b1' }, bandY: 0, phoneX: 0, phoneY: 378 },
  { n: 3, name: 'work', caption: 'Work mode (dark): four agents at work under hobkin, and the queue graded by priority across the projects', query: 'theme=dark&scroll=434', place: { screen: 'work' }, bandY: 0, phoneX: 614, phoneY: 58, phoneW: 560 },
  { n: 4, name: 'review', caption: "Code review (dark): a Change Review in Story mode, step 4 of 6. The user's own capture of the real app, 2000 px wide (the others are full Retina width)", picture: process.env.REVIEW_PICTURE ?? '', bandY: 112, phoneX: 960, phoneY: 140, phoneW: 880 },
  { n: 5, name: 'routines', caption: "Routines and reports (dark): the morning brief, among the day's reports from seven routines", query: 'theme=dark', place: { screen: 'reports' }, bandY: 0, phoneX: 614, phoneY: 76, phoneW: 648 },
  { n: 6, name: 'github', caption: "GitHub (light): pull requests waiting for review, a stack of two among them, from the scripted host's sample GitHub data", query: 'theme=light&click=GitHub', place: { screen: 'home' }, seconds: 8, bandY: 220, phoneX: 614, phoneY: 212, phoneW: 560 },
  { n: 7, name: 'themes', caption: 'Themes: Home in two custom themes hobkin made on request: Paper and ink (the band) and Night harbor over the night-sky photo (the phone cut)', query: '', place: { screen: 'home' }, bandY: 122, phoneX: 0, phoneY: 350, phoneW: 540 },
  { n: 8, name: 'memory', caption: 'Memory (dark): what hobkin keeps for every agent it runs, from the user and from hobkin', query: 'theme=dark', place: { screen: 'memory' }, bandY: 118, phoneX: 614, phoneY: 296, phoneW: 496 },
]

// ---------------------------------------------------------------------------------------------------------------
// The scripted host, for commands.

interface Host {
  run(name: string, args?: Record<string, unknown>): Promise<unknown>
  state(): Record<string, unknown>
  close(): void
}

async function connect(): Promise<Host> {
  const { port, token } = JSON.parse(readFileSync(join(HOME, 'client', 'host.json'), 'utf8')) as { port: number; token: string }
  if (port === 5188) throw Error('The demo never talks to port 5188.')
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`, { origin: PAGE })
  const waiting = new Map<string, (message: { ok: boolean; value?: unknown; error?: { message: string } }) => void>()
  let state: Record<string, unknown> = {}
  socket.on('message', (data) => {
    const message = JSON.parse(String(data)) as { type: string; id?: string; set?: Record<string, unknown>; ok: boolean }
    if (message.type === 'state' && message.set) state = { ...state, ...message.set }
    if (message.type === 'result') waiting.get(message.id!)?.(message)
  })
  await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject))
  await pause(1000)
  let next = 0
  return {
    run: (name, args = {}) =>
      new Promise((resolve, reject) => {
        const id = `demo-${next++}`
        waiting.set(id, (message) => (message.ok ? resolve(message.value) : reject(Error(`${name}: ${message.error?.message}`))))
        socket.send(JSON.stringify({ type: 'command', id, name, args }))
      }),
    state: () => state,
    close: () => socket.close(),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Safari and the pictures.

const sh = (command: string, args: string[]) => execFileSync(command, args, { encoding: 'utf8' }).trim()
const page = () => JSON.parse(readFileSync(join(STATE, 'size.json'), 'utf8')) as { width: number; height: number; scale: number }

function open(shot: Shot, host: Host) {
  const place = shot.place ? `&spot=${encodeURIComponent(JSON.stringify({ ...shot.place, home: HOME, ...placeExtra(shot, host) }))}` : ''
  sh('osascript', ['-e', `tell application "Safari" to set URL of front document to "${PAGE}/?${shot.query ?? ''}${place}"`])
}

/** The morning brief's report is opened by its id, which the host knows. */
function placeExtra(shot: Shot, host: Host): Record<string, unknown> {
  if (shot.name !== 'routines') return {}
  const reports = (host.state().reports ?? []) as { id?: string; title?: string }[]
  const brief = reports.find((report) => report.title === 'Morning brief')
  return brief?.id ? { report: brief.id } : {}
}

const safari = () => sh('pgrep', ['-x', 'Safari']).split('\n')[0]!

/** Safari draws a page only while its window is on screen: a hidden window, a sleeping display or another Space gives blank captures. */
async function untilShown() {
  for (let waited = 0; waited < 120; waited++) {
    try {
      execFileSync(join(STATE, 'window-id'), ['--visible', safari()])
      return
    } catch {
      if (waited === 0) console.log("Safari's window is not on screen; waiting for it (2 minutes at most).")
      await pause(1000)
    }
  }
  throw Error("Safari's window is not on screen, so it draws nothing to capture. Show it and run the shots again.")
}

/** The whole page, as Safari draws it: the window's capture without Safari's own bars above the page. A blank page is waited for, then refused. */
async function captureShown(file: string) {
  for (let tries = 0; tries < 4; tries++) {
    await untilShown()
    captureWhole(file)
    if (Number(sh('magick', [file, '-format', '%[fx:standard_deviation]', 'info:'])) > 0.01) return
    await pause(3000)
  }
  throw Error(`${file} stays blank: the page did not draw.`)
}

function captureWhole(file: string) {
  const { height, scale } = page()
  const window = sh(join(STATE, 'window-id'), [safari()])
  const raw = join(STATE, 'raw.png')
  sh('screencapture', ['-o', '-x', '-l', window, raw])
  const [width, tall] = sh('magick', ['identify', '-format', '%w %h', raw]).split(' ').map(Number) as [number, number]
  const pageTall = height * scale
  if (tall < pageTall) throw Error(`The capture is ${tall} px tall, less than the page's ${pageTall}.`)
  // The window's rounded bottom corners are see-through in a capture: each takes the page's own color beside it.
  const left = join(STATE, 'left.png')
  const right = join(STATE, 'right.png')
  const half = Math.floor(width / 2)
  const color = (x: number) => sh('magick', [raw, '-format', `%[pixel:p{${x},${tall - 40}}]`, 'info:'])
  sh('magick', [raw, '-crop', `${half}x${pageTall}+0+${tall - pageTall}`, '+repage', '-background', color(40), '-alpha', 'remove', '-alpha', 'off', left])
  sh('magick', [raw, '-crop', `${width - half}x${pageTall}+${half}+${tall - pageTall}`, '+repage', '-background', color(width - 40), '-alpha', 'remove', '-alpha', 'off', right])
  sh('magick', [left, right, '+append', file])
}

/** The 8:3 band and the 4:5 phone cut of a full capture, in its own pixels, never scaled. */
function cut(shot: Shot) {
  const full = join(OUT, `${shot.n}-${shot.name}-full.png`)
  const [width, tall] = sh('magick', ['identify', '-format', '%w %h', full]).split(' ').map(Number) as [number, number]
  // The pictures taken here are at the screen's scale; a picture from elsewhere is taken as it is.
  const scale = shot.picture !== undefined ? 1 : page().scale
  const bandTall = Math.round((width * 3) / 8)
  const y = Math.min(Math.max(0, Math.round(shot.bandY * scale)), tall - bandTall)
  const phoneWide = shot.phoneW ? Math.round(shot.phoneW * scale) : Math.round((bandTall * 4) / 5)
  const phoneTall = shot.phoneW ? Math.round((phoneWide * 5) / 4) : bandTall
  const x = Math.min(Math.max(0, Math.round(shot.phoneX * scale)), width - phoneWide)
  const phoneTop = Math.min(Math.max(0, Math.round((shot.phoneY ?? shot.bandY) * scale)), tall - phoneTall)
  const band = join(OUT, `${shot.n}-${shot.name}.png`)
  const phone = join(OUT, `${shot.n}-${shot.name}-m.png`)
  sh('magick', [full, '-crop', `${width}x${bandTall}+0+${y}`, '+repage', band])
  // The themes shot shows its other theme in the phone cut.
  const phoneSource = shot.name === 'themes' ? join(OUT, `${shot.n}-${shot.name}-a-full.png`) : full
  sh('magick', [phoneSource, '-crop', `${phoneWide}x${phoneTall}+${x}+${phoneTop}`, '+repage', phone])
  for (const file of [band, phone]) sh('cwebp', ['-quiet', '-q', '90', file, '-o', file.replace(/\.png$/, '.webp')])
  return { band: `${width}x${bandTall}`, phone: `${phoneWide}x${phoneTall}` }
}

// ---------------------------------------------------------------------------------------------------------------

async function themes(host: Host, shot: Shot) {
  // Two custom themes the user could have asked hobkin for: one over the app's own night-sky photo, one on paper.
  const themes = [
    { name: 'Night harbor', palette: { background: '#0d1424', surface: '#17213a', text: '#eef2ff', muted: '#a9b4d6', accent: '#ffb454' }, photo: true },
    { name: 'Paper and ink', palette: { background: '#f4efe6', surface: '#fffaf2', text: '#1f2430', muted: '#5b6070', accent: '#c2410c' }, photo: false },
  ]
  for (const [index, theme] of themes.entries()) {
    await host.run('appearance.set', { palette: theme.palette, name: theme.name, asked: `A theme called ${theme.name}` })
    if (theme.photo) await host.run('appearance.photo', { id: 'milky-way' })
    await pause(1500)
    open(shot, host)
    await pause((shot.seconds ?? 6) * 1000)
    await captureShown(join(OUT, `${shot.n}-${shot.name}-${index === 0 ? 'a' : 'b'}-full.png`))
  }
  // The band is cut from the second theme's capture and the phone cut from the first's (`cut`).
  copyFileSync(join(OUT, `${shot.n}-${shot.name}-b-full.png`), join(OUT, `${shot.n}-${shot.name}-full.png`))
  await host.run('appearance.use', { theme: 'system' })
}

const chosen = SHOTS.filter((shot) => WANTED.length === 0 || WANTED.includes(shot.name))
const host = CUT_ONLY ? null : await connect()
try {
  // The theme shot changes the window's colors, so it goes last.
  for (const shot of chosen.toSorted((left, right) => Number(left.name === 'themes') - Number(right.name === 'themes'))) {
    if (host) {
      const full = join(OUT, `${shot.n}-${shot.name}-full.png`)
      if (shot.picture !== undefined) {
        if (!shot.picture || !existsSync(shot.picture)) {
          console.log(`${shot.n}-${shot.name}: skipped, REVIEW_PICTURE names no picture`)
          continue
        }
        copyFileSync(shot.picture, full)
      } else if (shot.name === 'themes') {
        await themes(host, shot)
      } else {
        await shot.before?.(host)
        open(shot, host)
        await pause((shot.seconds ?? 6) * 1000)
        await captureShown(full)
      }
    }
    if (!existsSync(join(OUT, `${shot.n}-${shot.name}-full.png`))) continue
    const sizes = cut(shot)
    console.log(`${shot.n}-${shot.name}: band ${sizes.band}, phone ${sizes.phone}`)
  }
} finally {
  host?.close()
}

writeFileSync(join(OUT, 'contact.html'), contactSheet(SHOTS))

function contactSheet(shots: readonly Shot[]): string {
  const commit = existsSync(join(DEMO, 'build', 'commit.txt')) ? readFileSync(join(DEMO, 'build', 'commit.txt'), 'utf8').trim() : 'unknown'
  const rows = shots
    .filter((shot) => existsSync(join(OUT, `${shot.n}-${shot.name}.png`)))
    .map((shot) => {
      const base = `${shot.n}-${shot.name}`
      const size = (file: string) => sh('magick', ['identify', '-format', '%wx%h', join(OUT, file)])
      return `<section>
  <h2>${base}</h2>
  <p>${shot.caption}</p>
  <p class="files">${base}.png ${size(`${base}.png`)} · ${base}-m.png ${size(`${base}-m.png`)} · ${base}-full.png ${size(`${base}-full.png`)} · WebP beside each</p>
  <div class="pair"><img src="${base}.png" alt="${shot.caption}"><img src="${base}-m.png" alt="${shot.caption}, phone cut"></div>
</section>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>hobkin.dev shots</title>
<style>
  body { margin: 0; padding: 24px; background: #111318; color: #e8e8ea; font: 14px/1.5 -apple-system, system-ui, sans-serif; }
  section { margin: 0 0 48px; }
  h2 { margin: 0 0 4px; font-size: 16px; }
  p { margin: 0 0 8px; color: #b8bac2; max-width: 120ch; }
  .files { font: 12px ui-monospace, monospace; color: #8a8d97; }
  .pair { display: flex; gap: 16px; align-items: flex-start; overflow-x: auto; }
  img { display: block; flex: none; outline: 1px solid #2a2d36; }
</style></head><body>
<h1>hobkin.dev shots</h1>
<p>The real hobkin-client window at commit ${commit}, on a scripted host and a throwaway home with made-up data, captured in Safari at the screen's own size and cut, never scaled. Each image shows at its own pixel size: scroll sideways.</p>
${rows}
</body></html>
`
}
