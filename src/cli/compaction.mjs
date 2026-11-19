const SMART_AT_PERCENT = 80;
// Where a 200,000-token window reaches its 80%. Every model call reads the whole chat again, so a bigger window must not let it grow past this.
const SMART_AT_TOKENS = 160000;
export const FORCE_AT_PERCENT = 95;
const MINUTE_MS = 60000;
// Someone reading the last reply may be about to answer it, and they should not meet a spinner.
const QUIET_BEFORE_SMART_MS = 2 * MINUTE_MS;
// Far enough off that the chat is not needed for anything on the schedule before it is back.
const NEXT_RUN_IS_FAR_MS = 120 * MINUTE_MS;
// A compaction that cannot run must not hold the chat or the queue, so it waits before trying again.
const RETRY_AFTER_MS = 10 * MINUTE_MS;

const failedRecently = (last, now) => Boolean(last) && last.status !== 'completed' && now - Date.parse(last.at) < RETRY_AFTER_MS;
const worthCompacting = (percent, tokens) => percent >= SMART_AT_PERCENT || (Number.isFinite(tokens) && tokens >= SMART_AT_TOKENS);

/**
 * Whether the main session should compact. `force` is too full to wait for a good moment. `smart` is a good moment arriving early for a
 * chat that is full enough or big enough: it is idle and nobody needs it soon, because either agents are working or the next check is hours
 * away. Only the window's percentage forces it.
 */
export function compactionDue({ percent, tokens, auto, free, quietMs, agentsRunning, nextRunInMs, last, now = Date.now() }) {
  if (auto === false || !Number.isFinite(percent) || failedRecently(last, now)) return null;
  if (percent >= FORCE_AT_PERCENT) return 'force';
  if (!worthCompacting(percent, tokens) || !free || quietMs < QUIET_BEFORE_SMART_MS) return null;

  const nextRunIsFar = nextRunInMs === null || nextRunInMs >= NEXT_RUN_IS_FAR_MS;
  return agentsRunning || nextRunIsFar ? 'smart' : null;
}

/** How long until the soonest scheduled run, or `null` when none is coming. */
export function nextRunIn(schedules = [], now = Date.now()) {
  const upcoming = schedules.map(({ nextRun }) => Date.parse(nextRun?.at)).filter(at => at > now);
  return upcoming.length ? Math.min(...upcoming) - now : null;
}

/**
 * Pi compacts by itself once only its reserve of the window is left, between model calls, and the turn then carries on. A manual compact
 * aborts the turn instead, so a busy session reaches the force level this way. This stays in memory, so Pi's own settings are not touched,
 * and a small window keeps the room Pi already needs.
 */
export function compactAtForceLevel(settings, models) {
  const reserveFor = model => Math.max(
    settings.getCompactionReserveTokens(model),
    Math.ceil(model.contextWindow * (100 - FORCE_AT_PERCENT) / 100),
  );
  const modelOverrides = Object.fromEntries(models
    .filter(model => Number.isFinite(model.contextWindow))
    .map(model => [`${model.provider}/${model.id}`, { reserveTokens: reserveFor(model) }]));

  settings.applyOverrides({ compaction: { modelOverrides } });
}
