import { create } from 'zustand'
import { useSetup } from '@/features/onboarding/store.ts'
import { useView } from '@/app/view-store.ts'
import { hostStore, runCommand } from '@/lib/host/index.ts'
import type { FirstModels } from '#shared/tiers/first-models.ts'
import { needsSignInCanvas } from '../chat/availability.ts'
import { connectedLater } from './connect.ts'

/**
 * What Connect a model says once a provider connected there, outside the first-run setup, gave hobkin its first model
 * (`017-model-tiers`, "The first models"): the host is asked to put a home that never chose a model on Pi's default for
 * that provider, and the screen stays up until the person has read what was set. `idle` once there is nothing to say.
 */
export type FirstModelsNote = { state: 'idle' } | { state: 'asking' } | { state: 'said'; set: Extract<FirstModels, { set: true }> }

export const useFirstModelsNote = create<FirstModelsNote>(() => ({ state: 'idle' }))

export const readFirstModelsNote = () => useFirstModelsNote.setState({ state: 'idle' }, true)

// Watched from the host's own updates, so the screen is held in the same draw that would have taken it away.
const stop = hostStore.subscribe((now, before) => {
  const provider = connectedLater(before, now)
  if (!provider || now.model !== 'live' || useSetup.getState().open) return
  // Only where Connect a model was up: never over a screen that holds an agent's controls.
  if (!needsSignInCanvas(before, useView.getState().screen)) return

  useFirstModelsNote.setState({ state: 'asking' }, true)
  runCommand('tiers.first', { provider }).then(
    (answer) => {
      useFirstModelsNote.setState(answer.set ? { state: 'said', set: answer } : { state: 'idle' }, true)
    },
    () => {
      useFirstModelsNote.setState({ state: 'idle' }, true)
    },
  )
})
import.meta.hot?.dispose(stop)
