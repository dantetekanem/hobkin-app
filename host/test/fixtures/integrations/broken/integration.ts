import { Type } from 'typebox'
import { defineIntegration } from '#shared/integration/manifest.ts'

export default defineIntegration({
  id: 'broken',
  name: 'Broken',
  line: 'Its host part cannot start',
  screens: [],
  commands: { 'broken.run': { description: 'Never runs.', runs: 'host', args: Type.Object({}, { additionalProperties: false }) } },
})
