import type { HostPartFactory } from '#host/integration-contract.ts'

const factory: HostPartFactory = () => {
  throw Error('it cannot start')
}

export default factory
