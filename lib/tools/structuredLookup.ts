import { loadOrders, loadAccounts, loadTickets } from '@/lib/data/loadData'
import type { Order, Account, Ticket } from '@/lib/data/types'
import type { SessionIdentity } from '@/lib/identity/types'

type Found<T> = { found: true; record: T } | { found: false }

function accountFilterFor(session: SessionIdentity, requestedAccountId?: string): string | undefined {
  if (session.surface === 'customer') return session.accountId
  return requestedAccountId
}

export function getOrder(orderId: string, session: SessionIdentity): Found<Order> {
  const order = loadOrders().find(o => o.orderId === orderId)
  if (!order) return { found: false }
  const filter = accountFilterFor(session)
  if (filter && order.accountId !== filter) return { found: false }
  return { found: true, record: order }
}

export function getAccount(session: SessionIdentity, requestedAccountId?: string): Found<Account> {
  const accountId = session.surface === 'customer' ? session.accountId : requestedAccountId
  const account = loadAccounts().find(a => a.accountId === accountId)
  if (!account) return { found: false }
  return { found: true, record: account }
}

export function getTicket(ticketId: string, session: SessionIdentity): Found<Ticket> {
  const ticket = loadTickets().find(t => t.ticketId === ticketId)
  if (!ticket) return { found: false }
  const filter = accountFilterFor(session)
  if (filter && ticket.accountId !== filter) return { found: false }
  return { found: true, record: ticket }
}

export function listOpenTickets(session: SessionIdentity): Ticket[] {
  const open = loadTickets().filter(t => t.status === 'open')
  if (session.surface === 'customer') return open.filter(t => t.accountId === session.accountId)
  return open
}
