import { createHash, createHmac, randomBytes } from 'node:crypto';

const VERSION = 'hobkin-v1';
const SECRET = /^[0-9a-f]{64}$/;
const EMPTY = Buffer.alloc(0);

export const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex');

/** 16 fresh random bytes as 32 lowercase hex characters, new for every attempt. */
export const freshNonce = () => randomBytes(16).toString('hex');

/**
 * Signature v1 signs these nine values joined by one newline, with none after the last. Nothing is decoded, sorted or
 * normalized, so the target is the path and query exactly as sent, and the body is hashed as its exact bytes.
 */
export function canonicalInput({ installationId, keyId, method, target, timestamp, nonce, idempotencyKey = '', body = EMPTY }) {
  return [VERSION, installationId, keyId, method.toUpperCase(), target, String(timestamp), nonce, idempotencyKey, sha256Hex(body)].join('\n');
}

/** The secret is 32 bytes written as hex, and the key is those bytes, never the hex text. */
export function signRequest({ secret, ...request }) {
  if (typeof secret !== 'string' || !SECRET.test(secret)) throw Error('The signing secret must be 64 lowercase hex characters.');
  return createHmac('sha256', Buffer.from(secret, 'hex')).update(canonicalInput(request), 'utf8').digest('hex');
}

export function signedHeaders(request) {
  const { installationId, keyId, timestamp, nonce, idempotencyKey = '' } = request;
  return {
    'X-Hobkin-Installation-Id': installationId,
    'X-Hobkin-Key-Id': keyId,
    'X-Hobkin-Timestamp': String(timestamp),
    'X-Hobkin-Nonce': nonce,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    'X-Hobkin-Signature': signRequest(request),
  };
}
