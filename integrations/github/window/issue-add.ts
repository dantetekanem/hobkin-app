/** Add to queue with no host: its row shows it added, so its chip can be seen, and its words say nothing reached hobkin. */
export const SAMPLE_ADDED = 'This is sample data, so nothing reached hobkin. With a host, hobkin files the issue on the project whose repository it is in, first in the queue.'

/** Work on it again with no host. */
export const SAMPLE_AGAIN = 'This is sample data, so nothing reached hobkin. With a host, hobkin files a follow-up for the issue, first in the queue.'

type IssueAdd = { repo: string; number: number; again?: true }

/**
 * What hobkin said of an issue added to its queue, or, with `again`, worked on again as a follow-up: the host's own words, or the sample's.
 * A refusal rejects.
 */
export async function addedWords(
  issue: { repo: string; number: number },
  { live, again = false, add }: { live: boolean; again?: boolean; add: (args: IssueAdd) => Promise<{ message: string }> },
): Promise<string> {
  if (!live) return again ? SAMPLE_AGAIN : SAMPLE_ADDED
  const { message } = await add({ repo: issue.repo, number: issue.number, ...(again ? { again: true as const } : {}) })
  return message
}
