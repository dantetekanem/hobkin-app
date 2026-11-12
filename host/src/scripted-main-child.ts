import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runMainSessionChild } from 'hobkin/src/cli/main-session-child.mjs'
import { openConversation } from 'hobkin/src/cli/pi-session.mjs'
import { createScriptedSessionFactory } from './scripted.ts'

/** Fixed packaged entry: neither bootstrap nor home configuration chooses this factory. */
export function runScriptedMainChild(channel = process) {
  return runMainSessionChild(channel, {
    openSession: (options, dependencies) =>
      openConversation(options, {
        ...dependencies,
        scriptedMain: true,
        createSession: async sessionOptions => {
          if (typeof sessionOptions.agentDir !== 'string') throw Error('Scripted main requires its captured agent directory.')

          const createSession = await createScriptedSessionFactory(sessionOptions.agentDir)
          return createSession(sessionOptions)
        },
      }),
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runScriptedMainChild().catch(() => {
    process.stderr.write('Scripted main child bootstrap failed.\n')
    process.exit(1)
  })
}
