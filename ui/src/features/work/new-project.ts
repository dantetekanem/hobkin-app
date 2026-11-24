import type { FolderLook, NewProjectDone, ProjectKind, ProjectState, WorkProject, WorkState } from '#shared/protocol/work.ts'

/**
 * The New project popup's rules (_specs/059-new-project, "The popup"): the line under the folder for each thing hobkin
 * can see there, the kind that follows the folder until the user picks one, the YOLO switch, what stands in the way of
 * Add and the arguments of the add, and the sample answers for a window with no host. Pure, so each is tested alone.
 * hobkin checks everything again when it adds; what it refuses shows in the popup's foot.
 */

/** Which page opened the popup. It decides where the YOLO switch starts and where the keyboard lands after an add. */
export type OpenedFrom = 'work' | 'yolo'

/** What the popup knows of the folder: the look that came back and the text it was asked about. Null until one came back. */
export interface Looked {
  /** The trimmed text that was asked about. */
  asked: string
  look: FolderLook
}

/** The popup's fields as the user left them. */
export interface NewProjectForm {
  /** The folder as typed. */
  folder: string
  /** The kind the user picked, or null while the folder decides. */
  picked: ProjectKind | null
  wants: string
  /** The YOLO switch as the user set it, or null while it follows the page that opened the popup. */
  yoloChoice: boolean | null
  from: OpenedFrom
  looked: Looked | null
}

const typedFolder = (form: Pick<NewProjectForm, 'folder'>) => form.folder.trim()

/** The look for what is typed now: an answer for older text is no answer. */
export function currentLook(form: Pick<NewProjectForm, 'folder' | 'looked'>): FolderLook | null {
  const typed = typedFolder(form)
  return typed && form.looked?.asked === typed ? form.looked.look : null
}

const STATE_WORDS: Record<ProjectState, string> = {
  chosen: 'taken',
  proposed: 'proposed',
  skipped: 'skipped',
  dropped: 'dropped',
}

/** The one line under the folder field: what hobkin sees at what is typed. */
export function folderLine(form: Pick<NewProjectForm, 'folder' | 'looked'>): string {
  if (!typedFolder(form)) return 'Type a folder, or choose one with Open.'
  const look = currentLook(form)
  if (!look) return 'Looking…'
  if (look.found === 'missing') return 'There is no folder there.'
  if (look.found === 'file') return 'That is a file, not a folder.'
  if (look.known) return `Work already has this folder as ${look.known.name}, ${STATE_WORDS[look.known.state] ?? 'known'}.`
  if (look.namesake) return `Another project called ${look.name ?? 'this'} is already in Work, at ${look.namesake}.`
  const named = look.name ? ` It would be called ${look.name}.` : ''
  return look.git ? `A git repository.${named}` : `A folder with no git repository.${named}`
}

/** Whether Code can stand for the folder: not when hobkin has seen it and it holds no repository of its own. */
export function codeAllowed(look: FolderLook | null): boolean {
  return !(look && look.found === 'folder' && !look.git)
}

/** The kind as it stands: the user's pick, or what the folder says, and never Code for a folder that is no repository. */
export function kindOf(form: Pick<NewProjectForm, 'folder' | 'looked' | 'picked'>): ProjectKind {
  if (!codeAllowed(currentLook(form))) return 'goal'
  return form.picked ?? 'code'
}

/** What a pick of a kind does: Code is not taken for a folder that is no repository, and the kind stays as it was. */
export function pickKind(form: Pick<NewProjectForm, 'folder' | 'looked' | 'picked'>, choice: ProjectKind): ProjectKind | null {
  return choice === 'code' && !codeAllowed(currentLook(form)) ? form.picked : choice
}

const KIND_WORDS: Record<ProjectKind, string> = {
  code: 'Work makes changes on branches. Each waits for your yes before it merges.',
  goal: 'Work studies the folder and does steps toward your words, in the folder itself.',
}

/** The one line under the kind: what it means, or why Code cannot be picked. */
export function kindLine(form: Pick<NewProjectForm, 'folder' | 'looked' | 'picked'>): string {
  if (!codeAllowed(currentLook(form))) return 'Code needs a git repository of its own, and this folder has none.'
  return KIND_WORDS[kindOf(form)]
}

/** The YOLO switch: the user's own setting, or the page that opened the popup; never on for a goal. */
export function yoloOn(form: Pick<NewProjectForm, 'folder' | 'looked' | 'picked' | 'yoloChoice' | 'from'>): boolean {
  if (kindOf(form) === 'goal') return false
  return form.yoloChoice ?? form.from === 'yolo'
}

/** The one line beside the switch. */
export function yoloLine(form: Pick<NewProjectForm, 'folder' | 'looked' | 'picked' | 'yoloChoice' | 'from'>): string {
  if (kindOf(form) === 'goal') return 'A goal has nothing to merge, so YOLO mode has nothing to do there.'
  return yoloOn(form)
    ? 'After the add, YOLO mode is switched on for this project. It merges only what is ready.'
    : 'Off: finished changes wait for your yes. You can switch it on later.'
}

/** What stands in the way of Add, as the line beside the button, or null when nothing does. */
export function blocker(form: NewProjectForm): string | null {
  if (!typedFolder(form)) return 'Name a folder first.'
  const look = currentLook(form)
  if (!look) return 'Waiting for the look at the folder.'
  if (look.found === 'missing') return 'There is no folder there.'
  if (look.found === 'file') return 'That is a file. Name a folder.'
  if (look.known) return `Work already has this folder as ${look.known.name}.`
  if (look.namesake) return `A project called ${look.name ?? 'this'} is already in Work.`
  if (kindOf(form) === 'goal' && !form.wants.trim()) return 'A goal needs your words first.'
  return null
}

/** The line in the foot when nothing is missing and nothing was refused. */
export const READY_LINE = 'Adds it to Work. Nothing starts by itself.'

/** The arguments of `work.project.new`, or null while something stands in the way. */
export function newProjectArgs(form: NewProjectForm): { folder: string; kind: ProjectKind; wants?: string } | null {
  if (blocker(form)) return null
  const wants = form.wants.trim()
  return { folder: typedFolder(form), kind: kindOf(form), ...(wants ? { wants } : {}) }
}

/** The calls an add makes, as the popup gives them. */
export interface AddCalls {
  add: (args: { folder: string; kind: ProjectKind; wants?: string }) => Promise<NewProjectDone>
  yolo: (args: { slug: string; on: true }) => Promise<unknown>
}

/** How an add went: it was refused, it went through, or the project was added and YOLO mode would not turn on. */
export type AddResult =
  | { result: 'refused'; line: string }
  | { result: 'added'; done: NewProjectDone }
  | { result: 'added-yolo-refused'; done: NewProjectDone; line: string }

const wordsOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Adds the project and then, when the switch is on, turns YOLO mode on for it. hobkin's refusal is its own words. */
export async function addProject(form: NewProjectForm, calls: AddCalls): Promise<AddResult> {
  const args = newProjectArgs(form)
  if (!args) return { result: 'refused', line: blocker(form) ?? 'Something is missing.' }
  let done: NewProjectDone
  try {
    done = await calls.add(args)
  } catch (error) {
    return { result: 'refused', line: wordsOf(error) }
  }
  if (!yoloOn(form)) return { result: 'added', done }
  try {
    await calls.yolo({ slug: done.slug, on: true })
    return { result: 'added', done }
  } catch (error) {
    return { result: 'added-yolo-refused', done, line: `${done.name} was added. YOLO mode did not turn on: ${wordsOf(error)}` }
  }
}

/** A plain key press as the popup's key reads it, as `opensWorkload` reads W. */
interface KeyPress {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  repeat: boolean
  handled: boolean
  typing: boolean
}

/** N alone, once, while no field is being typed in and nothing used the key. */
export function opensNewProject(press: KeyPress): boolean {
  const plainN = (press.key === 'n' || press.key === 'N') && !press.metaKey && !press.ctrlKey && !press.altKey
  return plainN && !press.repeat && !press.handled && !press.typing
}

/** Command+Enter, which adds from anywhere in the popup. */
export const addsFromKey = (press: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean => press.key === 'Enter' && (press.metaKey || press.ctrlKey)

/** Where the keyboard goes after an add: the new project's row on Work, its card on YOLO mode. */
export const rowAfterAdd = (from: OpenedFrom, slug: string): string =>
  from === 'work' ? `[data-world-project="${slug}"]` : `[data-yolo-project="${slug}"]`

// The sample, for a window with no host. Its folders are `~/Projects/<name>` for each sample project, a git repository
// each. Any other folder under ~/Projects is a repository too, one under ~/Documents is a plain folder, a last part with a
// dot is a file, and every other path has no folder.

const SAMPLE_HOME = '~/Projects'
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project'

/** What the sample says of a typed folder, from the sample's own projects. */
export function sampleLook(typed: string, projects: readonly Pick<WorkProject, 'slug' | 'name' | 'state'>[]): FolderLook {
  const text = typed.trim()
  const path = text.replace(/\/+$/, '')
  const name = path.split('/').at(-1) ?? ''
  const none: FolderLook = { typed, folder: null, found: 'missing', git: false, name: null, known: null, namesake: null }
  if (!path || !name || name === '~') return none
  const inProjects = path.startsWith(`${SAMPLE_HOME}/`)
  const inDocuments = path.startsWith('~/Documents/')
  if (name.includes('.') && (inProjects || inDocuments)) return { ...none, found: 'file', folder: path.replace('~', '/Users/sample') }
  if (!inProjects && !inDocuments) return none
  const folder = path.replace('~', '/Users/sample')
  const own = inProjects && path === `${SAMPLE_HOME}/${name}` ? projects.find((project) => project.slug === slugOf(name)) : undefined
  const sameName = projects.find((project) => project.slug === slugOf(name))
  return {
    typed,
    folder,
    found: 'folder',
    git: inProjects,
    name,
    known: own ? { slug: own.slug, name: own.name, state: own.state } : null,
    namesake: !own && sameName ? `${SAMPLE_HOME}/${sameName.slug}` : null,
  }
}

/** The sample after an add: the project in the list, taken, with its kind. A goal starts with nothing done. */
export function sampleAdd(work: WorkState, args: { folder: string; kind: ProjectKind; wants?: string }): { state: WorkState; done: NewProjectDone } | { refused: string } {
  const look = sampleLook(args.folder, work.projects)
  if (look.found !== 'folder' || !look.name) return { refused: look.found === 'file' ? 'That is a file, not a folder.' : 'There is no folder there.' }
  if (look.known) return { refused: `Work already has this folder as ${look.known.name}.` }
  if (look.namesake) return { refused: `A project called ${look.name} is already in Work, at ${look.namesake}.` }
  if (args.kind === 'code' && !look.git) return { refused: 'Code needs a git repository, and this folder has none.' }
  if (args.kind === 'goal' && !args.wants?.trim()) return { refused: 'A goal needs the words it works toward.' }
  const slug = slugOf(look.name)
  const project: WorkProject = {
    slug,
    name: look.name,
    state: 'chosen',
    priority: 'P2',
    prMode: 'off',
    issues: 'off',
    level: 'casual',
    paused: false,
    open: 0,
    prs: 0,
    branches: 0,
    left: 0,
    unmerged: 0,
    nextLookAt: null,
    lookError: null,
    kind: args.kind,
    ...(args.kind === 'goal' ? { done: 0 } : {}),
  }
  const done: NewProjectDone = { slug, name: look.name, kind: args.kind, message: `This is sample data, so ${look.name} was added to the sample only.` }
  return { state: { ...work, projects: [...work.projects, project] }, done }
}
