# ParcelPilot Support Agent — Design Spec

**Date:** 2026-08-22
**Status:** Final — implemented, reviewed, and deployed (see [`SUBMISSION_NOTES.md`](../../SUBMISSION_NOTES.md))
**Context:** CalQuity AI Engineer assessment — build an AI agent system for ParcelPilot, a fictional B2B logistics platform, per `CalQuity AI Engineer — Job Description & AI Agent Assessment.md`. Background/analysis of the assignment and data pack lives in `ParcelPilot_Assignment_Explained.md`; the test plan lived in `Test_Prompts_Robustness_Checklist.md` (used during development, since removed from the repo — see Task 21 of the implementation plan for the verification pass it drove).

---

## 1. Overview & Goals

Build **one shared agent backend** serving **two chat surfaces**:

- **Customer Portal** — for a business customer's staff (Northstar, LumenWorks, Beacon Retail, Axis Labs) to ask account-scoped support questions and request escalation.
- **Internal Tools** — for ParcelPilot support/ops staff to investigate any account, answer support questions, take actions, and (for managers) view a proactive issue-detection dashboard.

Both surfaces call the same three tool categories over the same underlying data, differing only in the identity/role context injected server-side.

**Guiding principles, in priority order:**
1. Correctness and reliability are never traded away for cost. Every cost-saving decision below is cost-neutral-or-better on quality (e.g., deterministic code instead of LLM guesses is both cheaper and more reliable), never a quality-for-cost trade.
2. Prefer deterministic code over LLM judgment for anything computable (dates, thresholds, precedence, arithmetic). The LLM's job is understanding intent, choosing tools, and explaining results in language — not doing math or memorizing rules.
3. Access control is enforced server-side, in the tool layer, never by prompting the model to "behave."
4. When sources conflict or a request falls outside the supplied data, escalate rather than guess.
5. Minimize infrastructure cost and moving parts: no paid services, no database server, single deployable app.

---

## 2. Tech Stack

- **Framework:** Next.js (App Router), TypeScript throughout, single deployable project.
- **Agent orchestration:** Vercel AI SDK — multi-step tool-calling loop, streaming, and client-side tool-confirmation pattern.
- **Model:** Google Gemini (free tier), via `@ai-sdk/google`. Exact model ID to be confirmed at implementation time against current free-tier availability (model names/tiers shift). Provider is abstracted behind the AI SDK's common interface, so swapping models later is a one-line change if the chosen free-tier model underperforms on the harder conflict-resolution questions during testing.
- **Data storage:** No database service. Structured data (accounts/orders/tickets) and the document-chunk index are parsed once into static JSON/TS modules and loaded into server memory. No per-session data copies — every session reads the same shared, read-only dataset, filtered per-request by identity.
- **Hosting:** Vercel Hobby (free) tier. One project, one hosted URL.

---

## 3. Data Layer

### 3.1 Ingestion pipeline

A one-time build-step (not run per-request, not run per-login):

1. `ParcelPilot_Assessment_Data.xlsx` → parsed once into static `accounts.json`, `orders.json`, `tickets.json`.
2. The 6 PDFs → parsed and manually chunked once into `documentChunks.json`, each chunk tagged with metadata (below). This is a one-time authored step, not an automated PDF-parsing pipeline — the corpus is 6 short, already-read documents, so automated extraction adds risk (mis-chunking, lost metadata) for no benefit at this scale.
3. The two contracts' operative numbers are **additionally** hand-authored into a small `contractRules.json` — a structured mirror of the same terms that live as prose in the contract PDFs. This is a deliberate duplication: `documentChunks` exists so the model can retrieve and cite the actual source sentence (required by the assignment, and central to the trust story); `contractRules` exists so Tool 2 can compute exact answers in code instead of asking the model to parse fee logic from prose. Each `contractRules` entry stores a pointer back to its source document/section so the self-check pass (§6.4) can verify the two agree.

All three outputs are committed as static data files and loaded into memory at server start. Total dataset size is trivial (4 accounts, 6 orders, 7 tickets, ~20-30 document chunks, 2 contract-rule entries) — no query engine is needed.

### 3.2 Schemas

```
Account {
  accountId, accountName, plan: 'Enterprise'|'Growth'|'Standard',
  status, csm, contractFile: string | null, premiumSupport: boolean
}

Order {
  orderId, accountId, carrier, status: 'DRAFT'|'BOOKED'|'PICKED_UP'|'DELIVERED',
  bookedAt, pickupWindowStart, pickupWindowEnd, pickupActualAt: string | null,
  shipmentFeeInr, carrierFault: boolean, customerFault: boolean,
  cancellationRequestedAt: string | null
}

Ticket {
  ticketId, accountId, createdAt, status: 'open'|'closed', subject, description,
  channel, assignedTo, lastCustomerMessageAt, historicalResolution: string | null
}

DocumentChunk {
  chunkId, docId, docName, status: 'current'|'deprecated',
  docType: 'policy'|'sop'|'product_guide'|'contract',
  accountScope: string | null,   // accountId if this chunk is a contract clause, else null
  sectionTitle, text
}

ContractRule {
  accountId, sourceDoc, sourceSection,
  slaOverrides: { P1, P2, P3 } | null,
  cancellationFeeWaived: boolean,
  cancellationFeeGraceMinutes: number | null,
  cancellationFeeAmountInr: number | null,
  creditDelayThresholdHours: number | null,   // overrides SOP default of 2
  creditAmountInr: number | null,              // fixed override, if any (e.g. LumenWorks: 300)
  creditMonthlyCapInr: number | null
}
```

Reference snapshot time (for all "now" calculations): **2026-08-16 11:00 Asia/Kolkata**, per the workbook README. This value is loaded from data, never from the real system clock, so agent behavior stays correct regardless of when it's actually run or demoed.

---

## 4. Identity & Access Control

### 4.1 Mock login

Two portals on the landing page: **Customer Support** and **ParcelPilot Internal**. Each portal presents a select-from-list identity picker (no free text) drawn from six fixed identities:

- Customer: Northstar Logistics, LumenWorks, Beacon Retail, Axis Labs (→ `accountId`)
- Internal: Rohit (Support Agent), Priya Mehta (Manager)

Rohit/Priya are chosen because the source data already implies these roles — Rohit is the multi-account ticket assignee (front-line), Priya is the CSM/account owner for two Enterprise accounts (senior/account-owner). No invented personas.

Once selected, a `SessionIdentity` is created server-side and persisted for the session (cookie/local session store — mocked, not real auth):

```
SessionIdentity {
  surface: 'customer' | 'internal'
  accountId?: string          // set for customer sessions; pins every query
  staffId?: string            // set for internal sessions
  role?: 'support_agent' | 'manager'   // internal only
}
```

The UI shows a persistent "logged in as" badge with a one-click switch-identity control, for both usability and to make access-control behavior easy to demonstrate (ask the same question as two different identities, compare answers).

### 4.2 Enforcement

`SessionIdentity` is read server-side and injected into every tool call automatically. It is **never** a model-supplied argument — even if the model's tool call attempts to pass a different `accountId`, the server ignores it and substitutes the session's real identity for customer sessions. This is enforced independently in each tool:

- **Document search:** for customer sessions, contract-type chunks (`docType: 'contract'`) are filtered to `accountScope === session.accountId` before the model ever sees them — a customer can never retrieve another customer's contract text, regardless of query phrasing.
- **Structured lookup:** any `accountId` filter is forced to the session's `accountId` for customer sessions; requests for out-of-scope IDs return "not found," not an access-denied message (avoids confirming other accounts' IDs exist).
- **Action tool:** `confirm_action` additionally checks `session.role` — a `support_agent` session is rejected server-side (not just discouraged) on any credit-approval action exceeding ₹1,000, per the SOP's manager-approval rule. Internal sessions of either role can query across all accounts (matches how the ticket-assignment data already shows staff working a shared queue).

---

## 5. Agent Design

### 5.1 Orchestration model

A **single dynamic tool-calling loop** (not a hand-routed decision tree). The model receives the user's message, the tool menu, and a system prompt encoding the precedence rules (contract > current policy > SOP > deprecated docs; historical ticket resolutions are context only, never authoritative); it decides which tool(s) to call, observes results, and continues until it can answer or determines escalation is warranted — bounded by a step cap as a bug-guard against runaway loops, not a capability limit.

This is chosen over a hand-designed flow because the assignment explicitly may test with unseen order/account/ticket IDs and unseen question phrasings — a hard-coded routing table only covers anticipated shapes, while dynamic tool selection generalizes. It also directly matches the requirement's own language ("tools it can choose between").

### 5.2 Deterministic tool internals

Per the guiding principles, every tool resolves as much as possible in code before returning to the model: lateness math, threshold comparisons, precedence resolution, SLA breach detection, credit calculation. The model never performs date arithmetic or is asked to "decide" which document wins — tools return pre-resolved, already-correct answers with their supporting citation attached.

### 5.3 Self-check pass

For any answer that is (a) about to trigger a state-changing action, or (b) cites a specific policy/contract clause or number, a second lightweight model call reviews the draft answer against the tool outputs from that turn and checks two things:
1. **Citation accuracy** — does the cited source text actually support the claim made?
2. **Grounding** — does every specific fact in the answer (an ID, date, amount) actually appear in a tool result from this turn, rather than being invented?

If the check fails, the agent revises or downgrades to escalation rather than presenting the answer as-is.

### 5.4 Confidence labeling

Every direct answer carries one of four labels, shown in the UI:
- **High** — single authoritative source, no conflict detected.
- **Resolved conflict** — multiple sources disagreed; the precedence rule determined the answer (the conflicting source and the rule applied are both shown).
- **Low / needs verification** — data is incomplete or ambiguous (e.g., fault unknown); the agent states its best read but flags it.
- **Escalated** — outside the system's supported scope, or a genuine unresolved conflict; no answer is asserted.

---

## 6. Tool Design

Implemented as several small, focused functions (good separation of concerns, easy to test independently) grouped into exactly the three categories the assignment requires:

### 6.1 Document Search (category 1)
`search_documents(query, sessionContext)` → ranked chunks with full metadata attached (doc name, status, type, account scope, section). Ranking logic: exclude/deprioritize `deprecated` chunks unless explicitly asked for the historical version; boost chunks scoped to the session's account (or the account under investigation, for internal sessions) above general policy chunks on the same topic.

### 6.2 Structured Lookup & Calculation (category 2)
Concrete functions: `get_order`, `get_account`, `get_ticket`, `list_open_tickets` (internal only), `calculate_cancellation_eligibility`, `calculate_service_credit`, `calculate_sla_status`. Each performs its lookup/math in code using `contractRules` where an override exists, falling back to SOP defaults otherwise, and returns a resolved answer plus a citation pointer.

### 6.3 Action Tool (category 3)
`propose_action(actionType, payload, sessionContext)` — drafts a pending action (`create_escalation`, `update_ticket`, `approve_credit`, `create_followup_task`) without executing it, returned to the UI for display. `confirm_action(pendingActionId, sessionContext)` — executes only after explicit user confirmation, re-checking role/amount authorization at execution time (not trusting the earlier proposal). Customer sessions get a narrow slice of this tool (request escalation only); internal sessions get the full action set.

Every escalation/action carries a structured reason code: `SOURCE_CONFLICT`, `MISSING_DATA`, `OUTSIDE_SCOPE`, `EXCEEDS_APPROVAL_LIMIT`, `SLA_BREACH`, `SECURITY_INCIDENT`, `UNSUPPORTED_REQUEST`. These feed the dashboard (§8) as well as the escalation itself.

---

## 7. Confirmation-Before-Action Flow

Uses the AI SDK's client-side tool-confirmation pattern: `propose_action` has no server-side execution — it returns a structured preview that the UI renders as a card with Confirm/Cancel. Only an explicit user click triggers `confirm_action`. Each action in a multi-action turn gets its own independent confirmation (no blanket "yes" covering multiple proposals). A pending action that goes unconfirmed while the conversation moves on does not silently execute later on an unrelated "yes."

---

## 8. Trust & Reliability (primary bonus problem)

This is not a bolt-on feature — it is the throughline of §4–7 above. Concrete UI-visible elements:
- Confidence label on every answer (§5.4).
- Explicit conflict surfacing: when a stale/conflicting source is overridden (e.g., a historical ticket resolution contradicts a current contract), the UI shows a note naming both the overridden source and the rule that won, rather than silently picking one.
- Expandable reasoning-chain panel in the chat: collapsed by default, shows the tool-call sequence (order → account → contract → policy → calculation → decision) for any answer, addressing the assignment's "show which tool is being used" requirement at full depth rather than the minimum.
- Structured escalation reason codes (§6.3).

---

## 9. Proactive Issue Detection (secondary bonus problem)

A Manager-role-only dashboard on the Internal portal. Entirely deterministic (reuses the same calculation logic as Tool 2, run across all records instead of one) — no additional LLM calls, so it's both free and as trustworthy as the underlying calculators.

Panels:
1. **SLA breach/near-breach** — every open ticket checked against its (possibly contract-overridden) target, sorted by urgency.
2. **Known-issue clustering** — open tickets matched against KI-208/KI-211 by pattern, grouped.
3. **Security/high-severity auto-flag** — credential-exposure/outage language surfaced regardless of assigned severity.
4. **Cross-account impact** — same known issue affecting multiple accounts flagged distinctly from a single complaint.
5. **Historical-resolution audit** (standout feature) — the same policy-checker run backward against the two closed tickets' `historicalResolution` field, flagging disagreement with current rules (this is exactly what catches the TKT-450/TKT-451 errors automatically).

Every flag shows the rule that triggered it. Clicking a flag opens the chat pre-loaded with that ticket/order's context. A per-account "needs attention" indicator rolls up breach count + known-issue matches + historical flags.

**Known limitation, stated explicitly rather than faked:** the dataset is a single static snapshot, so true time-series "sudden increase" trend detection isn't meaningfully supportable here — noted as a natural extension once real historical data exists, not built against synthetic trend data.

---

## 10. Observability (Evalessensia integration)

The user's existing LLM observability platform (Evalessensia: FastAPI + Postgres/Supabase backend, Rust SDK, Next.js dashboard) is **not deployed as part of the hosted submission** — three extra hosted services (DB, backend, separate dashboard) would contradict the single-app, minimal-moving-parts principle, and observability tooling isn't itself part of the graded requirements or either bonus problem.

Instead:
- A small `traceSpan()` helper wraps every tool call and LLM call in the ParcelPilot agent, sending start/end span data via plain HTTP (`POST/PATCH` against Evalessensia's REST ingestion API, `X-API-Key` auth) — no SDK dependency needed, since ingestion is plain JSON over HTTP.
- This helper is gated behind an environment variable pointing at an Evalessensia endpoint. Unset (the case for the real hosted deployment) → no-op, fail-silent, zero risk to the graded app.
- For the demo video, Evalessensia is run locally alongside a local instance of ParcelPilot with the env var set, showing a real trace of this exact agent's real tool calls in the existing (unmodified) Evalessensia dashboard.
- The same `traceSpan` events also drive the lightweight in-chat reasoning panel (§8) — one instrumentation point, two consumers (an internal dev-facing deep view, and a light product-facing summary).
- Mentioned explicitly in the architecture/product note as evidence of range, with the deliberate non-deployment decision framed as scoping judgment for a time-boxed assessment.

---

## 11. UI/UX Overview

- **Landing page:** two portal cards (Customer Support / ParcelPilot Internal).
- **Login step:** select-from-list identity picker (6 total identities across both portals), no free text entry.
- **Chat screen (both portals):** standard chat UI; live indicator of the tool currently running; expandable reasoning-chain panel per answer; confirmation cards for proposed actions; persistent "logged in as" badge with quick-switch.
- **Dashboard (Internal, Manager role only):** the five panels from §9, each item linking back into the chat with context pre-loaded.

---

## 12. Major Trade-offs & Known Limitations

- **No vector database / embeddings:** deliberate — the 6-document corpus is small enough that structured metadata retrieval is both simpler and more correct (it respects deprecated/current status and account scope, which pure similarity search cannot). Would need revisiting if the document corpus grew substantially.
- **Contract terms duplicated as prose + structured rules:** necessary so citations stay real while calculations stay reliable, but means two representations of the same fact that could drift in a system where contracts change. Acceptable here because the dataset is fixed for this assessment; in production this would need a single authored source that generates both.
- **Free-tier LLM (Gemini) reasoning risk:** smaller/cheaper models may struggle with the harder multi-source conflict questions this assessment is built around. Mitigated by testing against the trap questions early (see §13) and by the AI SDK making a provider swap cheap if needed — but flagged as the single largest quality risk in this design.
- **Dashboard has no real trend data:** stated in §9, not hidden.
- **Evalessensia not live in the hosted deployment:** by design (§10), not an oversight.
- **Mocked auth throughout:** identity/role selection is a simple mock, not real authentication — acceptable and expected per the assignment's own instructions.

---

## 13. Testing Strategy

Before submission, run the full set of prompts in `Test_Prompts_Robustness_Checklist.md` against the deployed system, covering: access-control/jailbreak attempts, source-authority conflicts, known-issue vs. new-incident disambiguation, SLA/time-awareness, escalation-worthiness, confirmation-before-action bypass attempts, multi-step tool chaining, calculation boundary cases, and phrasing/unseen-data robustness. Particular attention to the model-reasoning-risk trade-off in §12 — the conflict-resolution and historical-ticket-trap questions are the highest-value tests to run early, before investing further in UI polish.
