import type { ChatMessage } from './snapshot.ts'

/**
 * How the conversation changes on the wire. hobkin keeps the last 100 messages and rebuilds the list on every refresh,
 * so the host sends only what differs: a reply appended, a notice slotted in by its time, the oldest message dropped.
 */
export type MessageOp =
  /** Replace the whole list. */
  | { op: 'reset'; messages: ChatMessage[] }
  /** Add to the end. */
  | { op: 'append'; messages: ChatMessage[] }
  /** Put in front of the message with this id. */
  | { op: 'insert'; before: string; message: ChatMessage }
  /** Replace the message with this id, in place. */
  | { op: 'update'; id: string; message: ChatMessage }
  | { op: 'remove'; ids: string[] }

/** The steps from one list to the next. Applying them to `previous` gives `next` exactly. */
export function diffMessages(previous: readonly ChatMessage[], next: readonly ChatMessage[]): MessageOp[] {
  const reset: MessageOp[] = [{ op: 'reset', messages: [...next] }]
  if (!previous.length) return next.length ? reset : []

  const before = new Map(previous.map((message) => [message.id, message]))
  const after = new Map(next.map((message) => [message.id, message]))
  if (before.size !== previous.length || after.size !== next.length) return reset

  // Messages on both sides must keep their order, or the lists differ by more than these steps can say.
  const kept = previous.filter((message) => after.has(message.id))
  const keptInNext = next.filter((message) => before.has(message.id))
  if (!kept.length || kept.some((message, index) => message.id !== keptInNext[index]!.id)) return reset

  const ops: MessageOp[] = []
  const removed = previous.filter((message) => !after.has(message.id)).map((message) => message.id)
  if (removed.length) ops.push({ op: 'remove', ids: removed })

  const lastKept = next.findLastIndex((message) => before.has(message.id))
  next.slice(0, lastKept).forEach((message, index) => {
    if (before.has(message.id)) return
    // The anchor is a kept message, so it is in the list whatever was inserted so far.
    const anchor = next.slice(index + 1, lastKept + 1).find((later) => before.has(later.id))!
    ops.push({ op: 'insert', before: anchor.id, message })
  })
  const appended = next.slice(lastKept + 1)
  if (appended.length) ops.push({ op: 'append', messages: appended })

  // The same object is the same message, so only one that was replaced is compared.
  for (const message of keptInNext) {
    const old = before.get(message.id)
    if (old !== message && JSON.stringify(old) !== JSON.stringify(message)) ops.push({ op: 'update', id: message.id, message })
  }
  return ops
}

export function applyMessageOps(messages: readonly ChatMessage[], ops: readonly MessageOp[]): ChatMessage[] {
  let list = [...messages]
  for (const step of ops) {
    if (step.op === 'reset') list = [...step.messages]
    else if (step.op === 'append') list.push(...step.messages)
    else if (step.op === 'remove') list = list.filter((message) => !step.ids.includes(message.id))
    else if (step.op === 'update') list = list.map((message) => (message.id === step.id ? step.message : message))
    else {
      const at = list.findIndex((message) => message.id === step.before)
      list.splice(at === -1 ? list.length : at, 0, step.message)
    }
  }
  return list
}
