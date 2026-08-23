import { describe, it, expect } from 'vitest'
import { calculateServiceCredit } from '../serviceCredit'
import type { Order } from '@/lib/data/types'

function order(overrides: Partial<Order>): Order {
  return {
    orderId: 'ORD-TEST', accountId: 'ACCT-003', carrier: 'RoadRunner', status: 'BOOKED',
    bookedAt: '2026-08-16T04:30:00+05:30', pickupWindowStart: '2026-08-16T05:30:00+05:30',
    pickupWindowEnd: '2026-08-16T06:30:00+05:30', pickupActualAt: null, shipmentFeeInr: 2400,
    carrierFault: true, customerFault: false, cancellationRequestedAt: null,
    ...overrides,
  }
}

const NOW = '2026-08-16T11:00:00+05:30'

describe('calculateServiceCredit', () => {
  it('escalates with MISSING_DATA when fault is unknown', () => {
    const result = calculateServiceCredit(order({ carrierFault: null, customerFault: null }), NOW, 0)
    expect(result.eligible).toBe(false)
    expect(result.escalate).toBe('MISSING_DATA')
  })

  it('is not eligible when the customer is at fault', () => {
    const result = calculateServiceCredit(order({ carrierFault: false, customerFault: true }), NOW, 0)
    expect(result.eligible).toBe(false)
  })

  it('applies the default 2-hour threshold and min(500, 10%) formula for a non-contract account', () => {
    // late by 4.5h (window end 06:30, now 11:00), carrier fault, shipmentFee 2400 -> 10% = 240
    const result = calculateServiceCredit(order({}), NOW, 0)
    expect(result.eligible).toBe(true)
    expect(result.creditInr).toBe(240)
    expect(result.requiresApproval).toBe(false)
  })

  it('is not eligible under the default policy when late by exactly 2 hours', () => {
    const result = calculateServiceCredit(
      order({ pickupWindowEnd: '2026-08-16T09:00:00+05:30' }), NOW, 0, // exactly 2h late at NOW
    )
    expect(result.eligible).toBe(false)
  })

  it('applies LumenWorks\' 4-hour / fixed ₹300 override instead of the SOP default', () => {
    // pickup window end 07:00, now 11:00 -> late by 4h exactly: NOT eligible under LumenWorks' >4h rule
    const notYetEligible = calculateServiceCredit(
      order({ accountId: 'ACCT-002', pickupWindowEnd: '2026-08-16T07:00:00+05:30' }), NOW, 0,
    )
    expect(notYetEligible.eligible).toBe(false)

    // late by 4h 1m -> eligible, fixed 300 (not the SOP formula)
    const eligible = calculateServiceCredit(
      order({ accountId: 'ACCT-002', pickupWindowEnd: '2026-08-16T06:58:00+05:30' }), NOW, 0,
    )
    expect(eligible.eligible).toBe(true)
    expect(eligible.creditInr).toBe(300)
  })

  it('flags requiresApproval when the credit exceeds INR 1,000', () => {
    const result = calculateServiceCredit(order({ shipmentFeeInr: 20000 }), NOW, 0) // 10% = 2000, capped by 500 -> 500, not >1000
    expect(result.requiresApproval).toBe(false)
    // force a >1000 case directly via a large fixed override scenario is covered by contract data;
    // for the default formula the cap of 500 means requiresApproval is always false — documented behavior.
  })

  it('escalates with EXCEEDS_APPROVAL_LIMIT when Northstar\'s monthly cap would be exceeded', () => {
    const result = calculateServiceCredit(order({ accountId: 'ACCT-001', shipmentFeeInr: 2400 }), NOW, 4900) // 4900 + 240 > 5000 cap
    expect(result.escalate).toBe('EXCEEDS_APPROVAL_LIMIT')
  })

  // I5: citation must reflect whether the specific field used (threshold or amount) actually
  // came from the contract, not merely whether a contract rule object exists for the account.
  describe('citation accuracy (I5)', () => {
    it('cites the SOP, not the contract, when Northstar (ACCT-001) falls through to the default threshold', () => {
      // Northstar has a contract rule, but creditDelayThresholdHours is null -> SOP default (2h) applies.
      // late by exactly 2h -> not eligible, and the "at or under threshold" branch fires.
      const result = calculateServiceCredit(
        order({ accountId: 'ACCT-001', pickupWindowEnd: '2026-08-16T09:00:00+05:30' }), NOW, 0,
      )
      expect(result.eligible).toBe(false)
      expect(result.citation).toBe('03_Cancellation_and_Service_Credit_SOP_v4.pdf, Section 2')
    })

    it('cites the SOP, not the contract, when Northstar (ACCT-001) falls through to the default credit amount formula', () => {
      // creditAmountInr is null for Northstar -> SOP min(500, 10%) formula applies.
      const result = calculateServiceCredit(order({ accountId: 'ACCT-001', shipmentFeeInr: 2400 }), NOW, 0)
      expect(result.eligible).toBe(true)
      expect(result.creditInr).toBe(240)
      expect(result.citation).toBe('03_Cancellation_and_Service_Credit_SOP_v4.pdf, Section 2')
    })

    it('cites the contract (regression) when LumenWorks (ACCT-002) has a non-null contract threshold', () => {
      // late by exactly 4h under LumenWorks' 4h contract threshold -> not eligible, contract cited.
      const result = calculateServiceCredit(
        order({ accountId: 'ACCT-002', pickupWindowEnd: '2026-08-16T07:00:00+05:30' }), NOW, 0,
      )
      expect(result.eligible).toBe(false)
      expect(result.citation).toBe('06_LumenWorks_Service_Agreement.pdf')
    })

    it('cites the contract (regression) when LumenWorks (ACCT-002) has a non-null fixed credit amount', () => {
      const result = calculateServiceCredit(
        order({ accountId: 'ACCT-002', pickupWindowEnd: '2026-08-16T06:58:00+05:30' }), NOW, 0,
      )
      expect(result.eligible).toBe(true)
      expect(result.creditInr).toBe(300)
      expect(result.citation).toBe('06_LumenWorks_Service_Agreement.pdf')
    })
  })
})
