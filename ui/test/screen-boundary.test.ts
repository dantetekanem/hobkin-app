import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { createElement, useState, type ReactNode } from 'react'
import { mountView, readViews } from './view-draws.ts'

// The net's two buttons, kept by their words so a test can press one.
const presses: Record<string, () => void> = {}
readViews({
  'components/ui/button.tsx': {
    Button: ({ onClick, children }: { onClick: () => void; children: ReactNode }) => {
      presses[String(children)] = onClick
      return createElement('button', null, children)
    },
  },
  'app/view-store.ts': { useView: { getState: () => ({ closeReview() {}, openScreen() {} }) } },
})
// React says each failure it hands to a net on the console. The tests cause them on purpose.
mock.method(console, 'error', () => {})
const { ScreenBoundary } = await import('../src/app/ScreenBoundary.tsx')
after(() => mock.restoreAll())

const HOOKS_MOVED = "null is not an object (evaluating 'hook.getSnapshot')"

test('a screen that fails once on what was mounted is drawn afresh by itself, and never shows a failure', async () => {
  // As after a hot update that moved a part's hooks: every draw of the part that is mounted fails from then on, also
  // the one React tries again by itself, and only a fresh mount draws.
  const spoiled = new Set<object>()
  let mounts = 0
  let mounted: object = {}
  let drawAgain: () => void = () => {}
  const Steps = () => {
    const [self] = useState(() => {
      mounts += 1
      return {}
    })
    const [, draw] = useState(0)
    mounted = self
    drawAgain = () => draw((count) => count + 1)
    if (spoiled.has(self)) throw new Error(HOOKS_MOVED)
    return createElement('p', null, 'the agent’s steps')
  }
  const view = await mountView(() => createElement(ScreenBoundary, { of: 'agent:a1', children: createElement(Steps) }))
  assert.equal(view.container.textContent, 'the agent’s steps')
  assert.equal(mounts, 1)

  await view.change(() => {
    spoiled.add(mounted)
    drawAgain()
  })

  assert.equal(view.container.textContent, 'the agent’s steps', 'the screen is there, with no failure shown')
  assert.equal(mounts, 2, 'mounted anew, once')
  await view.unmount()
})

test('a screen that fails again at once says what went wrong and where, and Try again draws it once it can', async () => {
  let broken = true
  const Steps = () => {
    if (broken) throw new Error(HOOKS_MOVED)
    return createElement('p', null, 'the agent’s steps')
  }
  const AgentScreen = () => createElement('section', null, createElement(Steps))
  const view = await mountView(() => createElement(ScreenBoundary, { of: 'agent:a1', children: createElement(AgentScreen) }))

  const said = view.container.textContent
  assert.match(said, /This screen could not be drawn/)
  assert.ok(said.includes(HOOKS_MOVED), 'the failure in its own words')
  assert.match(said, /in Steps › AgentScreen/, 'the parts it came through, innermost first')
  assert.match(said, /Try again/)
  assert.match(said, /Back to Work/)

  // Still broken: a try shows the failure again and leaves the rest of the window alone.
  await view.change(() => presses['Try again']!())
  assert.match(view.container.textContent, /This screen could not be drawn/)

  broken = false
  await view.change(() => presses['Try again']!())
  assert.equal(view.container.textContent, 'the agent’s steps')
  await view.unmount()
})

test('moving to another screen under the same net draws that screen, whatever the last one did', async () => {
  let broken = true
  const Screen = ({ name }: { name: string }) => {
    if (broken) throw new Error('boom')
    return createElement('p', null, name)
  }
  let show: (screen: string) => void = () => {}
  const Canvas = () => {
    const [of, setOf] = useState('agent:a1')
    show = setOf
    return createElement(ScreenBoundary, { of, children: createElement(Screen, { name: of }) })
  }
  const view = await mountView(() => createElement(Canvas))
  assert.match(view.container.textContent, /This screen could not be drawn/)

  await view.change(() => {
    broken = false
    show('agent:a2')
  })
  assert.equal(view.container.textContent, 'agent:a2')
  await view.unmount()
})
