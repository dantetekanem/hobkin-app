import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement, useState } from 'react'
import { Arrivals, useArrival } from '../src/features/agent-activity/arrive.ts'
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
