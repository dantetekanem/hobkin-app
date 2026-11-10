/**
 * Pull requests for the scripted host, whose GitHub page is made-up data: each one reads as the real hobkin commit
 * the sample review was built from, so the whole preparation can be watched without reaching GitHub. The review says
 * which commit it is, and the host posts nothing for it.
 */
import { readFileSync } from 'node:fs'
import { captureChange, type ChangedPath, type ChangeReader } from '#shared/review/capture.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import type { ReviewSource } from './sources.ts'

const FOLDER = new URL('../../../ui/src/features/review/sample/', import.meta.url)

function load() {
  try {
    const review = JSON.parse(readFileSync(new URL('review.json', FOLDER), 'utf8')) as Review
    const files = JSON.parse(readFileSync(new URL('files.json', FOLDER), 'utf8')) as ReviewFileContents[]
    return { change: review.change, specPath: review.spec?.path ?? null, files }
  } catch {
    throw new Error('The sample change is not here. `node scripts/review-sample.ts` writes it.')
  }
}

export function sampleReviewSource(): ReviewSource {
  return {
    head: async () => load().change.head,
    async read() {
      const { change, specPath, files } = load()
      const byPath = new Map(files.map((file) => [file.path, file]))
      const changed = files.filter((file) => file.base !== file.head)
      const reader: ChangeReader = {
        changed: async () =>
          changed.map((file): ChangedPath => {
            const moved = file.oldPath !== undefined && file.oldPath !== file.path
            const status = file.base == null ? 'added' : file.head == null ? 'deleted' : moved ? 'renamed' : 'modified'
            return { path: file.path, ...(moved ? { oldPath: file.oldPath } : {}), status }
          }),
        read: async (commit, path) => {
          const file = byPath.get(path) ?? files.find((entry) => entry.oldPath === path)
          const text = commit === change.base ? file?.base : file?.head
          return text == null ? { kind: 'missing' } : { kind: 'text', text }
        },
      }
      const spec = specPath ? byPath.get(specPath)?.head : null
      return {
        change: { project: change.project, item: change.item, title: change.title, branch: change.branch },
        capture: await captureChange(reader, change.base, change.head),
        spec: specPath && spec ? { path: specPath, text: spec } : null,
        readHead: async (path) => byPath.get(path)?.head ?? null,
      }
    },
  }
}
