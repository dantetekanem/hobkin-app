import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement, useState } from 'react'
import { ArriveAs, Arrivals, useArrival } from '../src/features/agent-activity/arrive.ts'
import { mountCounting } from './render-count.ts'

test('rows drawn with the transcript are simply there, and only a row that comes later arrives', async () => {
  const classes = new Map<string, string | undefined>()
  const Row = ({ id }: { id: string }) => {
    classes.set(id, useArrival())
    return null
  }
  let add = (_id: string) => {}
  const List = () => {
    const [rows, setRows] = useState(['a', 'b'])
    add = (id) => setRows((now) => [...now, id])
    return createElement(Arrivals, null, ...rows.map((id) => createElement(Row, { key: id, id })))
  }
  const mounted = await mountCounting(() => createElement(List))
  assert.deepEqual([...classes.values()].filter(Boolean).length, 0, 'none of the rows drawn with it arrives')

  await mounted.change(() => add('c'))
  assert.equal(classes.get('c'), 'aa-arrive')
  assert.deepEqual([classes.get('a'), classes.get('b')], [undefined, undefined], 'the rows there before stay as they are')
  await mounted.unmount()
})

test('a row outside any transcript list does not arrive', async () => {
  let shown: string | undefined = 'unset'
  const Row = () => {
    shown = useArrival()
    return null
  }
  const mounted = await mountCounting(() => createElement(Row))
  assert.equal(shown, undefined)
  await mounted.unmount()
})

test('a row of a windowed list arrives only when its list says so, and a group inside it arrives as anywhere', async () => {
  const classes = new Map<string, string | undefined>()
  const Row = ({ id }: { id: string }) => {
    classes.set(id, useArrival())
    return null
  }
  let add = (_id: string) => {}
  const Group = () => {
    const [rows, setRows] = useState(['inner a'])
    add = (id) => setRows((now) => [...now, id])
    return createElement(Arrivals, null, ...rows.map((id) => createElement(Row, { key: id, id })))
  }
  const List = () =>
    createElement(
      Arrivals,
      null,
      createElement(ArriveAs, { key: 'new', arrives: true }, createElement(Row, { id: 'new' })),
      createElement(ArriveAs, { key: 'back', arrives: false }, createElement(Row, { id: 'back' }), createElement(Group)),
    )
  const mounted = await mountCounting(() => createElement(List))
  assert.equal(classes.get('new'), 'aa-arrive', 'a key the list did not have arrives, even as the list is first drawn')
  assert.equal(classes.get('back'), undefined, 'a row drawn again as it scrolls back into view does not')
  assert.equal(classes.get('inner a'), undefined)
  await mounted.change(() => add('inner b'))
  assert.equal(classes.get('inner b'), 'aa-arrive', 'a command that comes into a group drawn before arrives')
  await mounted.unmount()
})
