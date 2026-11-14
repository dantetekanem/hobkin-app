import { isLocalPage } from '#shared/protocol/canvas.ts'
import type { SavedNote } from './store.ts'

/** After Save: where the file went, with a button that opens it, or the host's sentence. */
export function SavedNoteRow({ note, onOpen }: { note: SavedNote; onOpen: (path: string) => void }) {
  const path = 'path' in note ? note.path : undefined
  const words = 'path' in note ? `Saved to ${note.path}` : note.error
  return (
    <p role="status" className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-4 text-[12px] text-muted-foreground">
      <span className="min-w-0 flex-1 truncate" title={path}>
        {words}
      </span>
      {path !== undefined ? (
        <button type="button" className="shrink-0 rounded-full px-2 py-0.5 text-foreground hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onOpen(path)}>
          Open
        </button>
      ) : null}
    </p>
  )
}

/** The plain words over a page or drawing that did not arrive, with a way to open it in the browser instead. */
export function DidNotShow({ url, onOpenInBrowser }: { url: string; onOpenInBrowser: () => void }) {
  return (
    <div role="status" className="absolute inset-0 grid place-items-center bg-surface p-8 text-center">
      <div className="flex max-w-xs flex-col items-center gap-3">
        <p className="text-[14px] font-medium">This page did not show here.</p>
        <p className="text-[13px] text-muted-foreground">
          {isLocalPage(url) ? 'It may not be running yet.' : 'It may refuse to be shown inside another app.'} You can open it in the browser instead.
        </p>
        <button type="button" className="rounded-full border border-border px-3 py-1 text-[13px] hover:bg-surface-2" onClick={onOpenInBrowser}>
          Open in the browser
        </button>
      </div>
    </div>
  )
}
