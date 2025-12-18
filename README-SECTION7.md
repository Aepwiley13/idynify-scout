# Section 7: Decision Process & Stakeholders - Implementation Guide

## 📦 Files Included

1. **Section7DecisionProcess.jsx** - React component
2. **generate-section-7.js** - Netlify serverless function
3. **module-7-decision-process.json** - Complete specification (questionnaire + schema + example)

---

## 🚀 Installation Steps

### 1. React Component Setup

**Location:** `/src/components/recon/Section7DecisionProcess.jsx`

```bash
# Copy the file to your project
cp Section7DecisionProcess.jsx /path/to/your/project/src/components/recon/
```

**Dependencies Required:**
- `react` & `react-router-dom`
- Firebase (`firebase/firestore`, `firebase/auth`)

Already imported in the component - no additional packages needed.

---

### 2. Netlify Function Setup

**Location:** `/.netlify/functions/generate-section-7.js`

```bash
# Copy the file to your Netlify functions directory
cp generate-section-7.js /path/to/your/project/.netlify/functions/
```

**Dependencies Required:**
```bash
npm install @anthropic-ai/sdk firebase-admin
```

**Environment Variables (Netlify Dashboard):**
```
ANTHROPIC_API_KEY=sk-ant-...
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
```

---

## 🗄️ Firestore Database Schema

Add these fields to your `users` collection:

```javascript
{
  userId: "abc123",
  email: "user@example.com",
  
  // Section 7 Data
  section7Answers: {
    economicBuyer: "string (radio selection)",
    champion: "string (radio selection)",
    otherStakeholders: ["array of stakeholders"],
    committeeDecision: "string (radio selection)",
    approvalLevels: "string (radio selection)",
    technicalEvaluation: ["array of evaluators"],
    userInput: "string (radio selection)",
    consensusOrTopDown: "string (radio selection)",
    procurementInvolved: "string (radio selection)",
    decisionCriteria: "string (100-300 chars)",
    lastSaved: timestamp
  },
  
  section7Output: {
    section: 7,
    title: "Decision Process & Stakeholders",
    status: "completed",
    completedAt: timestamp,
    version: 1,
    decisionProcessMap: { /* full schema */ },
    rawAnswers: { /* all answers */ },
    metadata: { /* generation stats */ }
  },
  
  reconProgress: {
    section7Completed: true,
    section7LastSaved: timestamp,
    lastUpdated: timestamp
  }
}
```

---

## 🔧 Integration with Your App

### Add Route

In your `App.jsx` or routing file:

```javascript
import Section7DecisionProcess from './components/recon/Section7DecisionProcess';

// Add route
<Route path="/recon/section-7" element={<Section7DecisionProcess />} />
```

### Add to Navigation

```javascript
// From Section 6
<button onClick={() => navigate('/recon/section-7')}>
  Next: Decision Process →
</button>

// From Section 8
<button onClick={() => navigate('/recon/section-7')}>
  ← Back to Decision Process
</button>
```

---

## 🧪 Testing Checklist

### Component Tests

- [ ] All 10 questions render correctly
- [ ] Radio questions work (6 questions):
  - [ ] economicBuyer (8 options)
  - [ ] champion (8 options)
  - [ ] committeeDecision (4 options)
  - [ ] approvalLevels (4 options)
  - [ ] userInput (5 options)
  - [ ] consensusOrTopDown (5 options)
  - [ ] procurementInvolved (5 options)
- [ ] Multi-select questions work (2 questions):
  - [ ] otherStakeholders (1-6 selections)
  - [ ] technicalEvaluation (1-4 selections)
- [ ] Textarea question works:
  - [ ] decisionCriteria (100-300 chars)
- [ ] Character counter shows on textarea
- [ ] Selection counters show on multi-selects
- [ ] Validation shows errors for:
  - Missing required fields
  - Text too short (<100 chars)
  - Text too long (>300 chars)
  - No selections on multi-selects
- [ ] Auto-save triggers every 30 seconds
- [ ] Output displays all sections:
  - [ ] Stakeholder map (economic buyer, champion)
  - [ ] Decision complexity with timeline
  - [ ] Approval workflow (3 stages)
  - [ ] Ranked decision criteria
  - [ ] Selling strategy with multi-threading
- [ ] Edit button returns to questions
- [ ] Data persists on page refresh

### API Tests

```bash
# Test the Netlify function locally
curl -X POST http://localhost:8888/.netlify/functions/generate-section-7 \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test123",
    "answers": {
      "economicBuyer": "VP Sales",
      "champion": "Sales Operations Manager",
      "otherStakeholders": ["IT / Security", "End Users (SDRs/AEs)", "Finance Team", "Legal / Compliance"],
      "committeeDecision": "Small committee (2-3 people)",
      "approvalLevels": "2 levels (champion → manager)",
      "technicalEvaluation": ["IT/Security team", "Sales Operations"],
      "userInput": "High (users heavily influence)",
      "consensusOrTopDown": "Collaborative (input sought, leader decides)",
      "procurementInvolved": "Usually (depends on deal size)",
      "decisionCriteria": "1) ROI/cost savings - must show clear return on investment. 2) Ease of use for SDR team - cant be complex or require heavy training. 3) Integration with Salesforce - must sync seamlessly. 4) Implementation time - need fast rollout, under 30 days. 5) Vendor reputation - prefer established players with good support."
    }
  }'
```

Expected response:
- Status: 200
- `success: true`
- `output` contains complete JSON schema
- `stakeholderMap` has economic buyer, champion, technical buyers, influencers
- `approvalWorkflow.stages` has 3 stages with durations
- `decisionCriteria.rankedCriteria` has 5 ranked criteria
- `sellingStrategy.multiThreading.required` is boolean
- Generation time < 10 seconds
- Tokens used ~3000-4000

### Validation Tests

- [ ] Empty radio selection shows error
- [ ] Empty multi-select shows error
- [ ] Empty required textarea shows error
- [ ] Text <100 chars shows character count error
- [ ] Text >300 chars shows character limit error

---

## 📊 Key Features

### 1. Stakeholder Role Mapping

Automatically maps stakeholder roles with specific details:

```
Input:
economicBuyer: "VP Sales"
champion: "Sales Operations Manager"
otherStakeholders: ["IT / Security", "End Users", "Finance"]

Output:
💰 Economic Buyer: VP Sales
   Authority: Controls sales budget up to $100K
   Motivations: Revenue targets, scaling team, career advancement
   Concerns: Budget waste, implementation time, team pushback
   
🏆 Champion: Sales Operations Manager
   Relationship: Reports directly to VP Sales
   Influence: High - VP Sales trusts their technical judgment
   Support: ROI calculator, competitive comparison, implementation timeline
   
🔒 Technical Buyer: IT/Security
   Veto Power: YES (can block on security)
   Concerns: Data security, compliance, integration security
```

**Key Insights:**
- Economic Buyer = Final decision + budget authority
- Champion = Internal advocate who drives process
- Technical Buyers = Veto power (can block deal)
- Influencers = Input but no veto power

### 2. Champion Influence Assessment

Automatically assesses how much influence champion has:

```
Champion: "Sales Operations Manager"
Economic Buyer: "VP Sales"

Analysis:
- Relationship: Reports directly to economic buyer ✓
- Good working relationship ✓
- Technical trust ✓

Influence: "High"

Rationale: "VP Sales trusts their technical judgment and relies on them 
for tool recommendations. Champion's endorsement is critical."
```

**Influence Levels:**
- **Very High:** Champion IS economic buyer OR economic buyer fully trusts them
- **High:** Reports directly + good relationship + trusted advisor
- **Medium:** Peer to economic buyer OR indirect report
- **Low:** IC with limited access to economic buyer

### 3. Decision Complexity Calculator

Automatically calculates decision complexity and timeline:

```
Input:
committeeDecision: "Small committee (2-3 people)"
approvalLevels: "2 levels"

Output:
Complexity: "Moderate"
Average Decision Time: "6-8 weeks"

Reasoning:
- Small committee (not just 1 person) = adds coordination
- 2 approval levels = champion → VP Sales = moderate
- Not overly complex but requires alignment
```

**Complexity Matrix:**
- **Low:** Single decision maker + 1 level = 2-4 weeks
- **Moderate:** Small committee + 2 levels = 6-8 weeks
- **High:** Large committee + 3 levels = 12-16 weeks
- **Very High:** Very large committee + 4+ levels = 20+ weeks

### 4. 3-Stage Approval Workflow

Automatically creates workflow with durations:

```
Total Timeline: 6-8 weeks

Stage 1: Champion Evaluation (Week 1-3)
   Stakeholders: Champion, SDRs
   Activities: Trial, feedback, business case
   Success: Champion convinced, SDRs positive
   
Stage 2: Executive & Technical Review (Week 4-6)
   Stakeholders: VP Sales, IT/Security
   Activities: Demo, security review, references
   Success: Exec approves, IT clears security
   
Stage 3: Contract & Procurement (Week 7-8)
   Stakeholders: Legal, Procurement
   Activities: Contract review, negotiations
   Success: Signed contract, PO issued
```

**Duration Split Formulas:**
- 2-4 weeks total: 1w, 1w, 1w
- 6-8 weeks total: 2w, 3w, 2w
- 12-16 weeks total: 4w, 6w, 4w
- 20+ weeks total: 6w, 10w, 6w

### 5. Decision Criteria Parsing & Ranking

Automatically extracts and ranks criteria:

```
Input: "1) ROI/cost savings, 2) Ease of use, 3) Salesforce integration, 
4) Fast implementation, 5) Vendor reputation"

Output:
#1: ROI/cost savings → Weight: CRITICAL → Owner: VP Sales
#2: Ease of use → Weight: CRITICAL → Owner: SDRs
#3: Salesforce integration → Weight: HIGH → Owner: IT/Sales Ops
#4: Fast implementation → Weight: HIGH → Owner: VP Sales
#5: Vendor reputation → Weight: MODERATE → Owner: VP Sales + IT

Must-Haves: [ROI, ease of use, Salesforce integration]
Nice-to-Haves: [Vendor reputation, additional features]
Deal-Breakers: [Poor security, complex implementation, no Salesforce sync]
```

**Weight Assignment:**
- Rank 1-2 = **Critical** (non-negotiable)
- Rank 3-4 = **High** (very important)
- Rank 5+ = **Moderate** (nice to have)

### 6. Veto Power Detection

Automatically identifies who can block deals:

```
Veto Power: YES
- IT/Security (security concerns) ✓
- End Users if influence = "Very high" ✓

Veto Power: NO
- Finance (influences but doesn't block)
- Legal (can delay but not kill)
- Procurement (can delay but not kill)
```

**Critical:** If someone has veto power, MUST engage them early!

### 7. Multi-Threading Strategy

Automatically generates engagement sequence:

```
Multi-Threading Required: YES (committee decision)

Priority Sequence:
1st: Build champion relationship (Sales Ops) → PRIMARY
2nd: Get SDRs excited during trial → ADOPTION
3rd: Engage IT Security early → PREVENT VETO
4th: Executive briefing with VP Sales → FINAL APPROVAL

Key Relationships to Build:
- Sales Operations Manager (Champion) - PRIMARY
- VP Sales (Economic Buyer) - CRITICAL
- IT/Security Lead - TECHNICAL GATEKEEPER
- 2-3 SDRs (Trial Users) - ADOPTION DRIVERS
```

**Single-Threaded Risk:** High risk if only talking to champion!

---

## 📱 Mobile Responsiveness

Component is responsive by default using Tailwind:
- Radio options stack vertically on mobile
- Multi-select grid becomes 1 column
- Stakeholder cards stack vertically
- Approval workflow stages collapse
- Character counters remain visible

Test on:
- [ ] iPhone (375px width)
- [ ] iPad (768px width)
- [ ] Desktop (1280px+ width)

---

## 🐛 Troubleshooting

### Issue: Champion influence seems wrong

**Validation:** Check relationship to economic buyer:
- Reports directly = Higher influence
- Peer level = Medium influence
- Indirect report = Lower influence

**If champion IS economic buyer:** Influence should be "Very High" automatically

---

### Issue: Decision timeline doesn't match reality

**Cause:** Timeline calculated from complexity

**Debug:** Check complexity calculation:
- Committee size (single/small/large/very large)
- Approval levels (1/2/3/4+)

**Example:**
- Small committee + 2 levels = Moderate = 6-8 weeks ✓
- Single decision maker + 1 level = Low = 2-4 weeks ✓

---

### Issue: Criteria not parsing correctly

**Cause:** User didn't use clear numbering

**Good input:**
```
"1) ROI/cost savings 
2) Ease of use 
3) Salesforce integration"
```

**Bad input:**
```
"We need ROI and ease of use and integration" ← No ranking
```

**Fix:** Instruct users to number criteria in priority order

---

### Issue: Wrong stakeholders have veto power

**Validation:** Only these should have veto:
- IT/Security: YES (always)
- End Users: YES if userInput = "Very high (users can veto)"
- Everyone else: NO

**Not a bug:** Finance, Legal, Procurement can delay but don't have veto power

---

### Issue: Multi-threading shows "not required" for committee

**Bug check:** Multi-threading should be REQUIRED unless committeeDecision = "Single decision maker"

**If committee decision:** multi-threading IS required (multiple stakeholders must align)

---

## 🎯 Expected Performance

**Generation Time:**
- Typical: 9-10 seconds
- Max acceptable: 12 seconds
- Tokens used: ~3000-4000

**Component Load:**
- Initial load: < 1 second
- Firestore fetch: < 500ms
- Multi-select re-render: < 100ms

---

## 📊 Output Sections Generated

When a user completes Section 7, Claude generates:

```
🎯 Decision Process Map

✅ Stakeholder Map
   💰 Economic Buyer:
      → Role, authority, motivations, concerns
      → Engagement strategy
   
   🏆 Champion:
      → Role, relationship, influence level
      → How to support them
   
   🔒 Technical Buyers:
      → Roles, veto power, engagement needs
   
   👥 Influencers:
      → Roles, influence levels, concerns
   
   ⭐ End Users:
      → Influence level, veto power, adoption criticality

✅ Decision Complexity
   → Committee size
   → Approval layers
   → Complexity rating (Low/Moderate/High/Very High)
   → Average decision time
   → Consensus requirement

✅ Approval Workflow ⭐
   → Stage 1: Champion Evaluation (duration, activities, success criteria)
   → Stage 2: Executive & Technical Review
   → Stage 3: Contract & Procurement
   → Total duration
   → Common bottlenecks

✅ Procurement Process
   → Involvement level
   → When they get involved
   → Duration they add
   → Requirements (MSA, COI, etc.)
   → Negotiation style

✅ Decision Criteria (Ranked) ⭐
   → #1-5 Criteria with weights
   → Stakeholder owners
   → Must-haves
   → Nice-to-haves
   → Deal-breakers

✅ Selling Strategy ⭐
   → Multi-threading (required/not, key relationships, priority)
   → Champion enablement (content needs, internal selling)
   → Consensus building (strategy, meetings, objection handling)
   → Executive engagement (when, how, topics)

✅ Risk Factors
   → Single-threaded risk
   → Champion departure risk
   → Consensus failure risk
   → Procurement risk
   → Mitigation strategies (5-7 tactics)
```

---

## 🔗 Integration with Other Sections

### Feeds INTO:

**Section 9 (Messaging):**
- Stakeholder map → Personalized messaging per role
- Decision criteria → Value prop emphasis
- Champion needs → Enablement content

**Section 10 (GTM Strategy):**
- Decision complexity → Sales cycle assumptions
- Approval workflow → Resource planning
- Multi-threading → Sales team structure

**Sales Execution:**
- Stakeholder map → Account planning
- Approval workflow → Deal staging
- Risk factors → Risk mitigation playbook

### Feeds FROM:

**Section 6 (Buying Behavior):**
- Sales cycle validates decision timeline
- Final steps validate approval workflow

**Section 5 (Pain & Motivations):**
- Stakeholder pain map validates influencers

**Section 3 (Firmographics):**
- Company size influences committee size
- Decision speed validates complexity

---

## 💡 Pro Tips

### 1. Champion Influence Is Everything

**If champion influence is:**
- **Very High/High:** Build champion first, they'll bring economic buyer
- **Medium:** Build champion AND economic buyer in parallel
- **Low:** Go straight to economic buyer (champion can't drive deal)

Don't waste time on low-influence champions.

### 2. Veto Power = Early Engagement

If IT/Security has veto power:
- Engage in **Week 2-3** (not Week 8)
- Provide security docs proactively
- Get security review done during trial period

If users have veto power:
- Include in trial from **Day 1**
- Get 2-3 champions among users
- User feedback drives economic buyer decision

### 3. Multi-Threading Sequence Matters

**Wrong sequence:**
1. Economic buyer first ← TOO EARLY
2. Champion second ← BACKWARDS
3. Users last ← TOO LATE

**Right sequence:**
1. Champion first (build advocacy)
2. Users second (prove it works)
3. IT/Security third (clear blockers)
4. Economic buyer fourth (with champion + user support)

### 4. Decision Criteria = Sales Messaging

Map your pitch to their ranked criteria:

```
#1 Criterion: ROI → Lead with ROI in every conversation
#2 Criterion: Ease of use → Emphasize simple onboarding
#3 Criterion: Integration → Demo Salesforce sync first

Don't lead with #5 criterion (vendor reputation) when they care most about #1 (ROI).
```

**Match your message to their priorities.**

### 5. Bottlenecks = Proactive Planning

Common bottlenecks identified? Address BEFORE they occur:

```
Bottleneck: IT Security review (2-3 weeks)
Prevention: Engage IT in Week 2, provide docs proactively

Bottleneck: Economic buyer calendar (hard to schedule)
Prevention: Schedule exec briefing 2 weeks in advance

Bottleneck: Champion building internal case (takes 3 weeks)
Prevention: Provide pre-built business case, ROI calc, slides
```

### 6. Procurement Timing

Procurement involvement by stage:
- **Always:** Engaged in Stage 1 (heavy process)
- **Usually:** Engaged in Stage 3 (after exec approval)
- **Sometimes:** Engaged only if >$100K
- **Rarely/Never:** Fast-track, no formal process

Plan timeline accordingly.

### 7. Risk Mitigation Is Not Optional

**Must do:**
- Multi-thread (don't rely on single champion)
- Build direct relationship with economic buyer
- Engage veto-power stakeholders early
- Document all stakeholder alignments
- Have backup champion if primary leaves

Single-threaded deals are high-risk deals.

---

## ✅ Success Criteria

Before marking Section 7 as complete:

- [ ] All 10 questions answered
- [ ] Stakeholder map identifies 4+ roles
- [ ] Economic buyer and champion clearly defined
- [ ] Veto power correctly assigned
- [ ] Champion influence assessed
- [ ] Decision complexity calculated
- [ ] 3-stage approval workflow generated
- [ ] Timeline matches complexity
- [ ] 5+ decision criteria ranked
- [ ] Multi-threading strategy generated
- [ ] 5+ risk mitigation strategies provided
- [ ] Output displays all sections
- [ ] Colored stakeholder cards render
- [ ] Edit functionality works
- [ ] Data persists across sessions
- [ ] Mobile responsive
- [ ] No console errors
- [ ] Firestore updates correctly
- [ ] Navigation to Section 8 works

---

## 🔄 Next Steps After Implementation

1. **Create stakeholder-specific messaging** (Section 9)
2. **Build account planning templates** using stakeholder map
3. **Train sales on multi-threading** strategies
4. **Develop champion enablement kit** (content they need)
5. **Create risk mitigation playbooks** for each risk factor
6. **Map decision workflow to CRM stages** (alignment)
7. **Build Section 8** (Competitive Landscape) next

---

## 📞 Common Questions

**Q: What if champion IS the economic buyer?**  
A: Select "Same as Economic Buyer" for champion. Output will note they're same person with "Very High" influence automatically.

**Q: Can end users really veto deals?**  
A: Yes! If userInput is "Very high (users can veto)", they can block adoption. Example: If SDRs hate the tool, VP Sales won't force it.

**Q: How do I know if multi-threading is required?**  
A: If committeeDecision is anything except "Single decision maker", multi-threading IS required. Multiple stakeholders = must build multiple relationships.

**Q: What's the difference between influencer and champion?**  
A: Champion drives the process internally (advocate). Influencers provide input but don't drive (consulted). Champion is active, influencers are passive.

**Q: Should I always engage economic buyer directly?**  
A: Not always. If champion has "Very High" or "High" influence, build champion first and let them bring you to economic buyer. If champion has "Low" influence, go direct to economic buyer.

**Q: Why does procurement add 1-2 weeks if they don't have veto power?**  
A: They don't block deals but they slow them with: contract review, vendor assessment, payment terms negotiation, insurance verification. Process adds time but doesn't kill deals.

---

## 🎓 Training for Sales/Marketing

Share this output to:

1. **Map accounts properly** - Identify all stakeholders, not just champion
2. **Assess deal risk** - Single-threaded deals are high-risk
3. **Multi-thread strategically** - Build multiple relationships in sequence
4. **Enable champions** - Give them tools to sell internally
5. **Prevent vetoes** - Engage IT/Security and users early
6. **Navigate politics** - Understand consensus vs top-down cultures
7. **Forecast accurately** - Decision complexity predicts timeline

---

**Implementation complete! Section 7 is ready to deploy.** 🚀

**Next:** Build Section 8 (Competitive Landscape) or Section 9 (Messaging).

Section 9 is highest priority for Scout integration - it generates email copy using data from Sections 4-7!
