import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkProject } from '#shared/protocol/work.ts'
import { isGoal, projectFacts } from '../src/features/work/projects.ts'

const NOW = Date.parse('2026-11-24T12:00:00Z')
const project = (rest: Partial<WorkProject> = {}): WorkProject => ({
  slug: 'p',
  name: 'p',
  state: 'chosen',
  priority: 'P2',
  prMode: 'off',
  level: 'casual',
  paused: false,
  open: 0,
  prs: 0,
  branches: 0,
  left: 0,
  unmerged: 0,
  nextLookAt: null,
  lookError: null,
  ...rest,
})

test('a goal says Goal and counts its steps to do, done and left for the user, zeros included', () => {
  assert.equal(projectFacts(project({ kind: 'goal', open: 3, done: 5, left: 1 }), NOW), 'Goal · casual · 3 to do · 5 done · 1 left for you')
  assert.equal(projectFacts(project({ kind: 'goal' }), NOW), 'Goal · casual · 0 to do · 0 done · 0 left for you')
  assert.equal(projectFacts(project({ kind: 'goal', open: 1, nextLookAt: '2026-11-24T14:00:00Z' }), NOW), 'Goal · casual · 1 to do · 0 done · 0 left for you · next look in 2 hours')
})

test('a project with no kind is code and says what it said before', () => {
  assert.equal(isGoal(project()), false)
  assert.equal(projectFacts(project(), NOW), 'casual · not looked at yet')
  assert.equal(projectFacts(project({ open: 4, prs: 1, branches: 2, left: 1, unmerged: 3 }), NOW), 'casual · 4 items · 1 PR · 2 branches · 1 left for you · 3 unmerged')
  assert.equal(projectFacts(project({ kind: 'code', open: 1 }), NOW), 'casual · 1 item')
})
