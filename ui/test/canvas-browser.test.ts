import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BrowserArea, BrowserShell, BrowserShown } from '../src/lib/native.ts'
import { addressFrom, areaOf, barOf, covered, createNativeView, nativeShown, samplePoints } from '../src/features/canvas-panel/browser.ts'

test('a typed address becomes a page, and words are not searched', () => {
  const goes = (typed: string) => {
    const result = addressFrom(typed)
    return 'url' in result ? result.url : null
  }
  assert.equal(goes('example.com'), 'https://example.com/')
  assert.equal(goes('  hobkin.dev/docs?x=1 '), 'https://hobkin.dev/docs?x=1')
  assert.equal(goes('localhost:5173'), 'http://localhost:5173/')
  assert.equal(goes('localhost'), 'http://localhost/')
  assert.equal(goes('127.0.0.1:8080/app'), 'http://127.0.0.1:8080/app')
  assert.equal(goes('192.168.1.10'), 'http://192.168.1.10/')
  assert.equal(goes('http://example.com/a'), 'http://example.com/a')
  assert.equal(goes('HTTPS://Example.com'), 'https://example.com/')

  for (const words of ['', '   ', 'how to cook rice', 'hobkin', 'e.g.', 'what is localhost']) {
    assert.ok('refused' in addressFrom(words), JSON.stringify(words))
  }
  for (const other of ['file:///etc/passwd', 'javascript:alert(1)', 'tauri://localhost', 'data:text/html,hi', 'https://user:pw@example.com']) {
    assert.ok('refused' in addressFrom(other), other)
  }
})

const shown = (patch: Partial<BrowserShown> = {}): BrowserShown => ({ url: 'https://example.com/', title: 'Example', loading: false, back: false, forward: false, ...patch })

test('the bar shows the page as it is: its address, its title, loading, and whether it can go back or forward', () => {
  // Before the browser has said anything: hobkin's page, by hobkin's name for it, loading.
  assert.deepEqual(barOf({ url: 'https://hobkin.dev/', title: 'Docs', shown: null, editing: null }), {
    field: 'https://hobkin.dev/', label: 'Docs', loading: true, back: false, forward: false, opens: 'https://hobkin.dev/',
  })
  // The page the user went to, by its own title.
  assert.deepEqual(barOf({ url: 'https://hobkin.dev/', title: 'Docs', shown: shown({ back: true }), editing: null }), {
    field: 'https://example.com/', label: 'Example', loading: false, back: true, forward: false, opens: 'https://example.com/',
  })
  // A page with no title yet goes by its host; hobkin's name is for hobkin's page only.
  assert.equal(barOf({ url: 'https://hobkin.dev/', title: 'Docs', shown: shown({ title: '', loading: true }), editing: null }).label, 'example.com')
  assert.equal(barOf({ url: 'https://hobkin.dev/', title: 'Docs', shown: shown({ url: 'https://hobkin.dev/', title: ' ' }), editing: null }).label, 'Docs')
  // While the user types, the field holds what they typed.
  assert.equal(barOf({ url: 'https://hobkin.dev/', title: null, shown: shown(), editing: 'exa' }).field, 'exa')
  // What the browser shows that is not a web page never goes to the Mac's browser.
  assert.equal(barOf({ url: 'https://hobkin.dev/', title: null, shown: shown({ url: 'about:blank' }), editing: null }).opens, 'https://hobkin.dev/')
})

test('the native view shows only over an open page panel that nothing covers', () => {
  const area = { x: 700, y: 40, width: 600, height: 800 }
  assert.equal(nativeShown({ open: true, covered: false, area }), true)
  assert.equal(nativeShown({ open: false, covered: false, area }), false)
  assert.equal(nativeShown({ open: true, covered: true, area }), false)
  assert.equal(nativeShown({ open: true, covered: false, area: null }), false)
})

test('the rectangle sent is the page area in whole points, kept inside the window', () => {
  const window = { width: 1440, height: 900 }
  assert.deepEqual(areaOf({ left: 720.4, top: 40.6, width: 719.6, height: 859.4 }, window), { x: 720, y: 41, width: 720, height: 859 })
  // Sliding in from the right edge: only the part inside the window.
  assert.deepEqual(areaOf({ left: 1300, top: 40, width: 720, height: 860 }, window), { x: 1300, y: 40, width: 140, height: 860 })
  // Too little of it to show.
  assert.equal(areaOf({ left: 1430, top: 40, width: 720, height: 860 }, window), null)
  assert.equal(areaOf({ left: 0, top: 0, width: 0, height: 0 }, window), null)
})

test('anything over a part of the page area covers it', () => {
  const area = { x: 100, y: 100, width: 400, height: 300 }
  const points = samplePoints(area)
  assert.ok(points.every(({ x, y }) => x > area.x && x < area.x + area.width && y > area.y && y < area.y + area.height))
  assert.equal(covered(area, () => true), false)
  // A sheet over the lower right corner.
  assert.equal(covered(area, ({ x, y }) => !(x > 420 && y > 330)), true)
})

function fakeShell() {
  const calls: string[] = []
  const shell: BrowserShell = {
    open: async (url, area) => { calls.push(`open ${url} ${key(area)}`) },
    place: async (area) => { calls.push(area ? `place ${key(area)}` : 'hide') },
    navigate: async (url) => { calls.push(`navigate ${url}`) },
    back: async () => { calls.push('back') },
    forward: async () => { calls.push('forward') },
    reload: async () => { calls.push('reload') },
    close: async () => { calls.push('close') },
    shown: async () => null,
    onShown: async () => () => {},
    onKey: async () => () => {},
  }
  return { shell, calls }
}
const key = (area: BrowserArea) => `${area.x},${area.y},${area.width}x${area.height}`

test('the window tells the native view only what changed, opens it when it first shows, and closes it once', async () => {
  const { shell, calls } = fakeShell()
  const view = createNativeView(shell)
  const area = { x: 700, y: 40, width: 600, height: 800 }
  // Hidden from the start: nothing exists yet.
  await view.sync({ url: 'https://hobkin.dev/', visit: 0, area: null })
  await view.sync({ url: 'https://hobkin.dev/', visit: 0, area })
  await view.sync({ url: 'https://hobkin.dev/', visit: 0, area })
  await view.sync({ url: 'https://hobkin.dev/', visit: 0, area: { ...area, x: 650, width: 650 } })
  await view.sync({ url: 'https://hobkin.dev/', visit: 0, area: null })
  await view.sync({ url: 'https://hobkin.dev/', visit: 0, area: null })
  // hobkin shows its page again: the browser goes back to it.
  await view.sync({ url: 'https://hobkin.dev/', visit: 1, area })
  await view.close()
  await view.close()
  await view.sync({ url: 'https://hobkin.dev/', visit: 2, area })
  assert.deepEqual(calls, [
    'open https://hobkin.dev/ 700,40,600x800',
    'place 650,40,650x800',
    'hide',
    'navigate https://hobkin.dev/',
    'place 700,40,600x800',
    'close',
  ])
})

test('what the user does in the bar reaches the native view in order', async () => {
  const { shell, calls } = fakeShell()
  let release!: () => void
  shell.open = (url) => new Promise((resolve) => { release = () => { calls.push(`open ${url}`); resolve() } })
  const view = createNativeView(shell)
  const opening = view.sync({ url: 'https://hobkin.dev/', visit: 0, area: { x: 1, y: 2, width: 300, height: 400 } })
  const going = view.go('https://example.com/')
  const backing = view.back()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, [])
  release()
  await Promise.all([opening, going, backing, view.forward(), view.reload()])
  assert.deepEqual(calls, ['open https://hobkin.dev/', 'navigate https://example.com/', 'back', 'forward', 'reload'])
  // Before it exists, nothing goes, and an address typed meanwhile is where it opens.
  const fresh = fakeShell(), unopened = createNativeView(fresh.shell)
  await unopened.back(); await unopened.go('https://example.com/')
  assert.deepEqual(fresh.calls, [])
  await unopened.sync({ url: 'https://hobkin.dev/', visit: 0, area: { x: 1, y: 2, width: 300, height: 400 } })
  assert.deepEqual(fresh.calls, ['open https://example.com/ 1,2,300x400'])
})
