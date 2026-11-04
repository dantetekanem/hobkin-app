import { setTimeout as wait } from 'node:timers/promises';
import { readCredentials } from './credentials.mjs';
import { freshNonce, signedHeaders } from './sign.mjs';

export const FEEDBACK_PATH = '/api/v1/feedback';
export const TELEMETRY_PATH = '/api/v1/telemetry/batches';

const ATTEMPTS = 3;
const TIMEOUT_MS = 15000;
const MAX_WAIT_MS = 5000;
const FIRST_WAIT_MS = 500;
const NETWORK = { ok: false, status: 0, code: 'network', message: 'The server could not be reached.', retryable: true };
const REDIRECT = { code: 'redirect', message: 'The server answered with a redirect, which hobkin does not follow.', retryable: false };

const retryable = status => status === 429 || status >= 500;
const isRedirect = response => response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);

/** Seconds or an HTTP date, as milliseconds from now. */
function retryAfterMs(header, now) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

async function readJson(response) {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** A refusal in the server's shape, `{error:{code,message}}`, or a plain one named after its status. */
async function refusal(response, now) {
  const { error } = (await readJson(response)) ?? {};
  const code = typeof error?.code === 'string' ? error.code : `http_${response.status}`;
  const message = typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`;
  const result = { ok: false, status: response.status, code, message, retryable: retryable(response.status) };
  const after = retryAfterMs(response.headers.get('retry-after'), now);
  return after === null ? result : { ...result, retryAfterMs: after };
}

/**
 * Signed requests to the hobkin server. Every outcome is a plain result, never a throw. A network failure, a 429 and a
 * 5xx are tried again a few times, each with the same bytes and a fresh timestamp, nonce and signature. A refusal is
 * never tried again, a redirect is never followed, and a wait longer than a few seconds goes back to the caller.
 */
export function createTransport({
  credentials,
  fetch = globalThis.fetch,
  now = Date.now,
  sleep = wait,
  random = Math.random,
  attempts = ATTEMPTS,
  timeoutMs = TIMEOUT_MS,
  maxWaitMs = MAX_WAIT_MS,
}) {
  const backoffMs = tried => Math.min(maxWaitMs, FIRST_WAIT_MS * 2 ** (tried - 1)) * (0.5 + random() / 2);

  async function attempt({ method, path, body, idempotencyKey }) {
    const url = new URL(path, credentials.baseUrl);
    const headers = signedHeaders({
      secret: credentials.secret,
      installationId: credentials.installationId,
      keyId: credentials.keyId,
      method,
      target: url.pathname + url.search,
      timestamp: Math.floor(now() / 1000),
      nonce: freshNonce(),
      idempotencyKey,
      body,
    });
    if (body) headers['Content-Type'] = 'application/json';

    try {
      return await fetch(url, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return null;
    }
  }

  async function request({ method, path, body, idempotencyKey = '' }) {
    const sent = { method: method.toUpperCase(), path, body, idempotencyKey };
    let result = NETWORK;

    for (let tried = 1; tried <= attempts; tried++) {
      const response = await attempt(sent);
      if (response?.ok) return { ok: true, status: response.status, json: await readJson(response) };
      if (response && isRedirect(response)) return { ok: false, status: response.status, ...REDIRECT };

      result = response ? await refusal(response, now()) : NETWORK;
      if (!result.retryable || tried === attempts) break;

      const delay = result.retryAfterMs ?? backoffMs(tried);
      if (delay > maxWaitMs) break;
      await sleep(delay);
    }
    return result;
  }

  return { request };
}

/** A transport for this data folder, or null when it is not enrolled. Bad credentials throw, without saying what they hold. */
export function transportFor(root, options = {}) {
  const credentials = readCredentials(root);
  return credentials && createTransport({ ...options, credentials });
}
