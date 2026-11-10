import { Kbd } from '@/components/ui/kbd.tsx'

const HINTS: [keys: string, does: string][] = [
  ['tab', 'screens'],
  ['↓', 'agents'],
  ['⌘J', 'canvas'],
  ['⌘P', 'projects'],
  ['⌘Y', 'history'],
  ['⌘,', 'settings'],
]

/** One quiet line under the chat: the keys that steer the app from the message input. */
export function KeyHints() {
  return (
    <div className="select-none-chrome flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-5 pb-2.5 text-[11px] text-muted-foreground">
      {HINTS.map(([keys, does]) => (
        <span key={keys} className="flex items-center gap-1 whitespace-nowrap">
          <Kbd>{keys}</Kbd>
          {does}
        </span>
      ))}
    </div>
  )
}
