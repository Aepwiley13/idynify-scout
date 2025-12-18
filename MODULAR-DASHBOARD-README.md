# Modular Dashboard System (V2)

## Overview

The new modular dashboard system allows users to complete RECON intelligence gathering **one section at a time**, preventing the context overflow issues that occurred when trying to process all questions at once.

## Architecture

### Key Components

1. **Dashboard State Schema** (`src/schemas/dashboardSchema.json`)
   - JSON definition of the entire dashboard structure
   - Defines modules (RECON, SCOUT, SNIPER)
   - Defines sections within each module
   - Tracks progress, status, timestamps, and versioning

2. **Mission Control Dashboard V2** (`src/pages/MissionControlDashboardV2.jsx`)
   - Main dashboard view after login/signup/payment
   - Shows overview of all modules
   - Displays RECON sections with progress tracking
   - Initializes dashboard state from schema on first visit

3. **RECON Module Page** (`src/pages/RECONModulePage.jsx`)
   - Detailed view of all 10 RECON sections
   - Shows completion status, locked/unlocked state
   - Allows navigation to individual sections
   - Displays "Generate Intelligence" CTA when all sections complete

4. **RECON Section Page** (`src/pages/RECONSectionPage.jsx`)
   - Individual section questionnaire view
   - Placeholder implementation (content to be added)
   - Save progress functionality
   - Complete section functionality
   - Automatically unlocks next section on completion

5. **Dashboard Utilities** (`src/utils/dashboardUtils.js`)
   - `updateSectionStatus()` - Update section status and unlock next
   - `saveSectionData()` - Save section responses
   - `startSection()` - Mark section as in-progress
   - `completeSection()` - Mark section as completed
   - `getDashboardState()` - Get current dashboard state
   - `getSectionData()` - Get specific section data
   - `addEditHistory()` - Track edits to section data

## Routes

### New V2 Routes
```
/mission-control-v2                          → Main dashboard
/mission-control-v2/recon                    → RECON module page
/mission-control-v2/recon/section/:sectionId → Individual section (1-10)
```

### Old Routes (Still Active)
```
/mission-control    → Old dashboard
/scout-questionnaire → Old questionnaire flow
/icp-validation     → ICP validation page
```

## RECON Sections

The RECON module has **10 sections**:

1. **Business Foundation** (5-7 min) - Core business information and objectives
2. **Target Market Definition** (6-8 min) - Industries, company sizes, market segments
3. **Decision Maker Profiles** (5-6 min) - Job titles, roles, buying authority
4. **Geographic Targeting** (3-4 min) - Location scope, states, cities, regions
5. **Competitive Landscape** (4-5 min) - Competitors, alternatives, positioning
6. **Perfect Fit & Anti-Profile** (5-6 min) - Ideal customers and companies to avoid
7. **Pain Points & Challenges** (6-8 min) - Customer problems, frustrations, needs
8. **Budget & Pricing Intelligence** (4-5 min) - Pricing tiers, budget ranges
9. **Messaging & Value Proposition** (7-9 min) - Core messaging, positioning
10. **Behavioral & Timing Signals** (5-7 min) - Buying triggers, timing, engagement

**Total Estimated Time:** 50-65 minutes

## Data Flow

### 1. User First Visit
```
User logs in → Dashboard initializes from schema → Firestore `/dashboards/{userId}` created
```

### 2. Starting a Section
```
User clicks "Start Section" → Section status: "in_progress" → Navigate to section page
```

### 3. Completing a Section
```
User completes questions → Clicks "Complete Section" → Data saved → Next section unlocked → Return to RECON page
```

### 4. Progression
```
Complete Section 1 → Section 2 unlocks
Complete Section 2 → Section 3 unlocks
...
Complete Section 10 → "Generate Intelligence" button appears
```

### 5. Generate Intelligence
```
All sections complete → Click "Generate Intelligence" → Netlify functions called one at a time → ICP Brief, Strategy, TAM, Action Plan generated
```

## Firestore Schema

### Dashboard Document
```
/dashboards/{userId}
{
  version: "1.0.0",
  userId: "string",
  createdAt: "ISO 8601",
  lastUpdatedAt: "ISO 8601",
  currentModule: "recon",
  modules: [
    {
      id: "recon",
      status: "in-progress",
      completedSections: 0,
      progressPercentage: 0,
      sections: [
        {
          sectionId: 1,
          title: "Business Foundation",
          status: "not_started" | "in_progress" | "completed",
          unlocked: true,
          data: {...}, // Section responses
          metadata: {
            generationTime: null,
            model: null,
            tokensUsed: null,
            editHistory: []
          }
        },
        ...
      ]
    }
  ],
  progressTracking: {
    overallProgress: 0,
    milestones: [...]
  }
}
```

## Next Steps

### Phase 1: Section Content Implementation
- Build actual questionnaire content for each section
- Replace placeholder forms with real questions
- Implement conditional logic and validation

### Phase 2: Intelligence Generation
- Integrate section data with Netlify functions
- Generate ICP Brief from completed sections
- Generate Strategy, TAM, and Action Plans

### Phase 3: UX Enhancements
- Add section previews
- Implement autosave
- Add progress indicators
- Build section navigation breadcrumbs

### Phase 4: Analytics & Optimization
- Track time spent per section
- Identify drop-off points
- A/B test question formats

## Testing

### To Test the New System:

1. Navigate to `/mission-control-v2`
2. Click on "RECON" module
3. Click "Start Section" on Section 1
4. Fill out placeholder questions
5. Click "Complete Section"
6. Verify Section 2 unlocks
7. Repeat for all sections
8. Verify "Generate Intelligence" button appears after Section 10

### To Reset Dashboard State:

Delete the dashboard document from Firestore:
```javascript
// In Firebase Console
/dashboards/{userId} → Delete Document
```

On next visit, dashboard will reinitialize from schema.

## Benefits of Modular Approach

✅ **No Context Overflow** - Each section generates small outputs (~500-1000 tokens)
✅ **Better UX** - Users see progress incrementally
✅ **Flexible** - Can add/remove sections without breaking flow
✅ **Resumable** - Users can save and return later
✅ **Trackable** - Clear analytics on completion rates
✅ **Scalable** - Easy to add new modules (SCOUT, SNIPER)

## Migration Path

Old users on `/mission-control` → Gradual migration to `/mission-control-v2`
New users → Start directly on `/mission-control-v2`

## Notes

- The old dashboard (`/mission-control`) remains active for backwards compatibility
- All new development should use the V2 system
- Section content is currently placeholder - needs implementation
- Dashboard state persists in Firestore for easy recovery
