# SCOUT GAME — GATE 4 DELIVERABLE 4: PERFORMANCE BENCHMARK TARGETS

**Date:** 2026-02-14
**Source:** SCOUT-GAME-DISCOVERY-COMPLETE.md (Gate 3 approved, Section 9)
**Target:** Engineering + QA — performance testing and optimization

---

## OVERVIEW

The Scout Game introduces one performance-critical addition: **message prefetching**. All other operations use existing infrastructure at existing performance levels. The benchmarks below define pass/fail thresholds for each measurable operation.

---

## BENCHMARK TABLE

| # | Metric | Target | Acceptable | Fail | Current Baseline | Measurement Method | Source Evidence |
|---|--------|--------|------------|------|-----------------|-------------------|----------------|
| P1 | Cold start to first card visible | ≤ 2000ms | ≤ 3000ms | > 3000ms | ~500-1500ms | `performance.now()` at mount vs first card render | `DailyLeads.jsx:56-67` Firestore query |
| P2 | First card render (after data load) | ≤ 200ms | ≤ 500ms | > 500ms | <100ms | React render profiler | `CompanyCard.jsx` is a pure component |
| P3 | Card-to-card transition | ≤ 100ms | ≤ 200ms | > 200ms | <50ms | `setCurrentIndex` is synchronous state | `DailyLeads.jsx:325` |
| P4 | Barry message generation (single) | ≤ 8000ms | ≤ 12000ms | > 12000ms | 3000-8000ms | `logApiUsage` `responseTime` | `generate-engagement-message.js:368` |
| P5 | Prefetch buffer initial load (10 cards) | ≤ 15000ms | ≤ 20000ms | > 20000ms | N/A (new) | Time from session start to all 10 prefetch complete | Parallel `Promise.allSettled` |
| P6 | Messages ready before card viewed | 100% (all cards) | 95% (19/20) | <90% | N/A (new) | prefetchBuffer has messages before `cardIndex` advances | Prefetch runway analysis |
| P7 | Memory footprint (25-card session) | ≤ 5MB | ≤ 10MB | > 10MB | ~162KB | Chrome DevTools Memory snapshot | Section 2D: 25 companies + 75 contacts + 25 payloads |
| P8 | Session restore from localStorage | ≤ 100ms | ≤ 500ms | > 500ms | N/A (new) | Time to parse and hydrate localStorage keys | Simple key reads |
| P9 | Timer display update interval | 1000ms ± 50ms | 1000ms ± 100ms | Visible jank | N/A (new) | `setInterval` or `requestAnimationFrame` | Standard browser API |
| P10 | Send action completion | ≤ 3000ms | ≤ 5000ms | > 5000ms | 1000-3000ms | Time from send button tap to success state | `executeSendAction` at `sendActionResolver.js:288` |

---

## PREFETCH RUNWAY ANALYSIS

The prefetch strategy must ensure messages are always ready before the user reaches a card. This analysis validates the buffer sizing.

### Assumptions

| Variable | Value | Source |
|---------|-------|--------|
| Target engagements per session | 15 | Section 12: session goal |
| Session time budget | 30 minutes = 1800 seconds | Section 12: session window |
| Time per engagement (target) | 120 seconds | 1800s / 15 = 120s per engagement |
| Barry generation time (worst case) | 8 seconds | Section 9: P4 baseline |
| Barry generation time (average) | 5 seconds | Midpoint of 3-8s range |
| Initial prefetch batch | 10 cards | Section 2C: N=10 |
| Refill trigger | Buffer < 3 remaining | Build prompt specification |

### Scenario Analysis

| Scenario | User Pace | Prefetch Runway | Messages Ready? |
|---------|-----------|-----------------|----------------|
| Normal (120s/card) | 120s between cards | 10 × 120s = 1200s ahead, 8s generation | Always ready |
| Fast (60s/card) | 60s between cards | 10 × 60s = 600s ahead, 8s generation | Always ready |
| Very fast (30s/card) | 30s between cards | 10 × 30s = 300s ahead, 8s generation | Always ready |
| Sprint (15s/card) | 15s between cards | 10 × 15s = 150s ahead, 8s generation | Ready for first 10, refill must keep up |
| Impossible (5s/card) | 5s between cards | 10 × 5s = 50s ahead, 8s generation | May see loading states |

**Conclusion:** With a 10-card prefetch buffer, messages will be ready for all realistic engagement speeds. Only a physically impossible pace (< 8s per full engagement cycle) would expose loading states.

### Refill Strategy

```
When user completes card N:
  remaining = prefetchBuffer.size - currentIndex
  if (remaining < 3):
    prefetchMessages(cards, sessionMode, currentIndex + remaining, 5)
```

This triggers a 5-card refill when only 3 cards remain in the buffer, providing continuous coverage.

---

## API COST BUDGET

Each session generates costs from Barry message generation and potentially Apollo contact searches.

| Resource | Per-Card Cost | Per-Session (25 cards) | Rate Limit |
|---------|--------------|----------------------|------------|
| Claude API (Barry) | ~2000 tokens in + ~800 tokens out | ~70K tokens total | Anthropic tier limits |
| Apollo contact search | 1 API credit per search | Up to 25 credits | ~20-50 req/min (standard tier) |
| Gmail send | 1 send per engagement | Up to 25 sends | 500/day (Gmail standard) |

**Cost mitigation:**
- Prefetch only what's needed (10 initial, refill in batches of 5)
- Don't prefetch for cards user may skip (defer prefetch until card is 3 positions away)
- Cache Barry results per card in React state — don't re-generate on card revisit

---

## DEVICE PERFORMANCE TARGETS

| Device | Category | P1 Target | P3 Target | Notes |
|--------|----------|-----------|-----------|-------|
| iPhone SE (2nd gen) | Low-end | ≤ 2500ms | ≤ 150ms | Smallest screen, minimum spec |
| iPhone 14 Pro | Mid-range | ≤ 1500ms | ≤ 100ms | Standard target device |
| Samsung Galaxy S23 | Android baseline | ≤ 2000ms | ≤ 100ms | Android reference device |
| Desktop Chrome | Development | ≤ 1000ms | ≤ 50ms | Dev environment baseline |

**Testing protocol:**
1. Clear browser cache and localStorage
2. Load `/scout/game` from cold start
3. Measure P1 (time to first card visible)
4. Complete 5 engagements
5. Measure P3 (average card transition time)
6. Record memory snapshot at card 5 (P7)
7. Repeat 3 times, report median

---

## NETWORK CONDITION TESTING

| Condition | Simulated Latency | P4 Impact | P5 Impact | User Experience |
|-----------|-------------------|-----------|-----------|----------------|
| Fast WiFi | 20ms RTT | 3-8s | 10-15s | Smooth. All cards pre-loaded. |
| 4G LTE | 50ms RTT | 4-9s | 12-18s | Smooth. Minor initial wait. |
| 3G | 200ms RTT | 6-12s | 15-25s | May see loading on first few cards. Acceptable. |
| Slow 3G | 500ms RTT | 10-18s | 20-30s+ | Loading states likely. Degrade gracefully. |
| Offline | N/A | Fail | Fail | Show offline message. Preserve session state in localStorage. |

**Offline behavior:** Session state preserved in localStorage. On reconnect, resume from last position. Do not clear session. Show "Reconnecting..." indicator.

---

## MONITORING & MEASUREMENT

### What to Measure in Production

| Metric | How to Capture | Where to Log |
|--------|---------------|-------------|
| Session start to first card | `performance.now()` delta | Console (dev) / analytics (prod) |
| Per-card engagement duration | `cardOpenedAt` vs `message_sent` timestamp | Client-side only (localStorage array) |
| Prefetch hit rate | Messages available when card activated / total cards | Console (dev) |
| Barry generation time | Already logged via `logApiUsage` | Existing `apiLogs` collection |
| Session completion rate | Sessions with ≥1 engagement / total sessions started | Requires new analytics event (deferred) |

### What NOT to Measure (out of scope)

- Cross-session trends (no persistent gamification backend)
- User-vs-user comparisons (no leaderboard)
- A/B test metrics (deferred — add `intentSource` to `logApiUsage` metadata first)
- Revenue attribution from game engagements

---

## PASS/FAIL SUMMARY

A build passes performance benchmarks if:

- [ ] P1 ≤ 3000ms on all target devices
- [ ] P2 ≤ 500ms on all target devices
- [ ] P3 ≤ 200ms on all target devices
- [ ] P4 ≤ 12000ms (95th percentile across 10 generations)
- [ ] P5 ≤ 20000ms (initial 10-card prefetch)
- [ ] P6 ≥ 95% prefetch hit rate across a full 15-engagement session
- [ ] P7 ≤ 10MB at peak (25-card session)
- [ ] P8 ≤ 500ms session restore
- [ ] P10 ≤ 5000ms send completion
- [ ] No visible UI jank during card transitions (P3, P9)
- [ ] No memory leaks across a full 25-card session (P7 stable or decreasing)
