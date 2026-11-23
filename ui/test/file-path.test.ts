import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cutParts, fitPath } from '../src/components/file-path.ts'

/** Every character one unit wide, so a width reads as a count of characters. */
const chars = (text: string) => [...text].length

const DEEP = 'super/log/path/app/models/change.rb'

test('a path that fits is shown whole', () => {
  assert.equal(fitPath('app/models/change.rb', 20, chars), 'app/models/change.rb')
  assert.equal(fitPath('app/models/change.rb', 400, chars), 'app/models/change.rb')
})

test('before its row is measured, a path is shown whole', () => {
  assert.equal(fitPath(DEEP, 0, chars), DEEP)
  assert.equal(fitPath(DEEP, -3, chars), DEEP)
  assert.equal(fitPath(DEEP, Number.NaN, chars), DEEP)
})

test('a long path loses its first folders one by one, with one mark where they were', () => {
  assert.equal(fitPath(DEEP, 34, chars), '…/log/path/app/models/change.rb')
  assert.equal(fitPath(DEEP, 30, chars), '…/path/app/models/change.rb')
  assert.equal(fitPath(DEEP, 26, chars), '…/app/models/change.rb')
  assert.equal(fitPath(DEEP, 21, chars), '…/models/change.rb')
  assert.equal(fitPath(DEEP, 18, chars), '…/models/change.rb')
  assert.equal(fitPath(DEEP, 17, chars), '…/change.rb')
  assert.equal(fitPath(DEEP, 11, chars), '…/change.rb')
})

test('the file name stays whole while it fits, and only then is cut from its front', () => {
  // No room for the mark and the name together: the name alone.
  assert.equal(fitPath(DEEP, 10, chars), 'change.rb')
  assert.equal(fitPath(DEEP, 9, chars), 'change.rb')
  // The name alone is wider than the row: its end stays, after the mark.
  assert.equal(fitPath(DEEP, 8, chars), '…ange.rb')
  assert.equal(fitPath(DEEP, 2, chars), '…b')
  assert.equal(fitPath(DEEP, 1, chars), '…')
  assert.equal(fitPath('src/a_very_long_generated_file_name.ts', 12, chars), '…ile_name.ts')
})

test('a path with no folder is cut only in its name', () => {
  assert.equal(fitPath('README.md', 9, chars), 'README.md')
  assert.equal(fitPath('README.md', 6, chars), '…ME.md')
})

test('an absolute path never shows a mark that leaves nothing out', () => {
  const path = '/srv/code/app/models/change.rb'
  assert.equal(fitPath(path, path.length - 1, chars), '…/code/app/models/change.rb')
  assert.equal(fitPath(path, 20, chars), '…/models/change.rb')
})

test('a home path loses its ~ like any other folder', () => {
  const path = '~/code/app/models/change.rb'
  // Its first cut, …/code, is as long as the path, so the next one is taken.
  assert.equal(fitPath(path, path.length - 1, chars), '…/app/models/change.rb')
})

test('a Windows path is cut at its own separators', () => {
  assert.equal(fitPath('C:\\Users\\dev\\app\\models\\change.rb', 18, chars), '…\\models\\change.rb')
  assert.equal(fitPath('C:\\Users\\dev\\app\\models\\change.rb', 12, chars), '…\\change.rb')
})

test('a folder path keeps its last folder and its closing separator', () => {
  assert.equal(fitPath('ui/src/features/', 13, chars), '…/features/')
  assert.equal(fitPath('ui/src/features/', 9, chars), 'features/')
})

test('the cut follows measured pixels, not characters', () => {
  // JetBrains Mono at 12px is 7.2px a character; the window's text tracking takes 0.196px from each.
  const mono = (text: string) => [...text].length * (7.2 - 0.196)
  // A row with 130px for the path.
  assert.equal(fitPath(DEEP, 130, mono), '…/models/change.rb')
  // A wide row.
  assert.equal(fitPath(DEEP, 260, mono), DEEP)
  // Narrow letters let more of a proportional path stay.
  const narrowI = (text: string) => [...text].reduce((sum, char) => sum + (char === 'i' ? 0.5 : 1), 0)
  assert.equal(fitPath('xxxx/iiiiiiii/x.rb', 12, narrowI), '…/iiiiiiii/x.rb')
})

test('what the row holds unseen and what it shows add up to the whole path, which is what a copy takes', () => {
  for (const width of [0, 34, 21, 11, 10, 8, 1]) {
    const shown = fitPath(DEEP, width, chars)
    const parts = cutParts(DEEP, shown)
    assert.equal(parts.hidden + parts.kept, DEEP)
    assert.equal((parts.mark ? '…' : '') + parts.kept, shown)
  }
  assert.deepEqual(cutParts(DEEP, '…/models/change.rb'), { hidden: 'super/log/path/app', mark: true, kept: '/models/change.rb' })
  assert.deepEqual(cutParts(DEEP, 'change.rb'), { hidden: 'super/log/path/app/models/', mark: false, kept: 'change.rb' })
  assert.deepEqual(cutParts(DEEP, DEEP), { hidden: '', mark: false, kept: DEEP })
})
