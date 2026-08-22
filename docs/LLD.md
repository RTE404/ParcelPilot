# Low-Level Design — ParcelPilot Support Agent

**Companion documents:** [`HLD.md`](./HLD.md) for architecture/diagrams, [`superpowers/specs/2026-08-22-parcelpilot-agent-design.md`](./superpowers/specs/2026-08-22-parcelpilot-agent-design.md) for design rationale.

This document is implementation-ready detail: module layout, exact schemas, function signatures, algorithms, and state machines. It is the direct input to the implementation plan.

---

## 1. Module / Folder Structure

```
/app
  /customer/login/page.tsx
  /customer/chat/page.tsx
  /internal/login/page.tsx
  /internal/chat/page.tsx
  /internal/dashboard/page.tsx        # manager-role guarded
  /api/chat/route.ts                  # agent loop entry point (both portals)
  /api/dashboard/route.ts             # dashboard computation entry point
/lib
  /data
    accounts.json
    orders.json
    tickets.json
    documentChunks.json
    contractRules.json
    loadData.ts                       # parses once, memoized module-level cache
  /identity
    session.ts                        # SessionIdentity create/read, login mapping table
  /tools
    documentSearch.ts                 # Tool category 1
    structuredLookup.ts               # Tool category 2 (lookup + calculation functions)
    actions.ts                        # Tool category 3 (propose/confirm)
  /agent
    orchestrator.ts                   # AI SDK tool-calling loop wiring
    systemPrompt.ts                   # precedence rules, escalation philosophy, tool descriptions
    selfCheck.ts                      # second-pass citation/grounding check
  /dashboard
    computeFlags.ts                   # reuses structuredLookup calculators across full dataset
  /observability
    traceSpan.ts                      # env-gated helper used by orchestrator + tools
/components
  ChatWindow.tsx
  ToolActivityIndicator.tsx
  ReasoningChainPanel.tsx             # expandable, per-answer
  ConfirmationCard.tsx
  IdentityBadge.tsx                   # persistent "logged in as" + switch control
  DashboardPanels/*.tsx
```

---

## 2. Data Schemas

```typescript
type Plan = 'Enterprise' | 'Growth' | 'Standard'
type OrderStatus = 'DRAFT' | 'BOOKED' | 'PICKED_UP' | 'DELIVERED'
type TicketStatus = 'open' | 'closed'
type DocStatus = 'current' | 'deprecated'
type DocType = 'policy' | 'sop' | 'product_guide' | 'contract'
type Severity = 'P1' | 'P2' | 'P3'

interface Account {
  accountId: string
  accountName: string
  plan: Plan
  status: string
  csm: string
  contractFile: string | null
  premiumSupport: boolean
}

interface Order {
  orderId: string
  accountId: string
  carrier: string
  status: OrderStatus
  bookedAt: string            // ISO 8601, Asia/Kolkata
  pickupWindowStart: string
  pickupWindowEnd: string
  pickupActualAt: string | null
  shipmentFeeInr: number
  carrierFault: boolean
  customerFault: boolean
  cancellationRequestedAt: string | null
}

interface Ticket {
  ticketId: string
  accountId: string
  createdAt: string
  status: TicketStatus
  subject: string
  description: string
  channel: string
  assignedTo: string
  lastCustomerMessageAt: string
  historicalResolution: string | null   // only present on closed/historical tickets
}

interface DocumentChunk {
  chunkId: string
  docId: string
  docName: string
  status: DocStatus
  docType: DocType
  accountScope: string | null           // accountId for contract chunks, else null
  sectionTitle: string
  text: string
}

interface ContractRule {
  accountId: string
  sourceDoc: string
  sourceSection: string
  slaOverrides: Record<Severity, string> | null
  cancellationFeeWaived: boolean
  cancellationFeeGraceMinutes: number | null
  cancellationFeeAmountInr: number | null
  creditDelayThresholdHours: number | null
  creditAmountInr: number | null        // fixed override amount, if any
  creditMonthlyCapInr: number | null
}

interface SessionIdentity {
  surface: 'customer' | 'internal'
  accountId?: string                    // customer sessions only
  staffId?: string                      // internal sessions only
  role?: 'support_agent' | 'manager'    // internal sessions only
}

type ConfidenceLabel = 'high' | 'resolved_conflict' | 'low_needs_verification' | 'escalated'

type EscalationReasonCode =
  | 'SOURCE_CONFLICT'
  | 'MISSING_DATA'
  | 'OUTSIDE_SCOPE'
  | 'EXCEEDS_APPROVAL_LIMIT'
  | 'SLA_BREACH'
  | 'SECURITY_INCIDENT'
  | 'UNSUPPORTED_REQUEST'

interface PendingAction {
  id: string
  actionType: 'create_escalation' | 'update_ticket' | 'approve_credit' | 'create_followup_task'
  payload: Record<string, unknown>
  preview: string                        // human-readable summary shown in the confirmation card
  reasonCode: EscalationReasonCode
  proposedBySessionId: string
  createdAt: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired'
}
```

Reference "now" for all time-based logic: the fixed snapshot value `2026-08-16T11:00:00+05:30`, loaded from `loadData.ts`, never `Date.now()`.

---

## 3. Identity & Session Design

`lib/identity/session.ts` holds a fixed lookup table mapping the six login-list entries to `SessionIdentity` values:

```typescript
const LOGIN_OPTIONS: Record<string, SessionIdentity> = {
  'northstar':   { surface: 'customer', accountId: 'ACCT-001' },
  'lumenworks':  { surface: 'customer', accountId: 'ACCT-002' },
  'beacon':      { surface: 'customer', accountId: 'ACCT-003' },
  'axislabs':    { surface: 'customer', accountId: 'ACCT-004' },
  'rohit':       { surface: 'internal', staffId: 'rohit', role: 'support_agent' },
  'priya':       { surface: 'internal', staffId: 'priya_mehta', role: 'manager' },
}
```

Selecting a login option writes the corresponding `SessionIdentity` to a server-signed session cookie (mocked — no password, no real auth provider). Every API route reads the identity from that cookie server-side; it is never accepted as a request body field, so it cannot be spoofed by a client-crafted request or by anything the model outputs.

---

## 4. Tool Specifications

All tool functions take `(args, session: SessionIdentity)` and return a structured result. `session` is injected by the API route handler, never by the model.

### 4.1 Document Search (category 1)

```
search_documents(query: string, session) -> RankedChunk[]

RankedChunk extends DocumentChunk { relevanceScore: number, rankReason: string }
```//
Algorithm:
1. Keyword-match `query` against chunk `text`/`sectionTitle` (simple scoring — term overlap; no embeddings).
2. **Access filter (applied before ranking, not after):** if `session.surface === 'customer'`, drop any chunk where `accountScope !== null && accountScope !== session.accountId`. This guarantees a customer session can never receive another account's contract text regardless of query.
3. **Authority ranking:** deprioritize `status === 'deprecated'` chunks to the bottom of the result set unless the query explicitly references "deprecated"/"old policy"/"v2"; boost chunks where `accountScope === (session.accountId ?? targetAccountId)` above general-policy chunks on the same topic.
4. Return top-N with `rankReason` explaining why each chunk was included/ordered (used by the reasoning-chain panel).

### 4.2 Structured Lookup & Calculation (category 2)

```
get_order(orderId: string, session) -> Order | NotFound
get_account(session, accountId?: string) -> Account | NotFound
get_ticket(ticketId: string, session) -> Ticket | NotFound
list_open_tickets(session, filter?) -> Ticket[]          // internal only
calculate_cancellation_eligibility(orderId, session) -> CancellationResult
calculate_service_credit(orderId, session) -> ServiceCreditResult
calculate_sla_status(ticketId, session) -> SlaStatusResult
```

**Access filter (applied identically across all of these):** for `session.surface === 'customer'`, any `accountId` argument is force-overridden to `session.accountId`; if the requested record's `accountId` doesn't match, return `NotFound` (never a distinct "access denied" — avoids confirming the existence of other accounts' IDs). For `session.surface === 'internal'`, no account restriction; `list_open_tickets` and `accountId` overrides are unrestricted for both roles (role restrictions apply only in the action tool, §4.3).

See §6 for the calculation algorithms themselves.

### 4.3 Action Tool (category 3)

```
propose_action(actionType, payload, session) -> PendingAction
confirm_action(pendingActionId, session) -> ActionResult | AuthorizationError
cancel_action(pendingActionId, session) -> void
```

`propose_action` never mutates data — it only constructs and stores (in-memory, keyed by session) a `PendingAction` with status `pending`, and returns its `preview` for the confirmation card.

`confirm_action`:
1. Looks up the `PendingAction` by id; if missing or not `status === 'pending'`, return an error (handles stale/expired confirmations — see §7).
2. Re-checks authorization **at this point**, not trusting the state at proposal time: for `actionType === 'approve_credit'`, if `payload.amountInr > 1000` and `session.role !== 'manager'`, return `AuthorizationError` and leave the action `pending` (does not silently cancel it — a manager could still confirm the same pending action).
3. If a customer session, restrict `actionType` to `create_escalation` only; any other type is rejected regardless of what the model proposed.
4. On success, mutate the in-memory ticket/order store, set `status: 'confirmed'`, return the result.

---

## 5. Precedence Resolution Algorithm

Used by both the document-ranking step (§4.1) and the calculation functions (§6) to decide which source governs an answer:

```
function resolveAuthority(accountId, topic):
    contractRule = contractRules.find(r => r.accountId === accountId)
    if contractRule has an override for `topic`:
        return { source: contractRule, level: 'contract' }
    currentDoc = documentChunks matching topic, status == 'current', accountScope == null
    if currentDoc exists:
        return { source: currentDoc, level: 'policy' }
    // deprecated docs and historicalResolution on tickets are NEVER returned as authoritative
    return { source: null, level: 'none' }   // triggers escalation (MISSING_DATA)
```

`historicalResolution` fields are explicitly excluded from this function's search space — they are surfaced only as labeled context in the UI, never as a candidate source, per the assignment's own instruction that historical resolutions "may contain incorrect guidance."

---

## 6. Calculation Algorithms

### 6.1 `calculate_cancellation_eligibility(order, account, contractRules, now)`

```
if order.status == 'DRAFT': return { feeWaived: true, reason: 'draft, no fee', citation: SOP §1 }
if order.status == 'PICKED_UP': return { cancellable: false, reason: 'use return-to-origin', citation: SOP §1 }
if order.status == 'DELIVERED': return { cancellable: false, reason: 'cannot cancel delivered', citation: SOP §1 }
// status == 'BOOKED'
rule = contractRules.find(accountId)
if rule?.cancellationFeeWaived:
    return { cancellable: true, feeWaived: true, reason: 'account contract waives fee', citation: rule.sourceDoc }
minutesSinceBooking = (order.cancellationRequestedAt - order.bookedAt) in minutes
graceMinutes = rule?.cancellationFeeGraceMinutes ?? 30       // SOP default
if minutesSinceBooking <= graceMinutes:
    return { cancellable: true, feeWaived: true, reason: 'within grace period', citation: SOP §1 }
return { cancellable: true, feeWaived: false, feeInr: rule?.cancellationFeeAmountInr ?? 250, citation: SOP §1 }
```

### 6.2 `calculate_service_credit(order, account, contractRules, now)`

```
if order.carrierFault == null or order.customerFault == null:
    return ESCALATE(MISSING_DATA, "fault unknown, per SOP §3 do not promise a credit")
if order.customerFault: return { eligible: false, reason: 'customer fault' }
if not order.carrierFault: return { eligible: false, reason: 'carrier not at fault' }

rule = contractRules.find(accountId)
thresholdHours = rule?.creditDelayThresholdHours ?? 2        // SOP default
lateHours = (now - order.pickupWindowEnd) in hours, only if order not yet PICKED_UP
            or (order.pickupActualAt - order.pickupWindowEnd) in hours, if picked up late
if lateHours <= thresholdHours:
    return { eligible: false, reason: `late by ${lateHours}h, under ${thresholdHours}h threshold` }

if rule?.creditAmountInr != null:
    creditInr = rule.creditAmountInr                          // fixed override, e.g. LumenWorks ₹300
else:
    creditInr = min(500, 0.10 * order.shipmentFeeInr)          // SOP default formula

monthlyCap = rule?.creditMonthlyCapInr
if monthlyCap != null and (sumOfCreditsThisMonth(accountId) + creditInr) > monthlyCap:
    return ESCALATE(EXCEEDS_APPROVAL_LIMIT, "would exceed monthly aggregate cap")

requiresApproval = creditInr > 1000                            // SOP §3 manager-approval rule
return { eligible: true, creditInr, requiresApproval, citation: rule?.sourceDoc ?? SOP §2 }
```

### 6.3 `calculate_sla_status(ticket, account, contractRules, now)`

```
severity = classifySeverity(ticket)      // keyword rules below
rule = contractRules.find(accountId)
target = rule?.slaOverrides?.[severity] ?? policyDefaultTarget(account.plan, severity)
elapsed = now - ticket.createdAt
breached = elapsed > target
return { severity, target, elapsed, breached, citation: rule?.sourceDoc ?? 'Support Policy v3' }

function classifySeverity(ticket):
    text = (ticket.subject + ticket.description).toLowerCase()
    if matches(text, ['api key', 'credential', 'security incident', 'all shipment creation is failing', 'complete outage']):
        return 'P1'
    if matches(text, ['degraded', 'major feature unavailable']):
        return 'P2'
    return 'P3'
```

`classifySeverity` is a simple keyword-rule function, not an LLM call — the model can still override/flag a misclassification via the agent loop if the keyword rule looks wrong for a given ticket, but the default classification is deterministic and cheap.

---

## 7. Confirmation Flow — State Machine

> **Implementation note (added during plan-writing):** the Vercel AI SDK (v6) provides a native tool-approval mechanism — `needsApproval` on a tool definition and `addToolApprovalResponse`/`sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` on the client `useChat` hook — that implements exactly this propose/confirm/re-check flow without a hand-rolled `PendingAction` store. The action tools (§4.3) are implemented with `needsApproval: true`; the state transitions below describe the conceptual flow, which the SDK's `approval-requested` / approved / denied states map onto directly. The role/amount re-check still happens inside each tool's `execute` function, which the SDK only calls after approval — satisfying "re-validate at confirm time, not propose time" without custom state tracking.

```
        propose_action()
              |
              v
         [pending] ------ confirm_action() [authorized] -----> [confirmed] (mutation applied)
              |
              |------ confirm_action() [NOT authorized] -----> stays [pending] + AuthorizationError shown
              |
              |------ cancel_action() / explicit "no" --------> [cancelled]
              |
              |------ session ends / new unrelated topic ------> [expired] (never auto-confirms on a later unrelated "yes")
```

`PendingAction`s are stored server-side per session and expire on session end or after a fixed idle window (implementation detail: a short TTL, e.g. 15 minutes) — never carried forward silently across unrelated turns.

---

## 8. Self-Check Pass Design

Triggered when a draft answer either (a) is about to accompany a `propose_action` call, or (b) contains a citation to a specific document/section or a specific number (fee, credit amount, SLA target).

Input to the check: the draft answer text + the full set of tool results produced in that turn (not the whole conversation history — bounded, cheap).

Two checks, run as one combined model call:
1. **Citation accuracy** — for each cited source in the draft, does the cited chunk/rule's actual content support the specific claim made?
2. **Grounding** — for each specific fact in the draft (an ID, date, amount), does it literally appear in this turn's tool results?

Output: `{ pass: boolean, issues: string[] }`. On `pass: false`, the orchestrator does not surface the draft — it either retries with the flagged issues appended as feedback (one retry max) or downgrades to an `OUTSIDE_SCOPE`/`SOURCE_CONFLICT` escalation if the retry also fails.

---

## 9. Dashboard Computation Logic (Manager-only)

`lib/dashboard/computeFlags.ts`, invoked on page load, no caching needed given dataset size:

1. **SLA breach/near-breach:** run `calculate_sla_status` (§6.3) over every ticket where `status === 'open'`; sort descending by `elapsed - target`.
2. **Known-issue clustering:** keyword-match each open ticket's description against a small static known-issues table (`KI-208`: "csv"/"bulk upload"/row-count language; `KI-211`: "swiftship"/"still shows booked"/"webhook" language); group matches by `knownIssueId`.
3. **Security auto-flag:** reuse the `classifySeverity` keyword set (§6.3) — any ticket matching the security/credential-exposure branch is surfaced at the top of the SLA panel regardless of its current assigned severity field.
4. **Cross-account impact:** from the known-issue clustering step, flag any `knownIssueId` whose matched tickets span `>1` distinct `accountId`.
5. **Historical-resolution audit:** for every ticket with `historicalResolution != null`, reconstruct the relevant order/account context at the time and re-run the appropriate calculator (§6.1/6.2) against **current** rules; if the calculator's answer disagrees with the text of `historicalResolution` (simple keyword/number comparison, e.g. fee amount mentioned vs. calculated fee), flag it with a `reviewRecommended: true` note and the specific discrepancy.

All five run as plain synchronous computation over the in-memory dataset — no LLM calls, sub-millisecond in practice given the data size.

---

## 10. Observability Hook

```typescript
async function traceSpan<T>(name: string, meta: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const start = referenceNow()  // or real Date.now() for actual latency measurement, distinct from the domain "now"
  try {
    const result = await fn()
    void reportSpan({ name, meta, status: 'ok', durationMs: ... })   // fire-and-forget, swallow errors
    return result
  } catch (err) {
    void reportSpan({ name, meta, status: 'error', error: String(err) })
    throw err
  }
}

function reportSpan(span) {
  const endpoint = process.env.EVAL_ENDPOINT
  if (!endpoint) return                      // no-op in the hosted deployment
  fetch(`${endpoint}/api/v1/runs/create`, { method: 'POST', headers: { 'X-API-Key': process.env.EVAL_API_KEY }, body: JSON.stringify(span) })
    .catch(() => {})                          // never let tracing failure affect the agent
}
```

Wrapped around: each tool call, each Gemini call (main loop and self-check pass). The same span events populate the in-chat `ReasoningChainPanel` (always on, in-app, lightweight) regardless of whether `EVAL_ENDPOINT` is set.

---

## 11. Error Handling & Edge Cases

| Case | Handling |
|---|---|
| Requested order/account/ticket ID doesn't exist | Tool returns `NotFound`; agent states it plainly, does not guess. |
| ID exists but belongs to another account (customer session) | Tool returns `NotFound` (not "access denied") — see §4.2. |
| `carrierFault`/`customerFault` unknown | `calculate_service_credit` escalates with `MISSING_DATA`, per SOP §3. |
| Credit exceeds monthly cap | Escalates with `EXCEEDS_APPROVAL_LIMIT` rather than silently capping. |
| Support-agent session tries to confirm a >₹1,000 credit | `confirm_action` returns `AuthorizationError`; action stays `pending` for a manager session to pick up. |
| Two sources conflict with no clear precedence winner | `resolveAuthority` returns `level: 'none'`; agent escalates with `SOURCE_CONFLICT`, both sources shown. |
| Question outside all 6 documents' coverage | No tool returns a usable result; agent escalates with `OUTSIDE_SCOPE`. |
| Self-check pass fails twice | Downgrade to escalation rather than surfacing an unverified answer. |
| Confirmation clicked after conversation moved on | Rejected per the `expired` state (§7). |
| Agent loop exceeds step cap | Hard stop, return partial findings + `OUTSIDE_SCOPE` escalation rather than an unbounded loop. |
