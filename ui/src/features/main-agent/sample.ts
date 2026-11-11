import type { ActivityEntry } from '#shared/protocol/activity.ts'
import type { SampleActivity } from '@/features/agent-activity/sample.ts'

/**
 * Made-up work of hobkin's main agent, for a window with no host, in the shape the host sends: answering the user
 * about last night's runs, it reads a report, checks a branch and spawns a helper. Nothing here came from hobkin.
 * Its helpers are the frame's sample ones (`sampleMainChildren`).
 */
const said = (id: string, text: string): ActivityEntry => ({ id: `message:${id}`, kind: 'assistant', text })
const call = (id: string, name: string, args: object, state: ActivityEntry['state'], output = ''): ActivityEntry => ({ id: `tool:${id}`, kind: 'tool', name, state, input: JSON.stringify(args, null, 2), output })

const LOG = 'c41e2a9 Never redirect back to the sign-in page\n9b07f13 Test the sign-in redirect\n5d2c8e0 Faster cart totals'
const DIFF = call('call_main4', 'bash', { command: 'git -C ~/code/storefront diff --stat main...hobkin/3fa9c1-fix-login-redirect' }, 'completed', ' src/auth/redirect.test.ts | 4 ++--\n src/auth/redirect.ts      | 5 ++++-\n 2 files changed, 7 insertions(+), 3 deletions(-)')
const SPAWN = (state: ActivityEntry['state']) => call('call_main5', 'spawn_agent', { name: 'release-notes', role: 'read', model_slot: 'read-collect', task: 'Draft the release note for the login redirect fix.' }, state, state === 'running' ? '' : 'Queued release-notes (read-collect).')

export const SAMPLE_MAIN: SampleActivity = {
  cwd: '/Users/sample/code',
  done: [
    said('1:0', 'Looking at what the storefront run did overnight before I answer.'),
    call('call_main1', 'read', { path: '/Users/sample/.hobkin/reports/2026-11-10-storefront.md' }, 'completed', '# Storefront, overnight\n\n- The login redirect loop is fixed on `hobkin/3fa9c1-fix-login-redirect`.\n- 214 tests pass.'),
    call('call_main2', 'bash', { command: 'git -C ~/code/storefront log --oneline -3 hobkin/3fa9c1-fix-login-redirect' }, 'completed', LOG),
  ],
  next: [
    [DIFF],
    [DIFF, SPAWN('running')],
    [DIFF, SPAWN('completed')],
    [DIFF, SPAWN('completed'), said('3:0', 'The fix is two small commits with its own test. A helper is drafting the release note while you look at the branch.')],
  ],
}
