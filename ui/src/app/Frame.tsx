import { MotionConfig } from 'motion/react'
import { useEffect } from 'react'
import { ChatColumn } from '@/features/chat/ChatColumn.tsx'
import { useSettings } from '@/features/settings/store.ts'
import { AgentsDock } from './AgentsDock.tsx'
import { Canvas } from './Canvas.tsx'
import { ChatDim } from './ChatDim.tsx'
import { ChatHeader } from './ChatHeader.tsx'
import { ChatVeil } from './ChatVeil.tsx'
import { Divider } from './Divider.tsx'
import { KeyHints } from './KeyHints.tsx'
import { useFrameKeys } from './keys.ts'
import { useView } from './view-store.ts'
import { QuestionSheet } from '@/features/questions/QuestionSheet.tsx'
import { TiersLightbox } from '@/features/tiers/TiersLightbox.tsx'
import { FirstRunSetup } from '@/features/onboarding/FirstRunSetup.tsx'

/**
 * The app's frame. There are two things on screen: the chat, which is the screen itself, and the canvas,
 * a panel floating over its right side. Projects and earlier conversations are not a pane. They veil the chat.
 */
export function Frame() {
  const conversationWidth = useView((view) => view.conversationWidth)
  const movement = useSettings((state) => state.movement)
  const typeFace = useSettings((state) => state.typeFace)
  useFrameKeys()
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
      <div data-chat-side className="relative flex h-full shrink-0 flex-col" style={{ width: conversationWidth }}>
        <ChatHeader />
        <section aria-label="Conversation" className="relative flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <ChatColumn />
          </div>
          <AgentsDock />
          <KeyHints />
          <ChatVeil />
        </section>
        <ChatDim />
      </div>
      <Divider />
      <Canvas />
      <TiersLightbox />
      <FirstRunSetup />
      <QuestionSheet />
    </div>
    </MotionConfig>
  )
}
