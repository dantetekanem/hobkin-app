import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserSteps, engineEnv, LIMITS, runBrowser, snapshotElements, type RunOptions } from '../host/engine.ts'
import { HOBKIN_WINDOW_PLACES, OWN_WINDOW_REFUSAL, placeGuard } from '../host/places.ts'
import { fakeEngine, PAGE } from './support.ts'

type Answers = Parameters<typeof fakeEngine>[0]

const OWN_WINDOW = 'http://127.0.0.1:5187/'
/** The four ways a request to this computer's port 5187 can be written, each of them blocked. */
const BLOCKS = ['127.0.0.1', 'localhost', '[::1]', '0.0.0.0'].map((host) => ['network', 'route', `**://${host}:5187/**`, '--abort'])
/** What a call starts with: the control port closed, and where the browser is and what tabs it has. */
const SAFE = [['stream', 'disable'], ['get', 'url'], ['tab', 'list']]
/** What follows every step: where the browser is, and whether the page opened a tab. */
const WHERE = [['get', 'url'], ['get', 'title'], ['tab', 'list']]
/** What runs in the same batch before every command on the page: it fails when the page is on a refused place. */
const GUARD = ['eval', '-b', Buffer.from(placeGuard(['127.0.0.1:5187'])!).toString('base64')]
const isGuard = (command: string[]): boolean => command[2] === GUARD[2]
/** A command on the page, as it is run: behind the guard, in one batch. */
const onPage = (...commands: string[][]): string[][] => [GUARD, ...commands]
const READ = onPage(['snapshot', '-i', '-u'])

/** The engine on a fake agent-browser, in the session `agent-1`, kept off port 5187 of this computer. */
function guardedBrowser(answers: Answers = {}) {
  const engine = fakeEngine(answers)
  const run = (input: unknown, more: Partial<RunOptions> = {}) =>
    runBrowser(input, { binary: '/bin/agent-browser', session: 'agent-1', exec: engine.exec, shotsDir: '/nowhere', refused: ['127.0.0.1:5187'], ...more })
  /** How each call to the engine was made: one command, a batch that goes on after a failure, or one that stops. */
  const kinds = () => engine.calls.map(({ args }) => (args[3] !== 'batch' ? 'one' : args[4] === '--bail' ? 'batch that stops' : 'batch'))
  return { ...engine, run, kinds }
}

test('a call first closes the control port of its browser, and a new browser blocks the refused places before any page step', async () => {
  const browser = guardedBrowser()

  const first = await browser.run({ do: 'read' })

  assert.equal(first.result.ok, true)
  assert.deepEqual(browser.commands, [...SAFE, ...BLOCKS, ...READ, ...WHERE])
  // Closing the port may fail on a browser that is already safe, so that batch goes on; the blocks must all hold,
  // and the page command stops at its guard.
  assert.deepEqual(browser.kinds(), ['batch', 'batch that stops', 'batch that stops', 'batch that stops'])
  assert.equal(browser.portClosed.has('agent-1'), true)
  assert.deepEqual(browser.blocked.get('agent-1'), BLOCKS.map(([, , pattern]) => pattern))

  // The same browser, already safe: the port is closed again in case anything opened it, and nothing is blocked twice.
  browser.commands.length = 0
  await browser.run({ do: 'read' })
  assert.deepEqual(browser.commands, [...SAFE, ...READ, ...WHERE])
  assert.equal(browser.blocked.get('agent-1')!.length, BLOCKS.length)

  // A close ends that browser, so the step after it starts a new one, made safe the same way. A close alone starts none.
  browser.commands.length = 0
  await browser.run({ steps: [{ do: 'close' }, { do: 'read' }] })
  assert.deepEqual(browser.commands, [['close'], ...SAFE, ...BLOCKS, ...READ, ...WHERE])
  browser.commands.length = 0
  await browser.run({ do: 'close' })
  assert.deepEqual(browser.commands, [['close']])

  // With nowhere refused only the port is closed.
  const open = guardedBrowser()
  await open.run({ do: 'read' }, { refused: [] })
  assert.deepEqual(open.commands, [['stream', 'disable'], ['get', 'url'], ['snapshot', '-i', '-u'], ['get', 'url'], ['get', 'title']])
})

test('a browser that cannot be made safe runs no page step', async () => {
  const stuck = guardedBrowser({ stream: { fail: 'the daemon is busy' } })
  const refused = await stuck.run({ steps: [{ do: 'read' }, { do: 'click', on: 'e2' }] })
  assert.deepEqual(refused.result.error, { step: 0, do: 'read', message: 'The browser could not be made safe to use, so nothing was done: the daemon is busy' })
  assert.deepEqual(refused.result.steps.map((step) => [step.do, step.ok]), [['read', false]])
  assert.equal(stuck.commands.some(([name]) => name === 'snapshot' || name === 'click'), false)

  // A block that cannot be set: the browser is closed, so the next call starts over with a new one.
  const unblocked = guardedBrowser({ network: { fail: 'that pattern is not one' } })
  const failed = await unblocked.run({ do: 'read' })
  assert.equal(failed.result.error!.message, 'The browser could not be made safe to use, so nothing was done: that pattern is not one')
  assert.deepEqual(unblocked.commands, [...SAFE, BLOCKS[0], ['close']])
  assert.deepEqual([failed.result.url, failed.result.title], [null, null])
})

test("open refuses hobkin's own window before the engine is asked", async () => {
  const browser = guardedBrowser()
  const options = { refused: HOBKIN_WINDOW_PLACES }
  const own = ['http://127.0.0.1:5187', 'http://localhost:5187/work', 'http://[::1]:5187/', 'http://127.1:5187/', 'http://0.0.0.0:5187/', 'http://app.localhost:5187/', 'http://localhost:4848/']

  for (const url of own) {
    assert.throws(() => browserSteps({ do: 'open', url }, HOBKIN_WINDOW_PLACES), { message: OWN_WINDOW_REFUSAL }, url)
    await assert.rejects(browser.run({ do: 'open', url }, options), { message: "That address is hobkin's own window; an agent's browser does not open it." })
    await assert.rejects(browser.run({ steps: [{ do: 'read' }, { do: 'open', url }] }, options), { message: `steps[1]: ${OWN_WINDOW_REFUSAL}` })
  }
  assert.equal(browser.calls.length, 0)

  // Another port of this computer is a page like any other, which is what an agent tests.
  assert.equal(browserSteps({ do: 'open', url: 'http://127.0.0.1:3000' }, HOBKIN_WINDOW_PLACES).length, 1)
  assert.equal(browserSteps({ do: 'open', url: 'http://127.0.0.1:5187' }).length, 1, 'with no list nothing is refused')
})

test("a browser that a page sent to hobkin's own window is taken off it: the step fails, the chain stops, and nothing read is kept", async () => {
  // The click opens the window's address, as a link with a new tab or a script would.
  let clicked = false
  const answers: Answers = {
    click: () => {
      clicked = true
      return {}
    },
    get: (command) => (command[1] === 'title' ? { title: 'hobkin' } : { url: clicked ? OWN_WINDOW : PAGE.url }),
  }
  const browser = guardedBrowser(answers)

  const { result, text } = await browser.run({
    steps: [{ do: 'read' }, { do: 'click', on: 'e2' }, { do: 'read', what: 'text' }, { do: 'fill', on: 'e6', text: 'typed into the window' }],
  })

  const words = "That address is hobkin's own window; an agent's browser does not open it. A page sent the browser there, so it was moved to a blank page and nothing read in this call is given."
  assert.equal(result.ok, false)
  assert.deepEqual(result.error, { step: 1, do: 'click', message: words })
  // What the first step read came before, and still it is not given: there is no telling since when the page was there.
  assert.deepEqual(result.steps.map((step) => Object.keys(step).join()), ['do,ok,ms', 'do,ok,ms'])
  assert.deepEqual(result.steps.map((step) => step.ok), [true, false])
  assert.equal(result.elements, undefined)
  assert.deepEqual([result.url, result.title], ['about:blank', null])
  assert.equal(text, `click failed: ${words}\nStopped at step 2 of 4; the 2 steps after it did not run.`)

  const after = browser.commands.slice(browser.commands.findIndex(([name]) => name === 'click') + 1)
  assert.deepEqual(after, [...WHERE, ['open', '--', 'about:blank']], 'it was moved away, and no later step ran')
})

test('every command on the page runs behind a guard, in one batch, and is not run on a refused place', async () => {
  const browser = guardedBrowser()
  await browser.run({ steps: [{ do: 'click', on: 'About' }, { do: 'fill', on: 'e6', text: 'x' }, { do: 'scroll' }, { do: 'console' }, { do: 'back' }] })

  // Each batch that holds a page command starts with the guard; the ones that only ask or move do not.
  const batches = browser.calls.filter(({ args }) => args[3] === 'batch').map(({ options }) => JSON.parse(options.input!) as string[][])
  const aboutThePage = (name = '') => !['stream', 'network', 'get', 'tab', 'open', 'close'].includes(name)
  for (const [first, ...rest] of batches) {
    if (!rest.some((command) => aboutThePage(command[0])) && !aboutThePage(first?.[0])) continue
    assert.deepEqual(first, GUARD, `a page command without its guard: ${JSON.stringify(rest)}`)
  }
  assert.equal(browser.calls.some(({ args }) => args[3] !== 'batch'), false, 'no command runs alone')
  const guarded = batches.filter((batch) => isGuard(batch[0] ?? [])).map((batch) => batch[1]![0])
  assert.deepEqual(guarded, ['snapshot', 'click', 'fill', 'eval', 'scroll', 'console', 'console'])

  // A tab the page opened on a timer has become the one the engine acts on: the guard fails, and the click never runs.
  let onOwnWindow = false
  const moved = guardedBrowser({
    snapshot: () => {
      onOwnWindow = true
      return { snapshot: '- button "Approve" [ref=e1]' }
    },
    eval: (command) => (isGuard(command) && onOwnWindow ? { fail: 'Evaluation error: Error: hobkin-refused-place\n    at <anonymous>:5:60' } : { result: true }),
  })
  const { result } = await moved.run({ steps: [{ do: 'click', on: 'Approve' }, { do: 'read' }] })

  assert.deepEqual([result.ok, result.error!.step, result.error!.do], [false, 0, 'click'])
  assert.match(result.error!.message, /^That address is hobkin's own window; an agent's browser does not open it\./)
  assert.equal(moved.commands.some(([name]) => name === 'click'), false, 'the button was never pressed')
  assert.deepEqual(moved.commands.at(-1), ['open', '--', 'about:blank'])
  assert.deepEqual(result.steps, [{ do: 'click', ok: false, ms: result.steps[0]!.ms }])
})

test("a call that finds the browser already on hobkin's own window does nothing on it, and an open that is redirected there is undone", async () => {
  // A page opened it in a new tab between two calls.
  const moved = guardedBrowser({ get: () => ({ url: 'http://localhost:5187/work?token=1' }) })
  const refused = await moved.run({ steps: [{ do: 'click', on: 'Approve' }, { do: 'read' }] })
  assert.deepEqual([refused.result.error!.step, refused.result.error!.do], [0, 'click'])
  assert.match(refused.result.error!.message, /^That address is hobkin's own window; an agent's browser does not open it\. A page sent the browser there/)
  assert.deepEqual(moved.commands.slice(-1), [['open', '--', 'about:blank']])
  assert.equal(moved.commands.some(([name]) => name === 'snapshot' || name === 'click'), false, 'nothing was read or pressed there')

  // The address asked for is another, and the server answers by sending the browser to the window.
  const redirected = guardedBrowser({ open: (command) => (command[2] === 'about:blank' ? { url: 'about:blank', title: '' } : { url: OWN_WINDOW, title: 'hobkin' }) })
  const opened = await redirected.run({ steps: [{ do: 'open', url: 'http://example.invalid/go' }, { do: 'read' }] })
  assert.deepEqual([opened.result.ok, opened.result.error!.step, opened.result.url], [false, 0, 'about:blank'])
  assert.deepEqual(redirected.commands.filter(([name]) => name === 'open'), [['open', '--', 'http://example.invalid/go'], ['open', '--', 'about:blank']])

  // A reading step is checked too: what it read on the window is dropped, not given.
  let wasRead = false
  const read = guardedBrowser({
    read: () => {
      wasRead = true
      return { content: '# Welcome to the window' }
    },
    get: (command) => (command[1] === 'title' ? { title: 'hobkin' } : { url: wasRead ? OWN_WINDOW : PAGE.url }),
  })
  const dropped = await read.run({ do: 'read', what: 'text' })
  assert.equal(dropped.result.ok, false)
  assert.equal(dropped.result.text, undefined)
  assert.doesNotMatch(dropped.text, /Welcome/)
})

test('a selector that is only digits is refused: the engine would take it for a time to sleep', () => {
  for (const on of ['css:5000', 'css: 12 ', 'css:0']) {
    assert.throws(() => browserSteps({ do: 'wait', on }), /^Error: `on` has css: and only digits, which is a number and not a selector$/, on)
    assert.throws(() => browserSteps({ do: 'click', on }), /only digits/, on)
  }
  assert.throws(() => browserSteps({ do: 'scroll', to: 'css:99' }), /`to` has css: and only digits/)
  assert.equal(browserSteps({ do: 'wait', on: 'css:#a5000' }).length, 1)
  assert.equal(browserSteps({ do: 'click', on: '5000' }).length, 1, 'words that are digits name an element by what it says')
})

test('what a page says is cut to size: each name, value and address, a value from eval, and the whole of a chain', async () => {
  const long = (letter: string, length: number) => letter.repeat(length)
  const snapshot = [
    `- link ${JSON.stringify(long('n', 700))} [ref=e1, url=http://x.invalid/${long('u', 3000)}]`,
    `- textbox "Short" [ref=e2]: ${long('v', 900)}`,
    '- button "Fine" [ref=e3]',
  ].join('\n')

  const [link, field, button] = snapshotElements(snapshot)
  assert.equal(link!.name, `${long('n', LIMITS.elementName)}…`)
  assert.equal(link!.href, `http://x.invalid/${long('u', LIMITS.elementAddress - 17)}…`)
  assert.equal(field!.value, `${long('v', LIMITS.elementValue)}…`)
  assert.deepEqual(button, { ref: 'e3', role: 'button', name: 'Fine' })

  const read = await guardedBrowser({ snapshot: { snapshot } }).run({ do: 'read' })
  assert.equal(read.result.truncated, true, 'and the result says so')
  assert.equal((await guardedBrowser().run({ do: 'read' })).result.truncated, undefined)

  // A value too large to hand on is replaced by a line a script can still parse and read.
  const huge = await guardedBrowser({ eval: { result: { rows: long('y', LIMITS.keptText) } } }).run({ do: 'eval', code: 'rows()' })
  assert.equal(huge.result.value, `[cut: the value was ${LIMITS.keptText + 11} characters of JSON, more than the ${LIMITS.keptText} that are kept. Return less from the page.]`)
  assert.equal(huge.result.truncated, true)
  const small = await guardedBrowser({ eval: { result: { rows: long('y', 1000) } } }).run({ do: 'eval', code: 'rows()' })
  assert.deepEqual([(small.result.value as { rows: string }).rows.length, small.result.truncated], [1000, undefined])

  // A chain: each read is within its own limit, and together they pass the limit of a whole result. The last steps win.
  const page = guardedBrowser({ read: { content: long('t', 150_000) } })
  const chain = await page.run({ steps: [{ do: 'read', what: 'text' }, { do: 'read', what: 'text' }, { do: 'read', what: 'text' }, { do: 'read', what: 'text' }] })
  assert.equal(chain.result.ok, true)
  assert.deepEqual(chain.result.steps.map((step) => step.text?.length ?? null), [null, null, 150_000, 150_000])
  assert.deepEqual(chain.result.steps.map((step) => step.truncated ?? false), [true, true, false, false])
  assert.equal(chain.result.text!.length, 150_000)
  assert.equal(chain.result.truncated, true)
  assert.ok(JSON.stringify(chain.result).length < LIMITS.keptResult + 2000)
})

test('the engine is given a short list of what the host has in its environment, and none of its secrets', () => {
  const before = { ...process.env }
  Object.assign(process.env, {
    HOME: '/Users/someone',
    LANG: 'en_CA.UTF-8',
    LC_ALL: 'en_CA.UTF-8',
    ANTHROPIC_API_KEY: 'sk-secret',
    GITHUB_TOKEN: 'ghp-secret',
    HTTPS_PROXY: 'http://proxy.invalid:8080',
    NODE_OPTIONS: '--inspect',
    AGENT_BROWSER_PROFILE: 'Default',
    AGENT_BROWSER_CDP: '9222',
  })
  try {
    const env = engineEnv({ AGENT_BROWSER_EXECUTABLE_PATH: '/chrome' })
    const allowed = ['HOME', 'PATH', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', '__CF_USER_TEXT_ENCODING', 'AGENT_BROWSER_NO_VERSION_CHECK', 'AGENT_BROWSER_EXECUTABLE_PATH']
    for (const name of Object.keys(env)) assert.ok(allowed.includes(name), `${name} is not handed on`)
    assert.deepEqual([env.HOME, env.LANG, env.LC_ALL, env.PATH], ['/Users/someone', 'en_CA.UTF-8', 'en_CA.UTF-8', process.env.PATH])
    assert.deepEqual([env.AGENT_BROWSER_NO_VERSION_CHECK, env.AGENT_BROWSER_EXECUTABLE_PATH], ['1', '/chrome'])
    assert.doesNotMatch(JSON.stringify(env), /secret|proxy|inspect|Default|9222/)
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in before)) delete process.env[name]
    Object.assign(process.env, before)
  }
})

test('a tab that a page opened is followed in the browser\'s own tab and closed, so nothing is read or done in one that has no blocks', async () => {
  // The click opens a link in a new tab, and the engine moves to it.
  let opened: { tabId: string; url: string }[] = []
  const tabs = (command: string[]) => {
    if (command[1] === 'close') {
      opened = opened.filter(({ tabId }) => tabId !== command[2])
      return { closed: true }
    }
    const own = { tabId: 't1', url: PAGE.url, title: PAGE.title }
    return command[1] === 'list' ? { tabs: [own, ...opened] } : own
  }
  const browser = guardedBrowser({
    click: () => {
      opened = [{ tabId: 't2', url: 'http://localhost:3000/terms' }]
      return {}
    },
    tab: tabs,
    open: (command) => ({ url: command[2], title: 'Terms' }),
  })

  const { result, text } = await browser.run({ steps: [{ do: 'click', on: 'e2' }, { do: 'read', what: 'text' }] })

  assert.equal(result.ok, true, result.error?.message ?? '')
  const afterClick = browser.commands.slice(browser.commands.findIndex(([name]) => name === 'click') + 1, browser.commands.findIndex(([name]) => name === 'read'))
  // Closed, the browser brought back to its own tab, and the page opened there.
  assert.deepEqual(afterClick.filter(([name]) => name === 'open' || name === 'tab').slice(1), [['tab', 'close', 't2'], ['tab', 't1'], ['open', '--', 'http://localhost:3000/terms']])
  assert.deepEqual(opened, [], 'the tab the page opened is gone')
  assert.equal(text.split('\n')[0], 'click → e2')

  // A tab was in front when a step read the page: what it read may be that tab's, so it is not given.
  const reading = guardedBrowser({
    read: () => {
      opened = [{ tabId: 't4', url: 'http://localhost:3000/terms' }]
      return { content: 'what a tab with no blocks showed' }
    },
    tab: tabs,
    open: (command) => ({ url: command[2], title: 'Terms' }),
  })
  const unread = await reading.run({ do: 'read', what: 'text' })
  assert.deepEqual([unread.result.ok, unread.result.text, unread.result.url], [true, undefined, 'http://localhost:3000/terms'])
  assert.equal(unread.text.split('\n')[0], 'read → not given: a tab the page opened was in front and was closed. Read again.')
  assert.doesNotMatch(unread.text, /no blocks showed/)

  // A tab opened on hobkin's own window is closed and not followed: the step fails.
  const hostile = guardedBrowser({
    click: () => {
      opened = [{ tabId: 't3', url: 'http://localhost:5187/work' }]
      return {}
    },
    tab: tabs,
  })
  const refused = await hostile.run({ steps: [{ do: 'click', on: 'e2' }, { do: 'click', on: 'Approve' }] })
  assert.deepEqual([refused.result.ok, refused.result.error!.step], [false, 0])
  assert.match(refused.result.error!.message, /^That address is hobkin's own window/)
  assert.deepEqual(opened, [])
  assert.equal(hostile.commands.filter(([name]) => name === 'click').length, 1, 'the second click never ran')
  assert.equal(hostile.commands.some(([name, , address]) => name === 'open' && address?.includes('5187')), false, 'and the window was not opened in its place')
})
