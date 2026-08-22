import type { ContractRule } from './types'

export const ALL_CONTRACT_RULES: ContractRule[] = [
  {
    accountId: 'ACCT-001',
    sourceDoc: '05_Northstar_Logistics_Enterprise_Agreement.pdf',
    sourceSection: '1-3',
    slaOverrides: { P1: '15m', P2: '1h', P3: '8bh' },
    cancellationFeeWaived: true,
    cancellationFeeGraceMinutes: null,
    cancellationFeeAmountInr: null,
    creditDelayThresholdHours: null,       // no override — SOP default (2h) applies
    creditAmountInr: null,                  // no fixed override — SOP formula applies
    creditMonthlyCapInr: 5000,
  },
  {
    accountId: 'ACCT-002',
    sourceDoc: '06_LumenWorks_Service_Agreement.pdf',
    sourceSection: '1-3',
    slaOverrides: { P1: '2bh', P2: '4bh', P3: '2bd' },
    cancellationFeeWaived: false,
    cancellationFeeGraceMinutes: null,
    cancellationFeeAmountInr: null,
    creditDelayThresholdHours: 4,
    creditAmountInr: 300,
    creditMonthlyCapInr: null,
  },
]

export function getContractRule(accountId: string): ContractRule | undefined {
  return ALL_CONTRACT_RULES.find(r => r.accountId === accountId)
}
