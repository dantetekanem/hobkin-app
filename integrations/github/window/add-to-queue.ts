import { useWorkUi, type Said } from '@/features/work/store.ts'
import { addedWords } from './issue-add.ts'
import { run } from './commands.ts'

/**
 * Add to queue on an issue's row: hobkin files the issue on the project whose repository it is in, first in the queue
 * (`github.issue.add`). The row's `place` shows it under way and keeps what hobkin said, as Work's own actions do.
 */
export async function addIssueToQueue(issue: { repo: string; number: number }, { live, place }: { live: boolean; place: string }): Promise<Said> {
  const { busy, forget, note } = useWorkUi.getState()
  if (busy[place]) return { tone: 'refused', text: 'This is already under way.' }

  forget(place)
  useWorkUi.setState({ busy: { ...busy, [place]: true } })

  let said: Said
  try {
    said = { tone: 'done', text: await addedWords(issue, { live, add: (args) => run('github.issue.add', args) }) }
  } catch (error) {
    said = { tone: 'refused', text: error instanceof Error ? error.message : String(error) }
  }

  const { [place]: _done, ...stillBusy } = useWorkUi.getState().busy
  useWorkUi.setState({ busy: stillBusy })
  if (said.text) note(place, said)
  return said
}
