# The reconciler

Stage 1 of the read cutover. **Read-only. Reports, never repairs** — a repair path
is a write path that can rewrite history, which is the thing this programme
exists to remove.

```bash
FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/read-only-key.json \
  node scripts/reconcile/run.mjs --cutover=2026-09-16T20:15:00Z
```

`--json` for machine output, `--user=<uid>` to scope to one workspace.
Exit 0 when the Stage 1 gate passes, 1 when it does not, 2 on bad arguments.

## `--cutover` is the DEPLOY time

Not the merge time, not midnight. It is the moment the shadow-write code began
running in production, and the gate is extremely sensitive to it.

The first real run proved that. A cutover of `2026-09-16T00:00Z` reported one
divergence — a rejection swiped at 04:32 UTC, which turned out to predate the
shadow-write merge at 06:25 UTC by two hours. Nothing was broken; the timestamp
manufactured the failure. The runner now warns when the cutover is earlier than
the first shadow write it can see.

## It reports writes seen, not only divergences found

Sprint 1A shipped the classifier with no runner, so "run it for a week" had never
actually happened. When it was finally measured, production held **zero** shadow
documents — so a divergence-only report would have said "0 divergences", looked
clean, and proven nothing.

That is the 189-vs-76 failure shape: a number that looks like a good result while
silently measuring something else. So volume and composition are first-class
output, and **a clean week means real, varied traffic** — several event types,
spread across days — not seven calendar days of silence.

## The four outcomes

| | |
|---|---|
| `agreed` | legacy and shadow say the same thing |
| `expected-gap` | a legacy record last written *before* the cutover. The entire pre-cutover corpus, by design, not a fault |
| `undo-gap` | legacy moved back to `pending` while shadow holds the decision. Undo is unmodelled; reported, does **not** block |
| `divergence` | anything else. The only count that should ever be zero |

The verdict comes from `stageOneGate()` in `src/utils/icpReconcile.js` rather than
being narrated by the runner, so it cannot be reported more generously than the
numbers support.
