import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hostSource } from '../src/lib/host/discover.ts'

test('a host the shell handed over wins over everything', () => {
  assert.equal(hostSource({ handed: true, macWindow: true, dev: true }), 'handed')
  assert.equal(hostSource({ handed: true, macWindow: false, dev: false }), 'handed')
})

test('development keeps asking the handshake, in a tab or in the Mac window', () => {
  assert.equal(hostSource({ handed: false, macWindow: false, dev: true }), 'handshake')
  assert.equal(hostSource({ handed: false, macWindow: true, dev: true }), 'handshake')
})

test('a built Mac window asks the shell, and a built tab has no way to find a host', () => {
  assert.equal(hostSource({ handed: false, macWindow: true, dev: false }), 'shell')
  assert.equal(hostSource({ handed: false, macWindow: false, dev: false }), 'none')
})
