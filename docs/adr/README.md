# Architecture Decision Records

One page each. Decision · Reason · Consequences · Status.

An ADR records a decision that is **expensive to reverse and easy to erode** —
the kind where six months later someone reads the code, cannot see why it is
shaped that way, and "improves" it back to the thing it was built to replace.

They are not documentation of how the code works; `docs/CANONICAL_NAVIGATION.md`
and `docs/STATUS_ARCHITECTURE.md` do that. An ADR answers *why*, and stays
accurate even when the implementation moves.

| ADR | Decision | Status |
|---|---|---|
| [001](ADR-001-canonical-contact-experience.md) | Canonical contact experience — one destination, two display modes | Accepted |
| [002](ADR-002-contact-identity.md) | Contact identity — document ID canonical, email primary dedup signal | Accepted |
| [003](ADR-003-company-identity.md) | Company identity — `apollo_organization_id`, preview as permissions | Accepted |
| [004](ADR-004-navigation-contract.md) | Navigation contract — `openContact()` / `openCompany()` only | Accepted |
| [005](ADR-005-barry-context.md) | Barry context — persistent intelligence vs ephemeral session intent | Accepted |

**Superseding an ADR:** do not edit an accepted one beyond typo fixes. Add a new
ADR that supersedes it, and change the old one's status to
`Superseded by ADR-NNN`. The record of what we used to believe is the point.

The principles these decisions share live in
[`../PLATFORM_PRINCIPLES.md`](../PLATFORM_PRINCIPLES.md).
