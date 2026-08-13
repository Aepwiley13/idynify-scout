# Barry OS Decision Log

This document records governance decisions made during Barry OS architecture
and implementation. It is append-only. Decisions are not removed — they are
superseded by later entries if circumstances change.

---

## BO-001 — Barry is an orchestration runtime, not a chatbot
**Date:** 2026-08-07
**Decision:** Barry OS is the intelligence and orchestration layer for the
Idynify platform. Scout, Hunter, Sniper, Basecamp, Recon, and Reinforcements
are applications running on Barry OS. Barry is the runtime, not a feature
inside each module.
**Authority:** Document 1 — Barry OS Reference Architecture

---

## BO-002 — Mission Control consumes Awareness, never modules directly
**Date:** 2026-08-07
**Decision:** Mission Control is a consumer of Barry's Awareness projections.
It does not query modules directly. Data flow is Mission Control → Awareness
→ Signals → Modules. Mission Control must never know where data originates.
**Authority:** Document 1 — Barry OS Reference Architecture, Section 8

---

## BO-003 — Architecture governance hierarchy
**Date:** 2026-08-07
**Decision:** The authoritative hierarchy is:
Constitutional Brief → Canonical Audit → Reconciliation →
Reference Architecture (Doc 1) → Domain & Lifecycle Model (Doc 2) →
Signal Specification (Doc 3) → Capability Contracts (Doc 4) →
Implementation Plan (Doc 5) → Engineering.
No document may redefine a higher-order document.
Changes flow downward. Evidence flows upward.
**Authority:** Barry OS Audit Reconciliation Addendum

---

## BO-004 — Measurement-integrity fixes are exempt from the baseline freeze
**Date:** 2026-08-09
**Decision:** During baseline week, fixes that correct measurement integrity
(telemetry attribution, logging correctness) are permitted. Model tier
changes, Barry OS architecture changes, and new features are not permitted.
**Reason:** Preserving broken instrumentation for baseline purity produces
a baseline with no analytical value.
**Authority:** Aaron — 2026-08-09

---

## BO-005 — Team ownership model
**Date:** 2026-08-07
**Decision:** Team B authors Barry OS architecture documents. Team A validates
architecture against repository evidence. Aaron approves governance decisions
and architecture. No implementation begins without Aaron's explicit assignment.
**Authority:** Barry OS Phase Transition — 2026-08-07

---

## BO-006 — Model policy: two tiers, centralized in models.js
**Date:** 2026-08-08
**Decision:** All Anthropic model identifiers are centralized in
`netlify/functions/utils/models.js`. Two tiers only: MODEL_FAST and
MODEL_DEEP, both env-overridable. Any future model lifecycle change must
originate from a provider-status verification with URL and fetch date
recorded. Tier changes require a baseline comparison — retired model
replacements are exempt.
**Authority:** P0B — Team A, Aaron approval 2026-08-08

---

## BO-007 — Session memory must not auto-promote to durable memory
**Date:** 2026-08-07
**Decision:** Session conversation content must pass a confidence gate and
corroboration requirement before reaching durable Relationship or User Memory.
The closeBarrySession() auto-write pattern is a confirmed violation and is
scheduled for remediation at P10.
**Authority:** Document 2 — Barry OS Canonical Domain & Lifecycle Model, §Memory

---

## BO-008 — Observation is a processing step, not an architectural layer
**Date:** 2026-08-07
**Decision:** Observation is a named deterministic processing step in the
Signal → Awareness pipeline. It is not a sixth object layer. Observations
may be persisted for auditability and replay but are PROPOSED architecture
until Document 3 confirms the persistence contract.
**Authority:** Aaron — 2026-08-07

---

## BO-009 — barrySessionKey identity format
**Date:** 2026-08-07
**Decision:** The canonical Barry conversation key format is
{entityType}:{entityId}:{sessionType}. sourceModule is metadata, not
identity. The same contact conversation entered from Scout, Mission Control,
or Hunter is one conversation. Consolidation scoped to P9.
**Authority:** Barry OS Audit Reconciliation Addendum §7

---

## BO-010 — Think Layer is promotion, not creation
**Date:** 2026-08-07
**Decision:** barryStrategyRecommender.js is confirmed as a partial Think
Layer satisfying 3 of 4 Think functions. P5 is permanently named Think Layer
Promotion & Expansion. The architecture extends barryStrategyRecommender.js
rather than replacing it.
**Authority:** Barry OS Audit Reconciliation Addendum §4

---

## BO-011 — Product positioning frozen
**Date:** 2026-08-13
**Decision:** IDYNIFY is not a lead database with AI added to it. It is an
intelligence system for understanding and advancing business relationships.

Approved positioning hierarchy:
- **Brand:** IDYNIFY
- **Category:** AI Relationship Intelligence for Sales
- **Framework:** WHO → WHY → NEXT
- **Promise:** Know who matters, why they matter, and what to do next.
- **Barry:** The intelligence inside IDYNIFY.

**Authority:** Aaron — 2026-08-13
