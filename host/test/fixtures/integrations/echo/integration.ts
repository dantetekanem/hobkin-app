import { Type } from 'typebox'
import { defineIntegration } from '#shared/integration/manifest.ts'

/** A small integration for the host's tests: it says back what it is told, and keeps count. */
export default defineIntegration({
  id: 'echo',
  name: 'Echo',
  line: 'Says back what it is told',
  screens: [{ id: 'echo-page', label: 'Echo', line: 'What echo said', keywords: ['say'] }],
  commands: {
    'echo.say': {
      description: 'Say a line back.',
      runs: 'host',
      args: Type.Object({ text: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
      hobkin: true,
    },
    'echo.quiet': {
      description: 'Say nothing, and only for the window.',
      runs: 'host',
      args: Type.Object({}, { additionalProperties: false }),
    },
  },
})
