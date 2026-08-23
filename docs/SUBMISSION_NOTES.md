# Submission Notes — ParcelPilot Support Agent

The three short write-ups the assessment asks for, alongside the repo and (once deployed) the
hosted link. Fuller technical detail lives in [`docs/HLD.md`](HLD.md), [`docs/LLD.md`](LLD.md),
and the [design spec](superpowers/specs/2026-08-22-parcelpilot-agent-design.md) — this note
summarizes rather than repeats them.

---

## Architecture Note

**Agent design.** A single dynamic tool-calling loop (Vercel AI SDK v6 `streamText`, Gemini,
`stopWhen: stepCountIs(8)`) rather than a hand-routed decision tree. The model decides which
tool(s) to call and when it can answer or must escalate; a system prompt encodes source
precedence and the "don't guess" rule. This was chosen over a fixed flow because the assessment
explicitly tests with unseen IDs and phrasings — a routing table only covers anticipated shapes.

**Tool design.** Three categories, matching the assessment's own structure: document search
(policy/contract retrieval, authority-ranked), structured lookup (order/account/ticket, scoped
to the caller), and deterministic calculators (cancellation eligibility, service credit, SLA
status). The calculators are the load-bearing design decision: the model never does date math,
threshold comparison, or currency arithmetic itself — every number the user sees was computed in
plain TypeScript against a fixed reference time (`REFERENCE_NOW`, not the real clock, so answers
are reproducible regardless of when the grader runs it), and the tool result carries its own
citation. The model's job is to call the right tool and present the result faithfully, not to
compute or cite from memory.

**Document and structured-data handling.** The six source PDFs were parsed into a static,
in-memory document-chunk index (ranked by authority, current-vs-deprecated tagged) and the
account/order/ticket data into typed JSON, both generated once by a parse script from the
original workbook/PDFs and committed — no runtime parsing, no database. Read access to both is
account-scoped in the tool layer itself (not left to model instructions): a customer session's
lookups are hard-filtered to their own `accountId` before any ranking or response generation
happens, and a mismatched ID returns "not found" rather than "access denied" so the response
shape itself never confirms or denies another account's existence.

**Source reliability and conflict handling.** Precedence is fixed and enforced in code: a signed
contract clause beats the current policy/SOP, which beats current product docs; deprecated
documents and historical ticket resolutions are surfaced only as labeled, non-authoritative
context. Before a high-stakes answer (one citing a specific number, or accompanying a
state-changing action) reaches the user, a second model call checks it for citation accuracy and
factual grounding against that turn's tool results; a failing check triggers one revision
attempt, then escalates rather than presenting an unverified answer.

**Major technical trade-offs.**
- *Mocked, unsigned authentication* (explicitly permitted by the assessment) over real auth —
  the six identities are freely self-selectable with no password. This was deliberately audited:
  a forged session cookie cannot reach any capability beyond what a legitimate login already
  grants, because every access check compares against real loaded records, not the cookie's
  shape. What *is* cryptographically protected is the separate, more consequential channel — the
  tool-approval mechanism that gates state-changing actions — via the AI SDK's built-in
  approval-signing, so a crafted request body can't execute an action without a genuine
  human-confirmed round-trip.
- *Streaming vs. verifiability* — tool-call activity streams live (what a user actually watches
  happen), but final answer text is buffered until the self-check pass resolves, trading
  token-by-token prose streaming for a verified-before-shown guarantee on the text that matters
  most.
- *No real persistence* — actions (approvals, escalations) are logged in-memory for the
  duration of a server instance, not a database. This is an explicit scope decision for a
  take-home assessment against a static data pack, not an oversight; a real deployment would
  need a persistence layer before the monthly-credit-cap logic (for example) means anything
  across restarts.
- *Deterministic dashboard, no LLM calls* — the manager-only Issue Detection dashboard reuses the
  same calculators run across every record instead of one, entirely synchronously. This keeps it
  free and exactly as trustworthy as the underlying calculators, at the cost of not supporting
  genuinely open-ended dashboard questions.

---

## Product Note

**Which additional client problem(s) I chose, and how.** Two, both from the "Trust and
Reliability" and "Proactive Issue Detection" categories the assessment lists as options:

1. *Trust and Reliability* — a confidence label (High / Resolved conflict / Low-needs-verification
   / Escalated) on every answer, derived deterministically from which tool results grounded it
   and whether the self-check pass needed to intervene; explicit escalation with a reason code
   rather than a guess whenever data is missing or ambiguous; and the self-check pass itself
   (citation + grounding review before a high-stakes answer is shown).
2. *Proactive Issue Detection* — a manager-only dashboard: SLA breach/near-breach ranking,
   known-issue clustering, a distinct security/credential-exposure auto-flag, cross-account
   impact detection, a per-account "needs attention" rollup, and — the feature I'm most pleased
   with — a historical-resolution audit that re-runs the *current* calculators against every
   closed ticket's recorded resolution and flags disagreement, catching exactly the kind of
   stale/wrong past answer a human reviewer would otherwise have to notice by hand.

**Anything else I'd build for ParcelPilot next.** In priority order: (1) real persistence
(a database, not an in-memory log) so approvals, the monthly credit cap, and the dashboard's
audit trail survive a restart and work across multiple server instances; (2) a true time-series
version of the dashboard once real historical data exists — the current one is deliberately
honest about only supporting a single-snapshot view, not synthetic trend detection; (3) role-
scoped *reads* for internal staff, not just role-scoped *actions* — today any internal session
can read any account's data (a documented design choice, since staff work a shared queue), but a
larger deployment would likely want finer-grained read scoping per team; (4) a real feedback loop
on the self-check pass's false-escalation rate (see the metric below) to actually tune its
strictness with data instead of guesswork.

**What I intentionally left out.** Actual deployment (requires the grader's/my own Vercel
credentials — the app is deploy-ready but I didn't push a live instance without explicit
authorization to act on external infrastructure). True database persistence, as above. A
production-grade session/auth system — mocked auth is explicitly permitted by the assessment
and building real auth would be off-topic effort. Full internal role-based read scoping (see
above — deliberately deferred, not missed). Fine-tuning or prompt-optimizing the self-check
pass's strictness beyond a first honest pass — a live verification run surfaced that it's
occasionally too strict on citation-heavy, multi-fact answers, which I've documented rather than
hastily patched, since tuning a judgment threshold without a real evaluation set risks trading
one failure mode for another.

**One metric I'd use to judge usefulness.** *Self-check pass rate on the first attempt*, tracked
over real traffic: the fraction of high-stakes answers (citation- or number-bearing, or
accompanying an action) that pass grounding review without needing a revision or escalation. A
healthy, useful system should sit high and stable — a low or declining rate means either the
agent is citing unreliably (a real trust problem worth fixing at the source) or the self-check
prompt itself is miscalibrated (a tuning problem, not a trust problem) — and distinguishing those
two is exactly the kind of thing that needs production data, not more guessing.

---

## AI Tool Usage

This project was built with **Claude Code** (Anthropic's agentic CLI), used in a structured,
subagent-driven workflow rather than a single freeform session:

- **Design first.** The architecture spec, HLD, LLD, and a 21-task TDD implementation plan were
  authored (with my review and iteration) before any implementation code was written.
- **Subagent-driven implementation.** Each of the 21 plan tasks was implemented by a fresh,
  purpose-briefed subagent with no memory of prior tasks, then independently reviewed by a
  separate subagent against that task's spec and code-quality standards before moving on —
  never trusting a subagent's own self-report without spot-verification. Several genuine issues
  were caught this way, including a real cross-account access-control bug (found and fixed before
  it could ship) and multiple cases where the AI SDK's actual installed API surface didn't match
  what the plan assumed.
- **Live-model verification.** Once an API key was available, a paced live pass ran a curated
  set of the assessment's own robustness-checklist prompts against the real model (respecting
  the free tier's rate limit), which caught two real live-environment bugs no static review could
  have found: a since-deprecated default model ID, and a genuine formatting incompatibility that
  was silently causing the self-check pass to falsely escalate correct answers.
- **A final whole-branch review**, dispatched on the most capable available model, read the
  entire diff end-to-end against the original spec and independently re-verified (not just
  trusted) the access-control, confirmation-before-action, and deterministic/LLM-boundary claims
  made throughout the task-by-task process — and caught several real cross-task issues no
  single task's review could have (including this note's own two deliverable gaps).

Every non-trivial judgment call — security-relevant fixes, rejected "fixes" that would have
introduced regressions, scope decisions — is recorded with reasoning in the project's session
ledger (`.superpowers/sdd/2026-08-22-parcelpilot-agent-implementation/progress.md`, not
committed to the public repo but available on request), so the process is auditable, not just
the output.
