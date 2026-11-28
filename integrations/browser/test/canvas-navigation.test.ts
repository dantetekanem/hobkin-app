import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readCanvas } from 'hobkin/src/cli/canvas.mjs'
import { answered, callTool, readyPart, stateOf } from './support.ts'

test('a durable agent opens its visible canvas, then reads the page the user navigated to without starting Chrome', async t => {
  const { part, root, engine } = await readyPart(t)
  const owner = '0a1b2c3d', agent = `hobkin:${owner}:4`
  const opened = await callTool(part, { target: 'canvas', do: 'open', url: 'https://example.org/' }, agent)
  assert.equal(opened.failed, false, opened.text)
  assert.equal(readCanvas(root, owner).state.url, 'https://example.org/')
  const pending = callTool(part, { target: 'canvas', do: 'read' }, agent)
  await new Promise(resolve => setImmediate(resolve))
  const [request] = stateOf(part).navigation!
  assert.equal(request!.owner, owner)
  assert.equal(await answered(part, 'browser.canvas.claim', { id: request!.id, owner: 'main' }), null)
  assert.deepEqual(await answered(part, 'browser.canvas.claim', { id: request!.id, owner }), { do: 'read' })
  assert.equal(await answered(part, 'browser.canvas.claim', { id: request!.id, owner }), null)
  await answered(part, 'browser.canvas.finish', { id: request!.id, owner, text: 'https://example.org/about' })
  assert.match((await pending).text, /example.org\/about/)
  assert.equal(engine.calls.length, 0)
})

test('interactive steps reach only the visible canvas, without exposing typed text in shared state', async t => {
  const { part, engine } = await readyPart(t)
  await callTool(part, { target: 'canvas', do: 'open', url: 'https://example.org' })
  const steps = [
    { do: 'fill', on: 'Email', text: 'draft@example.org' }, { do: 'type', on: 'Message', text: 'hello' },
    { do: 'press', key: 'Enter' }, { do: 'click', on: 'Submit' }, { do: 'select', on: 'Plan', option: 'Basic' },
    { do: 'drag', on: 'Draft', to: 'Ready' }, { do: 'hover', on: 'Help' }, { do: 'scroll', by: 210 }, { do: 'upload', on: 'Choose folder' },
  ]
  const pending = callTool(part, { target: 'canvas', steps, json: true })
  for (const step of steps) {
    await new Promise(resolve => setImmediate(resolve))
    const [request] = stateOf(part).navigation ?? []
    assert.ok(request, step.do)
    assert.deepEqual(Object.keys(request).sort(), ['id', 'owner', 'revision'])
    const key = { id: request.id, owner: 'main' }
    assert.deepEqual(await answered(part, 'browser.canvas.claim', key), step)
    await answered(part, 'browser.canvas.finish', { ...key, text: 'ok' })
  }
  assert.equal(JSON.parse((await pending).text).ok, true)
  assert.equal(engine.calls.length, 0)
})

test('canvas commands never fall back to isolated automation or let a background run take a canvas', async t => {
  const { part, engine } = await readyPart(t)
  for (const [agent, input] of [['#main', { do: 'eval', code: '1' }], ['work-123', { do: 'open', url: 'https://example.org' }]] as const) {
    assert.equal((await callTool(part, { target: 'canvas', ...input }, agent)).failed, true)
  }
  assert.equal(engine.calls.length, 0)
})
