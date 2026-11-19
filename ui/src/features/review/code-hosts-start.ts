import { hostStore, runCommand } from '@/lib/host/index.ts'
import { learnCodeHostsOnConnect } from './code-hosts.ts'

/** Starts learning the named code hosts for the life of the window. The app calls this once as it starts. */
export const startLearningCodeHosts = () => learnCodeHostsOnConnect(hostStore, () => runCommand('review.codeHosts'))
