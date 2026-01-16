# 🎯 HUNTER MODULE - Comprehensive Analysis & Design

## 📋 Executive Summary

**Current Status**: Hunter is locked and shown as "COMING SOON" in Mission Control V2

**Purpose**: Automated outreach campaigns (as displayed in UI)

**Position in Flow**: Hunter is the 3rd module after Scout (lead discovery) and Recon (AI training)

---

## 🔍 Current State Analysis

### ✅ **SCOUT Module** (Active & Complete)

**Location**: `/scout`

**Tabs**:
1. **Daily Leads** - Fresh recommended companies daily
2. **Saved Companies** - User's accepted companies
3. **All Leads** - All saved contacts
4. **Total Market** - Browse entire market
5. **ICP Settings** - Define ideal customer profile

**Key Features**:
- ✅ Company discovery via Apollo API
- ✅ ICP-based matching and scoring
- ✅ Contact search and enrichment
- ✅ Manual contact addition (3 methods):
  - Manual Entry
  - Business Card Scan (OCR)
  - Find Contact (Apollo search with Barry AI)
- ✅ Contact management:
  - View/Edit contacts
  - Save to Phone (vCard export)
  - Enrich Contact (missing data)
- ✅ Company management:
  - Save companies
  - View company details
  - Search for decision makers
  - Accept/Reject workflow

**Data Collected**:
- Companies: `/users/{uid}/companies`
- Contacts: `/users/{uid}/contacts`
- Each contact has: name, email, phone, title, company, LinkedIn, source, status

**Scout Output**: Qualified contacts ready for outreach

---

### ✅ **RECON Module** (Active & Optional)

**Location**: `/mission-control-v2/recon`

**Purpose**: Train Barry AI Assistant with deep company knowledge

**10 Sections**:
1. **Foundation** - Company basics, mission, values
2. **Product Deep Dive** - Features, pricing, positioning
3. **Target Market Firmographics** - Industries, size, location
4. **Ideal Customer Psychographics** - Behaviors, motivations
5. **Pain Points & Motivations** - What drives customers
6. **Buying Behavior & Triggers** - When they buy, why they buy
7. **Decision Process** - Who decides, how long it takes
8. **Competitive Landscape** - Competitors, alternatives
9. **Messaging** - Value props, positioning statements
10. **Behavioral Signals** - Intent signals, engagement patterns

**Key Features**:
- ✅ Questionnaire-based input
- ✅ AI-powered output generation
- ✅ Editable outputs
- ✅ Progress tracking (0-100%)
- ✅ Optional (can skip and still use Scout)

**RECON Output**: Rich company context for AI-powered personalization

---

## 🎯 **HUNTER Module** (Locked - Design Needed)

### Based on Mission Control Description:
> "Automated outreach campaigns"

### Based on Phase5CampaignBuilder Code Analysis:

The existing `Phase5CampaignBuilder.jsx` component shows the original campaign intent:

**Campaign Types**:
- Email campaigns
- LinkedIn message campaigns

**Campaign Structure** (from code):
```javascript
{
  contactId: {
    type: 'email', // or 'linkedin'
    sequences: [
      { subject: 'Email 1 subject', body: 'Email 1 body' },
      { subject: 'Email 2 subject', body: 'Email 2 body' },
      { subject: 'Email 3 subject', body: 'Email 3 body' }
    ]
  }
}
```

**Key Features Found in Code**:
- Select contacts from Scout
- Auto-select top 10 ranked contacts
- Generate personalized campaigns via AI (barry-phase5-campaign function)
- Export to CSV
- Save to Firebase

---

## 🚀 **HUNTER Module - Proposed Design**

### **Module Purpose**
Transform qualified Scout contacts into active outreach campaigns with AI-powered personalization using RECON data.

### **User Flow**

```
Scout Contacts → Hunter Campaign Builder → Active Campaigns → Track Results
     ↓                      ↓                      ↓                ↓
  Qualified           AI Generates           Automated         Response
   Contacts           Sequences              Sending           Tracking
```

### **Core Features**

#### 1. **Campaign Builder**
- Select contacts from Scout (All Leads)
- Choose campaign type:
  - 📧 Email Sequence
  - 💼 LinkedIn Sequence
  - 🔄 Multi-Channel (Email + LinkedIn)
- Set sequence timing (days between messages)
- Review/edit AI-generated messages

#### 2. **AI Message Generation**
**Inputs**:
- Contact data (from Scout)
- Company data (from Scout)
- RECON context (if available)
- Campaign type

**Barry AI generates**:
- Personalized subject lines
- Email/message bodies
- Follow-up sequences (3-5 touches)
- Tailored value propositions

**Example Prompt Structure**:
```
Contact: {name}, {title} at {company}
RECON Context: {pain_points}, {value_props}, {messaging}
Generate a 3-email sequence to introduce our product
```

#### 3. **Campaign Dashboard**

**Views**:
- **Active Campaigns** - Currently running
- **Scheduled** - Queued to start
- **Paused** - Temporarily stopped
- **Completed** - Finished sequences

**Metrics Per Campaign**:
- Contacts enrolled
- Messages sent
- Open rate (if trackable)
- Reply rate
- Meeting booked

#### 4. **Campaign Management**

**Actions**:
- ▶️ Start campaign
- ⏸️ Pause campaign
- ⏹️ Stop campaign
- ✏️ Edit sequence
- 👥 Add/remove contacts
- 📊 View analytics

#### 5. **Sequence Editor**

**For each message in sequence**:
- Subject line (email) / Opening line (LinkedIn)
- Message body
- Personalization tokens: `{{first_name}}`, `{{company}}`, `{{title}}`
- Timing: Days after previous message
- Preview with real contact data

#### 6. **Integration Requirements**

**Email Sending**:
- Option 1: User connects Gmail/Outlook via OAuth
- Option 2: SendGrid/Postmark API integration
- Option 3: Manual export (copy/paste into user's email)

**LinkedIn Sending**:
- LinkedIn API (if available)
- Chrome Extension approach
- Manual export (copy/paste into LinkedIn)

**Tracking**:
- Email: Open/click tracking pixels
- LinkedIn: Manual reply marking
- Meeting booking via Calendly/Google Calendar links

---

## 🎨 **UI/UX Design Considerations**

### **Mission Control Card**
```
┌─────────────────────────────────┐
│  🎯 HUNTER                      │
│  [ACTIVE]                        │
│                                  │
│  Active Campaigns: 3             │
│  Messages Sent: 47               │
│  Reply Rate: 8.5%                │
│                                  │
│  [Launch Campaign →]             │
└─────────────────────────────────┘
```

### **Hunter Main Page Tabs**
1. **📊 Dashboard** - Overview, stats, recent activity
2. **🚀 Campaigns** - All campaigns, create new
3. **📝 Templates** - Saved message templates
4. **📈 Analytics** - Performance metrics
5. **⚙️ Settings** - Integrations, sending limits

### **Campaign Creation Flow**

**Step 1: Select Contacts**
- Import from Scout (All Leads)
- Filter by: company, title, tags, source
- Bulk select or individual
- Preview: 10 contacts selected

**Step 2: Choose Type & Timing**
- Campaign type: Email / LinkedIn / Multi-Channel
- Sequence length: 3-5 touches
- Timing: Days between messages (1, 2, 3, 5, 7 days)

**Step 3: Generate Messages**
- Barry generates personalized sequences
- Uses RECON data if available
- Shows loading: "Barry is crafting your messages..."
- Preview for 3 sample contacts

**Step 4: Review & Edit**
- Edit each message
- Test personalization tokens
- Preview with real contact data
- A/B test variants (optional)

**Step 5: Set Schedule**
- Start immediately or schedule
- Daily sending limits (10, 25, 50 per day)
- Sending window (9am-5pm local time)
- Pause on weekends (optional)

**Step 6: Launch**
- Final confirmation
- Campaign goes live
- Real-time status updates

---

## 🔄 **Integration with Existing Modules**

### **Scout → Hunter**
- Hunter pulls contacts from `/users/{uid}/contacts`
- Filter: Only enrolled contacts in campaigns
- Update contact status: `campaign_enrolled: true`
- Track: `campaigns: [{id, name, status, enrolled_at}]`

### **RECON → Hunter**
- Hunter uses RECON outputs for personalization
- If RECON incomplete: Use basic personalization
- If RECON complete: Deep personalization with pain points, value props, messaging

### **Hunter → Analytics**
- Track campaign performance
- Feed data back to Scout (lead scoring)
- Barry learns: Which messages get replies
- Improve future campaign generation

---

## 📊 **Data Schema**

### **Campaign Document** (`/users/{uid}/campaigns/{campaignId}`)
```javascript
{
  id: 'camp_123',
  name: 'Q1 2026 Outreach',
  type: 'email', // 'linkedin', 'multi-channel'
  status: 'active', // 'scheduled', 'paused', 'completed'
  created_at: '2026-01-14T...',
  started_at: '2026-01-15T...',

  // Contacts
  contact_ids: ['contact_1', 'contact_2', ...],
  enrolled_count: 25,

  // Sequence
  sequence: [
    {
      step: 1,
      delay_days: 0,
      subject: 'Quick question about {{company}}',
      body: 'Hi {{first_name}},\n\n...',
      personalization_tokens: ['first_name', 'company', 'title']
    },
    {
      step: 2,
      delay_days: 3,
      subject: 'Following up on my last email',
      body: '...'
    }
  ],

  // Settings
  daily_limit: 25,
  sending_window: { start: '09:00', end: '17:00' },
  skip_weekends: true,

  // Stats
  stats: {
    sent: 47,
    delivered: 45,
    opened: 18,
    clicked: 5,
    replied: 4,
    bounced: 2,
    unsubscribed: 0
  }
}
```

### **Campaign Enrollment** (`/users/{uid}/campaign_enrollments/{enrollmentId}`)
```javascript
{
  id: 'enroll_123',
  campaign_id: 'camp_123',
  contact_id: 'contact_1',
  enrolled_at: '2026-01-15T...',

  current_step: 2,
  status: 'active', // 'paused', 'completed', 'unsubscribed', 'bounced'

  sequence_progress: [
    {
      step: 1,
      sent_at: '2026-01-15T09:30:00',
      delivered: true,
      opened: true,
      clicked: false,
      replied: false
    },
    {
      step: 2,
      scheduled_for: '2026-01-18T10:00:00',
      sent_at: null
    }
  ]
}
```

---

## ⚠️ **Critical Decisions Needed**

### 1. **Sending Method**
**Options**:
- A) **Manual Export** - Generate messages, user copies to Gmail/LinkedIn (Simple, no permissions)
- B) **Email Integration** - OAuth connect to Gmail/Outlook (Complex, requires permissions)
- C) **API Service** - SendGrid/Postmark for transactional emails (Costs, deliverability)
- D) **Chrome Extension** - Automated sending via browser extension (Medium complexity)

**Recommendation**: Start with A (Manual Export), add B (Email Integration) later

### 2. **Personalization Level**
**Options**:
- A) **Basic** - Name, company, title only
- B) **RECON-Enhanced** - Use pain points, value props from RECON
- C) **Deep Research** - Web scraping, news, LinkedIn posts (expensive)

**Recommendation**: B (RECON-Enhanced), shows value of completing RECON

### 3. **Sending Limits**
**Options**:
- A) **Unlimited** - User manages their own limits
- B) **Tiered** - 10/day free, 50/day pro, 200/day enterprise
- C) **Per-Campaign** - User sets limit per campaign

**Recommendation**: C (Per-Campaign), gives user control

### 4. **Reply Tracking**
**Options**:
- A) **Manual** - User marks replies manually
- B) **Email Parsing** - Connect Gmail, auto-detect replies
- C) **No Tracking** - Just send, don't track responses

**Recommendation**: A (Manual) for MVP, B (Email Parsing) later

### 5. **Barry AI Role**
**Options**:
- A) **Message Generator** - Creates sequences, user edits
- B) **Assistant** - Suggests improvements, user writes
- C) **Analyzer** - Reviews messages, gives feedback

**Recommendation**: A (Message Generator), aligns with RECON's AI outputs

---

## 🛠️ **Technical Requirements**

### **New Files Needed**
```
src/pages/Hunter/
  ├── HunterMain.jsx           # Main page with tabs
  ├── Dashboard.jsx            # Overview tab
  ├── Campaigns.jsx            # Campaign list
  ├── CampaignBuilder.jsx      # Create/edit campaign
  ├── Templates.jsx            # Saved templates
  ├── Analytics.jsx            # Performance metrics
  └── Settings.jsx             # Integrations, limits

src/components/hunter/
  ├── ContactSelector.jsx      # Pick contacts from Scout
  ├── SequenceEditor.jsx       # Edit message sequence
  ├── MessagePreview.jsx       # Preview with real data
  ├── CampaignCard.jsx         # Campaign summary card
  ├── StatsWidget.jsx          # Metrics display
  └── EnrollmentTable.jsx      # Contact enrollment status

netlify/functions/
  ├── generateCampaign.js      # Barry generates sequences
  ├── saveCampaign.js          # Save to Firestore
  ├── startCampaign.js         # Activate campaign
  ├── sendMessage.js           # Send individual message (if API)
  └── trackEngagement.js       # Track opens/clicks
```

### **Firestore Collections**
```
/users/{uid}/campaigns/           # Campaign definitions
/users/{uid}/campaign_enrollments/ # Contact enrollments
/users/{uid}/campaign_templates/   # Saved templates
/users/{uid}/campaign_analytics/   # Aggregated stats
```

### **API Integrations**
- Apollo API (already integrated)
- Claude API (already integrated for Barry)
- Gmail API (if email integration)
- LinkedIn API (if LinkedIn integration)
- SendGrid/Postmark (if transactional email)

---

## 📝 **MVP Feature Set (Hunter v1.0)**

### **Must Have**
✅ Create campaign from Scout contacts
✅ Select 3-5 message sequence
✅ AI generate messages using Barry
✅ Edit/customize messages
✅ Manual export (copy to Gmail/LinkedIn)
✅ Campaign dashboard (active, paused, completed)
✅ Basic stats (enrolled, sent manually)
✅ Contact enrollment tracking

### **Should Have** (Post-MVP)
- Email integration (Gmail OAuth)
- Automated sending
- Open/click tracking
- Reply detection
- A/B testing
- Template library

### **Could Have** (Future)
- LinkedIn automation
- Multi-channel sequences
- Advanced analytics
- CRM sync
- Meeting booking integration

---

## 🎯 **Success Metrics**

### **User Adoption**
- % of Scout users who unlock Hunter
- % of Scout contacts enrolled in campaigns
- Average contacts per campaign

### **Engagement**
- Campaigns created per week
- Messages generated per campaign
- Manual sends tracked (if we can measure)

### **Effectiveness**
- Reply rate (if we can track)
- Meeting booked rate
- User-reported success stories

---

## 🚦 **Unlock Criteria**

**When should Hunter unlock?**

**Option A: Automatic**
- User has 10+ contacts in Scout
- RECON completion ≥ 30%
- User has been active for 7+ days

**Option B: Manual**
- User clicks "Unlock Hunter" button
- Shows what Hunter does
- Requires email confirmation or quick setup

**Option C: Paywall**
- Hunter is premium feature
- Requires upgrade to Pro plan
- Free trial: 1 campaign, 10 contacts

**Recommendation**: Option A (Automatic) - rewards Scout usage

---

## 📧 **Example Campaign Flow**

### **Scenario**: User has 25 qualified contacts from Scout, RECON is 80% complete

**Step 1: Click "Launch Campaign" in Hunter**
- Hunter opens with empty state
- CTA: "Create Your First Campaign"

**Step 2: Campaign Builder**
- Name: "Q1 2026 SaaS Outreach"
- Type: Email Sequence
- Contacts: Import 25 from Scout (filtered: SaaS companies)

**Step 3: Barry Generates Sequence**
```
Message 1 (Day 0):
Subject: Quick question about scaling {{company}}'s sales
Body:
Hi {{first_name}},

I noticed {{company}} is growing fast in the SaaS space.
Most companies at your stage struggle with [pain point from RECON].

We help [value prop from RECON]. Would you be open to a
quick 15-min call next week?

Best,
[Your Name]
```

**Step 4: Review & Edit**
- User tweaks wording
- Tests personalization with real contacts
- Approves sequence

**Step 5: Launch**
- Campaign status: Active
- Manual export: Generate 25 emails
- User copies to Gmail, sends throughout the week
- Marks replies in Hunter dashboard

**Step 6: Track Results**
- 25 sent
- 4 replies (16% reply rate)
- 2 meetings booked
- Barry learns: This message style works!

---

## 🎓 **User Education**

### **Onboarding Flow**
1. Welcome to Hunter video (60 seconds)
2. "Your First Campaign" tutorial
3. Best practices guide
4. Template library tour

### **In-App Guidance**
- Barry tips: "Try mentioning their recent funding round"
- Example campaigns: Show successful templates
- Tooltips: Explain each setting
- Preview mode: See before you send

### **Documentation**
- Hunter user guide
- Campaign best practices
- Message writing tips
- Troubleshooting FAQ

---

## ✅ **Recommendation: Next Steps**

### **Phase 1: Design Review** (This Document)
1. Review this analysis
2. Decide on critical questions (sending method, limits, tracking)
3. Sketch UI/UX wireframes
4. Define MVP scope

### **Phase 2: Technical Planning**
1. Design database schema
2. Plan API endpoints
3. Estimate development time
4. Set up feature flags

### **Phase 3: Development** (Recommended Order)
1. Campaign data models (Firestore)
2. Campaign Builder UI
3. Barry message generation (Netlify function)
4. Manual export (CSV/clipboard)
5. Campaign dashboard
6. Enrollment tracking
7. Basic analytics

### **Phase 4: Testing & Launch**
1. Internal testing with real campaigns
2. Beta users (5-10 customers)
3. Gather feedback
4. Polish UI
5. Public launch

---

## 💡 **Key Differentiators**

**What makes Hunter unique?**
1. **Barry AI** - Personalized message generation using RECON
2. **Learn from Scout** - Seamless contact import
3. **No complex integrations** - Manual export works out of the box
4. **Transparent metrics** - Clear success tracking
5. **Space theme** - Fun, engaging UX vs. boring CRM tools

---

## 📅 **Timeline Estimate**

**Assuming MVP scope (manual export only)**:
- Data models & API: 2 days
- Campaign Builder UI: 3 days
- Barry message generation: 2 days
- Dashboard & analytics: 2 days
- Testing & polish: 2 days
- **Total: ~11 days** (with existing Barry/Scout infrastructure)

**With email integration**:
- Add OAuth flow: +3 days
- Add automated sending: +2 days
- Add tracking: +2 days
- **Total: ~18 days**

---

**Document prepared for review before Hunter development begins.**
**All decisions above are recommendations - final choices are yours!**
