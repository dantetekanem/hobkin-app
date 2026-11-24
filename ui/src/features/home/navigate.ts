import { reviewIdOf, targetOfReviewId } from '#shared/review/ids.ts'
import { remembered } from '@/app/location.ts'
import { useView } from '@/app/view-store.ts'
import { openRunAmong } from '@/features/proofs/open-run.ts'
import { current } from '@/features/questions/queue.ts'
import { useQuestions } from '@/features/questions/store.ts'
import { useReports } from '@/features/reports/store.ts'
import { finishedReviewId } from '@/features/review/entry.ts'
import { useRoutines } from '@/features/routines/store.ts'
import { hasHost } from '@/lib/host/frame.ts'
import { hostStore } from '@/lib/host/index.ts'
import { openAddress } from '@/lib/open-link.ts'
import type { HomeTarget } from './types.ts'

/** A plain https address with no login in it, as an integration's card gives one. Anything else is not opened. */
function isWebAddress(url: string): boolean {
  if (url.length > 2048 || /[\\\s]/.test(url)) return false
  try {
    const address = new URL(url)
    return address.protocol === 'https:' && !address.username && !address.password
  } catch {
    return false
  }
}

/** Opens what a Home card or row names. Home only navigates: answering, merging, running and stopping happen where it lands. */
export function openTarget(target: HomeTarget): void {
  const { openScreen, openReviewFor, openAgentCanvas } = useView.getState()
  switch (target.to) {
    case 'screen':
      return openScreen(target.screen)
    case 'report':
      useReports.getState().open(target.id)
      return openScreen('reports')
    case 'action':
      openScreen('actions')
      remembered.setState({ action: target.id })
      return
    case 'review': {
      const id = finishedReviewId(target.change, hasHost(hostStore.getState()))
      return id ? openReviewFor(id) : openScreen('work')
    }
    case 'agent':
      return openAgentCanvas(target.id)
    case 'routine':
      useRoutines.getState().open(target.id, `routine-${target.id}`)
      return openScreen('routines')
    case 'pull': {
      const pull = targetOfReviewId(target.url)
      if (pull?.kind === 'pull') openReviewFor(reviewIdOf(pull))
      return
    }
    case 'url':
      if (isWebAddress(target.url)) openAddress(target.url)
      return
    case 'question':
      // hobkin's question rises on the question sheet by itself (questions/bridge.ts). Once put off, it waits under Action Items.
      if (!current(useQuestions.getState().queue)) openScreen('actions')
      return
    case 'project':
      return useView.getState().openProject(target.slug)
    case 'proof':
      // Home opens a run only for a model that broke on main, so it lands on the break.
      return openRunAmong(target.id, [], 'break')
  }
}
