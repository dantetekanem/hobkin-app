import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { closeCanvas, readCanvas, showPage } from 'hobkin/src/cli/canvas.mjs'
import { sessionCanvasOwner } from 'hobkin/src/cli/canvas-owner.mjs'
import type { HostContext } from '#host/integration-contract.ts'
import type { CanvasAction, CanvasRequest } from '../protocol.ts'
import type { BrowserStep } from './engine.ts'

/** Only the calling conversation's window can take its request. A closed/hidden canvas never falls back to Chrome. */
export function canvasNavigation(context: HostContext) {
  const waiting = new Map<string, { request: CanvasRequest; action: CanvasAction; claimed: boolean; end(text: string, failed?: boolean): void }>()
  const find = ({ id, owner }: { id: string; owner: string }) => {
    const job = waiting.get(id)
    return job?.request.owner === owner ? job : undefined
  }
  return {
    requests: () => [...waiting.values()].map(job => job.request),
    close: () => { for (const job of waiting.values()) job.end('Browser host closed.', true) },
    claim(key: { id: string; owner: string }) {
      const job = find(key)
      if (!job || job.claimed) return null
      job.claimed = true
      return job.action
    },
    finish(key: { id: string; owner: string; text: string; failed?: boolean }) {
      const job = find(key)
      if (job?.claimed) job.end(key.text, key.failed)
      return null
    },
    async run(agent: string, step: BrowserStep, signal?: AbortSignal): Promise<string> {
      const owner = agent === '#main' ? 'main' : /^hobkin:([0-9a-f]{8}):\d+$/.exec(agent)?.[1] ?? sessionCanvasOwner(agent)
      if (!owner) throw Error('Only a conversation with its own canvas can navigate it.')
      signal?.throwIfAborted()
      if (!context.connected()) throw Error('No Hobkin window is connected.')
      const root = context.dataRoot()
      if (step.do === 'open') {
        showPage(root, owner, { url: step.url })
        return 'Requested this page in your canvas.'
      }
      if (step.do === 'close') {
        closeCanvas(root, owner)
        return 'Closed your canvas.'
      }
      if (step.do === 'wait' && 'ms' in step) {
        await delay(step.ms, undefined, { signal })
        return 'Wait ended.'
      }
      if (step.do === 'console' || step.do === 'eval' || step.do === 'help' || step.do === 'screenshot') {
        throw Error(`${step.do} is not a canvas interaction.`)
      }
      const action: CanvasAction = step as CanvasAction
      const { state } = readCanvas(root, owner)
      if (!state.open || state.kind !== 'page') throw Error('Open a page in your canvas first.')
      const deadline = Date.now() + 25_000
      const ask = () => {
        signal?.throwIfAborted()
        if (readCanvas(root, owner).state.revision !== state.revision) throw Error('The canvas changed.')
        const id = randomUUID()
        return new Promise<string>((resolve, reject) => {
          const abort = () => end('Canvas interaction was cancelled.', true)
          const timeout = () => end('The visible canvas did not confirm the action. Inspect it before retrying.', true)
          const end = (text: string, failed = false) => {
            waiting.delete(id)
            clearTimeout(timer)
            signal?.removeEventListener('abort', abort)
            context.changed()
            if (failed) reject(Error(text))
            else resolve(text)
          }
          const timer = setTimeout(timeout, action.do === 'upload' ? 250_000 : 8000)
          waiting.set(id, { request: { id, owner, revision: state.revision }, action, claimed: false, end })
          signal?.addEventListener('abort', abort, { once: true })
          context.changed()
        })
      }
      if (step.do !== 'wait') return ask()
      while (Date.now() < deadline) {
        if (await ask() === 'found') return 'The wait condition is true in the visible canvas.'
        await delay(150, undefined, { signal })
      }
      throw Error('The canvas wait condition did not become true.')
    },
  }
}
