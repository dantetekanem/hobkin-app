import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ReactElement } from 'react'
import { localTestGuides, revisionComparison } from '../src/features/actions/test-locally.ts'
import { readViews } from './view-draws.ts'

readViews()
const { LocalTestPanel } = await import('../src/features/actions/TestLocally.tsx')

test('only the RpsLeague deploy decision offers the repository-owned local testing guides', () => {
  assert.deepEqual(localTestGuides({ kind: 'deploy', slug: 'rpsleague', items: ['123'] }), [
    'Prepare, start and stop locally',
    'Browser walkthrough',
  ])
  assert.equal(localTestGuides({ kind: 'merge', slug: 'rpsleague' }), null)
  assert.equal(localTestGuides({ kind: 'deploy', slug: 'other' }), null)
  assert.equal(localTestGuides(null), null)
})

test('skipping and Escape close the native testing step without answering the deploy decision', () => {
  const panel = LocalTestPanel({ labels: ['Setup', 'Walkthrough'], info: null, refresh() {}, loading: false, openFile() {} })
  const [summary, contents] = panel.props.children as ReactElement<{ children: ReactElement[] }>[]
  assert.equal(panel.type, 'details')
  assert.equal(summary!.type, 'summary')
  const skip = contents!.props.children.findLast((child) => child?.type === 'button') as ReactElement<{ onClick: (event: unknown) => void }>
  assert.ok(skip)
  let focused = false
  const details = { open: true, querySelector: () => ({ focus: () => { focused = true } }) }
  skip.props.onClick({ currentTarget: { closest: () => details } })
  assert.equal(details.open, false)
  assert.equal(focused, true)

  details.open = true
  let stopped = false
  const event = { key: 'Escape', currentTarget: details, preventDefault() {}, stopPropagation() { stopped = true } }
  panel.props.onKeyDown(event)
  assert.equal(details.open, false)
  assert.equal(stopped, true)
  stopped = false
  panel.props.onKeyDown({ ...event, key: '2' })
  assert.equal(stopped, true, 'the decision’s numbered approval shortcut does not run from the testing step')

  const walked: boolean[] = []
  const controls = [{ toggleAttribute: (_name: string, open: boolean) => walked.push(open) }]
  panel.props.onToggle({ currentTarget: { open: true, querySelectorAll: () => controls } })
  panel.props.onToggle({ currentTarget: { open: false, querySelectorAll: () => controls } })
  assert.deepEqual(walked, [true, false], 'keyboard stop traversal excludes hidden testing controls')
})

test('native testing opens a guide path returned by the host, not a remote URL', () => {
  const info = { repo: '/checkout', head: 'a', candidate: 'a', dirty: false, guides: ['/checkout/guides/rpsleague-local-setup.md', null] }
  let opened = ''
  const panel = LocalTestPanel({ labels: ['Setup', 'Walkthrough'], info, loading: false, refresh() {}, openFile(path) { opened = path } })
  const [, contents] = panel.props.children
  const buttons = contents.props.children.find(Array.isArray)
  buttons[0].props.onClick()
  assert.equal(opened, info.guides[0])
  assert.notEqual(buttons[1].type, 'button')
  assert.match(revisionComparison(info), /matches.*clean/)
  assert.match(revisionComparison({ ...info, candidate: 'b' }), /differs/)
  assert.match(revisionComparison({ ...info, dirty: true }), /uncommitted/)
  assert.match(revisionComparison(null), /unavailable/)
})
