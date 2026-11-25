import { runCommand } from '../../lib/host/client.ts'

/**
 * The Reports home's Catch me up (069-report-catch-up): hobkin starts one short report over the unread reports no
 * catch-up has covered, or says why it started nothing. The home shows hobkin's line where the press was.
 */

/** What the press says while the window shows sample reports, which hobkin never sees. */
export const CATCH_UP_SAMPLE_LINE = 'Sample reports. hobkin writes a catch-up once the host is connected.'

/** hobkin's line about the catch-up it started, or its refusal in its words. Never throws. */
export async function askCatchUp(sample: boolean): Promise<{ line: string; refused: boolean }> {
  if (sample) return { line: CATCH_UP_SAMPLE_LINE, refused: false }
  try {
    const { message } = await runCommand('reports.catchup.run')
    return { line: message, refused: false }
  } catch (error) {
    return { line: error instanceof Error ? error.message : String(error), refused: true }
  }
}
