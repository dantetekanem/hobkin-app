/**
 * Jumping to a step by its number. 1 to 9 are steps 1 to 9 and 0 is step 10. Two digits typed within
 * the window make one number. A number that cannot grow into another step of the story is taken at once,
 * so a short story never waits.
 */

/** How long a digit waits for a second one, in milliseconds. */
export const DIGIT_WINDOW = 600

export interface DigitBuffer {
  /** The digits typed so far. Empty when nothing is waiting. */
  digits: string
  /** When the last digit was typed. */
  at: number
}

export const NO_DIGITS: DigitBuffer = { digits: '', at: 0 }

export interface DigitResult {
  buffer: DigitBuffer
  /** The index of the step to go to now. */
  jump: number | null
  /** Milliseconds to wait before the number typed so far is taken. */
  wait: number | null
}

/** The step a run of digits names. A lone 0 is step 10. A step past the end of the story is its last. */
function stepOf(digits: string, total: number): number {
  return Math.min(digits === '0' ? 10 : Number(digits), total)
}

export function pressDigit(buffer: DigitBuffer, digit: string, now: number, total: number): DigitResult {
  if (!/^[0-9]$/.test(digit) || total < 1) return { buffer: NO_DIGITS, jump: null, wait: null }
  const continuing = buffer.digits !== '' && now - buffer.at <= DIGIT_WINDOW
  const digits = continuing ? buffer.digits + digit : digit
  // The smallest number this could still become is ten times what it is. A lone 0 is already 10.
  const canGrow = digits !== '0' && Number(digits) * 10 <= total
  if (canGrow) return { buffer: { digits, at: now }, jump: null, wait: DIGIT_WINDOW }
  return { buffer: NO_DIGITS, jump: stepOf(digits, total) - 1, wait: null }
}

/** Takes the number typed so far, when the window has closed. */
export function commitDigits(buffer: DigitBuffer, total: number): { buffer: DigitBuffer; jump: number | null } {
  if (buffer.digits === '' || total < 1) return { buffer: NO_DIGITS, jump: null }
  return { buffer: NO_DIGITS, jump: stepOf(buffer.digits, total) - 1 }
}
