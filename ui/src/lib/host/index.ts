/**
 * The UI's side of the host: the connection, the state it feeds, and hooks that read it.
 * Each hook answers with the host's data, and with the frame's sample data only in a browser tab no host has answered.
 */
export { answerQuestion, deferQuestion, hostStore, onWatchedChange, reportPresence, runCommand, selectMainModel, startHostConnection, type MainEffort } from './client.ts'
export { CommandError, type HostAddress } from './connection.ts'
export type { Connection, ConnectionStatus } from './frame.ts'
export {
  useActionItemCount,
  useAgents,
  useConnection,
  useGitHub,
  useHasHost,
  useHost,
  useHostEqual,
  useHostKept,
  useListHost,
  useListHostKept,
  useMainModel,
  useModels,
  usePendingQuestion,
  useProjects,
  useProofs,
  useRunningCount,
  useSessions,
  useWatchJob,
  useWork,
  type Models,
} from './hooks.ts'
export { canUseModel, isLive, type HostState, type Link } from './state.ts'
export type { ChecksState, GitHubConnection, GitHubIssue, GitHubPull, GitHubState, ReviewState } from '#shared/protocol/github.ts'
export type { KeyHelp, ModelChoice, ModelsState, ProviderAccess } from '#shared/protocol/models.ts'
export type { PendingQuestion, QuestionReply } from '#shared/protocol/question.ts'
export type { ChangeChoice, FinishedChange, FinishedGroup, Grade, PrMode, QueueRow, WorkProject, WorkState } from '#shared/protocol/work.ts'
