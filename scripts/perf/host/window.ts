/**
 * The load lab's fake window: connects to the host's socket, counts messages and bytes, and parses nothing beyond the
 * type, except the first state, to pick the jobs it watches. It runs in its own process, so its receive cost never
 * lands in the host's numbers.
 * Usage (forked by `lab.ts`): node window.ts <port> <token> <origin> <seconds to live> <run folder> <old | watch:N>
 * `old` is a window from before tails: it says nothing of what it reads and gets every feed whole. `watch:N` reads
 * tails and watches the first N jobs, as a user with N agents' pages open. The run folder is only there so a leftover
 * window can be found by its command line.
 */
import { WebSocket } from 'ws'

const [port, token, origin, live, , mode = 'old'] = process.argv.slice(2)
if (Number(port) === 5188) throw Error('The fake window never connects to the live host.')
// Never outlive the lab.
setTimeout(() => process.exit(2), Number(live) * 1000).unref()
process.on('disconnect', () => process.exit(0))

const watching = mode === 'old' ? null : Number(mode.split(':')[1] ?? 1)
const reads = watching === null ? '' : '&reads=tails,extend'
const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token!)}${reads}`, { origin })
let messages = 0
let bytes = 0
let states = 0
let largest = 0
let sizes: number[] = []
let firstState = 0
let takesWatch = false

/** After the first state: the first jobs it holds, told to the host as watched when it takes watching. */
function watchFirst(data: Buffer) {
  const state = JSON.parse(data.toString()) as { activity?: { job: string }[] }
  const jobs = (state.activity ?? []).map(({ job }) => job).filter((job) => job !== '#main').slice(0, watching ?? 0)
  if (takesWatch && jobs.length) socket.send(JSON.stringify({ type: 'watch', jobs }))
  process.send?.({ type: 'ready', watched: takesWatch ? jobs : [] })
}

socket.on('message', (data: Buffer) => {
  const length = data.length
  messages++
  bytes += length
  if (length > largest) largest = length
  sizes.push(length)
  const head = data.subarray(0, 24).toString()
  if (head.includes('"hello"')) takesWatch = (JSON.parse(data.toString()) as { watch?: boolean }).watch === true
  if (!head.includes('"state"')) return
  states++
  if (firstState) return
  firstState = length
  if (watching === null) process.send?.({ type: 'ready', watched: [] })
  else watchFirst(data)
})
socket.on('open', () => process.send?.({ type: 'open' }))
socket.on('error', (error) => process.send?.({ type: 'error', message: error.message }))

process.on('message', (message: { type?: string; reset?: boolean }) => {
  if (message?.type === 'read') {
    const sorted = [...sizes].sort((a, b) => a - b)
    const at = (share: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] : 0)
    process.send?.({ type: 'counts', messages, bytes, states, largest, firstState, p50: at(0.5), p99: at(0.99) })
    if (message.reset) {
      messages = bytes = states = largest = 0
      sizes = []
    }
  }
  if (message?.type === 'close') {
    socket.close()
    setTimeout(() => process.exit(0), 50)
  }
})
