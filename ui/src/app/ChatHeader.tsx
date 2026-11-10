import { History, Moon, Settings2, Sun } from 'lucide-react'
import { motion } from 'motion/react'
import { Mark } from '@/components/Mark.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useConnection } from '@/lib/host/index.ts'
import { Spotlight } from './Spotlight.tsx'
import { originOf, toggleTheme, useTheme } from './theme.ts'
import { useView } from './view-store.ts'

/**
 * The strip above the chat. The window is dragged by it. It holds the wordmark, the button that veils the chat
 * with earlier conversations, and the theme switch. The spotlight (Command+K) is drawn from here, over the whole window.
 */
export function ChatHeader() {
  const theme = useTheme()
  const historyOpen = useView((view) => view.veil === 'history')
  const openVeil = useView((view) => view.openVeil)
  const closeVeil = useView((view) => view.closeVeil)
  const toggleSettings = useView((view) => view.toggleSettings)
  const settingsOpen = useView((view) => view.screen === 'settings')
  // The dot says how the window is linked to hobkin: live, looking, read-only while the terminal has it, or not at all.
  const connection = useConnection()
  const said = connection.detail ? `${connection.label}. ${connection.detail}` : connection.label

  return (
    <header data-tauri-drag-region className="select-none-chrome relative z-20 flex h-12 shrink-0 items-center gap-1 pr-2 pl-[var(--titlebar-inset,16px)]">
      <div data-tauri-drag-region className="flex items-center gap-2">
        <Mark size={20} />
        <span className="wordmark text-[19px]">hobkin</span>
        <span
          title={said}
          aria-label={said}
          className={cn(
            'ml-0.5 size-1.5 rounded-full transition-colors duration-[450ms] ease-[ease]',
            connection.status === 'live' ? 'bg-ok' : connection.status === 'offline' ? 'bg-bad' : connection.status === 'read-only' ? 'bg-warn' : 'bg-border-strong',
          )}
        />
      </div>
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-pressed={historyOpen}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => (historyOpen ? closeVeil() : openVeil('history'))}
              className={cn(
                'no-drag relative flex h-8 items-center gap-1.5 rounded-full px-3 font-heading text-[13px] font-medium tracking-[-0.01em] outline-offset-0',
                'transition-colors duration-[160ms] ease-[ease]',
                historyOpen ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            />
          }
        >
          {historyOpen ? <motion.span layoutId="chat-veil-button" className="absolute inset-0 rounded-full bg-surface-2" transition={spring.pill} /> : null}
          <History className="relative size-3.5" aria-hidden="true" />
          <span className="relative">History</span>
        </TooltipTrigger>
        <TooltipContent>⌘Y</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={toggleSettings}
              aria-label="Settings"
              aria-pressed={settingsOpen}
              className={cn(
                'no-drag grid size-8 place-items-center rounded-full outline-offset-0 transition-colors duration-[160ms] ease-[ease] hover:bg-surface-2 hover:text-foreground',
                settingsOpen ? 'bg-surface-2 text-foreground' : 'text-muted-foreground',
              )}
            />
          }
        >
          <Settings2 className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>Settings ⌘,</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => toggleTheme(originOf(event.currentTarget))}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="no-drag grid size-8 place-items-center rounded-full text-muted-foreground outline-offset-0 transition-colors duration-[160ms] ease-[ease] hover:bg-surface-2 hover:text-foreground"
            />
          }
        >
          {theme === 'dark' ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
        </TooltipTrigger>
        <TooltipContent>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</TooltipContent>
      </Tooltip>
      <Spotlight />
    </header>
  )
}
