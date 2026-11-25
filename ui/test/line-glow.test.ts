import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RunChild } from '#shared/protocol/snapshot.ts'
import { helpersGlow, tasksGlow } from '../src/features/agent-activity/glow.ts'
import type { AgentTask, TaskState } from '../src/features/agent-activity/tasks.ts'

const task = (id: string, state: TaskState): AgentTask => ({ id, title: `Task ${id}`, state, order: Number(id) })
const helper = (name: string, state: RunChild['state']): RunChild => ({ name, state })

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
