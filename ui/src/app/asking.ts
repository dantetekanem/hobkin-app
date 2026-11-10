/**
 * Agents that are waiting for the user: a question only the user can answer, or help they asked for.
 * The frame puts them first in its lists and gives a key that jumps to them. See _specs/011-work.
 */
export interface Asking {
  id: string
  /** What the agent is waiting on the user for, in its own words. Absent while it gets on with its work. */
  asks?: string
}

/** The agent the jump goes to: the next one waiting after `current`, in list order, wrapping. Null when nobody waits. */
export function nextAsking(agents: readonly Asking[], current: string | null): string | null {
  const from = agents.findIndex((agent) => agent.id === current)
  for (let step = 1; step <= agents.length; step += 1) {
    const agent = agents[(from + step + agents.length) % agents.length]!
    if (agent.asks) return agent.id
  }
  return null
}

/** Agents waiting for the user first, each group in the order it had. */
export function waitingFirst<Agent extends Asking>(agents: readonly Agent[]): Agent[] {
  return [...agents.filter((agent) => agent.asks), ...agents.filter((agent) => !agent.asks)]
}

/**
 * An agent's question is answered in the same sheet as every other question (022-questions). Its id in the
 * sheet carries the agent, so the answer can find its way back to the agent that asked.
 */
const AGENT_QUESTION = 'agent:'

export function agentQuestionId(agentId: string): string {
  return AGENT_QUESTION + agentId
}

/** The agent that asked a question in the sheet, or null for a question that is not an agent's. */
export function agentOfQuestion(questionId: string): string | null {
  return questionId.startsWith(AGENT_QUESTION) ? questionId.slice(AGENT_QUESTION.length) : null
}

type Answered = { id: string; answer: { value: string } | { typed: string } }

/**
 * The agents whose questions were answered between two readings of the sheet's answers, each with the
 * answer in words: the chosen choice's label, or what the user typed.
 */
export function answeredAgents(
  before: readonly Answered[],
  after: readonly Answered[],
  labelOf: (agentId: string, value: string) => string | undefined,
): { agentId: string; text: string }[] {
  const seen = new Set(before.map(({ id }) => id))
  return after.flatMap(({ id, answer }) => {
    const agentId = agentOfQuestion(id)
    if (!agentId || seen.has(id)) return []
    const text = 'typed' in answer ? answer.typed : (labelOf(agentId, answer.value) ?? answer.value)
    return [{ agentId, text }]
  })
}
