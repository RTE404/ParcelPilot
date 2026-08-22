import { describe, it, expect } from 'vitest'
import { calculateCancellationEligibility } from '../cancellationEligibility'
import type { Order } from '@/lib/data/types'

function order(overrides: Partial<Order>): Order {
  return {
    orderId: 'ORD-TEST', accountId: 'ACCT-003', carrier: 'RoadRunner', status: 'BOOKED',
    bookedAt: '2026-08-16T09:00:00+05:30', pickupWindowStart: '2026-08-16T10:00:00+05:30',
    pickupWindowEnd: '2026-08-16T11:00:00+05:30', pickupActualAt: null, shipmentFeeInr: 1000,
    carrierFault: null, customerFault: null, cancellationRequestedAt: null,
    ...overrides,
  }
}

describe('calculateCancellationEligibility', () => {
  it('waives the fee for Northstar (ACCT-001) regardless of timing', () => {
    const result = calculateCancellationEligibility(
      order({ accountId: 'ACCT-001', bookedAt: '2026-08-16T09:00:00+05:30', cancellationRequestedAt: '2026-08-16T11:00:00+05:30' }),
    )
    expect(result.cancellable).toBe(true)
    expect(result.feeWaived).toBe(true)
    expect(result.citation).toContain('Northstar')
  })

  it('charges INR 250 for a non-contract account cancelling after the 30-minute grace period', () => {
    const result = calculateCancellationEligibility(
      order({ bookedAt: '2026-08-16T09:00:00+05:30', cancellationRequestedAt: '2026-08-16T09:35:00+05:30' }),
    )
    expect(result.feeWaived).toBe(false)
    expect(result.feeInr).toBe(250)
  })

  it('waives the fee within exactly 30 minutes of booking', () => {
    const result = calculateCancellationEligibility(
      order({ bookedAt: '2026-08-16T09:00:00+05:30', cancellationRequestedAt: '2026-08-16T09:30:00+05:30' }),
    )
    expect(result.feeWaived).toBe(true)
  })

  it('charges the fee at 30 minutes and 1 second', () => {
    const result = calculateCancellationEligibility(
      order({ bookedAt: '2026-08-16T09:00:00+05:30', cancellationRequestedAt: '2026-08-16T09:30:01+05:30' }),
    )
    expect(result.feeWaived).toBe(false)
  })

  it('is free for a DRAFT order', () => {
    const result = calculateCancellationEligibility(order({ status: 'DRAFT' }))
    expect(result.cancellable).toBe(true)
    expect(result.feeWaived).toBe(true)
  })

  it('refuses to cancel a PICKED_UP order', () => {
    const result = calculateCancellationEligibility(order({ status: 'PICKED_UP' }))
    expect(result.cancellable).toBe(false)
    expect(result.reason).toContain('return-to-origin')
  })

  it('refuses to cancel a DELIVERED order', () => {
    const result = calculateCancellationEligibility(order({ status: 'DELIVERED' }))
    expect(result.cancellable).toBe(false)
  })
})
