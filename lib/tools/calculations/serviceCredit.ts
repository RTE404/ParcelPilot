import type { Order } from '@/lib/data/types'
import { getContractRule } from '@/lib/data/contractRules'

export interface ServiceCreditResult {
  eligible: boolean
  creditInr: number | null
  requiresApproval: boolean
  reason: string
  citation: string
  escalate?: 'MISSING_DATA' | 'EXCEEDS_APPROVAL_LIMIT'
}

const SOP_CITATION = '03_Cancellation_and_Service_Credit_SOP_v4.pdf, Section 2'
const DEFAULT_THRESHOLD_HOURS = 2
const DEFAULT_CAP_INR = 500
const APPROVAL_THRESHOLD_INR = 1000

export function calculateServiceCredit(order: Order, referenceNow: string, priorCreditsThisMonthInr: number): ServiceCreditResult {
  if (order.carrierFault === null || order.customerFault === null) {
    return {
      eligible: false, creditInr: null, requiresApproval: false,
      reason: 'carrier/customer fault is unknown for this order — cannot promise a credit',
      citation: '03_Cancellation_and_Service_Credit_SOP_v4.pdf, Section 3',
      escalate: 'MISSING_DATA',
    }
  }
  if (order.customerFault || !order.carrierFault) {
    return { eligible: false, creditInr: null, requiresApproval: false, reason: 'not carrier-fault-only', citation: SOP_CITATION }
  }

  const rule = getContractRule(order.accountId)
  const thresholdHours = rule?.creditDelayThresholdHours ?? DEFAULT_THRESHOLD_HOURS

  const windowEnd = new Date(order.pickupWindowEnd)
  const comparisonPoint = order.pickupActualAt ? new Date(order.pickupActualAt) : new Date(referenceNow)
  const lateHours = (comparisonPoint.getTime() - windowEnd.getTime()) / 3_600_000

  if (lateHours <= thresholdHours) {
    return { eligible: false, creditInr: null, requiresApproval: false, reason: `late by ${lateHours.toFixed(1)}h, at or under the ${thresholdHours}h threshold`, citation: rule?.sourceDoc ?? SOP_CITATION }
  }

  const creditInr = rule?.creditAmountInr ?? Math.min(DEFAULT_CAP_INR, Math.round(order.shipmentFeeInr * 0.10))

  const monthlyCap = rule?.creditMonthlyCapInr
  if (monthlyCap != null && priorCreditsThisMonthInr + creditInr > monthlyCap) {
    return {
      eligible: true, creditInr, requiresApproval: true,
      reason: `credit would push monthly total to ${priorCreditsThisMonthInr + creditInr}, exceeding the ${monthlyCap} cap`,
      citation: rule!.sourceDoc, escalate: 'EXCEEDS_APPROVAL_LIMIT',
    }
  }

  return {
    eligible: true, creditInr, requiresApproval: creditInr > APPROVAL_THRESHOLD_INR,
    reason: `late by ${lateHours.toFixed(1)}h, carrier at fault`, citation: rule?.sourceDoc ?? SOP_CITATION,
  }
}
