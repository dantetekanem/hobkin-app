import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SlashCommand } from '#shared/protocol/slash.ts'
import { closedSlash, slashList } from '../src/features/chat/slash.ts'
import { agentCommands, agentSlashKey, agentSlashSent } from '../src/features/work/agent-slash.ts'

const pi = (name: string, count = 0): SlashCommand => ({ name, description: `what ${name} does`, source: 'pi', count })
// What Pi offers the agent's own session, by name, as the host lists it.
const PI = [pi('/fix-tests', 2), pi('/model'), pi('/review'), pi('/skill:humanizer', 5)]
const COMMANDS = agentCommands(PI)
const open = (text: string, selected = 0) => ({ text, commands: COMMANDS, state: { selected, closedFor: null } })

test("an agent's list is the window's /model and /effort, then what Pi offers its session", () => {
  assert.deepEqual(COMMANDS.map(({ name }) => name), ['/model', '/effort', '/fix-tests', '/review', '/skill:humanizer'], "Pi's own /model gives way to the window's")
  // Most used first, as in the main chat.
  assert.deepEqual(slashList('/', COMMANDS, closedSlash)?.rows.map(({ name }) => name), ['/skill:humanizer', '/fix-tests', '/model', '/effort', '/review'])
  // With no session to ask, the window's own are still there.
  assert.deepEqual(slashList('/mo', agentCommands([]), closedSlash)?.rows.map(({ name }) => name), ['/model'])
})

test('enter on /model opens the choice, on /effort writes it out for its level, and on a Pi command runs it', () => {
  assert.deepEqual(agentSlashKey(open('/mod'), 'Enter'), { state: closedSlash, text: '', run: { kind: 'model' } })
  assert.deepEqual(agentSlashKey(open('/eff'), 'Enter'), { state: closedSlash, text: '/effort ' })
  assert.deepEqual(agentSlashKey(open('/hum'), 'Enter'), { state: closedSlash, text: '', run: { kind: 'pi', name: '/skill:humanizer', args: '' } })
  // The other keys are the main chat's.
  assert.deepEqual(agentSlashKey(open('/', 0), 'ArrowDown'), { state: { selected: 1, closedFor: null } })
  assert.deepEqual(agentSlashKey(open('/fix'), 'Tab'), { text: '/fix-tests ', state: closedSlash })
  assert.equal(agentSlashKey(open('hello'), 'Enter'), null, 'not a command being typed')
})

test('a sent message runs a Pi command with what follows it, a bare /model opens the choice, and a change line stays one', () => {
  assert.deepEqual(agentSlashSent('/fix-tests the parser ', COMMANDS), { kind: 'pi', name: '/fix-tests', args: 'the parser' })
  assert.deepEqual(agentSlashSent('/review', COMMANDS), { kind: 'pi', name: '/review', args: '' })
  assert.deepEqual(agentSlashSent('/model', COMMANDS), { kind: 'model' })
  // These change the agent as they did before the list: /model with a model, /effort with a level, or why not.
  assert.equal(agentSlashSent('/model opus', COMMANDS), null)
  assert.equal(agentSlashSent('/effort high', COMMANDS), null)
  assert.equal(agentSlashSent('/effort', COMMANDS), null)
  // A slash its session does not offer, or words that only mention one, are a message.
  assert.equal(agentSlashSent('/nope', COMMANDS), null)
  assert.equal(agentSlashSent('please /review', COMMANDS), null)
})
