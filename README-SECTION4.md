# Section 4: Ideal Customer Psychographics - Implementation Guide

## 📦 Files Included

1. **Section4IdealCustomerPsychographics.jsx** - React component
2. **generate-section-4.js** - Netlify serverless function
3. **module-4-psychographics.json** - Complete specification (questionnaire + schema + example)

---

## 🚀 Installation Steps

### 1. React Component Setup

**Location:** `/src/components/recon/Section4IdealCustomerPsychographics.jsx`

```bash
# Copy the file to your project
cp Section4IdealCustomerPsychographics.jsx /path/to/your/project/src/components/recon/
```

**Dependencies Required:**
- `react` & `react-router-dom`
- Firebase (`firebase/firestore`, `firebase/auth`)

Already imported in the component - no additional packages needed.

---

### 2. Netlify Function Setup

**Location:** `/.netlify/functions/generate-section-4.js`

```bash
# Copy the file to your Netlify functions directory
cp generate-section-4.js /path/to/your/project/.netlify/functions/
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
  
  // Section 4 Data
  section4Answers: {
    nightFears: "string (100-400 chars)",
    goals: "string (100-400 chars)",
    values: ["Speed / Quick results", "Scalability / Growth", ...],
    commonPhrases: "string (50-300 chars)",
    emotionalState: ["Frustrated / Fed up", "Anxious / Stressed", ...],
    decisionFears: "string (100-300 chars)",
    changeAttitude: "string (radio selection)",
    successMeasurement: "string (100-300 chars)",
    personalMotivators: ["Career advancement", "Recognition / Status", ...],
    riskTolerance: "string (radio selection)",
    lastSaved: timestamp
  },
  
  section4Output: {
    section: 4,
    title: "Ideal Customer Psychographics",
    status: "completed",
    completedAt: timestamp,
    version: 1,
    psychographicProfile: { /* full schema */ },
    rawAnswers: { /* all answers */ },
    metadata: { /* generation stats */ }
  },
  
  reconProgress: {
    section4Completed: true,
    section4LastSaved: timestamp,
    lastUpdated: timestamp
  }
}
```

---

## 🔧 Integration with Your App

### Add Route

In your `App.jsx` or routing file:

```javascript
import Section4IdealCustomerPsychographics from './components/recon/Section4IdealCustomerPsychographics';

// Add route
<Route path="/recon/section-4" element={<Section4IdealCustomerPsychographics />} />
```

### Add to Navigation

```javascript
// From Section 3
<button onClick={() => navigate('/recon/section-4')}>
  Next: Psychographics →
</button>

// From Section 5
<button onClick={() => navigate('/recon/section-4')}>
  ← Back to Psychographics
</button>
```

---

## 🧪 Testing Checklist

### Component Tests

- [ ] All 10 questions render correctly
- [ ] Textarea questions work:
  - [ ] nightFears (100-400 chars)
  - [ ] goals (100-400 chars)
  - [ ] commonPhrases (50-300 chars)
  - [ ] decisionFears (100-300 chars)
  - [ ] successMeasurement (100-300 chars)
- [ ] Multi-select questions work:
  - [ ] values (2-5 selections enforced)
  - [ ] emotionalState (2-4 selections enforced)
  - [ ] personalMotivators (2-5 selections enforced)
- [ ] Radio questions work:
  - [ ] changeAttitude
  - [ ] riskTolerance
- [ ] Character counters show on textareas
- [ ] Selection counters show on multi-selects
- [ ] Validation shows errors for:
  - Missing required fields
  - Text too short (<100 chars for long fields)
  - Text too long (>400 chars)
  - Too few selections (<2 for values)
  - Too many selections (>5 for values)
- [ ] Auto-save triggers every 30 seconds
- [ ] Output displays all psychographic sections
- [ ] Edit button returns to questions
- [ ] Data persists on page refresh

### API Tests

```bash
# Test the Netlify function locally
curl -X POST http://localhost:8888/.netlify/functions/generate-section-4 \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test123",
    "answers": {
      "nightFears": "They worry about missing revenue targets and being blamed for slow sales growth. They fear their manual prospecting approach cant scale fast enough to hit aggressive growth goals.",
      "goals": "Hit 150% of quota this year and get promoted to VP Sales. Build a scalable sales engine that doesnt require constant firefighting.",
      "values": ["Speed / Quick results", "Scalability / Growth", "Reliability / Consistency"],
      "commonPhrases": "Were drowning in manual work, We cant scale fast enough, Our SDRs are burning out, Were losing deals to faster competitors",
      "emotionalState": ["Frustrated / Fed up", "Anxious / Stressed", "Determined / Focused"],
      "decisionFears": "Wasting budget on something that doesnt work and looking incompetent. Implementation taking too long and missing the quarter. Team wont adopt it.",
      "changeAttitude": "Early Majority (adopts after some validation)",
      "successMeasurement": "Outbound response rates improving from 2% to 5%. Meetings booked per SDR doubling from 4/week to 8/week. $500K in closed-won pipeline from outbound this quarter.",
      "personalMotivators": ["Career advancement", "Recognition / Status", "Making an impact"],
      "riskTolerance": "Calculated risk (data-driven decisions)"
    }
  }'
```

Expected response:
- Status: 200
- `success: true`
- `output` contains complete JSON schema
- `psychographicProfile` has 10 sections
- `languagePatterns.exactPhrases` is array of 5-8 phrases
- `valueSystem.topValues` is array with priorities 1-5
- Generation time < 10 seconds
- Tokens used ~2500-3500

### Validation Tests

- [ ] Empty textarea shows error
- [ ] Text <100 chars shows character count error
- [ ] Text >400 chars shows character limit error
- [ ] 0 values selected shows error
- [ ] 1 value selected shows "need 2 minimum" error
- [ ] 6 values cannot be selected (max 5)
- [ ] Missing radio selection shows error

---

## 📊 Key Features

### 1. Deep Psychological Profiling

Unlike firmographics (Section 3), psychographics digs into:
- **Mindset:** What they worry about, what drives them
- **Motivations:** Career goals, personal rewards
- **Language:** Exact phrases they use (critical for messaging)
- **Risk tolerance:** How they make decisions
- **Change readiness:** Early adopter vs resistant

### 2. Language Pattern Extraction

The function automatically extracts:
- **Exact phrases** from commonPhrases (splits on commas/periods)
- **Pain language** patterns (military metaphors, urgency terms)
- **Outcome language** (how they describe success)
- **Emotional words** (identifies charged language)

**Example:**
```
Input: "We're drowning in manual work, can't scale fast enough, losing deals to competitors"

Output:
exactPhrases: [
  "We're drowning in manual work",
  "can't scale fast enough",
  "losing deals to competitors"
]
painLanguage: "Uses drowning metaphor, expresses limitation ('can't'), competitive loss framing"
```

### 3. Value System Prioritization

Values are ranked 1-5 with specific implications:

```javascript
{
  "value": "Speed / Quick results",
  "priority": 1,
  "implication": "Long implementations are deal-breakers. Time-to-value matters more than features."
}
```

**NOT generic like:**
```javascript
{
  "implication": "They value speed" // ❌ Too vague
}
```

### 4. Emotional Journey Mapping

Maps current state → desired state → transition path:

```
Current: Frustrated, anxious, overwhelmed
Desired: Confident, in control, validated
Journey: Research (hopeful but skeptical) → Trial (cautiously optimistic) → Success (relieved) → Expansion (confident evangelist)
```

---

## 📱 Mobile Responsiveness

Component is responsive by default using Tailwind:
- Textareas stack vertically on mobile
- Multi-select grid becomes 1 column
- Character counters remain visible
- Buttons adjust size

Test on:
- [ ] iPhone (375px width)
- [ ] iPad (768px width)
- [ ] Desktop (1280px+ width)

---

## 🐛 Troubleshooting

### Issue: "Must be at least 100 characters"

**Cause:** Textarea fields have minimum lengths
- nightFears, goals, decisionFears, successMeasurement: 100-400 chars
- commonPhrases: 50-300 chars

**Fix:** Guide users to be detailed:
```javascript
helpText: "Be specific - aim for 2-3 sentences with concrete examples"
```

---

### Issue: "At least 2 selections required"

**Cause:** Values, emotionalState, personalMotivators need minimum 2

**Fix:** User must select at least 2 before generating

---

### Issue: "Cannot select more than 5 values"

**Expected behavior:** Max limits enforced
- values: 2-5 selections
- emotionalState: 2-4 selections
- personalMotivators: 2-5 selections

**Fix:** User must deselect one before selecting another

---

### Issue: Language patterns too generic

**Cause:** User's commonPhrases input too short or generic

**Debug:** Check prompt is extracting exact phrases correctly

**Example of good input:**
```
"We're drowning in manual prospecting, 
can't keep up with competitor speed, 
SDRs burning out after 6 months, 
I can't prove ROI to my board"
```

**Example of bad input:**
```
"We have problems with sales" // Too vague
```

---

### Issue: Value priorities not ranking correctly

**Cause:** Claude not maintaining order from user selections

**Fix:** Prompt explicitly states: "Prioritize values 1-5 in order they selected them"

---

## 🎯 Expected Performance

**Generation Time:**
- Typical: 7-9 seconds
- Max acceptable: 10 seconds
- Tokens used: ~2500-3500

**Component Load:**
- Initial load: < 1 second
- Firestore fetch: < 500ms
- Multi-select re-render: < 100ms

---

## 📊 Output Sections Generated

When a user completes Section 4, Claude generates:

```
🧠 Psychographic Profile

✅ Pain Landscape
   → Night fears (what keeps them up)
   → General anxiety themes
   → Daily frustrations
   → Strategic challenges

✅ Goal Architecture
   → Specific objectives
   → Aspirational goals
   → Measurable targets
   → Timeline/urgency

✅ Value System ⭐
   → Top 5 values (ranked with priorities 1-5)
   → Specific implications for each
   → Tradeoffs they'll make

✅ Language Patterns ⭐ (CRITICAL for Section 9)
   → Exact phrases (5-8 extracted)
   → Pain language patterns
   → Outcome language
   → Industry jargon
   → Emotional words

✅ Emotional Drivers
   → Current emotional state
   → Desired emotional state
   → Emotional journey map
   → Emotional triggers

✅ Risk Perception
   → Decision fears
   → Concerns/hesitations
   → Worst-case scenario
   → Risk mitigation needs

✅ Change Readiness
   → Adoption curve position
   → Change attitude
   → Innovation tolerance
   → Status quo bias strength

✅ Success Definition
   → Success metrics
   → Required proof points
   → Timeframe expectations
   → Acceptable ROI

✅ Personal Motivators
   → Career drivers (array)
   → Professional goals
   → Personal rewards

✅ Risk Profile
   → Tolerance level
   → Past behavior patterns
   → Risk/reward balance
```

---

## 🔗 Integration with Other Sections

### Feeds INTO:

**Section 5 (Pain & Motivations):**
- Pain landscape validates pain themes
- Language patterns used for pain phrasing

**Section 9 (Messaging):**
- Language patterns → Email copy, subject lines
- Values → Value proposition framing
- Emotional drivers → Emotional connection story
- Risk perception → Objection handling

**Section 7 (Decision Process):**
- Change readiness → Decision complexity expectations
- Risk tolerance → Approval process assumptions

### Feeds FROM:

**Section 1 (Company):**
- Current challenge validates nightFears
- 90-day goal validates goals/aspirations

**Section 3 (Firmographics):**
- Company size/stage influences risk tolerance
- Decision speed validates change readiness

---

## 💡 Pro Tips

### 1. Encourage Specificity

**Good answers:**
- nightFears: "Worried about missing Q4 targets and looking incompetent. Fear SDRs will churn before ramping. Stressed about CEO asking why sales isn't scaling."
- commonPhrases: "We're drowning in manual work, can't scale without more bodies, losing to faster competitors"

**Bad answers:**
- nightFears: "They have problems" ← Too vague
- commonPhrases: "Issues, challenges" ← Not specific phrases

### 2. Language Patterns Are Gold

The `languagePatterns.exactPhrases` output feeds directly into:
- Section 9 messaging
- Scout email sequences
- Cold outreach templates

Make sure users provide actual customer language, not paraphrased summaries.

### 3. Values Drive Positioning

The ranked values (1-5) determine:
- Which benefits to emphasize first
- What tradeoffs they'll accept
- How to frame pricing

If "Speed" is #1 and "Cost" is #5, emphasize fast results over low price.

### 4. Change Readiness Affects Sales Cycle

- Early Adopter → Fast sales cycle, less proof needed
- Early Majority → Moderate cycle, wants case studies
- Late Majority → Long cycle, needs extensive proof
- Laggard → Very long or impossible

Use this to set realistic expectations in Section 6.

---

## ✅ Success Criteria

Before marking Section 4 as complete:

- [ ] All 10 questions answered
- [ ] All textareas meet min character requirements
- [ ] All multi-selects meet min/max selection requirements
- [ ] Language patterns extracted (5-8 exact phrases)
- [ ] Values ranked 1-5 with specific implications
- [ ] Emotional journey mapped (current → desired)
- [ ] Risk profile aligns with tolerance level
- [ ] Output displays all 10 psychographic sections
- [ ] Edit functionality works
- [ ] Data persists across sessions
- [ ] Mobile responsive
- [ ] No console errors
- [ ] Firestore updates correctly
- [ ] Navigation to Section 5 works

---

## 🔄 Next Steps After Implementation

1. **Validate language patterns** with sales team (do these sound like real customers?)
2. **Use exact phrases** in Section 9 messaging
3. **Map values to features** (which features align with top values?)
4. **Create persona documents** combining Section 3 + 4
5. **Train sales on psychology** (how to connect emotionally)
6. **Build Section 5** (Pain & Motivations) next

---

## 📞 Common Questions

**Q: Why are textarea minimums so long (100+ chars)?**  
A: Psychological profiling needs depth. Short answers yield generic outputs. 2-3 detailed sentences produce actionable insights.

**Q: What if they don't know customer psychology well?**  
A: Encourage them to interview 3-5 best customers first, or use their own psychology if they're building for themselves.

**Q: Can they select "Depends on the situation" for changeAttitude?**  
A: Yes, it's an option. Output will note situational variance and suggest both early/late messaging approaches.

**Q: What if values conflict (e.g., Speed + Quality)?**  
A: Output's "tradeoffs" section addresses this explicitly ("Will sacrifice X for Y in Z situations").

**Q: How do language patterns feed Section 9?**  
A: The exact phrases become email subject lines, opening hooks, and body copy. This ensures messaging resonates authentically.

---

## 🎓 Training for Sales/Marketing

Share this output to:

1. **Understand buyer psychology** - What drives decisions
2. **Use customer language** - Speak their words, not yours
3. **Address fears proactively** - Overcome objections before they arise
4. **Align with values** - Emphasize what matters most to them
5. **Match change readiness** - Adjust sales approach to adoption curve

---

**Implementation complete! Section 4 is ready to deploy.** 🚀

**Next:** Build Section 5 (Pain Points & Motivations) to add specific pain quantification to psychological profiling.
