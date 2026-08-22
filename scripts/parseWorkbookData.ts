import * as XLSX from 'xlsx'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WORKBOOK_PATH = join(__dirname, '..', 'ParcelPilot_Assessment_Data.xlsx')
const OUT_DIR = join(__dirname, '..', 'lib', 'data')

// The workbook stores India-local datetimes. With `sheet_to_json({ raw: false })`,
// xlsx returns date cells as already-formatted strings like "2026-08-16 09:00"
// rather than Date objects, so we parse that literal wall-clock string directly
// and stamp it with the explicit +05:30 offset — this avoids any dependency on
// the host machine's local timezone (unlike round-tripping through `new Date(...)`).
function toIsoWithOffset(excelDate: unknown): string {
  if (excelDate instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${excelDate.getFullYear()}-${pad(excelDate.getMonth() + 1)}-${pad(excelDate.getDate())}T${pad(excelDate.getHours())}:${pad(excelDate.getMinutes())}:00+05:30`
  }
  const str = String(excelDate).trim()
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (match) {
    const [, year, month, day, hour, minute] = match
    return `${year}-${month}-${day}T${hour}:${minute}:00+05:30`
  }
  // Fallback: let JS parse it and reformat using local getters.
  const d = new Date(str)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00+05:30`
}

// Workbook booleans are serialized as the strings "TRUE" / "FALSE" (uppercase)
// when read with `raw: false`. Compare case-insensitively to be resilient to
// minor casing differences between exports.
function toBool(value: unknown): boolean {
  return String(value).trim().toUpperCase() === 'TRUE'
}

function toNullableBool(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') return null
  return toBool(value)
}

function sheetToRows(wb: XLSX.WorkBook, name: string) {
  const sheet = wb.Sheets[name]
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: null })
}

const wb = XLSX.readFile(WORKBOOK_PATH, { cellDates: true })

const accounts = sheetToRows(wb, 'accounts').map(r => ({
  accountId: r.account_id,
  accountName: r.account_name,
  plan: r.plan,
  status: r.status,
  csm: r.csm,
  contractFile: r.contract_file ?? null,
  premiumSupport: toBool(r.premium_support),
}))

const orders = sheetToRows(wb, 'orders').map(r => ({
  orderId: r.order_id,
  accountId: r.account_id,
  carrier: r.carrier,
  status: r.status,
  bookedAt: r.booked_at ? toIsoWithOffset(r.booked_at) : null,
  pickupWindowStart: r.pickup_window_start ? toIsoWithOffset(r.pickup_window_start) : null,
  pickupWindowEnd: r.pickup_window_end ? toIsoWithOffset(r.pickup_window_end) : null,
  pickupActualAt: r.pickup_actual_at ? toIsoWithOffset(r.pickup_actual_at) : null,
  shipmentFeeInr: Number(r.shipment_fee_inr),
  carrierFault: toNullableBool(r.carrier_fault),
  customerFault: toNullableBool(r.customer_fault),
  cancellationRequestedAt: r.cancellation_requested_at ? toIsoWithOffset(r.cancellation_requested_at) : null,
}))

const tickets = sheetToRows(wb, 'tickets').map(r => ({
  ticketId: r.ticket_id,
  accountId: r.account_id,
  createdAt: r.created_at ? toIsoWithOffset(r.created_at) : null,
  status: r.status,
  subject: r.subject,
  description: r.description,
  channel: r.channel,
  assignedTo: r.assigned_to,
  lastCustomerMessageAt: r.last_customer_message_at ? toIsoWithOffset(r.last_customer_message_at) : null,
  historicalResolution: r.historical_resolution ?? null,
}))

writeFileSync(join(OUT_DIR, 'accounts.json'), JSON.stringify(accounts, null, 2))
writeFileSync(join(OUT_DIR, 'orders.json'), JSON.stringify(orders, null, 2))
writeFileSync(join(OUT_DIR, 'tickets.json'), JSON.stringify(tickets, null, 2))

console.log(`Wrote ${accounts.length} accounts, ${orders.length} orders, ${tickets.length} tickets.`)
