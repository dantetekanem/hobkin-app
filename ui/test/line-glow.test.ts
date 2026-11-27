import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tasksGlow } from '../src/features/agent-activity/glow.ts'
import type { AgentTask, TaskState } from '../src/features/agent-activity/tasks.ts'

const task = (id: string, state: TaskState): AgentTask => ({ id, title: `Task ${id}`, state, order: Number(id) })

test('the tasks line glows while a task is in progress, and is still otherwise', () => {
  assert.equal(tasksGlow([task('1', 'done'), task('2', 'now'), task('3', 'queued')]), true)

  assert.equal(tasksGlow([task('1', 'done'), task('2', 'queued')]), false, 'between two tasks')
  assert.equal(tasksGlow([task('1', 'done'), task('2', 'done')]), false, 'all done')
  assert.equal(tasksGlow([]), false)
})
