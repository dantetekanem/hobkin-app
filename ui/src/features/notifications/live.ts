import { hobkinAgentId } from '#shared/protocol/hobkins.ts'
import { remembered } from '@/app/location.ts'
import { useView } from '@/app/view-store.ts'
import { hostStore } from '@/lib/host/client.ts'
import { shell, windowInFront, type NoticeShell } from '@/lib/native.ts'
import { useActionItems } from '../actions/store.ts'
import { useNoticePermission } from './permission.ts'
import { createRequestNotifications, type RequestFacts } from './request.ts'
import { needsOf, type Destination, type Need } from './rules.ts'

/**
 * The Mac's notifications, connected to the window (_specs/037-notifications): the host's facts go in, and a click
 * comes back to the app's own navigation. The rules are in `rules.ts` and `request.ts`. Loaded once by the frame.
 * Without the shell's commands (a browser tab, or a shell from before them) nothing starts.
 */

/** Opens the place that answers a need. Only the places a `Destination` names, and only through the app's navigation. */
export function reveal(opens: Destination): void {
  const view = useView.getState()
  switch (opens.to) {
    case 'question':
      // The sheet shows the question over every screen.
      return
    case 'actions':
      view.openScreen('actions')
      return
    case 'item':
      view.openScreen('actions')
      remembered.setState({ action: opens.id })
      return
    case 'hobkin':
      view.openAgentCanvas(hobkinAgentId(opens.id))
      return
    case 'review':
      view.openReviewFor(opens.id)
  }
}

/** The same sources give the same needs; a review's freshness is checked again after a second. */
let last: { inputs: unknown[]; at: number; needs: Need[] } | null = null
function currentNeeds(now: number): Need[] {
  const host = hostStore.getState()
  const inputs = [host.question, useActionItems.getState().rows, host.snapshot.hobkins, host.messages]
  if (last && now - last.at < 1000 && inputs.every((input, index) => input === last!.inputs[index])) return last.needs
  const needs = needsOf({ question: host.question, items: useActionItems.getState().rows, hobkins: host.snapshot.hobkins, messages: host.messages, now })
  last = { inputs, at: now, needs }
  return needs
}

function facts(): RequestFacts {
  const host = hostStore.getState()
  const ready = host.link === 'open' && host.snapshotReady && host.home !== null && !useActionItems.getState().sample
  return { home: host.home ?? '', generation: host.epoch, ready, needs: ready ? currentNeeds(Date.now()) : [] }
}

/** After an answer the Mac could not give, hobkin waits this long before asking again. */
const ASK_AGAIN_MS = 60_000

function adapterOf(notices: NoticeShell) {
  let asking: Promise<boolean> | null = null
  let unsureUntil = 0
  return {
    available: () => true,
    permission: () => {
      if (Date.now() < unsureUntil) return Promise.reject(Error('The Mac has not answered yet.'))
      asking ??= notices
        .permission(true)
        .then((state) => {
          useNoticePermission.setState({ state })
          // Only a refusal is an answer of no. Anything unsure is asked again later.
          if (state !== 'granted' && state !== 'denied') {
            unsureUntil = Date.now() + ASK_AGAIN_MS
            throw Error('The Mac has not answered yet.')
          }
          return state === 'granted'
        })
        .finally(() => {
          asking = null
        })
      return asking
    },
    listen: (click: (id: string) => Promise<void>) => notices.onOpen((key) => void click(key)),
    send: async ({ id, title, body }: { id: string; title: string; body: string }) => {
      await notices.send({ key: id, title, body })
      return true
    },
  }
}

const storage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
}

/** Starts the notifications when the shell has them. Returns how to stop. */
export function startNotifications(): () => void {
  let stopped = false
  const stops: (() => void)[] = []
  void shell().then(({ notices }) => {
    if (stopped) return
    if (!notices) {
      useNoticePermission.setState({ state: 'unavailable' })
      return
    }
    // What the Mac allows already, for Settings, without asking.
    void notices.permission(false).then((state) => useNoticePermission.setState({ state }), () => {})
    const controller = createRequestNotifications({ facts, storage, adapter: adapterOf(notices), front: windowInFront, reveal })
    const refresh = () => void controller.refresh()
    stops.push(hostStore.subscribe(refresh), useActionItems.subscribe(refresh), () => controller.dispose())
    refresh()
  })
  return () => {
    stopped = true
    stops.forEach((stop) => stop())
  }
}

const stop = startNotifications()
import.meta.hot?.dispose(stop)
