import type { Account, Order, Ticket } from './types'
import accountsJson from './accounts.json'
import ordersJson from './orders.json'
import ticketsJson from './tickets.json'

export const REFERENCE_NOW = '2026-08-16T11:00:00+05:30'

export function loadAccounts(): Account[] {
  return accountsJson as Account[]
}

export function loadOrders(): Order[] {
  return ordersJson as Order[]
}

export function loadTickets(): Ticket[] {
  return ticketsJson as Ticket[]
}

export function getAccountById(accountId: string): Account | undefined {
  return loadAccounts().find(a => a.accountId === accountId)
}

export function getOrderById(orderId: string): Order | undefined {
  return loadOrders().find(o => o.orderId === orderId)
}

export function getTicketById(ticketId: string): Ticket | undefined {
  return loadTickets().find(t => t.ticketId === ticketId)
}
