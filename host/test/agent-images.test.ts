import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HobkinApplication, ImageHandle } from 'hobkin/src/cli/application.mjs'
import { checkArguments } from '#shared/commands/registry.ts'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { agentHandlers, type AgentsApp } from '../src/agents.ts'
import { agentImages, Attachments } from '../src/attachments.ts'
import { runCommand } from '../src/commands.ts'
import { hobkinHandlers } from '../src/hobkins.ts'

const LIMITS = { images: 2, imageBytes: 1024 }
const WORDS_ALONE = 'Look at what I pasted.'

/**
 * hobkin's side of attached images. It takes each one from where the host puts it in place of the clipboard, as
 * hobkin's own paste does. With `seesImages` false, hobkin's own model cannot see an image, so its own paste refuses.
 */
function imageHobkin({ seesImages = true } = {}) {
  const attachments = new Attachments()
  const dropped: ImageHandle[] = []
  const take = async () => ({ image: { file: `/pasted/${String(await attachments.clipboard.getImage())}`, mimeType: 'image/png' } })
  const app = {
    pasteImage: async () => (seesImages ? take() : { notice: 'fixture/local cannot see images.' }),
    pastedImages: {
      paste: take,
      contents: (images: ImageHandle[]) => images.map(({ file, mimeType }) => ({ type: 'image' as const, data: `bytes of ${file}`, mimeType })),
    },
    dropImages: (images: ImageHandle[]) => void dropped.push(...images),
  } as unknown as HobkinApplication
  const attach = async (name: string, agent?: string) => (await attachments.attach(app, LIMITS, { name, bytes: Buffer.from(name), ...(agent ? { agent } : {}) })).id
  const images = agentImages(attachments, () => app, () => WORDS_ALONE)
  return { app, attachments, attach, dropped, images }
}

const RUNS: RunSummary[] = [
  { id: 'once:recap', title: 'Morning recap', state: 'running', kind: 'background', scheduleId: 'morning-recap' },
  { id: 'old', title: 'Yesterday', state: 'completed', kind: 'background', scheduleId: 'morning-recap' },
]

function agentsWith(images: ReturnType<typeof imageHobkin>['images']) {
  const asked: Record<string, unknown>[] = []
  const app: AgentsApp = {
    workAction: async () => ({}),
    kill: async () => true,
    runner: {
      messageCheck: async (request) => {
        if (!request.scheduleId) return { running: [{ scheduleId: 'morning-recap' }] }
        asked.push(request)
        return { scheduleId: request.scheduleId, status: 'queued' }
      },
    },
  }
  return { asked, handlers: agentHandlers({ app: () => app, runs: () => RUNS, images }) }
}

test("an image for an agent counts against that agent's message, and needs nothing of what hobkin's own model sees", async () => {
  const blind = imageHobkin({ seesImages: false })
  await assert.rejects(blind.attach('chart.png'), /cannot see images/)
  assert.ok(await blind.attach('chart.png', 'once:recap'), "the agent's own model takes the image, not hobkin's")

  const { attach } = imageHobkin()
  await attach('one.png')
  await attach('two.png')
  await assert.rejects(attach('three.png'), /2 images/)
  await attach('three.png', 'once:recap')
  await attach('four.png', 'once:recap')
  await assert.rejects(attach('five.png', 'once:recap'), /2 images/)
  await attach('five.png', 'hobkin:a1b2c3d4')
})

test('a message to a running agent carries the images attached for it, and pictures alone get words', async () => {
  const hobkin = imageHobkin()
  const { asked, handlers } = agentsWith(hobkin.images)
  const chart = await hobkin.attach('chart.png', 'once:recap')

  assert.deepEqual(await runCommand(handlers, 'agent.say', { run: 'once:recap', images: [chart] }), { ok: true, value: { queued: true } })
  assert.deepEqual(asked.at(-1), {
    scheduleId: 'morning-recap', runId: 'once:recap', noteId: undefined, message: WORDS_ALONE,
    images: [{ type: 'image', data: 'bytes of /pasted/chart.png', mimeType: 'image/png' }],
  })
  // The agent has it now: hobkin's file goes, and it cannot go a second time.
  assert.deepEqual(hobkin.dropped, [{ file: '/pasted/chart.png', mimeType: 'image/png' }])
  const again = await runCommand(handlers, 'agent.say', { run: 'once:recap', text: 'Again', images: [chart] })
  assert.match(!again.ok ? again.error.message : '', /not attached any more/)
  assert.equal(asked.length, 1)

  const photo = await hobkin.attach('photo.png', 'once:recap')
  await runCommand(handlers, 'agent.say', { run: 'once:recap', text: 'What changed here?', images: [photo] })
  assert.equal(asked.at(-1)?.message, 'What changed here?')

  // Once the agent has finished nothing goes, and the image is still attached, so it can be taken out.
  const late = await hobkin.attach('late.png', 'once:recap')
  const finished = await runCommand(handlers, 'agent.say', { run: 'old', images: [late] })
  assert.match(!finished.ok ? finished.error.message : '', /finished/)
  hobkin.attachments.detach(hobkin.app, late)

  assert.equal(checkArguments('agent.say', { run: 'once:recap' }).ok, false, 'a message needs words or an image')
  assert.equal(checkArguments('agent.say', { run: 'once:recap', images: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q'] }).ok, false)
})

test('a message to a durable hobkin carries the images attached for it', async () => {
  const hobkin = imageHobkin()
  const said: [string, Record<string, unknown>][] = []
  const hobkins = { say: async (id: string, args: Record<string, unknown>) => (said.push([id, args]), { started: true, queued: false, run: `hobkin:${id}:1` }) }
  const handlers = hobkinHandlers({ app: () => ({ hobkins }) as never, claudeMissing: async () => null, modelProblem: () => null, images: hobkin.images })
  const chart = await hobkin.attach('chart.png', 'hobkin:a1b2c3d4')

  assert.equal((await runCommand(handlers, 'hobkin.say', { id: 'a1b2c3d4', images: [chart] })).ok, true)
  assert.deepEqual(said.at(-1), ['a1b2c3d4', { text: WORDS_ALONE, images: [{ type: 'image', data: 'bytes of /pasted/chart.png', mimeType: 'image/png' }] }])
  assert.deepEqual(hobkin.dropped.map(({ file }) => file), ['/pasted/chart.png'])

  // Words alone go as before.
  await runCommand(handlers, 'hobkin.say', { id: 'a1b2c3d4', text: 'Go on.' })
  assert.deepEqual(said.at(-1), ['a1b2c3d4', { text: 'Go on.' }])
  assert.equal(checkArguments('hobkin.say', { id: 'a1b2c3d4' }).ok, false, 'a message needs words or an image')
})
