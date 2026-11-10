/**
 * Handing the reviewer's questions to hobkin. The host will implement this by putting the message into
 * the conversation. Until then the sample keeps the message, so the screen can show what would be sent.
 */
export interface ReviewHandoff {
  /** Sends the questions to hobkin as one message in the conversation. */
  discuss(reviewId: string, message: string): Promise<void>
}

export interface SampleHandoff extends ReviewHandoff {
  /** The last message handed over, which the sample did not send anywhere. */
  last(): { reviewId: string; message: string } | null
}

export function createSampleHandoff(): SampleHandoff {
  let last: { reviewId: string; message: string } | null = null
  return {
    async discuss(reviewId, message) {
      last = { reviewId, message }
    },
    last: () => last,
  }
}

export const sampleHandoff = createSampleHandoff()
