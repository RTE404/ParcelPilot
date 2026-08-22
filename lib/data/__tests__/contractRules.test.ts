import { describe, it, expect } from 'vitest'
import { getContractRule } from '../contractRules'

describe('contractRules', () => {
  it('encodes Northstar fee waiver and 15-minute P1 SLA', () => {
    const rule = getContractRule('ACCT-001')
    expect(rule?.cancellationFeeWaived).toBe(true)
    expect(rule?.slaOverrides?.P1).toBe('15m')
  })

  it('encodes LumenWorks 4-hour / ₹300 credit override', () => {
    const rule = getContractRule('ACCT-002')
    expect(rule?.creditDelayThresholdHours).toBe(4)
    expect(rule?.creditAmountInr).toBe(300)
    expect(rule?.cancellationFeeWaived).toBe(false)
  })

  it('returns undefined for accounts with no contract', () => {
    expect(getContractRule('ACCT-003')).toBeUndefined()
    expect(getContractRule('ACCT-004')).toBeUndefined()
  })
})
