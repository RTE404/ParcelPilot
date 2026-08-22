import type { Order } from '@/lib/data/types'
import { getContractRule } from '@/lib/data/contractRules'
import { REFERENCE_NOW } from '@/lib/data/loadData'

export interface CancellationResult {
  cancellable: boolean
  feeWaived: boolean
  feeInr: number | null
  reason: string
  citation: string
}

const SOP_CITATION = '03_Cancellation_and_Service_Credit_SOP_v4.pdf, Section 1'
const DEFAULT_GRACE_MINUTES = 30
const DEFAULT_FEE_INR = 250

export function calculateCancellationEligibility(order: Order): CancellationResult {
  if (order.status === 'DRAFT') {
    return { cancellable: true, feeWaived: true, feeInr: null, reason: 'DRAFT orders may be cancelled with no fee', citation: SOP_CITATION }
  }
  if (order.status === 'PICKED_UP') {
    return { cancellable: false, feeWaived: false, feeInr: null, reason: 'already picked up — use the return-to-origin workflow instead', citation: SOP_CITATION }
  }
  if (order.status === 'DELIVERED') {
    return { cancellable: false, feeWaived: false, feeInr: null, reason: 'delivered orders cannot be cancelled', citation: SOP_CITATION }
  }

  // status === 'BOOKED'
  const rule = getContractRule(order.accountId)
  if (rule?.cancellationFeeWaived) {
    return { cancellable: true, feeWaived: true, feeInr: null, reason: 'account contract waives the cancellation fee regardless of timing', citation: `${rule.sourceDoc}, Section 2 (Northstar)` }
  }

  const requestedAt = order.cancellationRequestedAt ? new Date(order.cancellationRequestedAt) : new Date(REFERENCE_NOW)
  const bookedAt = new Date(order.bookedAt)
  const minutesSinceBooking = (requestedAt.getTime() - bookedAt.getTime()) / 60000
  const graceMinutes = rule?.cancellationFeeGraceMinutes ?? DEFAULT_GRACE_MINUTES

  if (minutesSinceBooking <= graceMinutes) {
    return { cancellable: true, feeWaived: true, feeInr: null, reason: `cancellation requested within the ${graceMinutes}-minute grace period`, citation: SOP_CITATION }
  }

  const feeInr = rule?.cancellationFeeAmountInr ?? DEFAULT_FEE_INR
  return { cancellable: true, feeWaived: false, feeInr, reason: `cancellation requested ${Math.round(minutesSinceBooking)} minutes after booking, past the ${graceMinutes}-minute grace period`, citation: SOP_CITATION }
}
