import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PiSetup } from '../protocol/setup.ts'
import { agentPrompt, PI_NODE } from '../setup/agent-prompt.ts'
import { PI_PACKAGES } from '../setup/pi-packages.ts'

const COMMAND = 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.5.0'
const setup = (over: Partial<PiSetup> = {}): PiSetup => ({
  installed: false,
  version: null,
  pinned: '1.5.0',
  matches: false,
  canInstall: false,
  installCommand: COMMAND,
  packages: PI_PACKAGES.map(({ name, adds }) => ({ name, adds, installed: false })),
  node: { found: false, version: null, installs: '26.1.0' },
  canInstallNode: false,
  ...over,
})

test('with nothing on this Mac, the prompt asks for Node with npm, the pinned Pi by its exact line, and every package by its source', () => {
  const prompt = agentPrompt(setup(), null)

  assert.match(prompt, new RegExp(`Node ${PI_NODE.replace('.', '\\.')} or newer, with npm`))
  assert.match(prompt, /found no Node/)
  assert.ok(prompt.includes(`\`${COMMAND}\``), 'Pi by the exact npm line')
  for (const { source } of PI_PACKAGES) assert.ok(prompt.includes(`\`pi install ${source}\``), source)
  // Where hobkin looks, so the agent puts the programs somewhere hobkin finds them.
  for (const place of ['$SHELL -ilc', '~/Library/pnpm', '~/.npm-global/bin', '/opt/homebrew/bin', '/usr/local/bin', 'client/node/bin']) assert.ok(prompt.includes(place), place)
  assert.match(prompt, /You may change whatever stands in the way on this Mac/)
  assert.match(prompt, /did not try to install anything/)
  assert.match(prompt.trimEnd().split('\n').at(-1)!, /press Look again in hobkin\.$/, 'it ends by sending the person back to hobkin')
  assert.doesNotMatch(prompt, /[—–]/)
})

test('after a failure, the prompt says what hobkin saw, with no secret and no home folder in it', () => {
  const failure = [
    'npm could not install Pi.',
    'npm error code EACCES',
    'npm error path /Users/someone/.npm/_cacache',
    'npm error //registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz0123456789',
  ].join('\n')
  const prompt = agentPrompt(setup({ installed: true, version: '1.4.2', canInstall: true, node: { found: true, version: '22.19.0', installs: '26.1.0' } }), failure)

  assert.match(prompt, /found Pi 1\.4\.2/)
  assert.match(prompt, /found Node 22\.19\.0 with npm/)
  assert.match(prompt, /npm error code EACCES/)
  assert.match(prompt, /~\/\.npm\/_cacache/)
  assert.doesNotMatch(prompt, /\/Users\/someone/)
  assert.doesNotMatch(prompt, /npm_abcdefghijklmnopqrstuvwxyz0123456789/)
  assert.doesNotMatch(prompt, /did not try/)
})

test('with Pi in place, only the missing packages are asked for, and Pi is not installed again', () => {
  const packages = PI_PACKAGES.map(({ name, adds }) => ({ name, adds, installed: name !== 'pi-coder' }))
  const prompt = agentPrompt(setup({ installed: true, version: '1.5.0', matches: true, canInstall: true, packages }), 'Pi could not install pi-coder.')

  assert.ok(prompt.includes('`pi install npm:pi-coder`'))
  assert.ok(!prompt.includes('`pi install npm:pi-ask-user`'))
  assert.ok(!prompt.includes(COMMAND))
})

test('a Node without npm, and a host from before that says nothing of Node, are each said as they are', () => {
  assert.match(agentPrompt(setup({ node: { found: true, version: '20.11.0', installs: '26.1.0' } }), null), /found Node 20\.11\.0, but no npm beside it/)
  const { node: _node, canInstallNode: _can, ...before } = setup()
  assert.match(agentPrompt(before, null), /found no npm/)
})
