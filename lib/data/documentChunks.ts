import type { DocumentChunk } from './types'

export const ALL_CHUNKS: DocumentChunk[] = [
  // --- 01_Support_Policy_v3_CURRENT.pdf ---
  {
    chunkId: 'v3-precedence', docId: '01_support_policy_v3', docName: 'ParcelPilot Support Policy v3',
    status: 'current', docType: 'policy', accountScope: null, sectionTitle: '1. Scope and source precedence',
    text: 'This policy defines default support severity and response targets. A signed customer agreement may override these defaults. When sources conflict, use the signed customer agreement first, then the current support policy, then current product documentation. Historical tickets and internal notes are context only and may contain incorrect past guidance.',
  },
  {
    chunkId: 'v3-severity', docId: '01_support_policy_v3', docName: 'ParcelPilot Support Policy v3',
    status: 'current', docType: 'policy', accountScope: null, sectionTitle: '2. Severity definitions',
    text: 'P1 - Critical: Complete production outage preventing all shipment creation for a customer, confirmed security incident or suspected credential exposure, or another event causing immediate material business risk with no workaround. P2 - High: Major feature unavailable or materially degraded for a customer, but core operations remain possible or a workaround exists. P3 - Normal: Minor defect, how-to question, configuration request, or issue with limited operational impact.',
  },
  {
    chunkId: 'v3-targets', docId: '01_support_policy_v3', docName: 'ParcelPilot Support Policy v3',
    status: 'current', docType: 'policy', accountScope: null, sectionTitle: '3. Default first-response targets',
    text: 'Enterprise: P1 30 minutes 24x7, P2 2 hours, P3 1 business day. Growth: P1 2 business hours, P2 4 business hours, P3 2 business days. Standard: P1 4 business hours, P2 1 business day, P3 2 business days.',
  },
  {
    chunkId: 'v3-escalation', docId: '01_support_policy_v3', docName: 'ParcelPilot Support Policy v3',
    status: 'current', docType: 'policy', accountScope: null, sectionTitle: '4. Escalation',
    text: 'P1 incidents should be escalated immediately. If a response target is already breached, the agent should clearly state the breach and recommend escalation rather than hiding uncertainty.',
  },
  // --- 02_Support_Policy_v2_DEPRECATED.pdf ---
  {
    chunkId: 'v2-targets', docId: '02_support_policy_v2', docName: 'ParcelPilot Support Policy v2',
    status: 'deprecated', docType: 'policy', accountScope: null, sectionTitle: 'Severity and response targets',
    text: 'DEPRECATED — DO NOT USE FOR CURRENT REQUESTS, superseded by Support Policy v3 effective 1 May 2026. Enterprise: P1 1 hour, P2 4 hours, P3 2 business days. Growth: P1 4 business hours, P2 1 business day, P3 3 business days. Standard: P1 8 business hours, P2 2 business days, P3 3 business days.',
  },
  // --- 03_Cancellation_and_Service_Credit_SOP_v4.pdf ---
  {
    chunkId: 'sop-cancellation', docId: '03_cancellation_sop_v4', docName: 'ParcelPilot Cancellation & Service Credit SOP v4',
    status: 'current', docType: 'sop', accountScope: null, sectionTitle: '1. Order cancellation',
    text: 'DRAFT: May be cancelled with no fee. BOOKED, not yet PICKED_UP: May be cancelled. No fee within 30 minutes of booking. After 30 minutes, charge INR 250 unless a customer agreement explicitly waives the cancellation fee. PICKED_UP: Do not cancel. Use the return-to-origin workflow if the customer wants the parcel returned. DELIVERED: Cannot be cancelled.',
  },
  {
    chunkId: 'sop-credits', docId: '03_cancellation_sop_v4', docName: 'ParcelPilot Cancellation & Service Credit SOP v4',
    status: 'current', docType: 'sop', accountScope: null, sectionTitle: '2. Failed-pickup service credits',
    text: 'Under the default policy, a customer is eligible for a service credit when the pickup is more than 2 hours past the end of the scheduled pickup window, the carrier is at fault, and there is no customer-caused issue. The default credit is the lower of INR 500 or 10% of the shipment fee. A signed customer agreement may replace the default delay threshold, credit amount, or cap.',
  },
  {
    chunkId: 'sop-approval', docId: '03_cancellation_sop_v4', docName: 'ParcelPilot Cancellation & Service Credit SOP v4',
    status: 'current', docType: 'sop', accountScope: null, sectionTitle: '3. Approval and uncertainty',
    text: 'Any individual credit above INR 1,000 requires manager approval. Do not promise a credit when carrier fault, pickup timing, or customer fault is unknown. When data conflicts, identify the conflict and request verification before a state-changing action.',
  },
  // --- 04_Product_Operations_Guide_and_Known_Issues.pdf ---
  {
    chunkId: 'ops-plans', docId: '04_product_ops_guide', docName: 'ParcelPilot Product Operations Guide',
    status: 'current', docType: 'product_guide', accountScope: null, sectionTitle: '1. Plan capabilities',
    text: 'Bulk Upload: Available on Growth and Enterprise. Supported file size is up to 5,000 rows per CSV. Standard: Bulk Upload is not included. Shipment status: BOOKED means the shipment is created but ParcelPilot has not yet received a pickup confirmation. PICKED_UP means carrier pickup has been confirmed.',
  },
  {
    chunkId: 'ki-208', docId: '04_product_ops_guide', docName: 'ParcelPilot Product Operations Guide',
    status: 'current', docType: 'product_guide', accountScope: null, sectionTitle: '2. Current known issues — KI-208',
    text: 'KI-208 - Bulk Upload failures on large CSVs. Opened 10 August 2026. Status: Investigating. Some Growth and Enterprise customers experience intermittent failures on CSV uploads above approximately 3,000 rows, even though the supported product limit remains 5,000 rows. Workaround: split the upload into files below 3,000 rows. Individual shipment creation is unaffected.',
  },
  {
    chunkId: 'ki-211', docId: '04_product_ops_guide', docName: 'ParcelPilot Product Operations Guide',
    status: 'current', docType: 'product_guide', accountScope: null, sectionTitle: '2. Current known issues — KI-211',
    text: 'KI-211 - SwiftShip pickup webhook delay. Opened 12 August 2026. Status: Monitoring. SwiftShip pickup confirmation webhooks can arrive up to 20 minutes late. A parcel may physically be collected while ParcelPilot still shows BOOKED. Before telling a customer that a pickup did not occur, verify the carrier status or wait through the known delay window.',
  },
  {
    chunkId: 'ki-176', docId: '04_product_ops_guide', docName: 'ParcelPilot Product Operations Guide',
    status: 'current', docType: 'product_guide', accountScope: null, sectionTitle: '3. Resolved issue — KI-176',
    text: 'KI-176 - Address validation: Resolved 18 July 2026. Do not use this resolved issue to explain new incidents unless evidence specifically matches it.',
  },
  // --- 05_Northstar_Logistics_Enterprise_Agreement.pdf ---
  {
    chunkId: 'northstar-support', docId: '05_northstar_agreement', docName: 'ParcelPilot - Northstar Logistics Enterprise Agreement',
    status: 'current', docType: 'contract', accountScope: 'ACCT-001', sectionTitle: '1. Support terms',
    text: 'For Northstar Logistics, the following first-response targets replace ParcelPilot\'s standard support-policy targets: P1: 15 minutes, 24x7. P2: 1 hour. P3: 8 business hours.',
  },
  {
    chunkId: 'northstar-cancellation', docId: '05_northstar_agreement', docName: 'ParcelPilot - Northstar Logistics Enterprise Agreement',
    status: 'current', docType: 'contract', accountScope: 'ACCT-001', sectionTitle: '2. Shipment cancellation',
    text: 'Northstar may cancel any BOOKED shipment before pickup with no cancellation fee, regardless of how long ago the shipment was booked. Once a shipment is PICKED_UP, the standard return-to-origin process applies.',
  },
  {
    chunkId: 'northstar-credits', docId: '05_northstar_agreement', docName: 'ParcelPilot - Northstar Logistics Enterprise Agreement',
    status: 'current', docType: 'contract', accountScope: 'ACCT-001', sectionTitle: '3. Service credits',
    text: 'Monthly aggregate service credits are capped at INR 5,000. Unless this agreement states otherwise, the current ParcelPilot service-credit SOP applies.',
  },
  // --- 06_LumenWorks_Service_Agreement.pdf ---
  {
    chunkId: 'lumenworks-support', docId: '06_lumenworks_agreement', docName: 'ParcelPilot - LumenWorks Service Agreement',
    status: 'current', docType: 'contract', accountScope: 'ACCT-002', sectionTitle: '1. Support terms',
    text: 'P1: 2 business hours. P2: 4 business hours. P3: 2 business days. No weekend or after-hours support coverage.',
  },
  {
    chunkId: 'lumenworks-cancellation', docId: '06_lumenworks_agreement', docName: 'ParcelPilot - LumenWorks Service Agreement',
    status: 'current', docType: 'contract', accountScope: 'ACCT-002', sectionTitle: '2. Cancellation terms',
    text: 'No special cancellation-fee waiver applies. Use the current ParcelPilot Cancellation & Service Credit SOP.',
  },
  {
    chunkId: 'lumenworks-credits', docId: '06_lumenworks_agreement', docName: 'ParcelPilot - LumenWorks Service Agreement',
    status: 'current', docType: 'contract', accountScope: 'ACCT-002', sectionTitle: '3. Failed-pickup credits',
    text: 'If a pickup is more than 4 hours past the end of the scheduled pickup window, the carrier is at fault, and the customer is not at fault, LumenWorks receives a fixed INR 300 service credit. This clause replaces the default failed-pickup credit amount and timing threshold in the SOP.',
  },
]
