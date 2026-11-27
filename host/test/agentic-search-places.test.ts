import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { agenticSearchPlaces } from '../src/review/vicinity-scan.ts'

const home = '/home.invalid/someone'

test("agentic-search is looked for in Pi's own package folder, where the setup's pi-agentic-search install puts it, after the usual places", () => {
  const named = agenticSearchPlaces({ home, env: { PI_CODING_AGENT_DIR: '/pi.invalid/agent' } })
  const usual = agenticSearchPlaces({ home, env: {} })

  assert.equal(named.at(-1), join('/pi.invalid/agent', 'npm', 'node_modules', '.bin'), 'the folder Pi is told to use')
  assert.equal(usual.at(-1), join(home, '.pi', 'agent', 'npm', 'node_modules', '.bin'), "Pi's own folder in the home")
  assert.deepEqual(usual.slice(0, -1), [join(home, 'Library', 'pnpm', 'bin'), join(home, '.local', 'share', 'pnpm'), '/opt/homebrew/bin', '/usr/local/bin'])
})
