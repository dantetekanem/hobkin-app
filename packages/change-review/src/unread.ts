/**
 * Whether anything reads the files of a change. A change of documents nothing else names changes nothing that runs,
 * builds or generates: code can say so (`onlyUnread`), and the Reviewer rates it by that. A document code, a build, a
 * CI job or a generator names by its path or its file name is read, so it is rated as code, whatever its extension.
 */
import { classify } from './triage.ts'
import type { ChangedFile, RepoReader } from './types.ts'

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const nameOf = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

/** A file by its path alone: documentation that no other kind of file claims. */
const isDocument = (path: string) => classify({ path, status: 'modified', added: 0, deleted: 0, binary: false }).kind === 'docs'

/**
 * True when every changed file is documentation and no file at head that is not documentation names any of them, by
 * path or by file name. Reading is searched in the repository at head, so a name in a script, a workflow or a test
 * counts: when in doubt the change is not unread. False for a change with no files.
 */
export async function changesOnlyUnread(files: readonly ChangedFile[], repo: Pick<RepoReader, 'grep'>, head: string): Promise<boolean> {
  if (!files.length || !files.every((file) => !file.binary && isDocument(file.path))) return false
  const names = [...new Set(files.flatMap((file) => [file.path, nameOf(file.path), ...(file.oldPath ? [file.oldPath, nameOf(file.oldPath)] : [])]))]
  const hits = await repo.grep(head, names.map(escape).join('|'))
  return !hits.some((hit) => !isDocument(hit.path))
}
