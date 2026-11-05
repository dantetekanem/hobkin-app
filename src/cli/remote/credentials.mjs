import { randomBytes } from 'node:crypto';
import { linkSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_BASE_URL = 'https://api.hobkin.dev';
const ENROLL_TIMEOUT_MS = 10000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[0-9a-f]{64}$/;
const FIELDS = ['base_url', 'installation_id', 'key_id', 'secret'];
const MAX_BYTES = 4096;
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

export const credentialsFile = root => join(root, 'runtime', 'remote.json');

/** Plain HTTP only reaches this machine. Anything else needs HTTPS, and the base is an origin, so the signed path is the path sent. */
export function checkBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('remote.json has a base_url that is not a URL.');
  }

  const onThisMachine = url.protocol === 'http:' && LOOPBACK.test(url.hostname);
  if (url.protocol !== 'https:' && !onThisMachine) throw Error('remote.json needs an HTTPS base_url, except plain HTTP on this machine.');

  const onlyAnOrigin = typeof value === 'string'
    && !/[?#]/.test(value)
    && !url.username
    && !url.password
    && url.pathname === '/';
  if (!onlyAnOrigin) throw Error('remote.json needs a base_url with only a scheme, a host and a port.');

  return url.origin;
}

/** Each value stays private to this object, so logging it, inspecting it or saving it as JSON shows none of them. */
class RemoteCredentials {
  #installationId;
  #keyId;
  #secret;
  #baseUrl;

  constructor({ installation_id, key_id, secret, base_url }) {
    this.#installationId = installation_id;
    this.#keyId = key_id;
    this.#secret = secret;
    this.#baseUrl = base_url;
  }

  get installationId() { return this.#installationId; }
  get keyId() { return this.#keyId; }
  get secret() { return this.#secret; }
  get baseUrl() { return this.#baseUrl; }
}

function parsed(text) {
  try {
    return JSON.parse(text);
  } catch {
    // The parser quotes what it read, and that would be the secret.
    throw Error('remote.json is not valid JSON.');
  }
}

function validated(value) {
  const isRecord = value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isRecord || Object.keys(value).some(key => !FIELDS.includes(key))) {
    throw Error('remote.json must hold only installation_id, key_id, secret and base_url.');
  }
  if (!UUID.test(value.installation_id ?? '') || !UUID.test(value.key_id ?? '')) {
    throw Error('remote.json needs installation_id and key_id as lowercase UUIDs.');
  }
  if (!SECRET.test(value.secret ?? '')) throw Error('remote.json needs a secret of 64 lowercase hex characters.');

  return {
    installation_id: value.installation_id,
    key_id: value.key_id,
    secret: value.secret,
    base_url: checkBaseUrl(value.base_url ?? DEFAULT_BASE_URL),
  };
}

/**
 * Enrollment or provisioning writes remote.json; reading never does. No file means this machine is not enrolled,
 * and nothing is sent. A file anyone else can read is refused, and no error ever repeats what the file holds.
 */
export function readCredentials(root) {
  const file = credentialsFile(root);
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('remote.json must be a small regular file.');
  if (stat.mode & 0o077) throw Error('remote.json must be private to you, with mode 0600.');

  const values = validated(parsed(readFileSync(file, 'utf8')));
  return new RemoteCredentials(values);
}

/** Whether this machine can send, and where to, for anything that only reports. It never throws. */
export function enrollment(root) {
  try {
    const credentials = readCredentials(root);
    return credentials ? { enrolled: true, sendsTo: credentials.baseUrl } : { enrolled: false };
  } catch (error) {
    return { enrolled: false, problem: error.message };
  }
}

/**
 * A machine with no remote.json asks hobkin's server for its own key, once, and keeps it private to this user.
 * A file already in place is never replaced, even one that cannot be used. A failure leaves nothing behind, so a
 * later pass asks again.
 */
export async function enroll(root, { fetch = globalThis.fetch, baseUrl = DEFAULT_BASE_URL } = {}) {
  const file = credentialsFile(root);
  if (lstatSync(file, { throwIfNoEntry: false })) return false;

  const response = await fetch(new URL('/api/v1/enrollments', baseUrl), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(ENROLL_TIMEOUT_MS),
  });
  if (response.status !== 201) return false;
  const { installation_id, key_id, secret } = await response.json();
  const values = validated({ installation_id, key_id, secret, base_url: baseUrl });

  // Written whole under a private name, then linked into place: never half a key, never over one written meanwhile.
  mkdirSync(join(root, 'runtime'), { recursive: true, mode: 0o700 });
  const draft = `${file}.${randomBytes(8).toString('hex')}`;
  writeFileSync(draft, JSON.stringify(values), { flag: 'wx', mode: 0o600 });
  try {
    linkSync(draft, file);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    unlinkSync(draft);
  }
  return true;
}
