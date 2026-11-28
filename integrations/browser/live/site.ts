import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * The pages the live browser checks visit: a small site on 127.0.0.1 that the check starts itself, so nothing but
 * this computer is reached. Each piece of the home page is there for one verb or one kind of target.
 */

const HOME = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Core Test Home</title>
<style>body { font: 16px sans-serif; margin: 16px; } .tall { height: 3000px; }</style>
</head>
<body>
<h1>Core test page</h1>
<p id="intro">A small page for the browser tool.</p>
<nav>
  <a href="/about">About</a>
  <a href="/more?n=1">More</a>
  <a href="/more?n=2">More</a>
  <a href="/more?n=3">Read the long guide</a>
</nav>
<form id="login" onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'Saved ' + email.value + ' / ' + color.value + ' / ' + password.value.length">
  <label for="email">Email</label>
  <input id="email" name="email" type="email">
  <label for="password">Password</label>
  <input id="password" name="password" type="password">
  <label for="color">Color</label>
  <select id="color" name="color">
    <option value="r">Red</option>
    <option value="g">Green</option>
    <option value="b">Blue</option>
  </select>
  <label><input id="agree" type="checkbox"> I agree</label>
  <button type="submit">Save</button>
</form>
<p id="out">Nothing saved</p>
<button id="later" type="button" onclick="setTimeout(() => { document.getElementById('late').textContent = 'Loaded later'; }, 300)">Load later</button>
<p id="late"></p>
<button id="hover" type="button" onmouseover="document.getElementById('hovered').textContent = 'Hovered yes'">Hover me</button>
<p id="hovered">Hovered no</p>
<input id="keys" aria-label="Key box" onkeydown="document.getElementById('pressed').textContent = 'Pressed ' + (event.ctrlKey ? 'Control+' : '') + event.key">
<p id="pressed">Pressed nothing</p>
<button id="off" type="button" disabled>Disabled one</button>
<div class="tall"></div>
<a id="bottom" href="/about">Bottom link</a>
<script>
console.log('hello from the page');
console.warn('a warning from the page');
setTimeout(() => { throw new Error('a thrown page error'); }, 0);
</script>
</body>
</html>`


const page = (title: string, body: string): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`

const pages: Record<string, string> = {
  '/': HOME,
  '/canvas-form': page('Canvas interaction check', `<form id="form">
<label>Title <input name="title" required></label>
<label>Status <select name="status"><option>Draft</option><option>Ready</option></select></label>
<label>Files <input name="files" type="file" multiple></label>
<label>Folder <input name="folder" type="file" webkitdirectory></label>
<div draggable="true" aria-label="Card" ondragstart="event.dataTransfer.setData('text/plain','Card')">Card</div>
<div tabindex="0" aria-label="Done" ondragover="event.preventDefault()" ondrop="event.preventDefault();this.textContent=event.dataTransfer.getData('text/plain')+' dropped'">Done</div>
<button>Save locally</button></form><output id="receipt"></output><script>
form.onsubmit = event => {event.preventDefault(); const fields=form.elements; receipt.textContent = [fields.title.value, fields.status.value, fields.files.files.length+' files', fields.folder.files.length+' folder entries'].join(' / ')}
</script>`),
  '/about': page('About Core', '<h1>About this site</h1><p>The about page text.</p><a href="/">Home</a>'),
  '/more': page('More Core', '<h1>More</h1><a href="/">Home</a>'),
  '/long': page('Long Core', `<h1>Long</h1><ul>${Array.from({ length: 300 }, (_, n) => `<li><a href="/more?n=${n}">Item number ${n}</a></li>`).join('')}</ul><p>${'word '.repeat(6000)}</p>`),
  // A list whose options look like the engine's own switches, a file to download, and the clipboard.
  '/odd': page(
    'Odd Core',
    `<h1>Odd things</h1>
<select id="mode" aria-label="Mode"><option>plain</option><option>--headed</option><option>--json</option></select>
<a id="download" href="/file.txt" download>Download it</a>`,
  ),
}

const attribute = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

/** A page that sends its visitor to another address in each way a page can: a link, a new tab, a popup, a frame. */
const waysOut = (to: string): string =>
  page(
    'Ways Out',
    `<h1>Ways out</h1>
<a href="${attribute(to)}">Same tab</a>
<a href="${attribute(to)}" target="_blank">New tab</a>
<button type="button" onclick="window.open(${attribute(JSON.stringify(to))})">Popup</button>
<iframe title="Framed" src="${attribute(to)}"></iframe>`,
  )

export interface Site {
  url: string
  close(): Promise<void>
}

type Handler = (request: IncomingMessage, response: ServerResponse) => void

function serve(handler: Handler): Promise<Site> {
  const server = createServer(handler)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections()
            server.close(() => done())
          }),
      }),
    )
  })
}

/** Starts the site on a free port. */
export function startSite(): Promise<Site> {
  return serve((request, response) => {
    const { pathname, searchParams } = new URL(request.url ?? '/', 'http://x')
    const to = searchParams.get('to') ?? '/'

    if (pathname === '/redirect') {
      response.writeHead(302, { location: to })
      response.end()
      return
    }
    if (pathname === '/file.txt') {
      const name = searchParams.get('name') ?? 'hobkin-live-test-download.txt'
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${name}"` })
      response.end('downloaded bytes')
      return
    }

    const body = pathname === '/ways-out' ? waysOut(to) : pages[pathname]
    response.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' })
    response.end(body ?? page('Not found', '<h1>Not found</h1>'))
  })
}

/** What a window that must not be opened would hold: words no answer may carry, and a button no agent may press. */
export const OWN_WINDOW_SECRET = 'OWN-WINDOW-SECRET-7731'

/**
 * A stand-in for hobkin's own window: a page on this computer that an agent's browser is told to stay off. It keeps
 * what was asked of it, with what each request was for (`document`, `iframe`, `image`, `empty` for a fetch).
 */
export async function startOwnWindow(): Promise<Site & { asked: string[] }> {
  const asked: string[] = []
  const site = await serve((request, response) => {
    asked.push(`${request.headers['sec-fetch-dest'] ?? 'unknown'} ${request.url ?? ''}`)
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(page('hobkin', `<h1>${OWN_WINDOW_SECRET}</h1><button type="button" onclick="document.title = 'approved'">Approve</button>`))
  })
  return Object.assign(site, { asked })
}
