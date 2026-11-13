import { FADE_OUT, pitchCurve, type Tone } from './sounds.ts'

/** The parts of a Web Audio context the player uses. A real `AudioContext` is one, and a test hands it a fake. */
export interface SoundParam {
  setValueAtTime(value: number, at: number): unknown
  linearRampToValueAtTime(value: number, at: number): unknown
  exponentialRampToValueAtTime(value: number, at: number): unknown
}
export interface SoundNode {
  connect(destination: SoundNode): unknown
}
export interface SoundContext {
  readonly currentTime: number
  readonly destination: SoundNode
  createOscillator(): SoundNode & { type: string; readonly frequency: SoundParam; start(at: number): void; stop(at: number): void }
  createGain(): SoundNode & { readonly gain: SoundParam }
}

/** Tones start this far past the clock, so a start is never already behind the audio by the time it is read. */
const AHEAD = 0.005
/** How quiet a tone's decay gets before its last ramp to silence. An exponential ramp cannot reach zero itself. */
const FLOOR = 0.001

/**
 * Plays a sound's tones now: each is one oscillator through its own gain to the speakers. The gain rises from silence
 * to the peak, decays, and ends at silence, and the oscillator stops there, so the page lets both go.
 */
export function playTones(context: SoundContext, tones: readonly Tone[]): void {
  const start = context.currentTime + AHEAD
  for (const tone of tones) {
    const begin = start + tone.at
    const end = begin + tone.length
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = tone.wave
    const [first, ...rest] = pitchCurve(tone)
    oscillator.frequency.setValueAtTime(first![1], begin)
    for (const [at, hz] of rest) oscillator.frequency.linearRampToValueAtTime(hz, begin + at)
    gain.gain.setValueAtTime(0, begin)
    gain.gain.linearRampToValueAtTime(tone.peak, begin + tone.attack)
    gain.gain.exponentialRampToValueAtTime(FLOOR, end - FADE_OUT)
    gain.gain.linearRampToValueAtTime(0, end)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(begin)
    oscillator.stop(end)
  }
}
