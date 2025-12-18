# Section 1: Company Identity & Foundation - Documentation

## Overview

Section 1 is the first module of the RECON ICP Questionnaire system. It collects foundational information about the company and generates an Executive Summary with ICP insights.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    RECONSectionPage.jsx                     │
│  (Main container - handles routing and section selection)  │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ When sectionId === 1
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              Section1Foundation.jsx                         │
│  • Renders 10 questions                                     │
│  • Validates input                                          │
│  • Auto-saves every 30 seconds                              │
│  • Calls Netlify function for generation                    │
│  • Displays output                                          │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ On "Generate" button click
                   ▼
┌─────────────────────────────────────────────────────────────┐
│       /.netlify/functions/generate-section-1.js             │
│  • Validates answers                                        │
│  • Calls Claude API                                         │
│  • Parses JSON response                                     │
│  • Saves to Firestore                                       │
│  • Returns Executive Summary                                │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ Saves to
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Firestore Database                       │
│  users/{userId}                                             │
│  ├── section1Answers (object)                               │
│  ├── section1Output (object)                                │
│  └── reconProgress (object)                                 │
└─────────────────────────────────────────────────────────────┘
```

## Files

### 1. Component Files

#### `/src/components/recon/Section1Foundation.jsx`
React component that renders the Section 1 questionnaire.

**Features:**
- ✅ 10 questions (text, textarea, dropdown, radio)
- ✅ Real-time validation
- ✅ Character counters
- ✅ Auto-save every 30 seconds
- ✅ Progress indicator (X/10 questions)
- ✅ Generate Executive Summary button
- ✅ Output display with formatted sections
- ✅ Edit & Re-generate functionality

**Props:**
```jsx
<Section1Foundation
  initialData={object}    // Initial answers (optional)
  onSave={function}       // Callback when answers are saved
  onComplete={function}   // Callback when section is completed
/>
```

#### `/src/pages/RECONSectionPage.jsx`
Main section page that routes to Section1Foundation when `sectionId === 1`.

### 2. Backend Files

#### `/.netlify/functions/generate-section-1.js`
Netlify serverless function that generates Executive Summary using Claude API.

**Request Format:**
```json
{
  "answers": {
    "companyName": "string",
    "whatYouDo": "string",
    "industry": "string",
    "stage": "string",
    "role": "string",
    "mainProduct": "string",
    "problemSolved": "string",
    "currentCustomers": "string",
    "ninetyDayGoal": "string",
    "biggestChallenge": "string"
  },
  "userId": "string"
}
```

**Response Format:**
```json
{
  "success": true,
  "output": {
    "section": 1,
    "title": "Company Identity & Foundation",
    "status": "completed",
    "completedAt": "2025-12-18T10:30:00Z",
    "version": 1,
    "executiveSummary": {
      "companyOverview": { ... },
      "coreOffering": { ... },
      "currentState": { ... },
      "idealCustomerGlance": "string",
      "perfectFitIndicators": ["string", ...],
      "antiProfile": ["string", ...],
      "keyInsight": "string"
    },
    "rawAnswers": { ... },
    "metadata": {
      "generationTime": 7.2,
      "model": "claude-sonnet-4-20250514",
      "tokensUsed": 1847,
      "editHistory": []
    }
  },
  "metadata": {
    "generationTime": 7.2,
    "tokensUsed": 1847
  }
}
```

### 3. Database Schema

#### `/src/firebase/schema.js`
Updated with Section 1 schema documentation.

**section1Answers:**
```javascript
{
  companyName: "Acme Corp",
  whatYouDo: "We help B2B SaaS companies...",
  industry: "Technology / SaaS",
  stage: "Growth stage ($1M-$10M revenue)",
  role: "Founder / CEO",
  mainProduct: "AI-powered lead generation platform...",
  problemSolved: "Customers were wasting 20+ hours per week...",
  currentCustomers: "Series A/B SaaS companies with 20-100 employees...",
  ninetyDayGoal: "Close 10 customers and hit $100K MRR",
  biggestChallenge: "6+ month sales cycle",
  lastSaved: Timestamp
}
```

**section1Output:**
```javascript
{
  section: 1,
  title: "Company Identity & Foundation",
  status: "completed",
  completedAt: "2025-12-18T10:30:00Z",
  version: 1,
  executiveSummary: {
    companyOverview: {
      name: "Acme Corp",
      industry: "Technology / SaaS",
      stage: "Growth stage",
      elevatorPitch: "We help B2B SaaS companies..."
    },
    coreOffering: {
      product: "AI-powered lead generation platform",
      problemSolved: "Manual lead generation taking 20+ hours/week",
      targetCustomer: "Series A/B SaaS companies, 20-100 employees"
    },
    currentState: {
      ninetyDayGoal: "Close 10 customers, hit $100K MRR",
      biggestChallenge: "6+ month sales cycle",
      implication: "Need to narrow targeting to reduce cycle time"
    },
    idealCustomerGlance: "Your ideal customer is...",
    perfectFitIndicators: [
      "Recently raised Series A or Series B funding",
      "Hiring for sales/marketing roles",
      "20-100 employees",
      "$2M-$10M annual revenue",
      "Using basic CRM but outgrowing it",
      "Active on LinkedIn"
    ],
    antiProfile: [
      "Pre-revenue startups",
      "Enterprise companies (500+ employees)",
      "B2C companies",
      "Companies with large sales teams (10+)"
    ],
    keyInsight: "Focus on Series A/B companies showing hiring signals..."
  },
  rawAnswers: { /* copy of section1Answers */ },
  metadata: {
    generationTime: 7.2,
    model: "claude-sonnet-4-20250514",
    tokensUsed: 1847,
    editHistory: []
  },
  generatedAt: Timestamp
}
```

**reconProgress:**
```javascript
{
  currentSection: 1,
  completedSections: [1],
  section1Completed: true,
  lastUpdated: Timestamp
}
```

## Environment Variables

Required environment variables in `.env`:

```bash
# Anthropic API
ANTHROPIC_API_KEY=sk-ant-...

# Firebase Admin (for Netlify functions)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## Setup Instructions

### 1. Install Dependencies

```bash
npm install @anthropic-ai/sdk
npm install firebase-admin
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory with the required variables above.

### 3. Deploy Netlify Function

```bash
# Test locally
netlify dev

# Deploy to production
netlify deploy --prod
```

### 4. Test the Component

1. Navigate to `/mission-control-v2`
2. Click on "RECON" module
3. Click on "Section 1: Business Foundation"
4. Fill out the questionnaire
5. Click "Generate Executive Summary"
6. View the output

## Usage

### Basic Usage

```jsx
import Section1Foundation from './components/recon/Section1Foundation';

function App() {
  return (
    <Section1Foundation />
  );
}
```

### Advanced Usage with Callbacks

```jsx
import Section1Foundation from './components/recon/Section1Foundation';

function App() {
  const handleSave = async (answers) => {
    console.log('Answers saved:', answers);
  };

  const handleComplete = async (answers) => {
    console.log('Section completed:', answers);
    // Navigate to next section
  };

  return (
    <Section1Foundation
      initialData={{ companyName: 'Acme Corp' }}
      onSave={handleSave}
      onComplete={handleComplete}
    />
  );
}
```

## Validation Rules

| Field | Type | Required | Min Length | Max Length |
|-------|------|----------|------------|------------|
| companyName | text | ✅ | 2 | 100 |
| whatYouDo | textarea | ✅ | 50 | 300 |
| industry | dropdown | ✅ | - | - |
| stage | radio | ✅ | - | - |
| role | dropdown | ✅ | - | - |
| mainProduct | textarea | ✅ | 50 | 200 |
| problemSolved | textarea | ✅ | 50 | 300 |
| currentCustomers | textarea | ✅ | 100 | 400 |
| ninetyDayGoal | textarea | ❌ | - | 300 |
| biggestChallenge | textarea | ❌ | - | 300 |

## Testing

### Manual Testing

1. **Validation Test:**
   - Try to generate without filling required fields → Should show error
   - Enter text shorter than minimum → Should show validation error
   - Enter text longer than maximum → Should show character count warning

2. **Auto-Save Test:**
   - Fill in some answers
   - Wait 30 seconds
   - Check Firestore → `section1Answers` should be saved
   - Refresh page → Answers should persist

3. **Generation Test:**
   - Fill all required fields
   - Click "Generate Executive Summary"
   - Wait for response (should be < 10 seconds)
   - Verify output displays correctly
   - Check Firestore → `section1Output` should be saved

4. **Edit Test:**
   - After generation, click "Edit Answers"
   - Modify some answers
   - Click "Generate" again
   - Verify new output is generated

### Expected Behavior

✅ **Successful Generation:**
- Takes 5-10 seconds
- Returns complete JSON output
- Saves to Firestore
- Displays formatted output
- Shows generation metadata (time, tokens)

❌ **Error Scenarios:**
- Missing required fields → Client-side validation error
- API timeout (>10s) → Error message with retry option
- Invalid API key → 500 error with message
- JSON parse error → Retry with better prompt

## Troubleshooting

### Issue: Auto-save not working

**Solution:**
- Check browser console for errors
- Verify Firebase config is correct
- Check that user is authenticated
- Verify Firestore rules allow writes

### Issue: Generation takes too long (>10s)

**Solution:**
- Check Netlify function logs
- Verify Anthropic API key is valid
- Check if Claude API is rate limiting
- Consider implementing streaming

### Issue: Output not displaying

**Solution:**
- Check browser console for JSON parse errors
- Verify response matches expected schema
- Check that `executiveSummary` field exists
- Validate all required fields are present

### Issue: Firestore save fails

**Solution:**
- Check Firestore rules
- Verify user is authenticated
- Check Firebase Admin credentials in Netlify
- Review Netlify function logs

## Performance

### Metrics

- **Component Load Time:** < 1 second
- **Auto-Save Interval:** 30 seconds
- **Generation Time:** 5-10 seconds (average 7.2s)
- **Token Usage:** 1,500-2,000 tokens per generation
- **Cost per Generation:** ~$0.05 (Sonnet 4)

### Optimization Tips

1. **Reduce Generation Time:**
   - Use streaming API (future enhancement)
   - Reduce max_tokens if output is too long
   - Cache common responses

2. **Reduce Token Usage:**
   - Optimize prompt (remove unnecessary examples)
   - Use smaller model for simple cases
   - Implement prompt caching

3. **Improve UX:**
   - Show progress indicator during generation
   - Display partial results as they come in (streaming)
   - Cache output to avoid re-generation

## Next Steps

### Future Enhancements

1. **Streaming Output:**
   - Implement Server-Sent Events (SSE)
   - Stream JSON fields as they're generated
   - Show real-time progress

2. **Edit History:**
   - Track all versions of output
   - Allow reverting to previous versions
   - Show diff between versions

3. **AI Suggestions:**
   - Auto-suggest answers based on industry
   - Pre-fill common responses
   - Validate answers for quality

4. **Export Options:**
   - Export as PDF
   - Export as CSV
   - Share via link

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Netlify function logs
3. Check browser console for client-side errors
4. Review Firebase/Firestore logs

## Version History

- **v1.0.0** (2025-12-18): Initial release
  - 10 questions with validation
  - Auto-save functionality
  - Claude API integration
  - Executive Summary generation
  - Output display
