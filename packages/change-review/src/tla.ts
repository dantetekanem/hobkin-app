/**
 * TLA+ models in a change (050-tla-proofs, spec 032): a `.tla` model and the `.cfg` that configures its check are a
 * specification. Nothing of them runs in production, so they are never risky to deploy and never critical: what
 * matters is that the model check passes. A file a model names in `\* models:` is real code, and is not one of these.
 */
import type { ModelCheck } from './types.ts'

const fileOf = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

/** A TLA+ model, or a model's config: a `.tla` file, or a `.cfg` beside a `.tla` of its name or under a `tla/` folder. */
export function isModelFile(path: string, paths: readonly string[]): boolean {
  if (path.endsWith('.tla')) return true
  if (!path.endsWith('.cfg')) return false
  return paths.includes(path.replace(/\.cfg$/, '.tla')) || /(^|\/)tla\//.test(path)
}

/** The change is TLA+ models and their configs, and nothing else. */
export function changesOnlyModels(paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every((path) => isModelFile(path, paths))
}

/** Where a model's check stands at this commit, in a sentence: it holds, it fails and must pass, or it was not run. */
export function modelCheckWords(spec: string, check: ModelCheck | undefined): string {
  const file = fileOf(spec)
  if (!check) return `The model check of ${file} was not run at this commit, and it needs to pass.`
  if (check.result === 'violated') {
    const steps = check.steps ? ` in ${check.steps} ${check.steps === 1 ? 'step' : 'steps'}` : ''
    return `The model check of ${file} fails: ${check.broken ?? 'a rule'} breaks${steps}. It must pass before merging.`
  }
  if (check.result === 'error') return `The model check of ${file} could not finish at this commit, and it needs to pass.`
  if (check.unfired.length) return `The model check of ${file} held, but not every action ran, and it needs to pass with every action run.`
  return `The model check of ${file} holds in ${check.states.toLocaleString('en-US')} states at this commit.`
}

/** The models a change of only models has, each once by its `.tla`: a config speaks for the model beside it. */
export function modelsOf(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => path.replace(/\.cfg$/, '.tla')))].filter((path) => path.endsWith('.tla'))
}
