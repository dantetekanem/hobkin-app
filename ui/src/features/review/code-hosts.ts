/**
 * The window learns the code hosts the home names besides GitHub each time it reaches the host, so a pull request page
 * on one of them opens as its review everywhere, board cards included. An older host that knows no such command names
 * none, and nothing changes.
 */
import { learnCodeHosts, type NamedCodeHost } from '#shared/review/ids.ts'

/** The host link, as the window's host store keeps it. */
interface LinkStore {
  getState(): { link: string }
  subscribe(listener: (now: { link: string }, before: { link: string }) => void): () => void
}

/** Asks the host for the named code hosts. */
type AskHosts = () => Promise<{ hosts: NamedCodeHost[] }>

/** Learns the named hosts now if the host is reached, and again each time it is reached anew. Answers the function that stops it. */
export function learnCodeHostsOnConnect(store: LinkStore, ask: AskHosts): () => void {
  const learn = async () => {
    try {
      learnCodeHosts((await ask()).hosts)
    } catch {
      // A host that cannot say keeps what was learned before.
    }
  }
  if (store.getState().link === 'open') void learn()
  return store.subscribe((now, before) => {
    if (now.link === 'open' && before.link !== 'open') void learn()
  })
}
