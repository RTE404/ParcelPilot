export type Plan = 'Enterprise' | 'Growth' | 'Standard'
export type OrderStatus = 'DRAFT' | 'BOOKED' | 'PICKED_UP' | 'DELIVERED'
export type TicketStatus = 'open' | 'closed'

export interface Account {
  accountId: string
  accountName: string
  plan: Plan
  status: string
  csm: string
  contractFile: string | null
  premiumSupport: boolean
}

export interface Order {
  orderId: string
  accountId: string
  carrier: string
  status: OrderStatus
  bookedAt: string
  pickupWindowStart: string
  pickupWindowEnd: string
  pickupActualAt: string | null
  shipmentFeeInr: number
  carrierFault: boolean | null
  customerFault: boolean | null
  cancellationRequestedAt: string | null
}

export interface Ticket {
  ticketId: string
  accountId: string
  createdAt: string
  status: TicketStatus
  subject: string
  description: string
  channel: string
  assignedTo: string
  lastCustomerMessageAt: string
  historicalResolution: string | null
}

export type DocStatus = 'current' | 'deprecated'
export type DocType = 'policy' | 'sop' | 'product_guide' | 'contract'
export type Severity = 'P1' | 'P2' | 'P3'

export interface DocumentChunk {
  chunkId: string
  docId: string
  docName: string
  status: DocStatus
  docType: DocType
  accountScope: string | null
  sectionTitle: string
  text: string
}

export interface ContractRule {
  accountId: string
  sourceDoc: string
  sourceSection: string
  slaOverrides: Record<Severity, string> | null
  cancellationFeeWaived: boolean
  cancellationFeeGraceMinutes: number | null
  cancellationFeeAmountInr: number | null
  creditDelayThresholdHours: number | null
  creditAmountInr: number | null
  creditMonthlyCapInr: number | null
}
