import type { CommandArgs, CommandName, CommandResults } from '#shared/commands/registry.ts'
import type { ClientMessage, CommandFailure, HostMessage } from '#shared/protocol/messages.ts'
import type { Link } from './state.ts'

export interface HostAddress {
  /** `ws://127.0.0.1:<port>` */
  url: string
  token: string
}

/** The part of the browser's WebSocket this uses, so a test can stand in for it. */
export interface SocketLike {
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  send(data: string): void
  close(): void
}

export interface ConnectionOptions {
  /** Where the host is right now, or null when there is none. Asked before every attempt, because a restarted host has a new token. */
  discover: () => Promise<HostAddress | null>
  createSocket?: (url: string) => SocketLike
  schedule?: (run: () => void, ms: number) => void
  onMessage: (message: HostMessage) => void
  onLink: (link: Link) => void
}

/** A command the host refused, with its reason. */
export class CommandError extends Error {
  readonly code: CommandFailure | 'disconnected'

  constructor(code: CommandFailure | 'disconnected', message: string) {
    super(message)
    this.code = code
  }
}

// A host that was here comes back within seconds. One that was never found is looked for less often.
const RETRY_AFTER_LOSS_MS = [500, 1000, 2000, 4000]
const RETRY_WITHOUT_HOST_MS = [1000, 2000, 5000, 15000]

interface Waiting {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/** One WebSocket to the host that comes back by itself. It carries state in and commands out. */
export class HostConnection {
  private readonly options: ConnectionOptions
  private socket: SocketLike | null = null
  private readonly waiting = new Map<string, Waiting>()
  private commands = 0
  private attempts = 0
  private everOpen = false
  private stopped = true
  /** Goes up with every start, so an attempt begun before a stop gives up when it wakes. */
  private run = 0

  constructor(options: ConnectionOptions) {
    this.options = options
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.run += 1
    this.options.onLink('connecting')
    void this.connect(this.run)
  }

  stop(): void {
    this.stopped = true
    this.socket?.close()
  }

  private current(run: number): boolean {
    return !this.stopped && run === this.run
  }

  private async connect(run: number): Promise<void> {
    const address = await this.options.discover().catch(() => null)
    if (!this.current(run)) return
    if (!address) return this.retry(run)

    const create = this.options.createSocket ?? ((url: string) => new WebSocket(url) as SocketLike)
    const socket = create(`${address.url}/?token=${encodeURIComponent(address.token)}`)
    this.socket = socket
    socket.onmessage = ({ data }) => this.receive(String(data))
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      for (const { reject } of this.waiting.values()) reject(new CommandError('disconnected', 'Disconnected from hobkin.'))
      this.waiting.clear()
      if (this.current(run)) this.retry(run)
    }
    // An error is always followed by a close, which is where the retry starts.
    socket.onerror = () => {}
  }

  private retry(run: number): void {
    this.options.onLink(this.everOpen ? 'lost' : 'none')
    const delays = this.everOpen ? RETRY_AFTER_LOSS_MS : RETRY_WITHOUT_HOST_MS
    const wait = delays[Math.min(this.attempts, delays.length - 1)]!
    this.attempts += 1
    const schedule = this.options.schedule ?? ((again, ms) => void setTimeout(again, ms))
    schedule(() => {
      if (this.current(run)) void this.connect(run)
    }, wait)
  }

  private receive(text: string): void {
    let message: HostMessage
    try {
      message = JSON.parse(text) as HostMessage
    } catch {
      return
    }
    if (message.type === 'hello') {
      this.everOpen = true
      this.attempts = 0
    }
    if (message.type === 'result') {
      const asked = this.waiting.get(message.id)
      this.waiting.delete(message.id)
      if (message.ok) asked?.resolve(message.value)
      else asked?.reject(new CommandError(message.error.code, message.error.message))
      return
    }
    this.options.onMessage(message)
  }

  /** Sends a message the host needs no answer for. False when there is no connection. */
  send(message: ClientMessage): boolean {
    if (!this.socket) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  /** Runs a command in the host. Rejects with the host's reason, or at once when there is no connection. */
  command<Name extends CommandName>(name: Name, args: CommandArgs<Name>): Promise<CommandResults[Name]> {
    return new Promise((resolve, reject) => {
      const id = `c${++this.commands}`
      if (!this.send({ type: 'command', id, name, args })) return reject(new CommandError('disconnected', 'Disconnected from hobkin.'))
      this.waiting.set(id, { resolve: resolve as (value: unknown) => void, reject })
    })
  }
}
