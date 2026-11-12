import { CircleHelp, MessageSquare, X } from 'lucide-react'
import type { Note } from '../notes/notes.ts'
import { noteByline, sentWords } from '../state/quick-notes.ts'

/**
 * The notes panel's words, for a quick read beside a node (the user, 2026-11-12: "comments should open a panel near the
 * node for quick read"): each comment and question, who wrote it, its words, and whether it went anywhere yet. Drawn
 * twice: once unseen, to measure it.
 */
export function NotesBody({ title, notes, onClose }: { title: string; notes: readonly Note[]; onClose: () => void }) {
  return (
    <div className="rv-notes-body">
      <header className="rv-notes-head">
        <span>{title}</span>
        <button type="button" className="rv-notes-close" aria-label="Close the notes" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      {notes.length === 0 ? (
        <p className="rv-notes-empty">No notes here yet.</p>
      ) : (
        <ul className="rv-notes-list">
          {notes.map((note) => {
            const Icon = note.intent === 'question' ? CircleHelp : MessageSquare
            return (
              <li key={note.id} className="rv-notes-note" data-author={note.author} data-intent={note.intent}>
                <span className="rv-notes-by">
                  <Icon aria-hidden="true" />
                  {noteByline(note)}
                </span>
                <p className="rv-notes-text">{note.text}</p>
                <span className="rv-notes-sent" data-sent={note.sent != null}>
                  {sentWords(note)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
