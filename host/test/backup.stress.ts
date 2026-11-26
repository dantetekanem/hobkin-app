import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { backupNow } from '../src/backup.ts'
import { temporaryDirectory } from './support.ts'

// Run explicitly with pnpm test:backup:stress; the regular suite only discovers *.test.ts.
test('fifty thousand names all reach the zip', async (t) => {
  const base = temporaryDirectory(t)
  const source = join(base, 'home')
  const directory = join(base, 'home-backups')
  mkdirSync(join(source, 'notes'), { recursive: true })
  const count = 50_000
  for (let i = 0; i < count; i++) writeFileSync(join(source, 'notes', `note-${i}.md`), String(i))
  const entry = await backupNow(source, directory, Date.UTC(2026, 10, 12, 22, 30))
  const inside = new Set(execFileSync('unzip', ['-Z1', join(directory, entry.name)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n'))
  for (let i = 0; i < count; i++) assert.ok(inside.has(`home/notes/note-${i}.md`))
})
