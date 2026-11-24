import assert from 'node:assert/strict'
import test from 'node:test'
import { customWidgetsOf, layoutOf, orderWidgets, WIDGET_ORDER } from '../src/features/home/widgets.ts'
import type { ConnectionTile, HomeModel, HomeRow, HomeTone, NeedRow, WidgetKind } from '../src/features/home/types.ts'

const tile = (tone: HomeTone): ConnectionTile => ({ key: tone, name: tone, status: '', tone, note: null, mark: { symbol: 'Gh', hue: 0 }, target: { to: 'screen', screen: 'github' } })

const row = (tone: HomeTone): HomeRow => ({ id: tone, title: '', detail: null, tone, aside: null, action: { label: '', target: { to: 'screen', screen: 'work' } } })
const rows = (...tones: HomeTone[]) => tones.map(row)
const needRows = (...tones: HomeTone[]): NeedRow[] => tones.map(tone => ({ ...row(tone), kind: 'decision' }))

type Model = Omit<HomeModel, 'widgets'>
const model = (over: Partial<Model>): Model => ({
  strip: [],
  header: { title: '', line: null, chips: [], mood: 'idle' },
  stack: [],
  needs: { rows: [], more: 0 },
  running: { rows: [], held: null, slots: null, queue: [] },
  upcoming: { rows: [], day: { start: 0, end: 0, now: 0, marks: [] }, summary: '' },
  problems: { rows: [], more: 0 },
  projects: { rows: [] },
  connections: { known: false, lift: 0, tiles: [], summary: null },
  week: { days: [], completed: 0, unfinished: 0, wins: null },
  yolo: null,
  ...over,
})

const order = (m: Model) => orderWidgets(m, null).map(widget => widget.kind)

test('a calm dashboard keeps the ambient order and hides what does not apply', () => {
  // Nothing urgent, no connections/projects: those three drop out; the day's shape leads, empty cards sink.
  assert.deepEqual(order(model({})), ['upcoming', 'running', 'week', 'needs', 'problems'])
})

test('urgent widgets float to the top; empty ones sink', () => {
  const m = model({
    needs: { rows: needRows('accent'), more: 0 },
    problems: { rows: rows('bad'), more: 1 },
    running: { rows: [], held: null, slots: null, queue: [] },
    connections: { known: true, lift: 1, tiles: [tile('warn')], summary: null },
  })
  const ranked = order(m)
  // Needs (waiting on you) leads, then a fresh problem, then the connections sign-in, then ambient cards.
  assert.deepEqual(ranked.slice(0, 2), ['needs', 'problems'])
  assert.ok(ranked.indexOf('connections') < ranked.indexOf('upcoming'), 'a sign-in and failing checks outrank the timeline')
  assert.ok(ranked.indexOf('connections') < ranked.indexOf('week'), 'a sign-in outranks the week recap')
  assert.ok(ranked.indexOf('needs') < ranked.indexOf('connections'))
})

test('held work and active agents lift Running now above the ambient cards', () => {
  assert.equal(order(model({ running: { rows: [], held: 'Paused by you', slots: null, queue: [] } }))[0], 'running')
  assert.equal(order(model({ running: { rows: rows('info'), held: null, slots: null, queue: [] } }))[0], 'running')
})

test('layoutOf validates an external order and hidden set, dropping unknown kinds', () => {
  assert.equal(layoutOf(null), null)
  assert.equal(layoutOf({}), null)
  assert.equal(layoutOf({ order: ['nope'] }), null)
  assert.deepEqual(layoutOf({ order: ['week', 'bogus', 'needs'], hidden: ['projects', 1] }), { order: ['week', 'needs'], hidden: ['projects'] })
})

test('an external layout drives order and hides kinds, the client ranks the rest', () => {
  const m = model({ needs: { rows: needRows('accent'), more: 0 }, running: { rows: rows('info'), held: null, slots: null, queue: [] } })
  const widgets = orderWidgets(m, { order: ['week', 'running'], hidden: ['needs'] }).map(w => w.kind)
  assert.equal(widgets.includes('needs'), false, 'hidden kind is gone even though it is urgent')
  assert.deepEqual(widgets.slice(0, 2), ['week', 'running'], 'named kinds lead in the given order')
})

test('every widget kind is covered by the default order', () => {
  const kinds: WidgetKind[] = ['needs', 'running', 'upcoming', 'problems', 'projects', 'connections', 'week']
  assert.deepEqual([...WIDGET_ORDER].sort(), [...kinds].sort())
})

// The London example the user asked for: hobkin fetches the values and writes them into a keyvalue spec.
const london = {
  id: 'london',
  title: 'London',
  body: { kind: 'keyvalue', rows: [{ k: 'Weather', v: 'Rain · 14°C' }, { k: 'Time', v: '20:14' }] },
  updatedAt: '2026-11-12T20:14:00Z',
}

test('customWidgetsOf keeps valid specs, drops malformed ones, and de-duplicates by id', () => {
  const kept = customWidgetsOf([
    london,
    { id: 'temp', title: 'Temp', body: { kind: 'stat', value: '14°C', label: 'Feels like 12°C' } },
    { id: 'note', title: 'Note', body: { kind: 'text', text: 'Bins go out tonight.' }, weight: 900 },
    { id: 'london', title: 'Duplicate', body: { kind: 'text', text: 'ignored' } },
    { id: 'bad-body', title: 'No body', body: { kind: 'stat' } },
    { id: '', title: 'No id', body: { kind: 'text', text: 'x' } },
    { title: 'Missing id', body: { kind: 'text', text: 'x' } },
    { id: 'empty-rows', title: 'Empty', body: { kind: 'keyvalue', rows: [] } },
    'nonsense',
    null,
  ])
  assert.deepEqual(kept.map(widget => widget.id), ['london', 'temp', 'note'])
  assert.deepEqual(kept[0]?.body, { kind: 'keyvalue', rows: [{ k: 'Weather', v: 'Rain · 14°C' }, { k: 'Time', v: '20:14' }] })
  assert.equal(kept[0]?.updatedAt, '2026-11-12T20:14:00Z')
  assert.equal(kept[1]?.body.kind === 'stat' && kept[1].body.label, 'Feels like 12°C')
  assert.equal(kept[2]?.weight, 900)
})

test('custom widgets join the same ordering: weighted ones rank by weight, the rest sit in the ambient band', () => {
  const m = model({ needs: { rows: needRows('accent'), more: 0 } })
  const custom = customWidgetsOf([london, { id: 'alert', title: 'Alert', body: { kind: 'text', text: 'Heads up' }, weight: 2000 }])
  const widgets = orderWidgets(m, null, custom)
  const ids = widgets.map(widget => widget.id)

  // A weight above every built-in wins the top; an unweighted custom lands in the ambient band, above the empty cards.
  assert.equal(ids[0], 'custom:alert')
  assert.ok(ids.indexOf('custom:london') < ids.indexOf('week'), 'the London widget sits among the ambient cards')
  assert.ok(ids.indexOf('custom:london') > ids.indexOf('needs'), 'but below a waiting Need')
  // Each custom widget carries its spec for the renderer, under a namespaced id that cannot collide with a built-in.
  const londonWidget = widgets.find(widget => widget.id === 'custom:london')
  assert.equal(londonWidget?.kind, 'custom')
  assert.equal(londonWidget?.custom?.title, 'London')
})
