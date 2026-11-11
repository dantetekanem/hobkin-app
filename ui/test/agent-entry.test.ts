import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnimatePresence, motion } from 'motion/react'
import { agentEntry, agentReading, entryTransition } from '../src/features/work/agent-entry.ts'
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
  const readable = () => agentReading(true, fixture.entries.length > 0, false)
  assert.equal(readable(), false)
  fixture.entries.push({ id: 'existing-step' })
  assert.equal(readable(), true)
  fixture.entries.push({ id: 'next-step' })
  assert.equal(readable(), true)
  assert.equal(agentReading(false, true, true), false)
  assert.equal(agentReading(true, false, true), true, 'talk retains its empty input room')
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
