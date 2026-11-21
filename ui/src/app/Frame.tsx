import { MotionConfig } from 'motion/react'
import { lazy, Suspense, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { hostStore } from '@/lib/host/client.ts'
import { useChat } from '@/features/chat/chat-store.ts'
import { startAgentCompletion } from './agent-completion.ts'
import { ChatColumn } from '@/features/chat/ChatColumn.tsx'
import { useSettings } from '@/features/settings/store.ts'
import { useSetup } from '@/features/onboarding/store.ts'
import { useTour } from '@/features/tour/store.ts'
import { AgentsDock } from './AgentsDock.tsx'
import { Canvas } from './Canvas.tsx'
import { ChatDim } from './ChatDim.tsx'
import { ChatHeader } from './ChatHeader.tsx'
import { ChatVeil } from './ChatVeil.tsx'
import { Divider } from './Divider.tsx'
import { useWantedOnce } from './first-use.ts'
import { KeyHints } from './KeyHints.tsx'
import { useFrameKeys } from './keys.ts'
import { useView } from './view-store.ts'
import { QuestionSheet } from '@/features/questions/QuestionSheet.tsx'
// The Mac's notifications start with the frame, and only when the shell has them (`037-notifications`).
import '@/features/notifications/live.ts'
// A window nobody looks at holds still (052, S9).
import './away.ts'
import { TiersLightbox } from '@/features/tiers/TiersLightbox.tsx'
import { NewHobkin } from '@/features/hobkins/NewHobkin.tsx'
import { NerdStatsPanel } from '@/features/settings/NerdStats.tsx'
import { UpdateNotice } from '@/features/update/UpdateNotice.tsx'

// The first-run setup and the tour after it: code and style nobody needs once the setup is done.
const FirstRunSetup = lazy(() => import('@/features/onboarding/FirstRunSetup.tsx').then((module) => ({ default: module.FirstRunSetup })))

/**
 * The app's frame. There are two things on screen: the chat, which is the screen itself, and the canvas,
 * a panel floating over its right side. Projects and earlier conversations are not a pane. They veil the chat.
 */
export function Frame() {
  const conversationWidth = useView((view) => view.conversationWidth)
  const movement = useSettings((state) => state.movement)
  const typeFace = useSettings((state) => state.typeFace)
  const chatSide = useRef<HTMLDivElement | null>(null)
  useFrameKeys()
  useEffect(() => startAgentCompletion({
    host: hostStore,
    notice: (content) => useChat.setState(({ local }) => ({ local: [...local, {
      id: `local:completion:${crypto.randomUUID()}`, role: 'notice', content, at: Date.now(),
    }] })),
  }), [])
  useEffect(() => {
    document.documentElement.dataset.motion = movement
  }, [movement])
  useEffect(() => {
    document.documentElement.dataset.type = typeFace
  }, [typeFace])

  return (
    <MotionConfig reducedMotion={movement === 'still' ? 'always' : movement === 'lively' ? 'never' : 'user'}>
    {/* No background of its own: the page paints the one faded background, so the window's opacity is exactly the setting. */}
    <div className="flex h-full text-foreground">
      <div ref={chatSide} data-chat-side className="relative flex h-full shrink-0 flex-col" style={{ width: conversationWidth }}>
        <ChatHeader />
        <section aria-label="Conversation" className="relative flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <ChatColumn />
          </div>
          <AgentsDock />
          <KeyHints />
          <ChatVeil />
        </section>
        <ChatDim side={chatSide} />
      </div>
      <Divider />
      <Canvas />
      <TiersLightbox />
      <NewHobkin />
      <NerdStatsPanel />
      <SetupLayer />
      <QuestionSheet />
      <UpdateNotice />
    </div>
    </MotionConfig>
  )
}

/**
 * The first-run setup and the tour, mounted from the first time either opens. A window whose setup is done never
 * loads their code. On a first run the setup's cover, the window's own background, is there from the first draw, so
 * the app never shows before the setup does.
 */
function SetupLayer() {
  const setupOpen = useSetup((state) => state.open)
  const firstRun = useSetup((state) => state.origin === 'first-run')
  const tourOpen = useTour((state) => state.open)
  const mounted = useWantedOnce(setupOpen || tourOpen)
  if (!mounted) return null
  const cover = setupOpen && firstRun ? createPortal(<div aria-hidden className="fixed inset-0 z-[45] bg-background" />, document.body) : null
  return (
    <Suspense fallback={cover}>
      <FirstRunSetup />
    </Suspense>
  )
}
