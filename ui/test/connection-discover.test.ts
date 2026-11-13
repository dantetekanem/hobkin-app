import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handshakeFor } from '../src/lib/host/discover.ts'

const USUAL = 'http://127.0.0.1:5188/dev/handshake'

test('a development page asks the host its address names, and only that one', () => {
  assert.equal(handshakeFor('?host=5189', true), 'http://127.0.0.1:5189/dev/handshake')
  assert.equal(handshakeFor('?setup=1&host=5189', true), 'http://127.0.0.1:5189/dev/handshake')
  assert.equal(handshakeFor('?host=1024', true), 'http://127.0.0.1:1024/dev/handshake')
  assert.equal(handshakeFor('?host=65535', true), 'http://127.0.0.1:65535/dev/handshake')
})

test('without a port it can use, the page asks the usual host, as before', () => {
  assert.equal(handshakeFor('', true), USUAL)
  assert.equal(handshakeFor('?setup=1', true), USUAL)
  for (const junk of ['?host=', '?host=abc', '?host=5189x', '?host=+5189', '?host=51.89', '?host=-5189', '?host= 5189', '?host=example.invalid:5189', '?host=1023', '?host=0', '?host=65536', '?host=99999999999999999999']) {
    assert.equal(handshakeFor(junk, true), USUAL, junk)
  }
})

test('a build that is not for development asks no host at all', () => {
  assert.equal(handshakeFor('', false), null)
  assert.equal(handshakeFor('?host=5189', false), null)
})
