import assert from 'node:assert/strict'
import { test } from 'node:test'
import { useViewer } from '../src/features/viewer/store.ts'

test('the viewer keeps its file while it closes, and opens on the next one', () => {
  const { openFile, closeViewer } = useViewer.getState()
  openFile('/tmp/a.md')
  assert.deepEqual({ open: useViewer.getState().open, path: useViewer.getState().path }, { open: true, path: '/tmp/a.md' })
  closeViewer()
  assert.deepEqual({ open: useViewer.getState().open, path: useViewer.getState().path }, { open: false, path: '/tmp/a.md' })
  openFile('~/b.txt')
  assert.deepEqual({ open: useViewer.getState().open, path: useViewer.getState().path }, { open: true, path: '~/b.txt' })
})
