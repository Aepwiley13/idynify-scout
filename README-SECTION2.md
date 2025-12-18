# Section 2: Product/Service Deep Dive - Implementation Guide

## 📦 Files Included

1. **Section2ProductDeepDive.jsx** - React component
2. **generate-section-2.js** - Netlify serverless function
3. **module-2-product-deep-dive.json** - Complete specification (questionnaire + schema + example)

---

## 🚀 Installation Steps

### 1. React Component Setup

**Location:** `/src/components/recon/Section2ProductDeepDive.jsx`

```bash
# Copy the file to your project
cp Section2ProductDeepDive.jsx /path/to/your/project/src/components/recon/
```

**Dependencies Required:**
- `react` & `react-router-dom`
- Firebase (`firebase/firestore`, `firebase/auth`)

Already imported in the component - no additional packages needed.

---

### 2. Netlify Function Setup

**Location:** `/.netlify/functions/generate-section-2.js`

```bash
# Copy the file to your Netlify functions directory
cp generate-section-2.js /path/to/your/project/.netlify/functions/
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
  
  // Section 2 Data
  section2Answers: {
    productName: "string",
    category: "string",
    coreFeatures: ["string", "string", "string", "string", "string"],
    differentiation: "string",
    useCases: ["string", "string", ...],
    implementationTime: "string",
    supportLevel: "string",
    pricingModel: "string",
    startingPrice: "string",
    techStack: "string",
    integrations: ["string", "string", ...],
    lastSaved: timestamp
  },
  
  section2Output: {
    section: 2,
    title: "Product/Service Deep Dive",
    status: "completed",
    completedAt: timestamp,
    version: 1,
    productIntelligence: { /* full schema */ },
    rawAnswers: { /* all answers */ },
    metadata: { /* generation stats */ }
  },
  
  reconProgress: {
    section2Completed: true,
    section2LastSaved: timestamp,
    lastUpdated: timestamp
  }
}
```

---

## 🔧 Integration with Your App

### Add Route

In your `App.jsx` or routing file:

```javascript
import Section2ProductDeepDive from './components/recon/Section2ProductDeepDive';

// Add route
<Route path="/recon/section-2" element={<Section2ProductDeepDive />} />
```

### Add to Navigation

```javascript
// From Section 1
<button onClick={() => navigate('/recon/section-2')}>
  Next: Product Deep Dive →
</button>

// From Section 3
<button onClick={() => navigate('/recon/section-2')}>
  ← Back to Product Deep Dive
</button>
```

---

## 🧪 Testing Checklist

### Component Tests

- [ ] All 11 questions render correctly
- [ ] Text inputs have character counters
- [ ] Dropdown/radio selections work
- [ ] Multi-text inputs (5 features, 5 integrations) work
- [ ] Multi-select (use cases) enforces 2-4 selections
- [ ] Validation shows errors for:
  - Missing required fields
  - Character length violations (min/max)
  - Invalid pricing format (must start with $)
  - Too few use cases (< 2)
- [ ] Auto-save triggers every 30 seconds
- [ ] Manual save works on Generate button
- [ ] Loading states show during generation
- [ ] Output displays correctly after generation
- [ ] Edit button returns to questions
- [ ] Data persists on page refresh

### API Tests

```bash
# Test the Netlify function locally
curl -X POST http://localhost:8888/.netlify/functions/generate-section-2 \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test123",
    "answers": {
      "productName": "Test Product",
      "category": "Software (SaaS, on-premise, mobile app)",
      "coreFeatures": ["Feature 1 with at least 30 chars", "Feature 2 with at least 30 chars", "Feature 3 with at least 30 chars", "Feature 4 with at least 30 chars", "Feature 5 with at least 30 chars"],
      "differentiation": "We are different because we have unique AI technology that no one else has and our customers love it because it saves them tons of time and money",
      "useCases": ["Lead nurturing", "Sales enablement"],
      "implementationTime": "1-4 weeks",
      "supportLevel": "Moderate (onboarding call)",
      "pricingModel": "Tiered pricing",
      "startingPrice": "$499/month",
      "techStack": "They typically use Salesforce for CRM, HubSpot for marketing automation, Slack for team communication, and LinkedIn Sales Navigator for prospecting",
      "integrations": ["Salesforce", "HubSpot", "LinkedIn", "", ""]
    }
  }'
```

Expected response:
- Status: 200
- `success: true`
- `output` contains complete JSON schema
- Generation time < 10 seconds
- Tokens used ~2000-3000

### Error Handling Tests

- [ ] Missing required field returns helpful error
- [ ] Invalid userId returns 401/403
- [ ] Claude API timeout handled gracefully
- [ ] Firestore save failure doesn't crash request
- [ ] Invalid JSON from Claude is caught

---

## 📱 Mobile Responsiveness

Component is responsive by default using Tailwind:
- Questions stack vertically on mobile
- Multi-select grid becomes 1 column on mobile
- Buttons adjust size on smaller screens

Test on:
- [ ] iPhone (375px width)
- [ ] iPad (768px width)
- [ ] Desktop (1280px+ width)

---

## 🎨 Styling Notes

**Color Palette (Cyberpunk/Tech):**
- Background: `bg-black`
- Primary: `text-cyan-400`, `border-cyan-500`
- Secondary: `text-gray-300`, `text-gray-400`
- Accents: `bg-cyan-950/50`, `bg-cyan-950/30`
- Errors: `text-red-400`, `border-red-500`
- Success: `text-green-400`

**Typography:**
- Headings: `font-mono font-bold`
- Body: `font-sans`
- Inputs: `font-mono`

**Animations:**
- Hover effects on buttons (scale, color transition)
- Focus rings on inputs (cyan glow)
- Loading spinner during generation

---

## 🐛 Troubleshooting

### Issue: "Generation failed: 500"

**Check:**
1. Is `ANTHROPIC_API_KEY` set in Netlify environment variables?
2. Is the API key valid? (starts with `sk-ant-`)
3. Check Netlify function logs for exact error

**Fix:**
```bash
# Verify env var
netlify env:list

# Set if missing
netlify env:set ANTHROPIC_API_KEY sk-ant-your-key-here
```

---

### Issue: "Validation error: Must be at least 30 characters"

**Cause:** Core features require 30+ characters each

**Fix:** Guide users with better placeholder text:
```javascript
placeholder: "e.g., Email campaign builder with drag-and-drop interface and 100+ templates"
```

---

### Issue: Auto-save not working

**Check:**
1. User is authenticated (`auth.currentUser` exists)
2. Firestore rules allow writes
3. Console for Firebase errors

**Debug:**
```javascript
// Add logging in saveAnswers function
console.log('Saving answers:', answers);
console.log('User:', auth.currentUser?.uid);
```

---

### Issue: Multi-select not enforcing max selections

**Check:** `maxSelections` prop is set in question definition

**Fix:** Already set to 4 in `SECTION_2_QUESTIONS`

---

## 📊 Expected Performance

**Generation Time:**
- Typical: 5-8 seconds
- Max acceptable: 10 seconds
- Tokens used: ~2000-3000

**Component Load:**
- Initial load: < 1 second
- Firestore fetch: < 500ms
- Re-render on input: < 100ms

---

## 🔄 Next Steps After Implementation

1. Test with real users
2. Monitor generation success rate (target: >95%)
3. Collect feedback on question clarity
4. Track completion rate (target: >85%)
5. Optimize prompts if output quality varies
6. Add Section 3 (Firmographics) next

---

## 📞 Support

**Common Questions:**

**Q: Can users skip optional fields (integrations)?**  
A: Yes, `integrations` is `required: false`. Empty strings are fine.

**Q: What if they have more than 5 features?**  
A: They can only enter 5. Prompt says "top 5" to help prioritize.

**Q: Can they change answers after generation?**  
A: Yes, "Edit Answers" button returns to form. Re-generating creates new version.

**Q: Does this work offline?**  
A: No, requires internet for Firestore saves and Claude API calls.

---

## ✅ Success Criteria

Before marking Section 2 as complete:

- [ ] All questions render and validate correctly
- [ ] Auto-save works every 30 seconds
- [ ] Generation completes in < 10 seconds
- [ ] Output matches JSON schema exactly
- [ ] Edit functionality works
- [ ] Data persists across sessions
- [ ] Mobile responsive
- [ ] No console errors
- [ ] Firestore updates correctly
- [ ] Navigation to Section 3 works

---

**Implementation complete! Ready to deploy Section 2.** 🚀
