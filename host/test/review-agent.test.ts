import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { askSession, checkerTier, MODEL_DEADLINE_MS, piModelRunner, reviewTier, type PiSession } from '../src/review/agent.ts'
import { temporaryDirectory } from './support.ts'

const home = (t: Parameters<typeof temporaryDirectory>[0], config: unknown) => {
  const root = temporaryDirectory(t)
  writeFileSync(join(root, 'config.json'), JSON.stringify(config))
  return root
}

test('the Reviewer builds a review on the high tier with high thinking, whatever effort the tier names', (t) => {
  const root = home(t, { main: { model: 'p/main', effort: 'low' }, tiers: { mid: { model: 'anthropic/claude-sonnet-5-5', effort: 'low' }, high: { model: 'anthropic/claude-opus-5-5', effort: 'low' } } })
  assert.deepEqual(reviewTier(root), { tier: 'high', model: 'anthropic/claude-opus-5-5', effort: 'high' })
})

test('a tier means for a review what it means for hobkin: one with no model of its own follows the chat model, and fast the checks model', (t) => {
  // Another tier that is set is never taken in its place: only the fast tier is set, and the Reviewer still runs on the chat model.
  assert.deepEqual(reviewTier(home(t, { main: { model: 'p/main', effort: 'medium' }, tiers: { fast: { model: 'p/fast', effort: 'low' } } })), { tier: 'main', model: 'p/main', effort: 'high' })
  assert.deepEqual(checkerTier(home(t, { main: { model: 'p/main', effort: 'xhigh' }, background: { harness: 'pi', model: 'p/checks', effort: 'minimal' }, tiers: { high: { model: 'p/high', effort: 'high' } } })), { tier: 'background', model: 'p/checks', effort: 'minimal' })
  // No checks model: Quick follows the chat model, at low.
  assert.deepEqual(checkerTier(home(t, { main: { model: 'p/main', effort: 'xhigh' } })), { tier: 'main', model: 'p/main', effort: 'low' })
  assert.equal(reviewTier(home(t, {})), null)
  assert.equal(checkerTier(home(t, {})), null)
})

test('Quick runs the blind check on the fast tier, at its own thinking', (t) => {
  assert.deepEqual(checkerTier(home(t, { tiers: { fast: { model: 'p/fast', effort: 'minimal' }, mid: { model: 'p/mid', effort: 'low' } } })), { tier: 'fast', model: 'p/fast', effort: 'minimal' })
})

test('each review role runs on the tier the user named for it', (t) => {
  const config = { main: { model: 'p/main', effort: 'medium' }, tiers: { mid: { model: 'p/mid', effort: 'low' }, max: { model: 'p/max', effort: 'xhigh' } }, review: { reviewer: 'max', quick: 'mid' } }
  assert.deepEqual(reviewTier(home(t, config)), { tier: 'max', model: 'p/max', effort: 'high' })
  assert.deepEqual(checkerTier(home(t, config)), { tier: 'mid', model: 'p/mid', effort: 'low' })
  // A name hobkin does not have is no choice: the role keeps its default.
  assert.deepEqual(reviewTier(home(t, { ...config, review: { reviewer: 'huge' } })), { tier: 'main', model: 'p/main', effort: 'high' })
})

/** A Pi session that answers when told to, or as soon as it is stopped, as Pi's does, and writes down what it was asked. */
function session() {
  const calls: string[] = []
  let answer = () => {}
  const fake: PiSession = {
    messages: [],
    prompt: async (text) => {
      calls.push(`prompt: ${text}`)
      await new Promise<void>((resolve) => (answer = resolve))
      fake.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Three units.' }] })
    },
    abort: async () => {
      calls.push('abort')
      answer()
    },
    dispose: () => void calls.push('dispose'),
  }
  return { fake, calls, answer: () => answer() }
}

test('a model call answers with what the model wrote; one stopped first is never asked, and one stopped on the way is stopped', async () => {
  const asked = session()
  const reply = askSession(asked.fake, 'Rate it.', new AbortController().signal)
  asked.answer()
  assert.equal(await reply, 'Three units.')
  assert.deepEqual(asked.calls, ['prompt: Rate it.', 'dispose'])

  // Stopped before it starts, as when the host closed while the run was on its way to the model.
  const early = session()
  await assert.rejects(askSession(early.fake, 'Rate it.', AbortSignal.abort()), /^Error: The review was stopped before its model answered\.$/)
  assert.deepEqual(early.calls, ['dispose'])

  // Stopped on the way: the session stops too, and what it wrote by then is not taken for an answer.
  const late = session()
  const stop = new AbortController()
  const stopped = askSession(late.fake, 'Rate it.', stop.signal)
  stop.abort()
  await assert.rejects(stopped, /stopped before its model answered/)
  assert.deepEqual(late.calls, ['prompt: Rate it.', 'abort', 'dispose'])
})

test('a model call still going at its deadline is stopped, and says so', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const slow = session()
  const reply = askSession(slow.fake, 'Rate it.', new AbortController().signal)
  t.mock.timers.tick(MODEL_DEADLINE_MS - 1)
  assert.deepEqual(slow.calls, ['prompt: Rate it.'], 'not before its deadline')
  t.mock.timers.tick(1)
  await assert.rejects(reply, /^Error: The model gave no answer within 10 minutes, so it was stopped\.$/)
  assert.deepEqual(slow.calls, ['prompt: Rate it.', 'abort', 'dispose'])
})

/** A stand-in for running a program once: it writes down how it was run, what the system prompt file held while it ran, and answers as told. */
function oneShot(answer: { code: number; stdout?: string; stderr?: string }) {
  const runs: { program: string; args: readonly string[]; input?: string; env?: NodeJS.ProcessEnv; system: string | null }[] = []
  const program = async (file: string, args: readonly string[], options: { input?: string; env?: NodeJS.ProcessEnv }) => {
    const at = args.indexOf('--system-prompt')
    runs.push({ program: file, args, input: options.input, env: options.env, system: at >= 0 && existsSync(args[at + 1]!) ? readFileSync(args[at + 1]!, 'utf8') : null })
    return { started: true as const, code: answer.code, signal: null, timedOut: false, aborted: false, overflow: false, stdout: Buffer.from(answer.stdout ?? ''), stderr: Buffer.from(answer.stderr ?? ''), tail: '', seconds: 1 }
  }
  return { runs, program }
}

const LAUNCHED = { main: { model: 'acme/chat', effort: 'medium' }, tiers: { high: { model: 'acme/big' }, fast: { model: 'acme/small', effort: 'low' } } }
const asked = { system: 'You review code.', prompt: 'Is this change safe?', signal: new AbortController().signal }

test('with a launcher in the home, a review model call runs the launcher’s Pi once in its one-shot mode, the question on standard input and the system prompt in a file kept only while it runs', async (t) => {
  const home = temporaryDirectory(t)
  writeFileSync(join(home, 'config.json'), JSON.stringify({ ...LAUNCHED, launcher: { command: ['company-pi', '--profile', 'work'], env: { REGION: 'north' } } }))
  const { runs, program } = oneShot({ code: 0, stdout: 'It is safe.\n' })
  const run = piModelRunner({ root: home, data: () => home, runtime: async () => ({}) as never, program })

  assert.equal(await run({ pass: 'review', ...asked }), 'It is safe.')
  const [call] = runs
  assert.equal(call!.program, 'company-pi')
  const file = call!.args[call!.args.indexOf('--system-prompt') + 1]!
  assert.deepEqual(call!.args, ['--profile', 'work', '-p', '--no-session', '--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve', '--model', 'acme/big', '--thinking', 'high', '--system-prompt', file])
  assert.deepEqual([call!.input, call!.system, call!.env?.REGION], [asked.prompt, asked.system, 'north'])
  assert.equal(call!.args.some((arg) => arg.includes(asked.prompt) || arg.includes(asked.system)), false, 'neither is on the command line')
  assert.equal(existsSync(file), false, 'the system prompt file is gone once the call ends')

  // The blind check, and the titles that ask the same tier, go the same way on the fast tier.
  await run({ pass: 'checker', ...asked })
  assert.deepEqual(runs[1]!.args.slice(runs[1]!.args.indexOf('--model'), runs[1]!.args.indexOf('--model') + 4), ['--model', 'acme/small', '--thinking', 'low'])
})

test('a launcher that manages Pi’s extensions keeps them, and a call that fails names the model it asked for with secrets hidden', async (t) => {
  const home = temporaryDirectory(t)
  writeFileSync(join(home, 'config.json'), JSON.stringify({ ...LAUNCHED, launcher: { command: ['company-pi'], managedExtensions: true } }))
  const kept = oneShot({ code: 0, stdout: 'ok' })
  await piModelRunner({ root: home, data: () => home, runtime: async () => ({}) as never, program: kept.program })({ pass: 'review', ...asked })
  assert.equal(kept.runs[0]!.args.includes('--no-extensions'), false)

  const failing = oneShot({ code: 1, stderr: 'warming up\nAuthorization failed for token sk-live-4f8a9b2c7d1e6f3a0b5c8d2e9f7a1b3c\n' })
  const failed = piModelRunner({ root: home, data: () => home, runtime: async () => ({}) as never, program: failing.program })({ pass: 'review', ...asked })
  await assert.rejects(failed, (error: Error) => /acme\/big/.test(error.message) && /launcher/.test(error.message) && !/4f8a9b2c7d1e/.test(error.message) && /\[hidden\]/.test(error.message))
})
