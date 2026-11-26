import { createHash } from 'node:crypto'

/**
 * Which browser an agent gets. The engine keeps one browser per session name, so the name is made from the agent the
 * host says is calling and from nothing the agent wrote: no call can reach another agent's browser.
 */

/** A turn of a durable hobkin: `hobkin:<8 hex>:<n>`. Its browser is the hobkin's, the same from turn to turn. */
const DURABLE_TURN = /^hobkin:([0-9a-f]{8}):\d+$/

export interface AgentSession {
  /** The engine's session name: letters, digits and `-`. */
  name: string
  /** Words for a person. */
  label: string
}

export function sessionFor(agent: string, prefix = 'hobkin'): AgentSession {
  if (agent === '#main') return { name: `${prefix}-main`, label: 'Main chat' }
  const durable = DURABLE_TURN.exec(agent)?.[1]
  if (durable) return { name: `${prefix}-${durable}`, label: `hobkin ${durable}` }
  // A run's id may hold anything, so the name is made from its hash.
  const hash = createHash('sha1').update(agent).digest('hex').slice(0, 12)
  return { name: `${prefix}-run-${hash}`, label: agent.length > 16 ? `${agent.slice(0, 12)}…` : agent }
}
