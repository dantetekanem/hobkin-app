/**
 * Prepared reviews, kept in the home as artifacts so a review opens at once and survives a restart:
 * `client/reviews/<folder>/` holds one review file and one files file per commit it was built from, and the
 * reviewer's notes, sent or not. A new commit makes a new review, and the old one stays where it is.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { reviewFolder, targetOfReviewFolder, type ReviewTarget } from '#shared/review/ids.ts'
import type { NoteEntry } from '#shared/review/notes.ts'
import type { MergeAsked, PullOwner } from '#shared/review/status.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'

/** The reviewer's notes, sent and not, and the note they were writing. */
export interface NotesFile {
  entries: NoteEntry[]
  draft: { intent: 'comment' | 'question'; text: string; editing?: string } | null
}

/** How a review came to be. */
export interface ReviewMeta {
  /** As an ISO time. */
  preparedAt: string
  /** The agent with the change-review skill arranged its story, or the host did alone because no model was asked. */
  storyBy: 'agent' | 'host'
  /** How the host drew its graph, so a graph drawn by older rules is drawn again when someone asks for its review. */
  graph?: number
  /** Client version captured when this summary was generated. Missing on older reviews; never inferred later. */
  producerVersion?: string | null
  /** For a pull request: who opened it and whether it is the user's, as it was when the review was prepared. */
  owner?: PullOwner
}

export interface Prepared {
  review: Review
  files: ReviewFileContents[]
  meta: ReviewMeta | null
}

/** A target's most recent review in the home, as a list shows it. */
export interface StoredReview {
  target: ReviewTarget
  /** When its file was written, in milliseconds. */
  at: number
  meta: ReviewMeta | null
  /** What it is about, from the review file; null when the file cannot be read. */
  change: { title: string; project: string; head: string } | null
}

export interface ReviewStore {
  /** The review built from this commit, with its files, or null when there is none. */
  read(target: ReviewTarget, head: string): Prepared | null
  /** The most recently prepared review of a target, whatever its commit. */
  latest(target: ReviewTarget): Prepared | null
  /** The most recently prepared review of a target without reading it: when it was written, in milliseconds, and how it came to be. */
  newest(target: ReviewTarget): { at: number; meta: ReviewMeta | null } | null
  /** A review was built from this commit. */
  has(target: ReviewTarget, head: string): boolean
  /** Every target with a review in the home, each with its most recent one. */
  list(): StoredReview[]
  write(target: ReviewTarget, review: Review, files: ReviewFileContents[], meta?: ReviewMeta): void
  notes(target: ReviewTarget): NotesFile
  saveNotes(target: ReviewTarget, notes: NotesFile): void
  /** Takes everything of a target out of the home: every review built for it, its change reviews and its notes. */
  remove(target: ReviewTarget): void
  /** The merge the user asked for that has not happened, kept in the home so it outlives a restart. Null when there is none. */
  mergeAsked(target: ReviewTarget): MergeAsked | null
  saveMergeAsked(target: ReviewTarget, asked: MergeAsked | null): void
  /** When the user's yes merged it, as an ISO time, or null. A merged review is kept and leaves the list of reviews. */
  landedAt(target: ReviewTarget): string | null
  saveLanded(target: ReviewTarget, at: string | null): void
}

const short = (head: string) => head.slice(0, 12)
const NO_NOTES: NotesFile = { entries: [], draft: null }

/** Written in full to a file beside it, then put in place, so a reader never sees half a file. */
function writeWhole(file: string, text: string) {
  const next = `${file}.${process.pid}.next`
  writeFileSync(next, text, { mode: 0o600 })
  renameSync(next, file)
}

function readJson<Value>(file: string): Value | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Value
  } catch {
    return null
  }
}

/** What a review file says it is about, or null when the file lacks any of it. */
function aboutChange(change: Review['change'] | undefined): StoredReview['change'] {
  if (!change) return null
  if (typeof change.title !== 'string' || typeof change.project !== 'string' || typeof change.head !== 'string') return null
  return { title: change.title, project: change.project, head: change.head }
}

export function reviewStore(root: string): ReviewStore {
  const reviews = join(root, 'client', 'reviews')
  const folderOf = (target: ReviewTarget) => join(reviews, reviewFolder(target))
  /** What each review file is about, read once for each time it was written, as a list is asked for often. */
  const about = new Map<string, { at: number; change: StoredReview['change'] }>()
  const readAt = (folder: string, name: string): Prepared | null => {
    const review = readJson<Review>(join(folder, `review-${name}.json`))
    const files = readJson<ReviewFileContents[]>(join(folder, `files-${name}.json`))
    return review && files ? { review, files, meta: readJson<ReviewMeta>(join(folder, `meta-${name}.json`)) } : null
  }
  const newestIn = (folder: string) => {
    if (!existsSync(folder)) return null
    return (
      readdirSync(folder)
        .filter((name) => /^review-[0-9a-f]{12}\.json$/.test(name))
        .map((name) => ({ name: name.slice('review-'.length, -'.json'.length), at: statSync(join(folder, name)).mtimeMs }))
        .sort((a, b) => b.at - a.at)[0] ?? null
    )
  }

  return {
    read: (target, head) => readAt(folderOf(target), short(head)),
    latest(target) {
      const folder = folderOf(target)
      const newest = newestIn(folder)
      return newest ? readAt(folder, newest.name) : null
    },
    newest(target) {
      const folder = folderOf(target)
      const newest = newestIn(folder)
      return newest ? { at: newest.at, meta: readJson<ReviewMeta>(join(folder, `meta-${newest.name}.json`)) } : null
    },
    has: (target, head) => existsSync(join(folderOf(target), `review-${short(head)}.json`)),
    list() {
      if (!existsSync(reviews)) return []
      return readdirSync(reviews).flatMap((name): StoredReview[] => {
        const target = targetOfReviewFolder(name)
        const folder = join(reviews, name)
        const newest = target && statSync(folder, { throwIfNoEntry: false })?.isDirectory() ? newestIn(folder) : null
        if (!target || !newest) return []
        const file = join(reviews, name, `review-${newest.name}.json`)
        let known = about.get(file)
        if (known?.at !== newest.at) {
          known = { at: newest.at, change: aboutChange(readJson<Review>(file)?.change) }
          about.set(file, known)
        }
        return [{ target, at: newest.at, meta: readJson<ReviewMeta>(join(reviews, name, `meta-${newest.name}.json`)), change: known.change }]
      })
    },
    write(target, review, files, meta) {
      const folder = folderOf(target)
      mkdirSync(folder, { recursive: true, mode: 0o700 })
      // The files first: a review is never on disk without what it points into.
      writeWhole(join(folder, `files-${short(review.change.head)}.json`), JSON.stringify(files))
      if (meta) writeWhole(join(folder, `meta-${short(review.change.head)}.json`), JSON.stringify(meta))
      writeWhole(join(folder, `review-${short(review.change.head)}.json`), JSON.stringify(review))
    },
    notes(target) {
      const saved = readJson<Partial<NotesFile>>(join(folderOf(target), 'notes.json'))
      return saved ? { entries: Array.isArray(saved.entries) ? saved.entries : [], draft: saved.draft ?? null } : NO_NOTES
    },
    saveNotes(target, notes) {
      const folder = folderOf(target)
      mkdirSync(folder, { recursive: true, mode: 0o700 })
      writeWhole(join(folder, 'notes.json'), JSON.stringify(notes))
    },
    mergeAsked(target) {
      const saved = readJson<Partial<MergeAsked>>(join(folderOf(target), 'merge-asked.json'))
      return saved?.at && (saved.state === 'waiting' || saved.state === 'failed') ? { at: saved.at, state: saved.state, ...(saved.why ? { why: saved.why } : {}) } : null
    },
    saveMergeAsked(target, asked) {
      const folder = folderOf(target)
      if (!asked) return rmSync(join(folder, 'merge-asked.json'), { force: true })
      mkdirSync(folder, { recursive: true, mode: 0o700 })
      writeWhole(join(folder, 'merge-asked.json'), JSON.stringify(asked))
    },
    landedAt(target) {
      return readJson<{ at?: string }>(join(folderOf(target), 'landed.json'))?.at ?? null
    },
    saveLanded(target, at) {
      const folder = folderOf(target)
      if (!at) return rmSync(join(folder, 'landed.json'), { force: true })
      mkdirSync(folder, { recursive: true, mode: 0o700 })
      writeWhole(join(folder, 'landed.json'), JSON.stringify({ at }))
    },
    remove(target) {
      const folder = folderOf(target)
      for (const file of about.keys()) if (file.startsWith(`${folder}/`)) about.delete(file)
      rmSync(folder, { recursive: true, force: true })
    },
  }
}
