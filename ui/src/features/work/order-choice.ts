import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { DEFAULT_ORDER, type Order } from './change-list.ts'

/**
 * The order Work's finished changes are in. It lives while the window does, not across restarts, and on globalThis, as
 * the project choice does, so a hot update of this file keeps it.
 */
interface OrderChoice {
  order: Order
  choose: (order: Order) => void
}

const holder = globalThis as { __hobkinWorkOrder?: UseBoundStore<StoreApi<OrderChoice>> }
export const useOrderChoice = (holder.__hobkinWorkOrder ??= create<OrderChoice>()(() => ({ order: DEFAULT_ORDER }) as OrderChoice))

useOrderChoice.setState({ choose: (order) => useOrderChoice.setState({ order }) })
