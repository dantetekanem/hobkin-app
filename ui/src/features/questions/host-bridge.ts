import { answerQuestion, deferQuestion, hostStore } from '@/lib/host/client.ts'
import { connectQuestions } from './bridge.ts'
import { useQuestions } from './store.ts'

/**
 * hobkin's own questions rise on the sheet, and the user's answer or "later" goes back to hobkin through the host
 * (022-questions S4). The rules are in `bridge.ts`. Loaded once with the sheet, which every window has.
 */
const disconnect = connectQuestions({ host: hostStore, sheet: useQuestions, answer: answerQuestion, defer: deferQuestion })

import.meta.hot?.dispose(disconnect)
