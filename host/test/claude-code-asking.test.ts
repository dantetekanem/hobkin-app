import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { checkArguments } from '#shared/commands/registry.ts'
import type { PendingQuestion } from '#shared/protocol/question.ts'
import { answerToolRequest, type AskingSetup, type ToolRequest } from '../src/claude-code/asking.ts'
import { Questions, type Ask } from '../src/questions.ts'

const TITLE = 'Fix the flaky cache test'

/** The host's question sheet with someone at the window, and a way to wait for the next question on it. */
function sheet({ canShow = () => true }: { canShow?: () => boolean } = {}) {
  const questions = new Questions({ onChange: () => {}, canShow, typing: () => false })
  const next = async (after?: string): Promise<PendingQuestion> => {
    const until = Date.now() + 2000
    while (Date.now() < until) {
      const shown = questions.current()
      if (shown && shown.id !== after) return shown
      await delay(1)
    }
    throw Error('No question came up.')
  }
  const setup = (ask: Ask = questions.ask, more: Partial<AskingSetup> = {}): AskingSetup => ({ ask, from: TITLE, retryMs: 5, giveUpMs: 1000, ...more })
  return { questions, next, setup }
}

const ASKED: ToolRequest = {
  tool_name: 'AskUserQuestion',
  tool_use_id: 'toolu_ask',
  input: {
    questions: [
      {
        question: 'Which database should the cache use?',
        header: 'Database',
        options: [{ label: 'Postgres', description: 'Already running here' }, { label: 'Redis', description: '' }],
        multiSelect: false,
      },
      {
        question: 'Which checks should run before a merge?',
        header: 'Checks',
        options: [{ label: 'Tests', description: 'The unit tests' }, { label: 'Lint', description: 'Style rules' }],
        multiSelect: true,
      },
    ],
  },
}

// Two minutes on the sheet, then it counts as put off, so an agent never waits on someone who is away.
const TWO_MINUTES = 120_000

/** A question as the sheet shows it, with how long it stays up in place of when it goes. */
const shown = ({ id: _id, askedAt, expiresAt, ...question }: PendingQuestion) => ({ ...question, waitMs: expiresAt === null ? null : expiresAt - askedAt })

test('each question goes to the sheet and the answers go back', async () => {
  const { questions, next, setup } = sheet()
  const reply = answerToolRequest(ASKED, setup(), new AbortController().signal)

  const first = await next()
  assert.deepEqual(shown(first), {
    from: TITLE,
    question: 'Which database should the cache use?',
    tldr: 'Database',
    choices: [{ value: '1', label: 'Postgres: Already running here' }, { value: '2', label: 'Redis' }],
    other: true,
    waitMs: TWO_MINUTES,
  })
  questions.answer(first.id, { value: '1' })

  const second = await next(first.id)
  assert.equal(second.question, 'Which checks should run before a merge?')
  assert.equal(second.tldr, 'Checks · pick one, or type several')
  assert.equal(shown(second).waitMs, TWO_MINUTES)
  questions.answer(second.id, { typed: 'Tests, Lint' })

  assert.deepEqual(await reply, {
    behavior: 'allow',
    updatedInput: {
      questions: ASKED.input.questions,
      answers: { 'Which database should the cache use?': 'Postgres', 'Which checks should run before a merge?': 'Tests, Lint' },
    },
  })
  assert.equal(questions.current(), null)
})

test('a question put off or unaskable lets Claude go on', async () => {
  // Put off: Claude hears it, and the rest are not asked.
  const putOff = sheet()
  const deferred = answerToolRequest(ASKED, putOff.setup(), new AbortController().signal)
  putOff.questions.defer((await putOff.next()).id)
  assert.deepEqual(await deferred, { behavior: 'deny', message: 'The user put these questions off. Go on with your best judgment and say in your report what you assumed.' })
  assert.equal(putOff.questions.current(), null)

  // Nobody answers in time: it leaves the sheet as put off, so the sheet is free again and Claude goes on.
  const idle = sheet()
  const unanswered = answerToolRequest(ASKED, idle.setup(idle.questions.ask, { answerWaitMs: 20 }), new AbortController().signal)
  assert.equal(shown(await idle.next()).waitMs, 20)
  assert.deepEqual(await unanswered, { behavior: 'deny', message: 'The user put these questions off. Go on with your best judgment and say in your report what you assumed.' })
  assert.equal(idle.questions.current(), null)

  // Nobody at the window: asked again every little while, until it is no use.
  let tries = 0
  const away = sheet({ canShow: () => false })
  const counting: Ask = (request, signal) => {
    tries++
    return away.questions.ask(request, signal)
  }
  const unasked = await answerToolRequest(ASKED, away.setup(counting, { retryMs: 5, giveUpMs: 40 }), new AbortController().signal)
  assert.deepEqual(unasked, { behavior: 'deny', message: 'Nobody could be asked. Go on with your best judgment and say in your report what you assumed.' })
  assert.ok(tries > 2, `asked again while it could not be asked (${tries} tries)`)

  // Someone comes back before then: the question goes up.
  let present = false
  const back = sheet({ canShow: () => present })
  const later = answerToolRequest({ ...ASKED, input: { questions: (ASKED.input.questions as unknown[]).slice(0, 1) } }, back.setup(), new AbortController().signal)
  await delay(20)
  present = true
  back.questions.answer((await back.next()).id, { value: '2' })
  assert.deepEqual((await later)?.behavior, 'allow')

  // Claude withdrew the question, or the run stopped: it leaves the sheet and nothing goes back.
  const gone = sheet()
  const stop = new AbortController()
  const withdrawn = answerToolRequest(ASKED, gone.setup(), stop.signal)
  await gone.next()
  stop.abort()
  assert.equal(await withdrawn, null)
  assert.equal(gone.questions.current(), null)
})

test("a permission prompt asks allow or don't allow", async () => {
  const { questions, next, setup } = sheet()
  const ask = async (request: ToolRequest, reply: { value: string } | { typed: string } | 'later') => {
    const answer = answerToolRequest(request, setup(), new AbortController().signal)
    const question = await next()
    if (reply === 'later') questions.defer(question.id)
    else questions.answer(question.id, reply)
    return { question: shown(question), answer: await answer }
  }
  const run: ToolRequest = {
    tool_name: 'Bash',
    tool_use_id: 'toolu_run',
    display_name: 'Bash',
    description: 'Remove the old build',
    input: { command: 'rm -rf build', description: 'Remove the old build' },
  }

  assert.deepEqual(await ask(run, { value: 'allow' }), {
    question: {
      from: TITLE,
      question: 'Run `rm -rf build`?',
      tldr: 'Remove the old build',
      choices: [{ value: 'allow', label: 'Allow' }, { value: 'deny', label: "Don't allow" }],
      other: true,
      waitMs: TWO_MINUTES,
    },
    answer: { behavior: 'allow', updatedInput: run.input },
  })

  const edit = await ask({ tool_name: 'Edit', tool_use_id: 'toolu_edit', input: { file_path: '/work/src/a.ts', old_string: 'a', new_string: 'b' } }, { value: 'deny' })
  assert.equal(edit.question.question, 'Change /work/src/a.ts?')
  assert.equal(edit.question.tldr, undefined)
  assert.deepEqual(edit.answer, { behavior: 'deny', message: 'The user did not allow this.' })

  const other = await ask(
    { tool_name: 'mcp__tracker__search_issues', tool_use_id: 'toolu_mcp', display_name: 'Search issues', description: 'x'.repeat(300), input: { query: 'flaky' } },
    { typed: 'Use the cached list instead.' },
  )
  assert.equal(other.question.question, 'Use Search issues?')
  assert.equal(other.question.tldr?.length, 100)
  assert.deepEqual(other.answer, { behavior: 'deny', message: 'The user said: Use the cached list instead.' })

  const later = await ask(run, 'later')
  assert.deepEqual(later.answer, { behavior: 'deny', message: 'Nobody approved this, so it did not run. Go on without it or find another way.' })
})

test('a choice with a long label can be picked, and its whole label goes back', async () => {
  const { questions, next, setup } = sheet()
  const label = 'x'.repeat(120)
  const asked = [{ question: 'Where should the cache live?', header: 'Cache', options: [{ label, description: '' }, { label: 'Redis', description: '' }], multiSelect: false }]
  const reply = answerToolRequest({ tool_name: 'AskUserQuestion', tool_use_id: 'toolu_long', input: { questions: asked } }, setup(), new AbortController().signal)

  const question = await next()
  const choice = question.choices.find((each) => each.label === label)!
  // The pick reaches the host as `question.answer`, which takes a short value.
  assert.deepEqual(checkArguments('question.answer', { id: question.id, value: choice.value }), { ok: true })
  questions.answer(question.id, { value: choice.value })
  assert.deepEqual(await reply, { behavior: 'allow', updatedInput: { questions: asked, answers: { 'Where should the cache live?': label } } })
})
