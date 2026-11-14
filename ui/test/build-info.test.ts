import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { restartOnBump, VERSION_FILES, versionOf } from '../build-info.ts'

const appPackage = path.resolve(import.meta.dirname, '../../package.json')

/** A dev server that only counts its restarts. */
function fakeServer() {
  const watched: string[] = []
  const watcher = Object.assign(new EventEmitter(), {
    add: (files: string[]) => {
      watched.push(...files)
    },
  })
  const server = {
    watcher,
    restarts: 0,
    restart: async () => {
      server.restarts += 1
    },
  }
  return { server, watched }
}

test('the version the app shows is the one in package.json', () => {
  const { version } = JSON.parse(readFileSync(appPackage, 'utf8')) as { version: string }

  assert.equal(VERSION_FILES.app, appPackage)
  assert.equal(versionOf(VERSION_FILES.app), version)
  assert.equal(versionOf(path.join(import.meta.dirname, 'no-such-package.json')), 'unknown')
})

test('a bump of the app or of the hobkin core restarts the dev server, and no other change does', () => {
  const { server, watched } = fakeServer()

  restartOnBump(server)
  assert.deepEqual(watched, [VERSION_FILES.app, VERSION_FILES.core])

  server.watcher.emit('change', path.resolve(import.meta.dirname, '../src/main.tsx'))
  assert.equal(server.restarts, 0)

  server.watcher.emit('change', VERSION_FILES.app)
  server.watcher.emit('change', VERSION_FILES.core)
  assert.equal(server.restarts, 2)
})
