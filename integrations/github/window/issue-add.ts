/** Add to queue with no host: its row shows it added, so its chip can be seen, and its words say nothing reached hobkin. */
export const SAMPLE_ADDED = 'This is sample data, so nothing reached hobkin. With a host, hobkin files the issue on the project whose repository it is in, first in the queue.'

/** What hobkin said of an issue added to its queue: the host's own words, or the sample's. A refusal rejects. */
export async function addedWords(issue: { repo: string; number: number }, { live, add }: { live: boolean; add: (args: { repo: string; number: number }) => Promise<{ message: string }> }): Promise<string> {
  if (!live) return SAMPLE_ADDED
  const { message } = await add({ repo: issue.repo, number: issue.number })
  return message
}
