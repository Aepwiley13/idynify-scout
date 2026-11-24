# Contact Hub outbound safety matrix

Reviewed against isolated Contact Hub checkpoint `2f4b355b`. This is release
evidence from source review, synthetic Firestore records, and provider mocks.
All live send and merge gates remain closed. A passing characterization test
can reproduce a safety gap. It does not certify that pathway for activation.

| Path | Retired contact and authoritative opt-outs | Reservation and provider dispatch | In-flight deduplication | Receipts and attribution | Rollback safety and release status |
| --- | --- | --- | --- | --- | --- |
| Contact Hub Gmail | Server validates the saved contact and rejects retired references. Reservation checks normalized `emailSuppressionList`, supported contact flags, and carried merge suppression. | Verified at reservation. Transport can refresh the token after reservation. No second suppression read at the provider boundary. | Stable operation ID and contact-bound fingerprint prevent replay of the same attempt. Unknown outcomes retain the reservation. A fresh ID is a separate attempt. | Prior receipts and UID-scoped ledger survive. New entries carry the authoritative contact ID. Deterministic Activity records the Gmail message ID when its write succeeds. A failed Activity write can leave only a sent status. | Unresolved and post-merge attributed sends block rollback. Unattributed unresolved legacy entries conservatively block by account. **Partial.** Verify dispatch-time suppression and recovery of provider IDs when Activity finalization fails. |
| Scout quick sends | The server uses the submitted address and reaches Gmail without enforcing retired state or the authoritative list. A synthetic retired and suppressed fixture reproduced provider dispatch. | No trusted reservation or shared suppression check before dispatch. | Mocked concurrent requests dispatched twice. | Returns Gmail message/thread IDs and records downstream history. A provider acceptance followed by an application write failure is not atomically reconciled. | No shared reservation visible to rollback. **Blocked.** |
| Scout waves | Scheduled waves check fresh retirement and carried merge restrictions. Immediate `gmail-send-wave` uses a submitted recipient snapshot and does not apply those checks at dispatch. | Scheduled wave reads are checks, not per-recipient transactional claims. Immediate handler dispatches from the submitted batch. Neither path establishes authoritative address suppression across every recipient. | Sequential iteration limits a single request. It supplies no deduplication across concurrent runs or retries. | Per-recipient results, contact/timeline updates and wave stats are downstream of dispatch. Retain existing provider IDs and original recipient references. | Existing wave documents conservatively block merge/rollback. Immediate in-flight dispatch lacks a shared claim. **Blocked.** |
| Cadences | Bulk executor routes through the shared send resolver and quick send. That server endpoint inherits the retirement and opt-out gap. | Cadence ID is supplied for attribution and tracking. It is not an atomic per-contact reservation. | Client sequencing and cadence reuse do not protect two callers or an unknown provider result. | Cadence stats, tracking and downstream history use existing IDs. Post-provider writes are separate. | Any existing cadence conservatively blocks merge/rollback. Quick-send provider work is still invisible to the merge transaction. **Blocked.** |
| Scheduled follow-ups | `process-scheduled-engagements` verifies the fresh contact before dispatch, rejects retired state and carried restrictions, and keeps the canceled/skipped record. Direct `send-followup` is a separate legacy handler. Its send path does not provide equivalent verification. | Scheduled fixture verifies zero provider calls for retired/restricted contacts. The read does not reserve the pending record or cover an opt-out added after the read. The direct handler lacks a shared claim. | Mocked concurrent workers dispatched the same pending record twice. | Scheduled records retain contact ID and skipped reason. Successful writes follow Gmail and do not make overlapping attempts safe. | A new matching scheduled record, including a canceled one, blocks rollback. Active provider calls remain untracked by a shared claim. **Blocked.** |
| Barry outbound actions | Draft approval checks retirement in its claim transaction. The direct `barryActions` Gmail action uses parameters and lacks equivalent recipient/suppression enforcement. User confirmation is not proof of eligibility. | Draft claims protect the stored draft, but missing drafts can dispatch without a claim. Neither variant shares an authoritative per-address reservation with merge. | An actively held stored draft and completed receipt prevent replays in covered tests. A mock reproduced duplicate acceptance after a timeout releases the claim. Stale-claim reclamation can also resend after ambiguous delivery, and the no-draft case has no claim. | Stored draft replays return the original Gmail IDs. Direct action returns IDs to its caller. Keep all existing draft and communication records. | Known Barry queue/history records block execution. The direct path and ambiguous provider acceptance remain unresolved. **Blocked.** |
| Hunter campaigns | Current Campaign Detail uses the shared resolver and quick send. The legacy `gmail-send` campaign handler sends to a submitted address and only then reads the campaign/message slot. Neither provides the required authoritative retirement and opt-out checks. | No trusted per-contact campaign claim before dispatch. The legacy endpoint can reach Gmail before campaign-slot validation. | Neither path guarantees one delivery across concurrent requests or an ambiguous retry. | Modern campaign receipts use resolver results. Legacy updates the message slot after dispatch. Concurrent writes or provider-accepted failures can leave incomplete attribution. | Campaign dispatch is not covered by a shared merge claim. Existing receipt documents must remain unchanged. **Blocked.** |

## Verification depth

Mocked handler tests cover Contact Hub Gmail, Scout quick sends, scheduled
waves and follow-ups, and Barry draft approval. Cadence and current Hunter
routes were traced to the shared quick-send handler, and the cadence bulk
executor and resolver guards were regression-tested. Immediate waves,
direct Barry actions, the legacy follow-up handler, and the legacy Hunter
campaign handler were evaluated by source inspection. Separate synthetic
handler tests remain required before certifying those variants. No activation
approval applies to any row.

## Consolidated staging recommendation

Preserve the running accepted candidate `2f4697fa` on port 8893. Use
`2f4b355b` plus the local audit evidence as the base of a **new isolated
staging candidate with merge execution and live sends disabled**. It can
review non-outbound Contact Hub behavior. It cannot be used to approve
outbound activation.

Before approving any consolidated activation, have pathway owners validate
one shared trusted reservation keyed by account, canonical contact, channel,
and stable intent. Read authoritative recipient and suppression state inside
the reservation and check it again immediately before dispatch. Treat
provider acceptance without a durable result as unknown. Preserve the
original recipient, contact ID, provider ID and receipt on all retries.
The merge and rollback transaction must see the same claims, canceled work
and external side effects. New or modified history blocks automatic
rollback and is never reactivated by it. Verify each provider entry point
using concurrent mock dispatch, accept-then-timeout, token refresh,
suppression changes, receipt write failures and a merge/rollback race.
