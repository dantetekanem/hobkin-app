import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { isLoopbackPage, refusalFor } from './access.ts'

const LOOPBACK = '127.0.0.1'
/** Room for the largest image hobkin takes (64 MB), which arrives in base64 inside one command. */
const MAX_MESSAGE_BYTES = 96 * 1024 * 1024

export interface ServerOptions {
  port: number
  token: string
  origins: readonly string[]
  /** Answer the development UI's handshake with the token. */
  dev: boolean
  onConnection: (socket: WebSocket) => void
  /** Answers a request that nothing else here does, and returns true when it did. Left false, the 404 stands. */
  serve?: (request: IncomingMessage, response: ServerResponse) => boolean
}

export interface HostServer {
  port: number
  sockets(): Iterable<WebSocket>
  close(): Promise<void>
}

/** The address a UI connects to. */
export const socketUrl = (port: number) => `ws://${LOOPBACK}:${port}`

/**
 * A plain browser has no shell to hand it the token, so in development the host gives it to the pages it trusts that
 * are served on this Mac: the development UI, and a page `--origin` added. The app's own page is handed the token.
 * The origin check on the socket still applies to whoever uses the token.
 */
function answerHandshake(request: IncomingMessage, response: ServerResponse, { port, token, origins }: { port: number; token: string; origins: readonly string[] }) {
  const origin = request.headers.origin
  if (!origin || !origins.includes(origin) || !isLoopbackPage(origin)) {
    response.writeHead(403).end()
    return
  }
  response
    .writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': origin,
      vary: 'origin',
      'cache-control': 'no-store',
    })
    .end(JSON.stringify({ url: socketUrl(port), token }))
}

/** Listens on this machine only. A connection opens only with the token and from an allowed origin. */
export function listen({ port, token, origins, dev, onConnection, serve }: ServerOptions): Promise<HostServer> {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })
  const http = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', `http://${LOOPBACK}`)
    if (dev && request.method === 'GET' && pathname === '/dev/handshake') {
      answerHandshake(request, response, { port: (http.address() as AddressInfo).port, token, origins })
      return
    }
    if (serve?.(request, response)) return
    response.writeHead(404).end()
  })

  http.on('upgrade', (request, socket, head) => {
    const presented = new URL(request.url ?? '/', `http://${LOOPBACK}`).searchParams.get('token')
    const refusal = refusalFor({ origin: request.headers.origin, token: presented }, { origins, token })
    if (refusal) {
      socket.end(`HTTP/1.1 ${refusal.status} ${refusal.reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
      return
    }
    sockets.handleUpgrade(request, socket, head, (client) => onConnection(client))
  })

  return new Promise((resolve, reject) => {
    http.once('error', reject)
    http.listen(port, LOOPBACK, () => {
      http.off('error', reject)
      resolve({
        port: (http.address() as AddressInfo).port,
        sockets: () => sockets.clients,
        close: () =>
          new Promise((done) => {
            for (const client of sockets.clients) client.terminate()
            sockets.close()
            http.close(() => done())
            http.closeAllConnections()
          }),
      })
    })
  })
}
