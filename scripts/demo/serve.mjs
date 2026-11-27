// The demo window's server: serves one built UI on 127.0.0.1, hands the page the demo host's address from the demo
// home's client/host.json, and keeps the size the page last said it has.
//   node scripts/demo/serve.mjs <port> <dist folder> <demo home> <state folder>
import { createServer } from 'node:http'
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const [port, distArg, home, stateDir] = process.argv.slice(2)
const dist = path.resolve(distArg)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' }

createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (request.method === 'POST' && url.pathname === '/demo/log') {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      appendFileSync(path.join(stateDir, 'page-errors.log'), `${body}\n`)
      response.writeHead(204).end()
    })
    return
  }
  if (request.method === 'POST' && url.pathname === '/demo/size') {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      writeFileSync(path.join(stateDir, 'size.json'), body)
      response.writeHead(204).end()
    })
    return
  }
  if (url.pathname === '/demo/host.json') {
    try {
      const { port: hostPort, token } = JSON.parse(readFileSync(path.join(home, 'client', 'host.json'), 'utf8'))
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ url: `ws://127.0.0.1:${hostPort}`, token }))
    } catch {
      response.writeHead(503).end()
    }
    return
  }
  let file = path.join(dist, decodeURIComponent(url.pathname))
  if (!file.startsWith(dist)) return response.writeHead(403).end()
  try {
    if (statSync(file).isDirectory()) file = path.join(file, 'index.html')
  } catch {
    file = path.join(dist, 'index.html')
  }
  try {
    const data = readFileSync(file)
    response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    response.end(data)
  } catch {
    response.writeHead(404).end()
  }
}).listen(Number(port), '127.0.0.1', () => console.log(`demo window on http://127.0.0.1:${port}, serving ${dist}`))
