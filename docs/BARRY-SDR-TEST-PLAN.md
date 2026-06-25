# Barry Autonomous SDR - Experience Validation Test Plan

## Objective

Determine whether Barry has evolved from a prospecting assistant into a true autonomous SDR that:

1. Builds an accurate ICP with minimal user effort.
2. Learns from user behavior.
3. Reduces manual prospect review work.
4. Delivers qualified prospects with ready-to-send outreach.
5. Creates a faster and more valuable user experience than the previous version.

---

## Tester Profile

Assume you are:

**Founder & CEO of a B2B company selling software to marketing agencies.**

**Website:** https://www.idynify.com

**Seed Companies:**

- WebFX
- Disruptive Advertising
- Ignite Visibility

---

## Phase 1: Auto-ICP Evaluation

### Test Steps

1. Open Auto-Build from Website.
2. Enter website URL.
3. Enter at least 2 seed companies.
4. Start ICP generation.
5. Review generated ICP.

### Functional Validation

Verify:

- [ ] ICP generates successfully.
- [ ] Process completes in under 30 seconds.
- [ ] Industry mapping is accurate.
- [ ] Company size recommendations are reasonable.
- [ ] Geography recommendations are relevant.
- [ ] Pain points match website messaging.
- [ ] Buying roles are correctly identified.

### Experience Questions

Rate 1-10:

| Question | Score |
|----------|-------|
| **Ease of Setup** - How easy was it to create an ICP compared to completing the questionnaire manually? | ___ |
| **Accuracy** - How closely did Barry understand the business? | ___ |
| **Trust** - Would you confidently use this ICP without major edits? | ___ |
| **Time Saved** - Estimate how many minutes this saved versus manual setup. | ___ minutes |

### Success Criteria

Pass if:

- Accuracy >= 8/10
- Ease of Setup >= 8/10
- Time Saved >= 15 minutes

### Regression Testing

| Test | Pass / Fail |
|------|-------------|
| **Existing Questionnaire** - Questionnaire loads, validation works, submission works, ICP saves correctly | ___ |
| **Barry Chat ICP Builder** - Chat starts correctly, responses generate, ICP creation still works | ___ |

---

## Phase 2: Adaptive Learning Evaluation

### Test Steps

1. Review 10-20 leads.
2. Accept leads that match the ICP.
3. Reject leads that clearly do not.
4. Refresh the application.
5. Check ICP Settings.

### Functional Validation

Verify:

- [ ] Learned weights appear.
- [ ] Weighting changes based on decisions.
- [ ] Behavioral insights populate.
- [ ] Learning feels connected to actual choices.

### Experience Questions

Rate 1-10:

| Question | Score |
|----------|-------|
| **Transparency** - Can you understand WHY Barry is learning? | ___ |
| **Relevance** - Do the learned weights reflect your behavior? | ___ |
| **Confidence** - Would you trust Barry recommendations after seeing the learning model? | ___ |

### Success Criteria

Average score >= 8

---

### Recommend Only Mode

#### Test Steps

1. Enable Recommend Only.
2. Return to Daily Leads.
3. Review recommendations.

#### Functional Validation

Verify:

- [ ] Match badges appear.
- [ ] Skip badges appear.
- [ ] Review badges appear.
- [ ] Recommendations feel justified.

#### Experience Questions

Rate 1-10:

| Question | Score |
|----------|-------|
| **Recommendation Quality** - How often would you agree with Barry? | ___ |
| **Clarity** - Are recommendations easy to understand? | ___ |
| **Value** - Do recommendations reduce decision fatigue? | ___ |

#### Success Criteria

Average score >= 8

---

### Auto-Triage Evaluation

#### Test Steps

1. Reach 50+ swipes.
2. Maintain 80%+ agreement.
3. Verify promotion to Auto-Triage.

#### Functional Validation

Verify:

- [ ] Promotion occurs automatically.
- [ ] User receives notification.
- [ ] Status is clearly explained.

#### Experience Questions

Rate 1-10:

| Question | Score |
|----------|-------|
| **Trust** - Would you allow Barry to make decisions automatically? | ___ |
| **Explainability** - Do you understand why Barry promoted itself? | ___ |
| **Control** - Do you still feel in control? | ___ |

#### Success Criteria

Average score >= 8

---

### Daily Briefing Evaluation

#### Functional Validation

Verify sections appear:

- [ ] Auto Approved
- [ ] Auto Rejected
- [ ] Needs Review

Verify:

- [ ] Counts are accurate.
- [ ] Cards load quickly.
- [ ] Undo functions properly.

#### Experience Questions

Rate 1-10:

| Question | Score |
|----------|-------|
| **Usefulness** - Does the briefing help prioritize work? | ___ |
| **Efficiency** - How much review time does this save? | ___ |
| **Overall Experience** - Would you start your day here? | ___ |

#### Success Criteria

Average score >= 8

---

## Phase 3: Auto-Handoff Evaluation

### Test Steps

1. Approve a company.
2. Trigger auto-handoff.
3. Review discovered contacts.
4. Review outreach drafts.

### Functional Validation

Verify:

- [ ] Contacts discovered successfully.
- [ ] Contacts fit ICP.
- [ ] Messaging references company context.
- [ ] Messaging feels personalized.

### Experience Questions

Rate 1-10:

| Question | Score |
|----------|-------|
| **Contact Quality** | ___ |
| **Outreach Quality** | ___ |
| **Personalization** | ___ |
| **Send Readiness** - Would you send this draft with no edits? | ___ |

### Success Criteria

Average score >= 8

---

### Draft Review Workflow

#### Test Steps

Review 10 drafts. For each:

- Approve
- Edit & Approve
- Reject

#### Functional Validation

Verify:

- [ ] Status changes correctly.
- [ ] Edit rate updates.
- [ ] Dashboard statistics update.

#### Experience Questions

Rate 1-10:

| Question | Score |
|----------|-------|
| **Workflow Simplicity** | ___ |
| **Dashboard Clarity** | ___ |
| **Time Saved** | ___ |

#### Success Criteria

Average score >= 8

---

## Overall Product Evaluation

Compared to the previous version of Barry:

Rate 1-10:

| Category | Old Version | New Version |
|----------|-------------|-------------|
| ICP Creation | ___ | ___ |
| Lead Discovery | ___ | ___ |
| Lead Qualification | ___ | ___ |
| Outreach Preparation | ___ | ___ |
| Overall Value | ___ | ___ |

---

## Final Decision

Would you describe Barry as:

- [ ] AI Assistant
- [ ] Prospecting Tool
- [ ] SDR Copilot
- [ ] Autonomous SDR

---

## Critical Success Metrics

The release is considered successful if:

- [ ] Auto-ICP Accuracy >= 8/10
- [ ] Recommendation Quality >= 8/10
- [ ] Outreach Quality >= 8/10
- [ ] Overall Product Score >= 8/10
- [ ] Users report 50%+ reduction in prospecting effort
- [ ] Majority of testers classify Barry as an "Autonomous SDR"

> This version tests what really matters: not just whether features work, but whether users perceive a meaningful improvement in speed, trust, autonomy, and value. Those are the metrics that will tell you if Barry is genuinely becoming an autonomous SDR rather than just adding more functionality.
