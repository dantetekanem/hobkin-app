import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentEditorEnter, agentTarget, closeAgentPrompt, promptPress, talkBoxOf, useAgentPrompt, type AgentBox, type EnterPress } from '../src/features/chat/prompt-target.ts'

/** A page element as the key finds it: its attributes, and whether it takes no typing. */
const element = (attributes: Record<string, string>, readOnly = false) => {
  const page = { readOnly, getAttribute: (name: string) => attributes[name] ?? null }
  return page as unknown as Element
}

/** Control+Option+P with no editor open and the keyboard on `focused`. */
const pressOn = (focused: Element | null) => promptPress({ chatOpen: false, agentOpen: null, typingTo: talkBoxOf(focused) })

test("Control+Option+P in an agent's talk box opens the full prompt on that agent's message, and anywhere else on the main chat's", () => {
  const durableBox = element({ 'data-agent-input': 'hobkin:h1' })
  const runBox = element({ 'data-agent-input': 'run-7' })
  const finishedRunBox = element({ 'data-agent-input': 'run-7' }, true)
  const elsewhere = element({})

  assert.deepEqual(pressOn(durableBox), { do: 'open-agent', agent: 'hobkin:h1' })
  assert.deepEqual(pressOn(runBox), { do: 'open-agent', agent: 'run-7' }, "a run's box as well")
  assert.deepEqual(pressOn(elsewhere), { do: 'toggle-chat' }, 'the message input, a step, a list')
  assert.deepEqual(pressOn(null), { do: 'toggle-chat' })
  assert.deepEqual(pressOn(finishedRunBox), { do: 'toggle-chat' }, 'a finished run takes nothing more, so its box opens no editor of its own')
})

test('the same key closes the editor that is open, whatever has the keyboard', () => {
  assert.deepEqual(promptPress({ chatOpen: false, agentOpen: 'hobkin:h1', typingTo: null }), { do: 'close-agent' })
  assert.deepEqual(promptPress({ chatOpen: true, agentOpen: null, typingTo: 'hobkin:h1' }), { do: 'toggle-chat' })
})

/** An agent's talk box as the editor gets it, keeping what the editor does to it. */
function talkBox(text: string, turnRunning = false) {
  const seen = { text, sends: [] as (string | undefined)[], closes: 0 }
  const box: AgentBox = {
    to: { name: 'Chrome testing with Hobkin', face: null },
    text,
    setText: (next) => {
      seen.text = typeof next === 'function' ? next(seen.text) : next
    },
    attachments: [],
    attach() {},
    detach() {},
    canSend: true,
    turnRunning,
    send: (queue) => {
      seen.sends.push(queue)
    },
  }
  const close = () => {
    seen.closes += 1
  }
  return { seen, target: agentTarget(box, close) }
}

test("the editor opened on an agent's box writes that box's message: its words come in, and what is written there stays in the box when it closes", () => {
  const { seen, target } = talkBox('Look at the login page')

  assert.equal(target.text, 'Look at the login page')
  assert.equal(target.to.name, 'Chrome testing with Hobkin')

  target.setText('Look at the login page\n\n1. Sign in')
  assert.equal(seen.text, 'Look at the login page\n\n1. Sign in')

  target.back()

  assert.equal(seen.closes, 1)
  assert.equal(seen.text, 'Look at the login page\n\n1. Sign in', 'closing takes nothing out of the box')
  assert.deepEqual(seen.sends, [])
  assert.equal(target.drafts, null, "an agent's message has no drafts set aside: the list stays the main chat's")
})

test("it sends through the agent's box, with the box's own way of waiting for the turn, and closes", () => {
  const { seen, target } = talkBox('Try it again', true)

  target.send()
  target.send('follow-up')
  target.send('interrupt')

  assert.deepEqual(seen.sends, [undefined, 'follow-up', 'interrupt'])
  assert.equal(seen.closes, 3)
})

test('a durable agent started from it takes the words out of the box only while they are still the prompt', () => {
  const started = talkBox('Plan the release')

  started.target.handedOff('Plan the release')

  assert.equal(started.seen.text, '')
  assert.equal(started.seen.closes, 1)

  // Words a stop gave back came into the box while the sheet was open: they stay.
  const grown = talkBox('Plan the release')
  grown.target.setText('Earlier words\n\nPlan the release')

  grown.target.handedOff('Plan the release')

  assert.equal(grown.seen.text, 'Earlier words\n\nPlan the release')
  assert.equal(grown.seen.closes, 1)
})

test("its keys are the box's, with Command+Enter for the box's Enter, since Enter adds a line", () => {
  const press = (held: Partial<EnterPress>): EnterPress => ({ ctrl: false, meta: false, alt: false, shift: false, ...held })
  const during = { turnRunning: true, canSend: true }
  const idle = { turnRunning: false, canSend: true }

  assert.equal(agentEditorEnter(press({ meta: true }), during), 'send', 'it steers the turn in flight, as Enter in the box does')
  assert.equal(agentEditorEnter(press({ alt: true }), during), 'follow-up')
  assert.equal(agentEditorEnter(press({ ctrl: true }), during), 'interrupt')
  assert.equal(agentEditorEnter(press({ alt: true }), idle), 'send', 'with no turn running both send as Enter does')
  assert.equal(agentEditorEnter(press({ ctrl: true }), idle), 'send')
  assert.equal(agentEditorEnter(press({ ctrl: true, shift: true }), during), 'durable')
  assert.equal(agentEditorEnter(press({}), during), null, 'Enter adds a line')
  assert.equal(agentEditorEnter(press({ shift: true }), during), null)
  assert.equal(agentEditorEnter(press({ ctrl: true }), { turnRunning: true, canSend: false }), 'nothing', 'the key is used, and nothing goes')
})

test("a box that goes away closes its own editor, and leaves another agent's open", () => {
  useAgentPrompt.setState({ agent: 'hobkin:h1' })

  closeAgentPrompt('run-7')
  assert.equal(useAgentPrompt.getState().agent, 'hobkin:h1')

  closeAgentPrompt('hobkin:h1')
  assert.equal(useAgentPrompt.getState().agent, null)
})
