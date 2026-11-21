/**
 * The load lab's fake model, for real Pi agents: OpenAI's chat completions on this machine only, the API Pi uses for
 * DeepSeek. Each answer streams about 30 words a second for two seconds, then calls `read` on a file in the agent's
 * folder, which Pi answers itself, so the agent asks again. Once told to end, it answers "Done." and the runs finish.
 * It runs in its own process, so its cost is in neither the host's numbers nor the agents'.
 * Usage (forked by `lab.ts`): node model.ts <seconds to live> <run folder>
 */
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const [live] = process.argv.slice(2)
// Never outlive the lab.
setTimeout(() => process.exit(2), Number(live) * 1000).unref()
process.on('disconnect', () => process.exit(0))

const WORDS = 'the agent reads each file and writes what it found so the host has words to send while the window draws'.split(' ')
const WORDS_PER_ANSWER = 60
const WORD_MS = 33
let ending = false
let requests = 0

function answer(response: ServerResponse, model: string) {
  const chunk = (choices: unknown[], extra: object = {}) =>
    response.write(`data: ${JSON.stringify({ id: 'chatcmpl-lab', object: 'chat.completion.chunk', created: 0, model, choices, ...extra })}\n\n`)
  const finish = (reason: 'stop' | 'tool_calls') => {
    chunk([{ index: 0, delta: {}, finish_reason: reason }])
    chunk([], { usage: { prompt_tokens: 1500, completion_tokens: WORDS_PER_ANSWER, total_tokens: 1500 + WORDS_PER_ANSWER } })
    response.end('data: [DONE]\n\n')
  }
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  if (ending) {
    chunk([{ index: 0, delta: { role: 'assistant', content: 'Done.' }, finish_reason: null }])
    return finish('stop')
  }

  let sent = 0
  const timer = setInterval(() => {
    if (sent < WORDS_PER_ANSWER) {
      chunk([{ index: 0, delta: { ...(sent ? {} : { role: 'assistant' }), content: `${WORDS[sent % WORDS.length]} ` }, finish_reason: null }])
      sent++
      return
    }
    clearInterval(timer)
    if (ending) return finish('stop')
    const call = { index: 0, id: `call_${requests}_${sent}`, type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: 'notes.md' }) } }
    chunk([{ index: 0, delta: { tool_calls: [call] }, finish_reason: null }])
    finish('tool_calls')
  }, WORD_MS)
  response.on('close', () => clearInterval(timer))
}

const server = createServer((request, response) => {
  let body = ''
  request.on('data', (part) => (body += part))
  request.on('end', () => {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) return void response.writeHead(404).end()
    requests++
    answer(response, (JSON.parse(body) as { model?: string }).model ?? 'lab')
  })
})
server.listen(0, '127.0.0.1', () => process.send?.({ type: 'ready', port: (server.address() as AddressInfo).port }))

process.on('message', (message: { type?: string }) => {
  if (message?.type === 'end') ending = true
  if (message?.type === 'count') process.send?.({ type: 'count', requests })
})
