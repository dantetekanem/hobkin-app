import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const SECOND_MS = 1000;

// The provider states these in seconds and text, and a value it left out stays out.
const windowFrom = (used, minutes, resetAt) => {
  const usedPercent = Number(used);
  if (used === undefined || used === null || used === '' || !Number.isFinite(usedPercent)) return {};
  return {
    usedPercent,
    ...(Number.isFinite(Number(minutes)) && minutes !== undefined && minutes !== null ? { windowMinutes: Number(minutes) } : {}),
    ...(Number(resetAt) > 0 ? { resetAt: Number(resetAt) * SECOND_MS } : {}),
  };
};
const named = (primary, secondary) => ({
  ...(primary.usedPercent === undefined ? {} : { primary }),
  ...(secondary.usedPercent === undefined ? {} : { secondary }),
});
const fromHeaders = headers => {
  const [primary, secondary] = ['primary', 'secondary'].map(name => windowFrom(
    headers?.[`x-codex-${name}-used-percent`],
    headers?.[`x-codex-${name}-window-minutes`],
    headers?.[`x-codex-${name}-reset-at`],
  ));
  return named(primary, secondary);
};
const fromEvent = ({ rate_limits: limits }) => {
  const [primary, secondary] = [limits?.primary, limits?.secondary].map(entry => windowFrom(entry?.used_percent, entry?.window_minutes, entry?.reset_at));
  return named(primary, secondary);
};

/**
 * Loaded into Hobkin's jobs. The provider puts the subscription's usage on every reply and Pi shows it to extensions,
 * so this reads no credentials and makes no request. It lives in the run's own process, and the owner reads the file.
 */
export default function watchUsage(pi) {
  let file = null;
  const save = windows => {
    if (!file || !Object.keys(windows).length) return;
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, JSON.stringify({ at: new Date().toISOString(), ...windows }), { mode: 0o600 });
      renameSync(temporary, file);
    } catch {
      // A reading is a help to the owner, and never worth a run.
    }
  };
  pi.on('session_start', (_event, context) => {
    const session = context.sessionManager.getSessionFile();
    file = session && basename(dirname(session)) === 'jobs' ? join(dirname(dirname(session)), 'work', 'subscription.json') : null;
  });
  pi.on('after_provider_response', ({ headers }) => save(fromHeaders(headers)));
  pi.on('provider_stream_event', ({ data }) => {
    if (data?.type === 'codex.rate_limits') save(fromEvent(data));
  });
}
