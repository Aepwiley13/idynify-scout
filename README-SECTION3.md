# Section 3: Target Market Firmographics - Implementation Guide

## 📦 Files Included

1. **Section3TargetMarketFirmographics.jsx** - React component
2. **generate-section-3.js** - Netlify serverless function
3. **module-3-firmographics.json** - Complete specification (questionnaire + schema + example)

---

## 🚀 Installation Steps

### 1. React Component Setup

**Location:** `/src/components/recon/Section3TargetMarketFirmographics.jsx`

```bash
# Copy the file to your project
cp Section3TargetMarketFirmographics.jsx /path/to/your/project/src/components/recon/
```

**Dependencies Required:**
- `react` & `react-router-dom`
- Firebase (`firebase/firestore`, `firebase/auth`)

Already imported in the component - no additional packages needed.

---

### 2. Netlify Function Setup

**Location:** `/.netlify/functions/generate-section-3.js`

```bash
# Copy the file to your Netlify functions directory
cp generate-section-3.js /path/to/your/project/.netlify/functions/
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
  
  // Section 3 Data
  section3Answers: {
    companySize: ["11-50", "51-200"],
    revenueRange: ["$1M-$5M", "$5M-$20M"],
    growthStage: ["Series A-B", "Bootstrapped/Profitable"],
    geography: ["Nationwide (US)", "North America"],
    targetIndustries: ["Technology / SaaS", "Professional Services", "Marketing / Advertising"],
    avoidIndustries: "Government, Non-profit, Hospitality",
    companyType: "B2B",
    budgetRange: "$5K-$25K",
    decisionSpeed: "Fast (1-4 weeks)",
    marketSize: "10,000-50,000 companies",
    lastSaved: timestamp
  },
  
  section3Output: {
    section: 3,
    title: "Target Market Firmographics",
    status: "completed",
    completedAt: timestamp,
    version: 1,
    firmographicProfile: { /* full schema */ },
    rawAnswers: { /* all answers */ },
    metadata: { /* generation stats */ }
  },
  
  reconProgress: {
    section3Completed: true,
    section3LastSaved: timestamp,
    lastUpdated: timestamp
  }
}
```

---

## 🔧 Integration with Your App

### Add Route

In your `App.jsx` or routing file:

```javascript
import Section3TargetMarketFirmographics from './components/recon/Section3TargetMarketFirmographics';

// Add route
<Route path="/recon/section-3" element={<Section3TargetMarketFirmographics />} />
```

### Add to Navigation

```javascript
// From Section 2
<button onClick={() => navigate('/recon/section-3')}>
  Next: Firmographics →
</button>

// From Section 4
<button onClick={() => navigate('/recon/section-3')}>
  ← Back to Firmographics
</button>
```

---

## 🧪 Testing Checklist

### Component Tests

- [ ] All 10 questions render correctly
- [ ] Multi-select questions work:
  - [ ] Company Size (unlimited selections)
  - [ ] Revenue Range (unlimited selections)
  - [ ] Growth Stage (unlimited selections)
  - [ ] Geography (unlimited selections)
  - [ ] Target Industries (1-3 selections enforced)
- [ ] Single-select questions work:
  - [ ] Company Type (radio)
  - [ ] Budget Range (dropdown)
  - [ ] Decision Speed (radio)
  - [ ] Market Size (radio)
- [ ] Text input works (Industries to Avoid - optional)
- [ ] Validation shows errors for:
  - Missing required multi-selects
  - No industry selected (need 1-3)
  - Missing radio/dropdown selections
- [ ] Multi-select limits enforced (max 3 for industries)
- [ ] Selected items show checkmark (✓)
- [ ] Disabled state for max selections reached
- [ ] Auto-save triggers every 30 seconds
- [ ] Output displays all sections correctly
- [ ] TAM/SAM calculations show
- [ ] Scoring algorithm displays properly
- [ ] Edit button returns to questions
- [ ] Data persists on page refresh

### API Tests

```bash
# Test the Netlify function locally
curl -X POST http://localhost:8888/.netlify/functions/generate-section-3 \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test123",
    "answers": {
      "companySize": ["11-50", "51-200"],
      "revenueRange": ["$1M-$5M", "$5M-$20M"],
      "growthStage": ["Series A-B", "Bootstrapped/Profitable"],
      "geography": ["Nationwide (US)", "North America"],
      "targetIndustries": ["Technology / SaaS", "Professional Services", "Marketing / Advertising"],
      "avoidIndustries": "Government, Non-profit",
      "companyType": "B2B",
      "budgetRange": "$5K-$25K",
      "decisionSpeed": "Fast (1-4 weeks)",
      "marketSize": "10,000-50,000 companies"
    }
  }'
```

Expected response:
- Status: 200
- `success: true`
- `output` contains complete JSON schema
- `tamEstimate` is a number (e.g., 28500)
- `samEstimate` is a number (e.g., 8550)
- `firmographicScoring` has 5 criteria totaling 100 weight
- Generation time < 10 seconds
- Tokens used ~2500-3000

### Validation Tests

- [ ] Empty multi-select shows error
- [ ] 0 industries selected shows error
- [ ] 4+ industries cannot be selected
- [ ] Missing company type shows error
- [ ] Missing budget range shows error
- [ ] Missing decision speed shows error
- [ ] Missing market size shows error

---

## 📊 Key Features

### 1. Multi-Select with Visual Feedback

Questions like Company Size, Revenue Range, Geography allow multiple selections:
- ✅ Selected items highlighted in cyan
- ✅ Checkmark (✓) appears on selected items
- ✅ Disabled state when max reached (for Target Industries)
- ✅ Counter shows "Selected: X / Y max"

### 2. TAM/SAM Calculation

The Netlify function automatically calculates:
- **TAM (Total Addressable Market):** Based on firmographic filters
- **SAM (Serviceable Addressable Market):** Typically 30% of TAM
- **Methodology:** Explains calculation approach
- **Confidence Level:** High/Medium/Low based on specificity

Example calculation:
```
User estimate: "10,000-50,000 companies" → Midpoint: 30,000
Filters:
- B2B companies only (70%) = 21,000
- Target industries (80%) = 16,800
- Series A-B stage (50%) = 8,400
- Active hiring (40%) = 3,360

TAM = 28,500 companies (broad match)
SAM = 8,550 companies (serviceable)
```

### 3. Firmographic Scoring Algorithm

Generates lead scoring rules based on user selections:
- **Company Size:** 20% weight
- **Revenue:** 20% weight
- **Industry:** 25% weight (highest)
- **Growth Stage:** 20% weight
- **Geography:** 15% weight

Scoring scale:
- 90-100 = A+ (perfect fit, prioritize immediately)
- 75-89 = A (strong fit, high priority)
- 60-74 = B (good fit, pursue actively)
- 45-59 = C (acceptable fit, pursue if capacity)
- 30-44 = D (marginal fit, nurture only)
- 0-29 = F (poor fit, disqualify)

---

## 📱 Mobile Responsiveness

Component is responsive by default using Tailwind:
- Multi-select grid becomes 1 column on mobile
- Buttons stack vertically on smaller screens
- Radio options remain readable

Test on:
- [ ] iPhone (375px width)
- [ ] iPad (768px width)
- [ ] Desktop (1280px+ width)

---

## 🐛 Troubleshooting

### Issue: "At least one selection required"

**Cause:** User didn't select any options in multi-select

**Fix:** Ensure at least one option selected before generating

---

### Issue: "Cannot select more than 3 industries"

**Expected behavior:** Target Industries is limited to 3 selections max

**Fix:** User must deselect one before selecting another

---

### Issue: TAM/SAM calculations seem wrong

**Check:**
1. Is user's market size estimate realistic?
2. Are filters being applied correctly?
3. Review methodology in output

**Debug:** Check Netlify function logs for calculation details

---

### Issue: Scoring algorithm weights don't add to 100

**Validation:** Function validates totalWeight = 100

**Fix:** If error occurs, check prompt instructions in generate-section-3.js

---

### Issue: Budget alignment warning

**Cause:** Section 2 pricing doesn't match Section 3 budget range

**Expected:** This is intentional - helps identify pricing misalignment

**Example:** If Section 2 price is $499/mo ($6K/year) but budget range is "<$5K", output will flag this mismatch

---

## 🎯 Expected Performance

**Generation Time:**
- Typical: 6-9 seconds
- Max acceptable: 10 seconds
- Tokens used: ~2500-3000

**Component Load:**
- Initial load: < 1 second
- Firestore fetch: < 500ms
- Multi-select re-render: < 100ms

---

## 📊 Output Sections Generated

When a user completes Section 3, Claude generates:

```
📊 Firmographic Profile

✅ Company Size Parameters
   - Employee ranges (with primary range identified)
   - Revenue ranges (with primary range identified)
   - Detailed rationale for each

✅ Growth Stage Indicators
   - Target stages selected
   - Ideal stage identified
   - Stage rationale explained

✅ Geographic Targeting
   - Scope (local to global)
   - Regions covered
   - Market penetration strategy

✅ Industry Focus
   - Primary industries (1-3)
   - Industry rationale
   - Industries to avoid + why

✅ Company Type
   - Classification (B2B/B2C/etc)
   - Sales implications

✅ Budget Profile
   - Typical spend range
   - Alignment with Section 2 pricing
   - Budget cycle timing

✅ Decision Velocity
   - Speed (very fast to very slow)
   - Sales cycle implications
   - Urgency factors

✅ Market Size (CRITICAL)
   - User estimate
   - TAM calculation
   - SAM calculation
   - Confidence level
   - Methodology explained

✅ Firmographic Scoring Algorithm
   - 5 weighted criteria
   - Specific scoring rules for each
   - A+ to F grading scale
   - Usage guidance
```

---

## 🔗 Integration with Other Sections

### Feeds INTO:

**Scout Lead Generation:**
- Company size filters → Lead list criteria
- Revenue filters → Budget qualification
- Industry filters → Vertical targeting
- Geography → Location filtering
- Scoring algorithm → Lead prioritization

**Section 4 (Psychographics):**
- Growth stage → Change readiness expectations
- Decision speed → Urgency profile validation
- Company type → Buying behavior patterns

**Section 7 (Decision Process):**
- Company size → Complexity expectations
- Budget range → Approval process assumptions
- Decision speed → Sales cycle planning

### Feeds FROM:

**Section 2 (Product):**
- Pricing → Budget alignment check
- Tech stack → Company maturity inference
- Implementation time → Company size fit

---

## 💡 Pro Tips

### 1. Encourage Specific Selections

**Good:**
- Company Size: "11-50" and "51-200" (focused)
- Industries: 2-3 specific industries (targeted)

**Bad:**
- Company Size: All 6 options selected (too broad)
- Industries: "Other" only (not actionable)

### 2. Validate Budget Alignment

After Section 3, compare:
- Section 2 starting price: $499/month
- Section 3 budget range: $5K-$25K

If price is OUTSIDE budget range, flag for user review.

### 3. Use Scoring Algorithm

The generated scoring algorithm should be:
1. Exported to Scout for lead scoring
2. Used by sales team for prioritization
3. Updated as ICP evolves

### 4. TAM/SAM Sanity Check

If TAM > 100,000 companies:
- Market might be too broad
- Consider narrowing industry or geography
- Or accept broad market for scale play

If TAM < 500 companies:
- Market might be too narrow
- Risk of limited growth potential
- Validate with user

---

## ✅ Success Criteria

Before marking Section 3 as complete:

- [ ] All 10 questions answered
- [ ] At least 1 industry selected (max 3)
- [ ] Multi-select validation working
- [ ] TAM/SAM calculated correctly
- [ ] TAM is reasonable (500-100,000 range typical)
- [ ] Scoring algorithm has 5 criteria totaling 100%
- [ ] Budget alignment checked vs Section 2
- [ ] Output displays all sections
- [ ] Edit functionality works
- [ ] Data persists across sessions
- [ ] Mobile responsive
- [ ] No console errors
- [ ] Firestore updates correctly
- [ ] Navigation to Section 4 works

---

## 🔄 Next Steps After Implementation

1. **Test TAM calculations** with various market sizes
2. **Validate scoring algorithm** makes sense for your use case
3. **Export scoring rules** to Scout for lead prioritization
4. **Review budget alignment** with sales team
5. **Use firmographic filters** in lead generation
6. **Track conversion rates** by firmographic segment
7. **Build Section 4** (Psychographics) next

---

## 📞 Common Questions

**Q: Can users select all options in multi-select?**  
A: Yes for most multi-selects (company size, revenue, etc). Only Target Industries is limited to 3 max.

**Q: What if they select "Any stage" for growth stage?**  
A: This is allowed but reduces TAM calculation accuracy. Output will note confidence is "low".

**Q: How accurate are TAM/SAM calculations?**  
A: Medium confidence. Based on user estimate + industry filters. Not scientific but directionally correct.

**Q: What if budget range doesn't align with Section 2 pricing?**  
A: Output will flag this mismatch. Sales team should review pricing strategy or ICP targeting.

**Q: Can they skip "Industries to avoid"?**  
A: Yes, it's optional. Output will say "None specified" if blank.

**Q: Does the scoring algorithm actually score leads?**  
A: Not automatically. It provides scoring RULES that Scout or sales team implements.

---

## 🎓 Training for Sales Team

Share this output with sales to:

1. **Understand ICP criteria** - What makes a perfect fit
2. **Use scoring algorithm** - Prioritize leads correctly
3. **Know budget expectations** - Qualify on budget early
4. **Respect decision velocity** - Align sales cycle to their speed
5. **Target right industries** - Focus on high-fit verticals

---

**Implementation complete! Section 3 is ready to deploy.** 🚀

**Next:** Build Section 4 (Ideal Customer Psychographics) to add psychological profiling to firmographic data.
