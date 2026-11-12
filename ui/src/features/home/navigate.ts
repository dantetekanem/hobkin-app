import { remembered } from '@/app/location.ts'
import { useView } from '@/app/view-store.ts'
import { openGitHubPage } from '@/features/github/open.ts'
import { current } from '@/features/questions/queue.ts'
import { useQuestions } from '@/features/questions/store.ts'
import { useReports } from '@/features/reports/store.ts'
import { finishedReviewId } from '@/features/review/entry.ts'
import { useRoutines } from '@/features/routines/store.ts'
import { hasHost } from '@/lib/host/frame.ts'
import { hostStore } from '@/lib/host/index.ts'
import type { HomeTarget } from './types.ts'

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
    case 'url':
      if (/^https:\/\/github\.com\//.test(target.url) && target.url.length <= 2048 && !/[\\\s]/.test(target.url)) openGitHubPage(target.url)
      return
    case 'question':
      // hobkin's question rises on the question sheet by itself (questions/bridge.ts). Once put off, it waits under Action Items.
      if (!current(useQuestions.getState().queue)) openScreen('actions')
      return
  }
}
