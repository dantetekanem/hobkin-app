import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RunChild } from '#shared/protocol/snapshot.ts'
import type { TeamsAgent } from '#shared/protocol/teams.ts'
import { helpersGlow, tasksGlow, teamsGlow } from '../src/features/agent-activity/glow.ts'
import type { AgentTask, TaskState } from '../src/features/agent-activity/tasks.ts'

const task = (id: string, state: TaskState): AgentTask => ({ id, title: `Task ${id}`, state, order: Number(id) })
const helper = (name: string, state: RunChild['state']): RunChild => ({ name, state })
const member = (name: string, state: TeamsAgent['state']): TeamsAgent => ({ key: name, name, task: '', state, from: 'run' })

test('the tasks line glows while a task is in progress, and is still otherwise', () => {
  assert.equal(tasksGlow([task('1', 'done'), task('2', 'now'), task('3', 'queued')]), true)

  assert.equal(tasksGlow([task('1', 'done'), task('2', 'queued')]), false, 'between two tasks')
  assert.equal(tasksGlow([task('1', 'done'), task('2', 'done')]), false, 'all done')
  assert.equal(tasksGlow([]), false)
})

test('the helpers line glows while a helper runs, and is still while they only wait or have ended', () => {
  assert.equal(helpersGlow([helper('scout', 'reported'), helper('fixer', 'running')]), true)

  assert.equal(helpersGlow([helper('scout', 'queued'), helper('fixer', 'cancelling'), helper('lost', 'unknown')]), false)
  assert.equal(helpersGlow([helper('scout', 'reported'), helper('fixer', 'failed'), helper('late', 'stopped')]), false)
  assert.equal(helpersGlow([]), false)
})

test('the teams line glows while one of its agents is working, and is still while they wait or have ended', () => {
  assert.equal(teamsGlow([member('test-gate', 'done'), member('observability', 'running')]), true)

  assert.equal(teamsGlow([member('test-gate', 'queued'), member('observability', 'unknown')]), false)
  assert.equal(teamsGlow([member('test-gate', 'done'), member('observability', 'failed')]), false)
  assert.equal(teamsGlow([]), false)
})
