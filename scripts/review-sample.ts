/**
 * Builds the sample data for Change Review:
 *
 *   node scripts/review-sample.ts              write the sample review and the stress review
 *   node scripts/review-sample.ts --request    print what the model would be sent, to write the model pass from
 *
 * The sample is one real hobkin commit. hobkin commits carry no spec, so the spec in the sample folder was
 * written after the fact, and the model pass there was written by hand. Both are sample input: the review
 * is built from them and from the commit's bytes by the same passes the host will run.
 * It can be run again at any time and writes the same files.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { captureChange } from '#shared/review/capture.ts'
import { completeReview, draftReview, modelRequest, type ModelPassInput } from '#shared/review/prepare.ts'
import { buildStress } from '#shared/review/stress.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { openReview, validateReview } from '#shared/review/validate.ts'
import { gitReader } from './review-git.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const SAMPLE = path.join(ROOT, 'ui/src/features/review/sample')
// hobkin's history is part of this repository's, so the sample commit is read from here.
const REPOSITORY = process.env.HOBKIN_REPOSITORY ?? ROOT
/** "Say what the main agent is doing, above the input": nine files, code and tests, about fifteen units. */
const COMMIT = '7d02c99f8c61be4291e0c2046d29787cbc1c010a'
const ITEM = '7d02c9'
const SLUG = 'say-what-hobkin-is-doing'

async function writeJson(name: string, value: unknown, compactRows = false) {
  const text = compactRows && Array.isArray(value) ? `[\n${value.map((row) => JSON.stringify(row)).join(',\n')}\n]\n` : `${JSON.stringify(value, null, 2)}\n`
  await writeFile(path.join(SAMPLE, name), text)
  return text.length
}

/** A written review must open again against its own files. This is the check the app runs on load. */
function reopen(review: Review, files: readonly ReviewFileContents[]) {
  const byId = new Map(files.map((file) => [file.fileId, file]))
  openReview(JSON.parse(JSON.stringify(review)), (fileId, side) => (side === 'added' ? byId.get(fileId)?.head : byId.get(fileId)?.base) ?? null)
}

async function buildSample(printRequest: boolean) {
  const git = gitReader(REPOSITORY)
  const commit = await git.commit(COMMIT)
  const specPath = `_specs/${ITEM}-${SLUG}/spec.md`
  const specText = await readFile(path.join(SAMPLE, 'spec.md'), 'utf8')
  const capture = await captureChange(git, commit.parent, commit.hash)

  const draft = await draftReview({
    id: 'sample',
    change: { project: 'hobkin', item: ITEM, title: commit.subject, branch: `hobkin/${ITEM}-${SLUG}` },
    capture,
    spec: { path: specPath, text: specText },
    readHead: (file) => git.text(commit.hash, file),
  })
  draft.notices.push(`Sample data. This review was built from hobkin commit ${commit.hash.slice(0, 7)}. Its spec was written after the fact and its story by hand.`)

  if (printRequest) {
    console.log(JSON.stringify(modelRequest(draft), null, 2))
    return
  }

  const modelPass = JSON.parse(await readFile(path.join(SAMPLE, 'model-pass.json'), 'utf8')) as ModelPassInput
  const { review, corrections } = await completeReview(draft, modelPass)
  // The hand-written pass goes through the same checks as a model's. Here, whatever the host had to correct, cut or
  // drop is a mistake in the file, so the script stops and says which.
  if (corrections.length > 0) throw new Error(`The model pass needed corrections:\n${corrections.map((line) => `  ${line}`).join('\n')}`)
  for (const step of modelPass.story ?? []) {
    if (!review.story.some((entry) => entry.title === step.title && entry.text === step.text)) throw new Error(`A step of the model pass was cut or dropped: "${step.title}".`)
  }
  for (const [id, entry] of Object.entries(modelPass.nodes ?? {})) {
    if (review.nodes.find((node) => node.id === id)?.summary !== entry.summary) throw new Error(`The summary of ${id} in the model pass was cut or dropped.`)
  }
  for (const wire of modelPass.wires ?? []) {
    if (wire.label && !review.edges.some((edge) => edge.label === wire.label)) throw new Error(`The label "${wire.label}" in the model pass was cut or dropped.`)
  }

  const files: ReviewFileContents[] = review.files.map((file) => {
    const captured = capture.files.find((entry) => entry.id === file.id)
    if (captured) return { fileId: file.id, path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}), base: captured.base, head: captured.head, binary: captured.binary }
    const text = draft.headFiles.get(file.path) ?? null
    return { fileId: file.id, path: file.path, base: text, head: text, binary: false }
  })
  reopen(review, files)

  const reviewBytes = await writeJson('review.json', review)
  const fileBytes = await writeJson('files.json', files, true)
  const kinds = (kind: string) => review.nodes.filter((node) => node.kind === kind).length
  console.log(`sample   ${commit.hash.slice(0, 7)} ${commit.subject}`)
  console.log(`         ${review.nodes.length} nodes (${kinds('criterion')} lines, ${kinds('test')} tests, ${kinds('code')} code, ${kinds('file')} files, ${kinds('context')} context)`)
  console.log(`         ${review.edges.length} wires (${review.edges.filter((edge) => edge.certainty === 'model').length} proposed), ${review.story.length} steps, +${review.change.additions} -${review.change.deletions}`)
  console.log(`         review.json ${reviewBytes.toLocaleString('en-US')} bytes, files.json ${fileBytes.toLocaleString('en-US')} bytes`)
}

async function writeStress() {
  const { review, files } = await buildStress()
  const problems = validateReview(review)
  if (problems.length > 0) throw new Error(`The stress review is not valid: ${problems.join(' ')}`)
  reopen(review, files)
  const reviewBytes = await writeJson('stress-review.json', review)
  const fileBytes = await writeJson('stress-files.json', files, true)
  console.log(`stress   ${review.nodes.length} nodes, ${review.edges.length} wires, ${review.story.length} steps`)
  console.log(`         stress-review.json ${reviewBytes.toLocaleString('en-US')} bytes, stress-files.json ${fileBytes.toLocaleString('en-US')} bytes`)
}

await mkdir(SAMPLE, { recursive: true })
const printRequest = process.argv.includes('--request')
await buildSample(printRequest)
if (!printRequest) await writeStress()
