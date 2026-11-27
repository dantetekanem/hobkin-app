import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/** The version a package.json in this repository names, by its path from this file. */
function versionOf(path: string): string {
  return (JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as { version: string }).version
}

// The user, 2026-11-27: "core should be the same 0.2.5, always the same as package".
test("hobkin's core always has the app's version", () => {
  assert.equal(versionOf('../../packages/hobkin/package.json'), versionOf('../../package.json'))
})
