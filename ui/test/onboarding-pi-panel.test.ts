import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement, type ReactNode } from 'react'
import type { PiSetup } from '../../shared/protocol/setup.ts'
import { mountView, readViews, stillMotion } from './view-draws.ts'

// A Mac with hobkin's carried Node only, as the app finds it: no npm, so a Node of hobkin's own comes first.
const bare: PiSetup = {
  installed: false,
  version: null,
  pinned: '1.5.0',
  matches: false,
  canInstall: false,
  installCommand: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.5.0',
  packages: [
    { name: 'pi-extended-teams', adds: 'Helper agents.', installed: false },
    { name: 'pi-agentic-search', adds: 'Ranked code search.', installed: false },
  ],
  node: { found: false, version: null, installs: '26.3.1' },
  canInstallNode: true,
}

// The panel's buttons, by their words, so the test presses them as a person does.
const presses: Record<string, () => void> = {}
// Each install the panel asked the host for, in order, and the one that fails once.
const asked: string[] = []
let failsOnce: string | null = null

readViews({
  'components/ui/button.tsx': {
    Button: ({ onClick, children }: { onClick: () => void; children: ReactNode }) => {
      presses[String(children)] = onClick
      return createElement('button', null, children)
    },
  },
  'lib/host/index.ts': {
    runCommand: async (name: string, args?: { name?: string }) => {
      const step = args?.name ?? name
      asked.push(step)
      if (step === failsOnce) {
        failsOnce = null
        throw Error('npm could not install Pi.\nnpm error code ENOTFOUND')
      }
      return bare
    },
  },
  'motion/react': { motion: stillMotion },
})
const { PiPanel } = await import('../src/features/onboarding/PiPanel.tsx')

/** Lets the panel's installs, which run one after another on their own, go as far as they go. */
const settled = () => new Promise((resolve) => setImmediate(resolve))

test('a failed install is tried again from the step that failed, and the steps before it are not run again', async () => {
  const outcomes: string[] = []
  const view = await mountView(() =>
    createElement(PiPanel, {
      pi: bare,
      onState() {},
      onDone: (outcome: string) => outcomes.push(outcome),
      onBusy() {},
      still: true,
    }),
  )

  failsOnce = 'setup.install-pi'
  await view.change(async () => {
    presses.Install!()
    await settled()
  })
  assert.deepEqual(asked, ['setup.install-node', 'setup.install-pi'], 'Node installs, then Pi fails and nothing after it runs')
  assert.deepEqual(outcomes, [])

  asked.length = 0
  await view.change(async () => {
    presses['Try again']!()
    await settled()
  })
  assert.deepEqual(asked, ['setup.install-pi', 'pi-extended-teams', 'pi-agentic-search'], 'Try again starts at Pi, not at Node')
  assert.deepEqual(outcomes, ['installed'])
  await view.unmount()
})

test('while Pi itself is missing or too old there is no Not now, and with only packages missing Not now puts them off', async () => {
  const forget = () => {
    for (const words of Object.keys(presses)) delete presses[words]
  }
  const mounted = async (pi: PiSetup) => {
    forget()
    const outcomes: string[] = []
    const view = await mountView(() => createElement(PiPanel, { pi, onState() {}, onDone: (outcome: string) => outcomes.push(outcome), onBusy() {}, still: true }))
    return { view, outcomes }
  }

  // "if pi is not installed it cant move": the story holds at Pi, with Install, Look again and the agent's prompt.
  const missing = await mounted(bare)
  assert.equal(presses['Not now'], undefined)
  assert.ok(presses.Install)
  await missing.view.unmount()

  const byHand = await mounted({ ...bare, canInstallNode: false })
  assert.equal(presses['Not now'], undefined)
  assert.ok(presses['Look again'], 'by hand, Look again finds the Pi installed meanwhile')
  await byHand.view.unmount()

  const tooOld = await mounted({ ...bare, installed: true, version: '0.9.0', canInstall: true })
  assert.equal(presses['Not now'], undefined)
  await tooOld.view.unmount()

  const packagesOnly = await mounted({ ...bare, installed: true, version: '1.5.0', matches: true, canInstall: true, node: { found: true, version: '26.3.1', installs: '26.3.1' } })
  assert.ok(presses['Not now'], 'the packages stay as they were: they can wait')
  await packagesOnly.view.change(() => presses['Not now']!())
  assert.deepEqual(packagesOnly.outcomes, ['later'])
  await packagesOnly.view.unmount()
})
