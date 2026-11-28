import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserSteps, LIMITS, runBrowser, snapshotElements, VERBS, type Exec, type RunOptions } from '../host/engine.ts'
import { fakeEngine, PAGE, SNAPSHOT, temporaryFolder } from './support.ts'

type Answers = Parameters<typeof fakeEngine>[0]

/** The engine on a fake agent-browser, in the session `agent-1`. */
function fakeBrowser(answers: Answers = {}, shotsDir = '/nowhere/shots') {
  const engine = fakeEngine(answers)
  const run = (input: unknown, more: Partial<RunOptions> = {}) => runBrowser(input, { binary: '/bin/agent-browser', session: 'agent-1', exec: engine.exec, shotsDir, ...more })
  return { ...engine, run }
}

/** What every call also runs around its steps: closing the control port, and asking where the browser is. */
const AROUND_STEPS = ['stream', 'network', 'get']
const stepCommands = (commands: string[][]): string[][] => commands.filter(([name = '']) => !AROUND_STEPS.includes(name))

/** The commands a step ran on the page. What is run around every step is told in host-safety.test.ts. */
async function commandsOf(step: unknown, answers?: Answers, shotsDir?: string): Promise<string[][]> {
  const browser = fakeBrowser(answers, shotsDir)
  const { result } = await browser.run(step)
  assert.equal(result.ok, true, result.error?.message ?? '')
  return stepCommands(browser.commands)
}

test('input that could not run is refused in plain words, before anything runs', async () => {
  const refused: [unknown, RegExp][] = [
    [{}, /`do` is one of open, read/],
    [{ do: 'fly' }, /`do` is one of .*, not "fly"/],
    [{ do: 'fill', on: 'Email' }, /^Error: fill needs `on` and `text`$/],
    [{ do: 'open' }, /^Error: open needs `url`$/],
    [{ do: 'select', on: 'Color' }, /^Error: select needs `on` and `option`$/],
    [{ do: 'click', on: 'Save', url: 'http://x' }, /^Error: click does not use `url`$/],
    [{ do: 'press', key: 'Enter', on: 'Email' }, /^Error: press does not use `on`$/],
    [{ do: 'click', on: 'Save', speed: 2 }, /unknown field `speed`/],
    [{ do: 'click', on: '  ' }, /`on` is empty/],
    [{ do: 'click', on: 'css:' }, /css: with no selector/],
    [{ do: 'click', on: 'css:--json' }, /cannot start with -/],
    [{ do: 'click', on: 12 }, /`on` is text/],
    [{ do: 'read', what: 'html' }, /`what` is one of elements, text, all/],
    [{ do: 'read', within: '--json' }, /`within` is a CSS selector/],
    [{ do: 'scroll', by: 100, to: 'top' }, /`by` or `to`, not both/],
    [{ do: 'scroll', by: 1.5 }, /`by` is a whole number/],
    [{ do: 'scroll', by: 0 }, /not 0/],
    [{ do: 'wait' }, /exactly one of `text`, `on`, `url` or `ms`/],
    [{ do: 'wait', text: 'Hi', ms: 100 }, /exactly one of/],
    [{ do: 'wait', ms: 60_001 }, /`ms` is from 0 to 60000/],
    [{ do: 'screenshot', full: 'yes' }, /`full` is true or false/],
    [{ do: 'help', url: 'http://x' }, /help does not use `url`/],
    [{ steps: [] }, /at least one step/],
    [{ steps: 'open' }, /at least one step/],
    [{ do: 'open', url: 'http://x', steps: [{ do: 'read' }] }, /one step or `steps`, not both: `do` and `url`/],
    [{ steps: [{ do: 'read' }, { do: 'click' }] }, /^Error: steps\[1\]: click needs `on`$/],
    [{ steps: [{ steps: [{ do: 'read' }] }] }, /steps\[0\]: a step cannot hold `steps`/],
    [{ steps: [{ do: 'read' }, { do: 'help' }] }, /`help` is asked for on its own/],
    [{ steps: Array.from({ length: LIMITS.steps + 1 }, () => ({ do: 'read' })) }, /at most 50 steps/],
    ['open', /takes one step/],
  ]
  const browser = fakeBrowser()
  for (const [input, words] of refused) {
    assert.throws(() => browserSteps(input), words, JSON.stringify(input))
    await assert.rejects(browser.run(input), words)
  }
  await assert.rejects(browser.run({ do: 'read' }, { binary: '' }), /agent-browser binary/)
  await assert.rejects(browser.run({ do: 'read' }, { session: 'a b; rm' }), /session name/)
  assert.equal(browser.calls.length, 0)

  // A field left undefined is a field not given, and an empty `text` is how a field is cleared.
  assert.equal(browserSteps({ do: 'read', within: undefined, steps: undefined }).length, 1)
  assert.equal(browserSteps({ do: 'fill', on: 'Email', text: '' }).length, 1)
  assert.equal(VERBS.length, 20)
})

test('open takes only http and https addresses, with a host and no sign-in, and asks the engine nothing otherwise', async () => {
  const refused: [string, RegExp][] = [
    ['file:///etc/passwd', /only http and https addresses/],
    ['javascript:alert(1)', /only http and https addresses/],
    ['data:text/html,<h1>hi</h1>', /only http and https addresses/],
    ['about:blank', /only http and https addresses/],
    ['chrome://settings', /only http and https addresses/],
    // Without a scheme the host's name reads as one.
    ['localhost:3000', /only http and https addresses, written in full, such as http:\/\/localhost:3000/],
    ['not an address', /is not a web address/],
    ['http://', /is not a web address/],
    ['https://user:secret@example.invalid/', /does not take an address with a sign-in/],
    ['https://user@example.invalid/', /does not take an address with a sign-in/],
    ['--help', /is not a web address/],
  ]
  const browser = fakeBrowser()
  for (const [url, words] of refused) {
    await assert.rejects(browser.run({ do: 'open', url }), words, url)
    // A chain is refused whole, before its first step.
    await assert.rejects(browser.run({ steps: [{ do: 'read' }, { do: 'open', url }] }), /^Error: steps\[1\]: /, url)
  }
  assert.equal(browser.calls.length, 0)
  for (const url of ['http://localhost:3000', 'https://example.invalid/a?b=c#d', 'http://127.0.0.1:8080/', 'http://[::1]:3000/']) {
    assert.equal((await fakeBrowser().run({ do: 'open', url })).result.ok, true, url)
  }
})

test('help answers the guide and touches no browser', async () => {
  const browser = fakeBrowser()
  const { result, text } = await browser.run({ do: 'help' }, { guide: '# The guide\n\nRead me.' })
  assert.equal(text, '# The guide\n\nRead me.')
  assert.deepEqual(result, { ok: true, url: null, title: null, steps: [{ do: 'help', ok: true, ms: 0, text }], text })
  assert.deepEqual((await browser.run({ steps: [{ do: 'help' }] }, { guide: 'G' })).text, 'G')
  // Not even a binary or a session is needed for it.
  assert.equal((await runBrowser({ do: 'help' }, { binary: '', session: '', shotsDir: '', guide: 'G' })).text, 'G')
  assert.equal(browser.calls.length, 0)
})

test('each verb becomes agent-browser commands, with literal text after --', async (t) => {
  const fresh = [['console', '--clear'], ['errors', '--clear']]
  const code = (text: string) => Buffer.from(text).toString('base64')
  const mapped: [unknown, string[][]][] = [
    [{ do: 'open', url: 'http://localhost:3000' }, [...fresh, ['open', '--', 'http://localhost:3000']]],
    [{ do: 'read' }, [['snapshot', '-i', '-u']]],
    [{ do: 'read', what: 'elements', within: '#main' }, [['snapshot', '-i', '-u', '-s', '#main']]],
    [{ do: 'read', what: 'all', within: 'form' }, [['snapshot', '-u', '-s', 'form']]],
    [{ do: 'read', what: 'text' }, [['read']]],
    [{ do: 'click', on: 'e2' }, [['click', '@e2']]],
    [{ do: 'fill', on: '@e6', text: '--json' }, [['fill', '@e6', '--', '--json']]],
    [{ do: 'fill', on: 'e6', text: '' }, [['fill', '@e6', '--', '']]],
    [{ do: 'press', key: 'Control+a' }, [['press', '--', 'Control+a']]],
    [{ do: 'select', on: 'css:#color', option: 'Green' }, [['select', '#color', '--', 'Green']]],
    [{ do: 'hover', on: 'css: nav a.first' }, [['hover', 'nav a.first']]],
    [{ do: 'scroll' }, [['eval', '-b', code('window.innerHeight')], ['scroll', 'down', '577']]],
    [{ do: 'scroll', by: 300 }, [['scroll', 'down', '300']]],
    [{ do: 'scroll', by: -120 }, [['scroll', 'up', '120']]],
    [{ do: 'scroll', to: 'top' }, [['scroll', 'up', '10000000']]],
    [{ do: 'scroll', to: 'bottom' }, [['scroll', 'down', '10000000']]],
    [{ do: 'scroll', to: 'e12' }, [['scrollintoview', '@e12']]],
    [{ do: 'scroll', to: 'About' }, [['snapshot', '-i'], ['scrollintoview', '@e2']]],
    [{ do: 'wait', text: 'Dashboard' }, [['wait', '--text', 'Dashboard']]],
    [{ do: 'wait', text: '--help' }, [['wait', '--fn', 'document.body.innerText.includes("--help")']]],
    [{ do: 'wait', url: '**/dashboard' }, [['wait', '--url', '**/dashboard']]],
    // A plain delay is kept in the host, so a cancelled one holds nothing up.
    [{ do: 'wait', ms: 20 }, []],
    [{ do: 'wait', on: 'e2' }, [['wait', '@e2']]],
    [{ do: 'wait', on: 'css:#late' }, [['wait', '#late']]],
    [{ do: 'wait', on: 'About' }, [['snapshot', '-i']]],
    [{ do: 'back' }, [...fresh, ['back']]],
    [{ do: 'forward' }, [...fresh, ['forward']]],
    [{ do: 'reload' }, [...fresh, ['reload']]],
    [{ do: 'eval', code: 'document.title' }, [['eval', '-b', code('document.title')]]],
    [{ do: 'console' }, [['console'], ['errors']]],
    [{ do: 'close' }, [['close']]],
  ]
  for (const [step, commands] of mapped) assert.deepEqual(await commandsOf(step), commands, JSON.stringify(step))

  const shots = temporaryFolder(t)
  const shot = await commandsOf({ do: 'screenshot', full: true }, {}, shots)
  assert.deepEqual(shot[0]!.slice(0, 3), ['screenshot', '--full', '--'])
  assert.ok(shot[0]![3]!.startsWith(`${shots}/agent-1-`) && shot[0]![3]!.endsWith('.png'))
  assert.deepEqual((await commandsOf({ do: 'screenshot' }, {}, shots))[0]!.slice(0, 2), ['screenshot', '--'])
  assert.match((await commandsOf({ do: 'read', what: 'text', within: '#out' }, { eval: { result: 'Saved' } }))[0]![2]!, /^[A-Za-z0-9+/=]+$/)

  // Only the caller's env configures agent-browser: a profile or a browser to attach to that the shell happens to
  // carry must not reach it. Every command goes to the caller's session, as arguments and never as a shell line.
  const browser = fakeBrowser()
  const shell = { AGENT_BROWSER_PROFILE: 'Default', AGENT_BROWSER_CDP: '9222', AGENT_BROWSER_SESSION: 'someone-else' }
  Object.assign(process.env, shell)
  try {
    await browser.run({ do: 'click', on: 'e2' }, { env: { AGENT_BROWSER_EXECUTABLE_PATH: '/chrome' } })
  } finally {
    for (const name of Object.keys(shell)) delete process.env[name]
  }
  const { binary, args, options } = browser.calls.find((call) => call.args.includes('click'))!
  assert.equal(binary, '/bin/agent-browser')
  assert.deepEqual(args, ['--session', 'agent-1', '--json', 'click', '@e2'])
  assert.deepEqual(Object.keys(options.env!).filter((name) => name.startsWith('AGENT_BROWSER_')).sort(), ['AGENT_BROWSER_EXECUTABLE_PATH', 'AGENT_BROWSER_NO_VERSION_CHECK'])
  assert.deepEqual([options.env!.AGENT_BROWSER_EXECUTABLE_PATH, options.env!.AGENT_BROWSER_NO_VERSION_CHECK, options.env!.PATH], ['/chrome', '1', process.env.PATH])
})

test('a target is a ref, a css selector, or words that match exactly one element', async () => {
  // Words: the exact name wins over names that only contain it, whatever the case or spacing.
  assert.deepEqual(await commandsOf({ do: 'click', on: 'About' }), [['snapshot', '-i'], ['click', '@e2']])
  assert.deepEqual(await commandsOf({ do: 'click', on: '  i  AGREE ' }), [['snapshot', '-i'], ['click', '@e11']])
  assert.deepEqual(await commandsOf({ do: 'hover', on: 'sign in' }), [['snapshot', '-i'], ['hover', '@e5']])
  // fill looks only at fields and select only at lists, so a button of the same name is not in the way.
  assert.deepEqual(await commandsOf({ do: 'fill', on: 'Search', text: 'tea' }), [['snapshot', '-i'], ['fill', '@e7', '--', 'tea']])
  assert.deepEqual(await commandsOf({ do: 'select', on: 'Color', option: 'Green' }), [['snapshot', '-i'], ['select', '@e9', '--', 'Green']])

  const several = fakeBrowser()
  const twice = await several.run({ do: 'click', on: 'More' })
  assert.equal(twice.result.ok, false)
  assert.deepEqual(twice.result.error, {
    step: 0,
    do: 'click',
    message: '2 elements are named "More". Use the ref of the one you mean:\ne3 link "More"\ne4 link "More"',
    candidates: [{ ref: 'e3', role: 'link', name: 'More' }, { ref: 'e4', role: 'link', name: 'More' }],
  })
  assert.equal(several.commands.some((command) => command[0] === 'click'), false)
  assert.match((await several.run({ do: 'click', on: 'Search' })).result.error!.message, /e7 textbox "Search"\ne8 button "Search"/)

  const none = await several.run({ do: 'click', on: 'Sign up in seconds' })
  assert.match(none.result.error!.message, /^No element is named "Sign up in seconds". The page has:\ne5 link "Sign in with a code"\ne1 heading "Welcome"\n/)
  assert.match(none.result.error!.message, /… and 7 more; read the page to see them all$/)
  assert.equal(none.result.error!.candidates!.length, LIMITS.candidates)
  assert.match(none.text, /^click failed: No element is named/)

  const field = await several.run({ do: 'fill', on: 'Save', text: 'x' })
  assert.equal(field.result.error!.message, 'No field is named "Save". The page has:\ne6 textbox "Email"\ne7 textbox "Search"\ne9 combobox "Color"')
  const empty = await fakeBrowser({ snapshot: { snapshot: '' } }).run({ do: 'select', on: 'Color', option: 'Red' })
  assert.equal(empty.result.error!.message, 'No list is named "Color". The page has no lists with a name.')
  assert.deepEqual(empty.result.error!.candidates, [])
})

test('waiting for a named element asks again until it shows, and gives up in time', async () => {
  let asked = 0
  const late = fakeBrowser({ snapshot: () => ({ snapshot: (asked += 1) < 3 ? '- link "About" [ref=e2]' : SNAPSHOT }) })
  const shown = await late.run({ do: 'wait', on: 'Save' })
  assert.equal(shown.result.ok, true)
  assert.equal(shown.result.steps[0]!.ref, 'e12')
  assert.equal(asked, 3)
  assert.match(shown.text, /^wait → e12 button "Save"/)

  const never = await fakeBrowser().run({ do: 'wait', on: 'Dashboard' }, { env: { AGENT_BROWSER_DEFAULT_TIMEOUT: '300' } })
  assert.match(never.result.error!.message, /^No element is named "Dashboard" after 300ms\./)
  const two = await fakeBrowser().run({ do: 'wait', on: 'More' })
  assert.match(two.result.error!.message, /^2 elements are named "More"/)

  const timedOut = await fakeBrowser({ wait: { fail: 'Wait timed out after 25000ms' } }).run({ do: 'wait', text: 'Done' })
  assert.equal(timedOut.result.error!.message, 'Wait timed out after 25000ms: text "Done" never showed.')
})

test('a chain stops at its first failing step and keeps what ran before it', async () => {
  const browser = fakeBrowser({ click: { fail: 'Element not found: #go' } })
  const { result, text } = await browser.run({
    steps: [
      { do: 'open', url: 'http://localhost:3000' },
      { do: 'read', what: 'text' },
      { do: 'click', on: 'css:#go' },
      { do: 'fill', on: 'e6', text: 'never' },
      { do: 'close' },
    ],
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.steps.map((step) => [step.do, step.ok]), [['open', true], ['read', true], ['click', false]])
  assert.equal(result.steps[1]!.text, '# Welcome\n\nHello.')
  assert.deepEqual(result.error, { step: 2, do: 'click', message: 'Element not found: #go' })
  assert.deepEqual([result.url, result.title], [PAGE.url, PAGE.title])
  // The failed step is the last one, so nothing of an earlier step is lifted to the top.
  assert.equal(result.text, undefined)
  assert.equal(browser.commands.some((command) => command[0] === 'fill' || command[0] === 'close'), false)
  assert.equal(text, [
    'open → "Home" http://localhost:3000/',
    'read → 17 characters of text',
    '# Welcome',
    '',
    'Hello.',
    'click failed: Element not found: #go',
    'Stopped at step 3 of 5; the 2 steps after it did not run.',
    'now at "Home" http://localhost:3000/',
  ].join('\n'))

  // A batch that fails part way fails its step in the failing command's words.
  const refused = await fakeBrowser({ open: { fail: 'Navigation failed: net::ERR_CONNECTION_REFUSED' } }).run({ do: 'open', url: 'http://localhost:1' })
  assert.equal(refused.result.error!.message, 'Navigation failed: net::ERR_CONNECTION_REFUSED')
  assert.equal(refused.text.split('\n')[0], 'open failed: Navigation failed: net::ERR_CONNECTION_REFUSED')

  const stale = await fakeBrowser({ click: { fail: 'Unknown ref: e99' } }).run({ do: 'click', on: 'e99' })
  assert.equal(stale.result.error!.message, 'Unknown ref: e99. Refs change when a new page loads: read again and use the new ref.')

  // A select that finds no such option is told which options there are.
  const noSuchOption = {
    fail: 'option_not_found: No option matched ["Pink"]',
    data: { options: [{ label: 'Red', value: 'r' }, { label: 'Blue', value: 'b' }] },
  }
  const option = await fakeBrowser({ select: noSuchOption }).run({ do: 'select', on: 'e9', option: 'Pink' })
  assert.equal(option.result.error!.message, 'option_not_found: No option matched ["Pink"]: Red, Blue.')
})

test('the result has one shape, and the last step lifts what it found to the top', async (t) => {
  const one = await fakeBrowser().run({ do: 'open', url: 'http://localhost:3000' })
  assert.deepEqual(Object.keys(one.result), ['ok', 'url', 'title', 'steps'])
  assert.deepEqual([one.result.ok, one.result.url, one.result.title], [true, PAGE.url, PAGE.title])
  assert.deepEqual(Object.keys(one.result.steps[0]!), ['do', 'ok', 'ms'])
  assert.equal(Number.isInteger(one.result.steps[0]!.ms), true)
  assert.equal(one.text, 'open → "Home" http://localhost:3000/')

  const { result } = await fakeBrowser().run({ steps: [{ do: 'eval', code: '1' }, { do: 'click', on: 'About' }, { do: 'read' }] })
  assert.deepEqual(result.steps.map((step) => Object.keys(step).join()), ['do,ok,ms,value', 'do,ok,ms,ref', 'do,ok,ms,elements'])
  assert.equal(result.value, undefined)
  assert.equal(result.elements, result.steps[2]!.elements)
  assert.deepEqual(result.elements![1], { ref: 'e2', role: 'link', name: 'About', href: 'http://localhost:3000/about' })
  assert.deepEqual(result.elements![5], { ref: 'e6', role: 'textbox', name: 'Email', value: 'a@b.c' })
  assert.deepEqual(result.elements![10], { ref: 'e11', role: 'checkbox', name: 'I agree', checked: false })
  assert.deepEqual(result.elements![11], { ref: 'e12', role: 'button', name: 'Save', disabled: true })

  const seen = await fakeBrowser().run({ do: 'console' })
  assert.deepEqual(seen.result.messages, [{ type: 'log', text: 'hi' }])
  assert.deepEqual(seen.result.errors, [{ text: 'Error: boom' }])
  assert.equal(seen.text, 'console → 1 message, 1 error\nlog: hi\npage error: Error: boom\nnow at "Home" http://localhost:3000/')

  const shot = await fakeBrowser({}, temporaryFolder(t)).run({ do: 'screenshot' })
  assert.equal(shot.result.path, shot.result.steps[0]!.path)
  assert.equal(shot.text.split('\n')[0], `screenshot → ${shot.result.path}`)

  assert.equal((await fakeBrowser({ eval: { result: null, unserializable: 'undefined' } }).run({ do: 'eval', code: 'undefined' })).result.value, null)
  const tree = await fakeBrowser().run({ do: 'read', what: 'all' })
  assert.equal(tree.result.text, SNAPSHOT)
  assert.equal(tree.result.elements!.length, 12)

  // After close there is no browser to ask, and asking would start one.
  const closing = fakeBrowser()
  const closed = await closing.run({ steps: [{ do: 'read' }, { do: 'close' }] })
  assert.deepEqual([closed.result.ok, closed.result.url, closed.result.title], [true, null, null])
  assert.deepEqual(closing.commands.at(-1), ['close'])
  assert.equal(closed.text.split('\n').at(-1), 'close → closed')

  const lost = await fakeBrowser({ get: { fail: 'no page' } }).run({ do: 'read', what: 'text' })
  assert.deepEqual([lost.result.ok, lost.result.url, lost.result.title], [true, null, null])
})

test('snapshot lines are read whatever their names, addresses and values hold', () => {
  const elements = snapshotElements([
    '- button "Say \\"hi\\" [now], ok: yes" [ref=e39]',
    '- link "IPv6 [link]" [ref=e40, url=http://[::1]:9/x,y]',
    '- textbox "q" [ref=e42]: a]: b',
    '- button [ref=e43]',
    '- paragraph',
    '  - StaticText "Not an element: [ref=e99]"',
    '    - tab "Two" [selected, expanded=true, ref=e44]',
    '- checkbox "Some" [checked=mixed, ref=e45]',
    '- button "Icon" [ref=e46, hint="trash icon"]',
  ].join('\n'))
  assert.deepEqual(elements, [
    { ref: 'e39', role: 'button', name: 'Say "hi" [now], ok: yes' },
    { ref: 'e40', role: 'link', name: 'IPv6 [link]', href: 'http://[::1]:9/x,y' },
    { ref: 'e42', role: 'textbox', name: 'q', value: 'a]: b' },
    { ref: 'e43', role: 'button', name: '' },
    { ref: 'e44', role: 'tab', name: 'Two', selected: true, expanded: true },
    { ref: 'e45', role: 'checkbox', name: 'Some', checked: false },
    { ref: 'e46', role: 'button', name: 'Icon' },
  ])
  assert.deepEqual(snapshotElements(''), [])
  assert.deepEqual(snapshotElements(undefined), [])
})

test('the text is compact, and long pages are cut with a way to narrow them', async () => {
  const short = await fakeBrowser().run({ do: 'read' })
  assert.equal(short.text, [
    'read → 12 elements',
    'e1 heading "Welcome"',
    'e2 link "About"',
    'e3 link "More"',
    'e4 link "More"',
    'e5 link "Sign in with a code"',
    'e6 textbox "Email" = "a@b.c"',
    'e7 textbox "Search"',
    'e8 button "Search"',
    'e9 combobox "Color" = "Red"',
    'e10 option "Red" [selected]',
    'e11 checkbox "I agree" [not checked]',
    'e12 button "Save" [disabled]',
    'now at "Home" http://localhost:3000/',
  ].join('\n'))

  const links = (count: number) => ({ snapshot: Array.from({ length: count }, (_, n) => `- link "Item ${n}" [ref=e${n + 1}]`).join('\n') })
  const many = await fakeBrowser({ snapshot: links(400) }).run({ do: 'read' })
  assert.equal(many.result.elements!.length, 400)
  assert.equal(many.result.truncated, undefined)
  const shown = many.text.split('\n')
  assert.equal(shown.length, 1 + LIMITS.shownElements + 2)
  assert.equal(shown[0], 'read → 400 elements')
  assert.equal(shown[LIMITS.shownElements + 1], '… 250 more elements. Narrow it with `within`, a CSS selector.')

  const huge = await fakeBrowser({ snapshot: links(LIMITS.keptElements + 5) }).run({ do: 'read' })
  assert.equal(huge.result.elements!.length, LIMITS.keptElements)
  assert.equal(huge.result.truncated, true)
  assert.match(huge.text, /… 1850 or more more elements\./)

  const long = await fakeBrowser({ read: { content: 'x'.repeat(LIMITS.shownText + 1000) } }).run({ do: 'read', what: 'text' })
  assert.equal(long.result.text!.length, LIMITS.shownText + 1000)
  assert.equal(long.text.split('\n')[1]!.length, LIMITS.shownText)
  assert.equal(long.text.split('\n')[2], '… the first 8000 of 9000 characters. Narrow it with `within`, a CSS selector.')
  const endless = await fakeBrowser({ read: { content: 'x'.repeat(LIMITS.keptText + 1) } }).run({ do: 'read', what: 'text' })
  assert.equal(endless.result.text!.length, LIMITS.keptText)
  assert.equal(endless.result.truncated, true)

  const value = await fakeBrowser({ eval: { result: { rows: 'y'.repeat(LIMITS.shownText * 2) } } }).run({ do: 'eval', code: 'rows()' })
  assert.equal((value.result.value as { rows: string }).rows.length, LIMITS.shownText * 2)
  assert.equal(value.text.split('\n')[1]!.length, LIMITS.shownText + 1)

  const noisy = Array.from({ length: LIMITS.keptMessages + 10 }, (_, n) => ({ type: 'log', text: n === 509 ? 'z'.repeat(5000) : `line ${n}` }))
  const chatter = await fakeBrowser({ console: { messages: noisy }, errors: { errors: [] } }).run({ do: 'console' })
  assert.equal(chatter.result.messages!.length, LIMITS.keptMessages)
  assert.equal(chatter.result.messages!.at(-1)!.text.length, LIMITS.messageText)
  assert.equal(chatter.result.truncated, true)
  const said = chatter.text.split('\n')
  assert.equal(said[0], 'console → 510 messages, 0 errors')
  assert.equal(said[1], '… 460 earlier ones left out')
  assert.equal(said.length, 1 + 1 + LIMITS.shownMessages + 1)
})

test('a cancelled call stops the command that is running and the rest of the chain', async () => {
  const stop = new AbortController()
  const browser = fakeBrowser({
    click: () => {
      stop.abort()
      return {}
    },
  })
  // The real process is killed by the signal; this one notices it when the next command starts.
  const chain = { steps: [{ do: 'read' }, { do: 'click', on: 'e2' }, { do: 'fill', on: 'e6', text: 'x' }, { do: 'read' }] }
  const { result, text } = await browser.run(chain, { signal: stop.signal })
  assert.equal(result.ok, false)
  assert.deepEqual(result.steps.map((step) => [step.do, step.ok]), [['read', true], ['click', true], ['fill', false]])
  assert.deepEqual(result.error, { step: 2, do: 'fill', message: 'Cancelled before it finished.' })
  assert.deepEqual([result.url, result.title], [null, null])
  assert.deepEqual(stepCommands(browser.commands).map((command) => command[0]), ['snapshot', 'click'])
  assert.match(text, /fill failed: Cancelled before it finished\.\nStopped at step 3 of 4; the step after it did not run\.$/)
  for (const call of browser.calls) assert.equal(call.options.signal, stop.signal)

  const before = fakeBrowser()
  const never = await before.run({ do: 'read' }, { signal: AbortSignal.abort() })
  assert.equal(never.result.error!.message, 'Cancelled before it finished.')
  assert.equal(before.calls.length, 0)

  // A wait for a named element sleeps between looks, and the signal ends that sleep too. So does a plain delay.
  for (const step of [{ do: 'wait', on: 'Dashboard' }, { do: 'wait', ms: 30_000 }]) {
    const waiting = new AbortController()
    setTimeout(() => waiting.abort(), 50)
    const started = Date.now()
    const cut = await fakeBrowser().run(step, { signal: waiting.signal })
    assert.equal(cut.result.error!.message, 'Cancelled before it finished.')
    assert.ok(Date.now() - started < 2000)
  }
})

test('an agent-browser that cannot run fails the step, not the call', async () => {
  const options = { binary: '/bin/agent-browser', session: 'agent-1', shotsDir: '/nowhere' }
  const broken: Exec = async () => {
    throw Object.assign(Error('spawn /bin/agent-browser ENOENT'), { code: 'ENOENT' })
  }
  const missing = await runBrowser({ do: 'read' }, { ...options, exec: broken })
  assert.equal(missing.result.error!.message, 'The browser could not run: spawn /bin/agent-browser ENOENT')
  assert.deepEqual([missing.result.ok, missing.result.url], [false, null])

  const crashed: Exec = async () => ({ stdout: 'not json', stderr: 'daemon crashed', code: 1 })
  const garbled = await runBrowser({ do: 'read' }, { ...options, exec: crashed })
  // It fails where every call starts: making the browser safe.
  assert.equal(garbled.result.error!.message, 'The browser could not be made safe to use, so nothing was done: agent-browser gave no answer: daemon crashed')

  const unknownCommand: Exec = async () => ({ stdout: '{"success":false,"error":"Unknown command: batch","type":"unknown_command"}', stderr: '', code: 1 })
  const usage = await runBrowser({ do: 'console' }, { ...options, exec: unknownCommand })
  assert.equal(usage.result.error!.message, 'The browser could not be made safe to use, so nothing was done: Unknown command: batch')

  // The real process: a binary that is not there is reported the same way, with nothing thrown.
  const real = await runBrowser({ do: 'read' }, { ...options, binary: '/nonexistent/agent-browser' })
  assert.match(real.result.error!.message, /^The browser could not run: .*ENOENT/)
})
