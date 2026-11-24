import { defineIntegration } from '#shared/integration/manifest.ts'

/** Its id is not its folder's name. */
export default defineIntegration({ id: 'another', name: 'Another', line: 'In the wrong folder', screens: [], commands: {} })
