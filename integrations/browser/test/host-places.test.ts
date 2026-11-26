import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blockPatterns, HOBKIN_WINDOW_PLACES, isRefusedPlace, placeGuard, REFUSED_PLACE_MARK } from '../host/places.ts'

test("hobkin's own window and the engine's dashboard are refused, however this computer is spelled", () => {
  const refused = [
    'http://127.0.0.1:5187',
    'http://127.0.0.1:5187/work?x=1#top',
    'http://localhost:5187/',
    'http://LOCALHOST:5187/',
    'http://[::1]:5187/',
    'https://127.0.0.1:5187/',
    'ws://127.0.0.1:5187/socket',
    // Other ways to write this computer, which the address parser or the system folds into it.
    'http://127.1:5187/',
    'http://2130706433:5187/',
    'http://0x7f.0.0.1:5187/',
    'http://127.0.0.2:5187/',
    'http://0.0.0.0:5187/',
    'http://app.localhost:5187/',
    'http://localhost.:5187/',
    'http://[0:0:0:0:0:0:0:1]:5187/',
    'http://user@127.0.0.1:5187/',
    // The engine's dashboard.
    'http://127.0.0.1:4848/',
    'http://localhost:4848/api/sessions',
  ]
  for (const address of refused) assert.equal(isRefusedPlace(address, HOBKIN_WINDOW_PLACES), true, address)

  const taken = [
    'http://127.0.0.1:3000/',
    'http://localhost:5188/',
    'http://localhost/',
    'https://example.invalid:5187/',
    'http://5187.example.invalid/',
    'http://example.invalid/?next=http://127.0.0.1:5187/',
    'about:blank',
    'chrome-error://chromewebdata/',
    'not an address',
  ]
  for (const address of taken) assert.equal(isRefusedPlace(address, HOBKIN_WINDOW_PLACES), false, address)

  assert.equal(isRefusedPlace(null, HOBKIN_WINDOW_PLACES), false)
  assert.equal(isRefusedPlace('http://127.0.0.1:5187/', []), false, 'with no list nothing is refused')
})

test('a list can be made longer, and a place on another computer is matched by its own name', () => {
  const places = [...HOBKIN_WINDOW_PLACES, '127.0.0.1:40123', 'intranet.invalid:8080', 'plain.invalid:80']
  assert.equal(isRefusedPlace('http://localhost:40123/x', places), true)
  assert.equal(isRefusedPlace('http://intranet.invalid:8080/', places), true)
  assert.equal(isRefusedPlace('http://plain.invalid/', places), true, 'the port a scheme means')
  assert.equal(isRefusedPlace('http://other.invalid:8080/', places), false)
})

test('each place becomes request patterns for every spelling a block can be written with', () => {
  assert.deepEqual(blockPatterns(['127.0.0.1:5187', 'localhost:5187', '[::1]:5187']), [
    '**://127.0.0.1:5187/**',
    '**://localhost:5187/**',
    '**://[::1]:5187/**',
    '**://0.0.0.0:5187/**',
  ])
  assert.deepEqual(blockPatterns(['intranet.invalid:8080']), ['**://intranet.invalid:8080/**'])
  assert.equal(blockPatterns(HOBKIN_WINDOW_PLACES).length, 8)
  assert.deepEqual(blockPatterns([]), [])
})

test('the guard run inside a page agrees with the list, for every spelling', () => {
  const guard = placeGuard(HOBKIN_WINDOW_PLACES)!
  /** Runs the guard as a page at the address would: with that page's `location`. */
  const runAt = (address: string) => {
    const { hostname, port, protocol } = new URL(address)
    return new Function('location', `return ${guard}`)({ hostname, port, protocol }) as boolean
  }

  const refused = ['http://127.0.0.1:5187/', 'http://localhost:5187/work?x=1', 'http://[::1]:5187/', 'http://127.0.0.2:5187/', 'http://0.0.0.0:5187/', 'http://app.localhost:5187/', 'https://localhost:4848/']
  for (const address of refused) {
    assert.throws(() => runAt(address), { message: REFUSED_PLACE_MARK }, address)
    assert.equal(isRefusedPlace(address, HOBKIN_WINDOW_PLACES), true, address)
  }

  const taken = ['http://127.0.0.1:3000/', 'http://localhost/', 'https://example.invalid:5187/', 'http://localhost:5188/']
  for (const address of taken) {
    assert.equal(runAt(address), true, address)
    assert.equal(isRefusedPlace(address, HOBKIN_WINDOW_PLACES), false, address)
  }
  // A page with no address of its own, such as a blank one.
  assert.equal(new Function('location', `return ${guard}`)({ hostname: '', port: '', protocol: 'about:' }), true)
  assert.equal(placeGuard([]), null, 'with nowhere refused there is nothing to guard')
})
