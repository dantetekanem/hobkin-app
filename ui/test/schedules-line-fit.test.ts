import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentSchedule } from '#shared/protocol/schedules.ts'
import { COMPACT_WIDTH, DOT_WIDTH, lineFit, lineRoom, shownWords } from '../src/features/schedules/line-fit.ts'
import { scheduleLine } from '../src/features/schedules/schedules.ts'

const NOW = Date.parse('2026-11-23T15:00:00.000Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()

// Six pixels a character, so a test can count the room it gives.
const measure = (text: string) => text.length * 6

const watch: AgentSchedule = { id: 'w', name: 'Watch CI for #412', state: 'waiting', nextAt: at(102_000) }
const deploy: AgentSchedule = { id: 'd', name: 'Watch the deploy', state: 'waiting', nextAt: at(250_000) }
const preview: AgentSchedule = { id: 'p', name: 'Preview is up', state: 'running' }

const lineOf = (...list: AgentSchedule[]) => scheduleLine(list, NOW)!

// The main chat's status row at the chat's narrowest (360px) and at its first width (460px): the row is 24px narrower.
const NARROWEST_ROW = 336
const FIRST_ROW = 436
const WIDE_ROW = 640

test('while the row is quiet the line takes 40% of it, between 8.5rem and 14rem', () => {
  assert.equal(lineRoom(FIRST_ROW, false), 174)
  assert.equal(lineRoom(NARROWEST_ROW, false), 136)
  assert.equal(lineRoom(WIDE_ROW, false), 224)
})

test('while a turn runs the line gives way: whole in a wide chat, its count and countdown at the first width, its dot alone at the narrowest', () => {
  assert.equal(lineRoom(WIDE_ROW, true), 224)
  assert.equal(lineRoom(FIRST_ROW, true), COMPACT_WIDTH)
  assert.equal(lineRoom(NARROWEST_ROW, true), DOT_WIDTH)
})

test('with room the line says the name and the countdown, cutting the name at a whole word', () => {
  const one = lineOf(watch)
  const whole = lineFit(224, one, measure)
  assert.equal(whole.form, 'full')
  assert.equal(shownWords(one, whole), 'Watch CI for #412 in 1:42')

  const cut = lineFit(170, one, measure)
  assert.equal(shownWords(one, cut), 'Watch CI… in 1:42', 'never "Watch C…"')
})

test('where no whole word of the name fits, the line says its count and countdown instead', () => {
  const three = lineOf(watch, deploy, preview)
  const fit = lineFit(136, three, measure)
  assert.equal(fit.form, 'compact')
  assert.equal(shownWords(three, fit), '3 · running')
})

test('the compact line: the count and the countdown, the countdown alone for one, that one runs, or that it is paused', () => {
  const compact = (...list: AgentSchedule[]) => {
    const line = lineOf(...list)
    return shownWords(line, lineFit(COMPACT_WIDTH, line, measure))
  }
  const later: AgentSchedule = { ...preview, state: 'waiting', nextAt: at(400_000) }

  assert.equal(compact(watch, deploy, later), '3 · 1:42')
  assert.equal(compact(watch), '1:42')
  assert.equal(compact(watch, deploy, preview), '3 · running')
  assert.equal(compact({ ...watch, state: 'paused', nextAt: undefined }), 'paused')
})

test('below the compact room only the dot is left', () => {
  const fit = lineFit(DOT_WIDTH, lineOf(watch), measure)
  assert.equal(fit.form, 'dot')
  assert.equal(shownWords(lineOf(watch), fit), '')
})
