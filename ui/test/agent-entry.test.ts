import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnimatePresence, motion } from 'motion/react'
import { agentEntry, agentReading, entryTransition, keepsPreview } from '../src/features/work/agent-entry.ts'
import { isStill } from '../src/app/still-rule.ts'

test('the shared entry is quick and continuous: one spring with no bounce, faster than a screen push, and no count-dependent delay', () => {
  for (const count of [1, 2, 41]) {
    const participants = Array.from({ length: count }, () => entryTransition(true, false, { duration: 0.62 }))
    assert.ok(Math.max(...participants.map((part) => (part.duration + ('delay' in part ? part.delay : 0)) * 1000)) <= 340)
    assert.deepEqual(agentEntry(false), { type: 'spring', duration: 0.32, bounce: 0, delay: 0 })
  }
})

test('existing and newly delivered content is readable synchronously, with no fabricated empty exchange', () => {
  const fixture = { entries: [] as { id: string }[] }
  const readable = () => agentReading(true, fixture.entries.length > 0)
  assert.equal(readable(), false)
  fixture.entries.push({ id: 'existing-step' })
  assert.equal(readable(), true)
  fixture.entries.push({ id: 'next-step' })
  assert.equal(readable(), true)
  assert.equal(agentReading(false, true), false)
})

test('snapshot presence initializes explicit nested entrances at their readable target', () => {
  const row = createElement(motion.li, {
    initial: { opacity: 0, transform: 'translateY(24px)' },
    animate: { opacity: 1, transform: 'translateY(0px)', transition: { duration: 0.6, delay: 0.4 } },
  }, 'existing step')
  const snapshot = renderToStaticMarkup(createElement(AnimatePresence, { initial: false }, createElement(motion.ol, {}, row)))
  assert.match(snapshot, /opacity:1;transform:translateY\(0px\)/)
  const arrival = renderToStaticMarkup(createElement(AnimatePresence, {}, row))
  assert.match(arrival, /opacity:0;transform:translateY\(24px\)/, 'an enabled arrival boundary still starts at the live-item entrance')
})

test('effective Still and reduced System are immediate; unrelated transitions retain identity', () => {
  for (const [setting, reduce] of [['still', false], ['system', true]] as const) {
    assert.equal(agentEntry(isStill(setting, reduce)).duration, 0)
    assert.equal(agentEntry(isStill(setting, reduce)).delay, 0)
  }
  assert.equal(agentEntry(isStill('lively', true)).duration, 0.32)
  const other = { type: 'spring', duration: 0.62 }
  assert.equal(entryTransition(false, false, other), other)
})

test('a click or the keyboard in an agent previewed from the list keeps it open, whether the walk began on a screen or on an agent', () => {
  const view = (previewReturn: 'work' | null, previewFrom: string | null) => ({ screen: 'agent' as const, openAgent: 'a2', previewReturn, previewFrom })
  assert.equal(keepsPreview(view('work', null), 'a2'), true, 'a walk that began on the Work screen')
  assert.equal(keepsPreview(view(null, 'a1'), 'a2'), true, "a walk that began on another agent's window")
  assert.equal(keepsPreview(view(null, null), 'a2'), false, 'an agent opened for good has no preview to keep')
  assert.equal(keepsPreview(view('work', null), 'a3'), false, 'another agent is on screen')
  assert.equal(keepsPreview({ ...view('work', null), screen: 'work' }, 'a2'), false)
})
