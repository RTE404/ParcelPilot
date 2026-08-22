import { describe, it, expect } from 'vitest'
import { loadAccounts, loadOrders, loadTickets, getAccountById, REFERENCE_NOW } from '../loadData'

describe('loadData', () => {
  it('loads exactly the 4 known accounts', () => {
    const accounts = loadAccounts()
    expect(accounts).toHaveLength(4)
    expect(accounts.map(a => a.accountId).sort()).toEqual([
      'ACCT-001', 'ACCT-002', 'ACCT-003', 'ACCT-004',
    ])
  })

  it('loads Northstar with its contract file and Enterprise plan', () => {
    const northstar = getAccountById('ACCT-001')
    expect(northstar?.accountName).toBe('Northstar Logistics')
    expect(northstar?.plan).toBe('Enterprise')
    expect(northstar?.contractFile).toBe('05_Northstar_Logistics_Enterprise_Agreement.pdf')
  })

  it('loads 6 orders and 7 tickets', () => {
    expect(loadOrders()).toHaveLength(6)
    expect(loadTickets()).toHaveLength(7)
  })

  it('exposes the fixed reference time from the workbook README', () => {
    expect(REFERENCE_NOW).toBe('2026-08-16T11:00:00+05:30')
  })

  it('loads ORD-1001 with its known fields', () => {
    const order = loadOrders().find(o => o.orderId === 'ORD-1001')
    expect(order).toMatchObject({
      accountId: 'ACCT-001',
      carrier: 'SwiftShip',
      status: 'BOOKED',
      carrierFault: false,
      customerFault: false,
    })
  })
})
