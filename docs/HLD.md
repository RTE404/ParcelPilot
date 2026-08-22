# High-Level Design — ParcelPilot Support Agent

**Companion documents:** [`LLD.md`](./LLD.md) for schemas/algorithms/module-level detail, [`superpowers/specs/2026-08-22-parcelpilot-agent-design.md`](./superpowers/specs/2026-08-22-parcelpilot-agent-design.md) for the full design rationale and trade-off discussion this HLD/LLD pair is derived from.

---

## 1. Purpose & Scope

A single AI agent backend serving two chat surfaces for ParcelPilot, a fictional B2B logistics platform:

- **Customer Portal** — business-customer staff (Northstar, LumenWorks, Beacon Retail, Axis Labs) ask account-scoped support questions and request escalation.
- **Internal Tools** — ParcelPilot support/ops staff investigate any account, answer questions, take actions, and (Manager role only) view a proactive issue-detection dashboard.

Both surfaces are thin frontends over one shared agent, tool layer, and dataset — differing only in the identity/role context attached to each session.

## 2. System Context

```mermaid
flowchart TB
    CustomerUser["Customer staff\n(Northstar / LumenWorks /\nBeacon Retail / Axis Labs)"]
    StaffUser["ParcelPilot staff\n(Support Agent / Manager)"]
    System["ParcelPilot Support Agent\n(this system)"]
    Gemini["Gemini API\n(external, free tier)"]
    Eval["Evalessensia\n(external, local-only, optional)"]

    CustomerUser -->|"chat questions,\nescalation requests"| System
    StaffUser -->|"chat questions, actions,\ndashboard"| System
    System -->|"tool-calling, generation"| Gemini
    System -.->|"trace spans, env-gated,\ndemo only"| Eval
```

The system's only external dependency in the hosted deployment is the Gemini API. Evalessensia is wired in but inert (no-op) unless a local endpoint env var is set — it is not part of the hosted system's runtime dependency graph.

## 3. Architecture Overview

```mermaid
flowchart TB
    subgraph Client["Browser"]
        CP["Customer Portal UI"]
        IP["Internal Portal UI"]
        DashUI["Manager Dashboard UI"]
    end

    subgraph App["Next.js App — single Vercel deployment"]
        API["Chat API route"]
        AUTH["Session Identity\n(mock auth layer)"]
        AGENT["Agent Orchestrator\n(Vercel AI SDK tool-calling loop)"]
        SELFCHECK["Self-Check Pass"]
        T1["Tool: Document Search"]
        T2["Tool: Structured Lookup\n& Calculation"]
        T3["Tool: Action\n(propose / confirm)"]
        DASH["Dashboard Computation"]
        TRACE["traceSpan() helper\n(env-gated, fail-silent)"]
    end

    subgraph Data["Static Data Layer — in server memory"]
        ACC["accounts.json"]
        ORD["orders.json"]
        TKT["tickets.json"]
        CHUNKS["documentChunks.json"]
        RULES["contractRules.json"]
    end

    subgraph External["External"]
        GEMINI["Gemini API"]
        EVAL["Evalessensia\n(local-only)"]
    end

    CP --> API
    IP --> API
    DashUI --> DASH
    API --> AUTH --> AGENT
    AGENT --> T1 & T2 & T3
    AGENT --> GEMINI
    SELFCHECK --> GEMINI
    AGENT --> SELFCHECK
    T1 --> CHUNKS
    T2 --> ACC & ORD & TKT & RULES
    T3 --> ACC & ORD & TKT
    DASH --> ACC & ORD & TKT & RULES
    AGENT -.-> TRACE
    T1 & T2 & T3 -.-> TRACE
    TRACE -.->|"optional"| EVAL
```

## 4. Major Components & Responsibilities

| Component | Responsibility |
|---|---|
| **Session Identity / Mock Auth** | Establishes who's asking (account or staff+role) from the select-from-list login; injects that identity into every downstream call. Never model-controlled. |
| **Agent Orchestrator** | Runs the single dynamic tool-calling loop: sees the question + tool menu + precedence rules, decides which tools to call and in what order, up to a step cap. |
| **Tool: Document Search** | Retrieves and ranks document chunks by relevance *and* authority metadata (current/deprecated, contract account-scope). |
| **Tool: Structured Lookup & Calculation** | Fetches records and performs all date/threshold/precedence math in code, returning pre-resolved answers with citation pointers. |
| **Tool: Action** | Two-phase propose/confirm for state-changing operations; re-validates authorization at confirm time. |
| **Self-Check Pass** | Second-pass review of high-stakes answers for citation accuracy and factual grounding before they reach the user. |
| **Dashboard Computation** | Reuses the calculation tool's logic across the full dataset (not per-question) to surface SLA risk, known-issue clusters, and historical-resolution conflicts. Manager-role only. |
| **traceSpan() helper** | Wraps tool/LLM calls; sends span data to Evalessensia only if an endpoint env var is set, otherwise a no-op. Also feeds the in-chat reasoning panel. |
| **Static Data Layer** | Parsed once at build time from the source PDFs/xlsx; shared, read-only, in server memory; no database service. |

## 5. Request Flow — Multi-Step Query

Example: *"Can Northstar cancel ORD-1001 without a fee?"*

```mermaid
sequenceDiagram
    actor User as Northstar user
    participant UI as Customer Portal
    participant Agent as Agent Orchestrator
    participant Order as Tool: get_order
    participant Acct as Tool: get_account
    participant Docs as Tool: search_documents
    participant Calc as Tool: calculate_cancellation_eligibility
    participant LLM as Gemini

    User->>UI: "Can I cancel ORD-1001 without a fee?"
    UI->>Agent: message + session identity (accountId=ACCT-001)
    Agent->>LLM: question + tool menu + precedence rules
    LLM-->>Agent: call get_order(ORD-1001)
    Agent->>Order: get_order(ORD-1001, session)
    Order-->>Agent: order record (status BOOKED)
    Agent->>LLM: tool result
    LLM-->>Agent: call get_account()
    Agent->>Acct: get_account(session)
    Acct-->>Agent: account + contractFile
    Agent->>LLM: tool result
    LLM-->>Agent: call search_documents("cancellation fee")
    Agent->>Docs: search_documents(query, session)
    Docs-->>Agent: ranked chunks (Northstar contract clause first)
    Agent->>LLM: tool result
    LLM-->>Agent: call calculate_cancellation_eligibility(ORD-1001)
    Agent->>Calc: calculate(order, account, contractRules)
    Calc-->>Agent: feeWaived=true + citation
    Agent->>LLM: tool result
    LLM-->>Agent: drafted answer + citation
    Agent->>Agent: self-check pass (citation + grounding)
    Agent-->>UI: answer + confidence label + reasoning chain
    UI-->>User: "No fee — per Northstar's Enterprise Agreement, Section 2..."
```

## 6. Confirmation-Before-Action Flow

```mermaid
sequenceDiagram
    actor Staff as Rohit (Support Agent)
    participant UI as Internal Portal
    participant Agent as Agent Orchestrator
    participant Propose as Tool: propose_action
    participant Confirm as Tool: confirm_action

    Staff->>UI: "Escalate TKT-501 to P1"
    UI->>Agent: message + session identity (role=support_agent)
    Agent->>Propose: propose_action(create_escalation, payload)
    Propose-->>Agent: pendingAction {id, preview, reasonCode=SLA_BREACH}
    Agent-->>UI: render confirmation card (not yet executed)
    UI-->>Staff: "About to escalate TKT-501 to P1 — SLA already breached by 15m. Confirm?"
    Staff->>UI: clicks Confirm
    UI->>Agent: confirm_action(pendingActionId)
    Agent->>Confirm: confirm_action(id, session)
    Confirm->>Confirm: re-check role/amount authorization
    Confirm-->>Agent: executed {escalationId}
    Agent-->>UI: "Escalation ESC-xxxx created."
```

## 7. Deployment Architecture

```mermaid
flowchart LR
    subgraph Vercel["Vercel — Hobby (free)"]
        App["ParcelPilot Next.js App\n(single project)"]
    end
    subgraph GoogleAI["Google AI Studio"]
        Gemini["Gemini API — free tier"]
    end
    subgraph LocalOnly["Local machine — demo recording only"]
        EvalAPI["Evalessensia FastAPI"]
        EvalDB[("Supabase Postgres")]
        EvalUI["Evalessensia Dashboard"]
    end

    Browser -->|HTTPS| App
    App -->|tool-calling API calls| Gemini
    App -.->|"trace spans, only if\nEVAL_ENDPOINT is set"| EvalAPI
    EvalAPI --> EvalDB
    EvalUI --> EvalAPI
```

One deployed service for the graded submission. Evalessensia is never part of the hosted deployment's runtime — see LLD §9 for the exact gating mechanism.

## 8. Non-Functional Design Goals

- **Cost:** zero paid infrastructure — free-tier LLM, no database service, no vector store, Vercel Hobby hosting. Cost discipline is achieved by pushing computation into deterministic code, never by reducing agent capability, step budget, or reasoning quality.
- **Reliability/Trust:** every direct answer carries a confidence label; conflicts between sources are surfaced, not silently resolved; a self-check pass guards high-stakes answers against miscitation and fabrication; anything outside the supplied data's coverage is escalated rather than guessed.
- **Security:** account/role scoping is enforced server-side inside every tool call, independent of model behavior — a prompt cannot widen what a session is allowed to fetch or execute.
- **Auditability:** every answer traces back to a specific document/section or a specific calculation; the reasoning chain is inspectable in the UI, not just asserted.

## 9. Out of Scope / Non-Goals

- Real authentication/authorization (mocked per the assignment's own allowance).
- A production-grade document ingestion pipeline (the 6-document corpus is hand-chunked once; not designed to scale to a large, changing corpus without revisiting the retrieval approach — see design spec §12).
- Real-time/trend-based anomaly detection on the dashboard (single static data snapshot; no time-series data exists to detect trends from).
- Deploying Evalessensia as a live, hosted component of this submission.
