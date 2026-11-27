import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement, type ReactNode } from 'react'
import type { ProgramSignIn, ProgramSignInEnd, SetupNeed } from '../../shared/protocol/setup.ts'
import { mountView, readViews } from './view-draws.ts'

const need = (over: Partial<SetupNeed> & Pick<SetupNeed, 'id' | 'name' | 'fix'>): SetupNeed => ({
  group: 'code',
  neededBy: 'Work and Change Review',
  found: false,
  version: null,
  problem: 'Not installed',
  ...over,
})

// A Mac missing git and gh, with Claude Code installed and signed out.
const GIT = need({ id: 'git', name: 'git', fix: { kind: 'install-program', name: 'git', says: "Installs Apple's Command Line Tools.", byHand: 'xcode-select --install' } })
const GH = need({ id: 'gh', name: 'GitHub CLI', fix: { kind: 'install-program', name: 'gh', says: "Installs GitHub's own gh.", byHand: 'https://cli.github.com' } })
const GH_OUT = need({ id: 'gh', name: 'GitHub CLI', problem: 'Not signed in', fix: { kind: 'sign-in-program', name: 'gh', says: 'Signs gh in.', byHand: 'gh auth login' } })
const CLAUDE_OUT = need({ id: 'claude', group: 'features', name: 'Claude Code', problem: 'Not signed in', fix: { kind: 'sign-in-program', name: 'claude', says: 'Signs Claude Code in.', byHand: 'claude auth login' } })

/** The buttons drawn, by their words, so the test presses them as a person does. */
let presses: Record<string, () => void> = {}
/** The paste field's own handlers, as the review drew it last. */
let field: { onChange?: (event: { target: { value: string } }) => void; onKeyDown?: (event: { key: string; preventDefault(): void }) => void } = {}
const opened: string[] = []

/** What the host answers, by command, and every command the review ran, with its arguments. */
let host: Record<string, (args: Record<string, unknown>) => unknown> = {}
const asked: string[] = []

readViews({
  'components/ui/button.tsx': {
    Button: ({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) => {
      if (!disabled) presses[String(children)] = onClick
      return createElement('button', null, children)
    },
  },
  'components/ui/input.tsx': {
    Input: (props: typeof field) => {
      field = props
      return createElement('input')
    },
  },
  'lib/host/index.ts': {
    runCommand: async (name: string, args: Record<string, unknown> = {}) => {
      asked.push(Object.keys(args).length ? `${name} ${JSON.stringify(args)}` : name)
      const answer = host[name]
      if (!answer) throw Error(`Unexpected command: ${name}`)
      return answer(args)
    },
  },
  'lib/open-link.ts': { openAddress: (url: string) => opened.push(url) },
})
const { NeedsReview } = await import('../src/features/onboarding/NeedsReview.tsx')

const settled = () => new Promise((resolve) => setImmediate(resolve))

async function review(needs: () => SetupNeed[], answers: typeof host) {
  presses = {}
  field = {}
  asked.length = 0
  opened.length = 0
  host = { 'setup.needs': () => ({ needs: needs() }), ...answers }
  const view = await mountView(() => createElement(NeedsReview, { onSignIn() {} }))
  await view.change(settled)
  return {
    view,
    text: () => String(view.container.textContent),
    press: async (words: string) => {
      const button = presses[words]
      assert.ok(button, `a button says ${words}: ${Object.keys(presses).join(', ')}`)
      presses = {}
      await view.change(async () => {
        button()
        await settled()
        await settled()
      })
    },
  }
}

test('an install is a press, and only after it fails does the row offer the line to copy, until Look again', async () => {
  const { view, text, press } = await review(() => [GH], {
    'setup.install-program': () => {
      throw Error('Nothing could be downloaded from GitHub, so nothing was installed.')
    },
  })
  assert.doesNotMatch(text(), /cli\.github\.com/, 'no line to copy before a failure')
  assert.match(text(), /Installs GitHub's own gh\./, 'the row says what the press installs')

  await press('Install')
  assert.deepEqual(asked, ['setup.needs', 'setup.install-program {"name":"gh"}', 'setup.needs'])
  assert.match(text(), /nothing was installed/, 'the failure is said')
  assert.match(text(), /cli\.github\.com/, 'the line to copy is the fallback after the failure')
  assert.equal(presses.Install, undefined)

  await press('Look again')
  assert.doesNotMatch(text(), /cli\.github\.com/, 'Look again brings the press back')
  assert.ok(presses.Install)
  await view.unmount()
})

test("git's press opens Apple's installer, and the row says to come back and press Look again", async () => {
  const { view, text, press } = await review(() => [GIT], { 'setup.install-program': () => ({ finished: false }) })
  await press('Install')
  assert.deepEqual(asked, ['setup.needs', 'setup.install-program {"name":"git"}', 'setup.needs'])
  assert.match(text(), /Apple's installer is open/)
  assert.match(text(), /press Look again/)
  await view.unmount()
})

test("gh's sign-in shows its one-time code, opens GitHub from a button, and reads the Mac again once it is done", async () => {
  let signedIn = false
  let end: (value: ProgramSignInEnd) => void = () => {}
  const prompt: ProgramSignIn = { name: 'gh', url: 'https://github.com/login/device', code: 'AB12-CD34', pastes: false }
  const { view, text, press } = await review(() => (signedIn ? [{ ...GH_OUT, found: true, problem: null, fix: null }] : [GH_OUT]), {
    'setup.sign-in-program': () => prompt,
    'setup.sign-in-program-wait': () => new Promise((resolve) => (end = resolve)),
  })

  await press('Sign in')
  assert.match(text(), /AB12-CD34/)
  assert.deepEqual(opened, [], 'nothing opens by itself')
  await press('Open GitHub')
  assert.deepEqual(opened, ['https://github.com/login/device'])

  signedIn = true
  await view.change(async () => {
    end({ signedIn: true, message: null })
    await settled()
  })
  assert.deepEqual(asked.filter((line) => line === 'setup.needs').length, 2, 'it read the Mac again')
  assert.doesNotMatch(text(), /AB12-CD34/)
  await view.unmount()
})

test("Claude Code's sign-in takes the code its page shows, and a sign-in that fails offers the line to copy", async () => {
  let end: (value: ProgramSignInEnd) => void = () => {}
  const { view, text, press } = await review(() => [CLAUDE_OUT], {
    'setup.sign-in-program': () => ({ name: 'claude', url: 'https://claude.ai/oauth/authorize?abc', code: null, pastes: true }),
    'setup.sign-in-program-code': () => ({ ok: true }),
    'setup.sign-in-program-wait': () => new Promise((resolve) => (end = resolve)),
  })

  await press('Sign in')
  await press('Open page')
  assert.deepEqual(opened, ['https://claude.ai/oauth/authorize?abc'])
  await view.change(async () => {
    field.onChange!({ target: { value: 'abc123#def456' } })
    await settled()
  })
  await view.change(async () => {
    field.onKeyDown!({ key: 'Enter', preventDefault() {} })
    await settled()
  })
  assert.ok(asked.includes('setup.sign-in-program-code {"name":"claude","code":"abc123#def456"}'))

  await view.change(async () => {
    end({ signedIn: false, message: "Claude Code did not sign in.\nThat code wasn't accepted." })
    await settled()
  })
  assert.match(text(), /wasn't accepted/)
  assert.match(text(), /claude auth login/, 'the line to copy after the failure')
  await view.unmount()
})
