// Transport/resource admission, not a model token window. Work context can exceed 64 KiB.
const DEFAULT_BYTES = 256 * 1024;
const MIN_BYTES = 64 * 1024;
const MAX_BYTES = 1024 * 1024;

export function promptByteLimit() {
  const value = process.env.HOBKIN_MAX_PROMPT_BYTES;
  if (value === undefined) return DEFAULT_BYTES;
  const bytes = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(bytes) || bytes < MIN_BYTES || bytes > MAX_BYTES) {
    throw Error(`HOBKIN_MAX_PROMPT_BYTES must be an integer from ${MIN_BYTES} to ${MAX_BYTES}.`);
  }
  return bytes;
}

export function assertPromptBytes(prompt, limit, label) {
  const bytes = Buffer.byteLength(prompt);
  if (bytes > limit) throw Error(`${label} exceeded its byte limit (${bytes} > ${limit} UTF-8 bytes); check HOBKIN_MAX_PROMPT_BYTES.`);
}
