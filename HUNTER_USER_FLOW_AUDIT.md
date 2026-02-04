# Hunter — Current State User Flow Audit

**Date:** February 4, 2026
**Auditor:** Engineering Team
**Status:** As-Built Documentation (Not Aspirational)

---

## 1. What Is Hunter Today?

Hunter is an AI-powered engagement system that helps users reach out to contacts they've saved in Scout. At its core, Hunter exists to solve one problem: **"I have a lead's information, now what do I say to them?"**

Hunter's value proposition is that users don't need to write cold outreach from scratch. They describe their intent in plain language—"I want to introduce myself and see if they need help with marketing automation"—and Barry (the AI) generates three personalized message options based on the contact's role, company, and whatever RECON training the user has completed.

**When Hunter feels useful:**
- When you have a contact with enriched data (title, company, industry) and you need a conversation starter
- When you've completed RECON training, so Barry can incorporate your company's pain points and messaging preferences
- When Gmail is connected and you want to send an email without leaving the app
- When you want quick, AI-generated outreach without the mental load of crafting messages from zero

**When Hunter falls apart:**
- When the contact has minimal data (just a name and email), Barry's output becomes generic
- When RECON training is incomplete—Barry warns about this but proceeds anyway, producing less personalized messages
- When you want to engage via SMS, LinkedIn, or phone—Hunter opens the native app but has no way to confirm the engagement actually happened
- When you expect the system to track the full lifecycle of an engagement—Hunter logs the attempt but doesn't know if you actually sent that text or LinkedIn message
- When you expect follow-up automation or sequences—Hunter doesn't do this today

---

## 2. Full User Flow Walkthrough

### Entry Point: Contact Profile Page

A user navigates to Scout → All Leads → clicks on a contact → lands on `ContactProfile.jsx`. In the top navigation bar, there's a purple button labeled **"Engage with Hunter"** with a target icon.

When clicked, this opens `HunterContactDrawer`, a slide-out panel that takes over the right side of the screen.

### Step 1: Barry's Question

The drawer opens to the **main view**. At the top, Barry (represented by a sparkle icon) asks:

> "What do you want to do with [FirstName]?"

Below this is a free-form text area where the user must describe their intent. This is required—the "Generate Messages" button is disabled until text is entered.

**Example input:** "I want to introduce myself and see if they're looking for help with their sales process"

Below the input, the user sees:
- Contact's email (or "No email" with an "Add" button)
- Contact's phone (or "No phone" with an "Add" button)
- How many missions this contact is in (if any)
- An "Add to Mission" button (if missions exist)

**Possible paths from here:**
1. User enters intent and clicks "Generate Messages" → proceeds to Step 2 or Step 2a
2. User clicks "Add" to enter missing email/phone → opens edit-info view
3. User clicks "Add to Mission" → opens add-mission view
4. User clicks X to close drawer → drawer closes, nothing saved

### Step 2a: Relationship Context (Conditional)

If the contact does NOT have an `engagementIntent` already saved, Barry asks:

> "How would you describe your relationship with [FirstName]?"

Four options appear:
- **Prospect** — "Someone new I want to connect with"
- **Warm / Existing** — "Someone I already know"
- **Customer** — "An existing customer"
- **Partner** — "A business partner or collaborator"

The user can select one (which gets saved to the contact record) or click "Skip this step" (defaults to Prospect).

**This view is skipped entirely** if the contact already has `engagementIntent` set from a previous interaction.

### Step 2b: Message Generation

After intent submission (and optional relationship context), the drawer switches to the **options view** and shows a loading state:

> "Barry is analyzing and crafting your messages..."
> "Using RECON data and contact intelligence"

Behind the scenes, the frontend calls `/.netlify/functions/generate-engagement-message` with:
- `userIntent` — the free-form text the user typed
- `engagementIntent` — prospect/warm/customer/partner
- `contactId` — the contact's ID
- `contact` — basic contact fields (name, title, company, etc.)
- `barryContext` — existing Barry analysis if cached

The backend function:
1. Verifies Firebase auth token
2. Loads full contact data from Firestore
3. Loads RECON data (Sections 5 & 9) for pain points and messaging preferences
4. Loads user profile for company context
5. Constructs a detailed prompt for Claude Sonnet 4.5
6. Requests 3 distinct message strategies: Direct & Short, Warm & Personal, Value-Led
7. Parses the JSON response and returns it

**On success:** Three message cards appear, each showing:
- Strategy label (e.g., "Direct & Short")
- Subject line
- Message body preview
- Reasoning (why this approach works)

**On failure:** An error message appears with a "Try Again" button. There are no fallback templates—if Claude fails, the user must retry.

### Step 3: Strategy Selection

The user clicks one of the three message cards. The selected message's subject and body are loaded into editable fields, and the drawer advances to the **weapon view**.

### Step 4: Weapon Selection

Barry's reasoning for the selected strategy appears at the top (if available). Below are the message fields (editable) and a grid of "weapons":

| Weapon | State | Badge |
|--------|-------|-------|
| Email | Enabled if contact has email | "Gmail" if connected, "Opens App" if not |
| Text | Always enabled | "Opens App" |
| LinkedIn | Enabled if contact has `linkedin_url` | "Opens LinkedIn" |
| Call | Enabled if contact has phone | "Opens Dialer" |

**Calendar is not shown in HunterContactDrawer** (it exists in `sendActionResolver.js` but isn't wired to the UI).

The user clicks a weapon to proceed.

### Step 5: Review & Send

The drawer shows a final review screen with:
- The weapon selected
- Recipient name
- A notice explaining what will happen (native handoff vs. real send)
- Editable subject and message fields
- Character count for SMS (shows SMS segment count)

**If email + Gmail connected:** Notice says "Gmail connected - email will be sent directly"
**If email + Gmail NOT connected:** Notice says "This will open your email app. Connect Gmail for direct sending."
**If text:** "This will open your SMS app to send manually."
**If LinkedIn:** "This will open LinkedIn. Message copied to clipboard."
**If call:** "This will open your phone dialer."

The send button label changes based on context:
- "Send Email" (Gmail connected)
- "Open Email Draft" (no Gmail)
- "Open Text Message"
- "Open LinkedIn"
- "Call Contact"

### Step 6: Execution

When the user clicks the send/open button, `executeSendAction()` in `sendActionResolver.js` runs:

**For Email with Gmail connected (Option A: Real Send):**
1. Calls `/.netlify/functions/gmail-send-quick`
2. Backend loads stored OAuth tokens from `users/{userId}/integrations/gmail`
3. Refreshes access token if expired
4. Constructs RFC 2822 email and sends via Gmail API
5. Returns `gmailMessageId` and `sentAt`
6. Logs to `email_logs` collection
7. Result: `SEND_RESULT.SENT`

**For Email without Gmail (Option B: Native Handoff):**
1. Constructs `mailto:` URL with encoded subject and body
2. Sets `window.location.href` to the mailto URL
3. Result: `SEND_RESULT.OPENED`

**For Text/SMS:**
1. Constructs `sms:` URL with phone (if available) and body
2. Sets `window.location.href` to the SMS URL
3. Result: `SEND_RESULT.OPENED`

**For LinkedIn:**
1. Opens `contact.linkedin_url` in new tab
2. Copies message body to clipboard (silently fails if clipboard unavailable)
3. Result: `SEND_RESULT.OPENED`

**For Call:**
1. Constructs `tel:` URL with phone
2. Sets `window.location.href` to the tel URL
3. Result: `SEND_RESULT.OPENED`

**After execution:**
- `logActivity()` writes to the contact's `activity_log` array with type like `email_sent`, `email_opened`, `text_opened`, `linkedin_opened`, `call_initiated`
- Sets `last_contacted` timestamp on contact
- Updates `engagementIntent` on contact record

### Step 7: Success View

The drawer shows a success screen based on the result:

| Result | Icon | Title | Description |
|--------|------|-------|-------------|
| `SENT` | Check | "Email Sent!" | "Your email to [Name] has been sent via Gmail." |
| `OPENED` | ExternalLink | Varies by weapon | "Email Draft Opened" / "SMS App Opened" / etc. |
| `FAILED` | AlertCircle | "Action Failed" | Error message |
| `UNAVAILABLE` | AlertCircle | "Action Unavailable" | Reason |

Actions available:
- "Send Another Message" — resets state and returns to main view
- "Add to Mission" — opens mission selection
- "Close" — closes drawer

---

## 3. Barry's Actual Behavior

### What Inputs Barry Receives

The `generate-engagement-message` function receives:

```javascript
{
  userId,
  authToken,
  contactId,
  userIntent,        // Free-form text (REQUIRED, PRIMARY DRIVER)
  engagementIntent,  // "prospect" | "warm" | "customer" | "partner"
  contact: {
    firstName, lastName, name, title, company_name,
    company_industry, seniority, email, phone, linkedin_url
  },
  barryContext       // Cached Barry analysis (optional)
}
```

Barry also loads from Firestore:
- Full contact record (more fields than passed from frontend)
- RECON Section 5: Pain points & motivations
- RECON Section 9: Messaging preferences (tone, length, CTAs)
- User profile (company name)

### What Logic/Services Are Involved

1. **Firebase Admin SDK** — token verification, Firestore reads
2. **Anthropic SDK** — Claude Sonnet 4.5 API call
3. **Prompt Engineering** — A detailed prompt (~300 lines) that includes:
   - User's goal verbatim
   - Contact information
   - Relationship context (tone guidance)
   - Existing Barry context (if cached)
   - RECON data (if available)
   - Style guidelines (no buzzwords, be conversational)

### What Outputs Are Generated

Barry returns exactly 3 message objects:

```javascript
{
  messages: [
    {
      strategy: "direct",
      label: "Direct & Short",
      subject: "Subject line (50 chars max)",
      message: "Full message body (3-6 sentences)",
      reasoning: "Why this approach works for [FirstName]"
    },
    { strategy: "warm", ... },
    { strategy: "value", ... }
  ],
  dataUsed: {
    contact: true,
    recon: true/false,
    barryContext: true/false
  }
}
```

### How Consistent Are Outputs?

**Barry is NOT deterministic.** Given the same inputs, Barry will generate different messages each time because:
- Claude has temperature/randomness by default
- The prompt asks for "distinct" approaches
- No seed or deterministic parameters are set

### What Happens When Barry Fails

- If Claude returns invalid JSON → error thrown → user sees "Something went wrong. Please try again."
- If Claude returns fewer than 3 messages → error thrown → same error message
- If network fails → caught → same error message
- **There are no fallback templates.** The comment in code explicitly states: "// NO FALLBACK - AI only"

### Key Questions Answered

**Is Barry deterministic or variable?**
Variable. Each generation produces different messages.

**Does Barry retain context?**
No. Barry has no memory between sessions. Each generation is independent. The only "memory" is the cached `barryContext` field on the contact record, which is generated separately by `barryGenerateContext` when viewing a contact profile—not during engagement.

**Does Barry influence state, or just generate text?**
Just generates text. Barry doesn't update any fields, change statuses, or trigger workflows. The HunterContactDrawer handles state changes after the user acts.

---

## 4. Engagement Methods — What Really Happens

### Email

**What happens when the user clicks it:**
1. If Gmail is connected → real email sent via Gmail API
2. If Gmail is not connected → `mailto:` link opens default email client

**What dependencies exist:**
- Gmail integration requires OAuth setup (`gmail-oauth-init.js`, `gmail-oauth-callback.js`)
- OAuth tokens stored in `users/{userId}/integrations/gmail`
- Access tokens expire and must be refreshed

**What fails most often:**
- Token refresh failures (returns `GMAIL_REFRESH_FAILED`)
- Gmail daily sending limits (returns `GMAIL_QUOTA`)
- Malformed email addresses (caught by Gmail API)

**What data is saved:**
- Real send: Activity logged as `email_sent` with `gmailMessageId`, email logged to `email_logs` collection
- Native handoff: Activity logged as `email_opened` but **no confirmation it was actually sent**

### Text (SMS)

**What happens when the user clicks it:**
`sms:{phone}?body={encodedMessage}` URL opens native SMS app. The phone number is pre-filled (if available) and message is pre-filled in the compose field.

**What dependencies exist:**
- Must be on a device with SMS capability
- On desktop, this may open Messages app or fail silently

**What fails most often:**
- Desktop browsers where SMS URLs aren't handled
- The URL is opened but we have no way to know if it worked

**What data is saved:**
Activity logged as `text_opened` with the message content, but **there is no confirmation the SMS was sent**. The system cannot know if the user actually hit send in their SMS app.

### LinkedIn

**What happens when the user clicks it:**
1. Opens `contact.linkedin_url` in a new browser tab
2. Copies message body to clipboard (if clipboard API available)

**Is this an action or just a link?**
It's just a link with a clipboard side effect. LinkedIn doesn't support deep linking to a compose screen with pre-filled text.

**Is there any tracking or confirmation?**
Activity logged as `linkedin_opened` but **there is no tracking of whether a message was sent**. The user must manually paste and send on LinkedIn.

### Call

**What happens when the user clicks it:**
`tel:{phone}` URL opens native phone dialer with number pre-filled.

**What data is saved:**
Activity logged as `call_initiated` but **there is no tracking of whether the call was made or how long it lasted**.

### Manual / Copy-Paste

**Does this exist implicitly or explicitly?**
Implicitly. There's no "copy to clipboard" button in the UI specifically for manual sending, but:
- LinkedIn action copies message to clipboard
- Users can manually copy from the message preview field

**How does the system know engagement occurred?**
It doesn't. For native handoffs, the system assumes the action was attempted based on the URL being opened, but has no confirmation of completion.

---

## 5. Engagement State & Data Model

### What Does "Engaged" Mean in the System Today?

There are **two separate concepts** that are often conflated:

1. **`lead_status`** — A field on contacts that can be `active`, `engaged`, `archived`, `converted`
2. **`activity_log`** — An array of timestamped events like `email_sent`, `text_opened`, etc.

**Critical finding:** `HunterContactDrawer` **does NOT update `lead_status` to "engaged"**. It only:
- Logs to `activity_log`
- Sets `last_contacted` timestamp
- Updates `engagementIntent` (prospect/warm/customer/partner)

The `lead_status` field is updated in other places (`ProspectCard.jsx` allows manual status changes), but not automatically by Hunter engagement.

### When Is Engagement State Set?

| Action | What Gets Updated |
|--------|-------------------|
| User sends email (Gmail) | `activity_log` += `email_sent`, `last_contacted` = now |
| User opens email draft | `activity_log` += `email_opened`, `last_contacted` = now |
| User opens SMS app | `activity_log` += `text_opened`, `last_contacted` = now |
| User opens LinkedIn | `activity_log` += `linkedin_opened`, `last_contacted` = now |
| User opens dialer | `activity_log` += `call_initiated`, `last_contacted` = now |

### Where Is State Stored?

**Contact document** (`users/{userId}/contacts/{contactId}`):
```javascript
{
  activity_log: [
    { type: "email_sent", timestamp: "...", channel: "email", method: "real", subject: "...", ... }
  ],
  last_contacted: "2026-02-04T...",
  engagementIntent: "prospect",
  lead_status: "active",  // NOT changed by Hunter
  ...
}
```

**Email logs** (for Gmail sends only):
```javascript
// Collection: email_logs
{
  userId, contactId, toEmail, toName, subject, bodyPreview,
  gmailMessageId, status: "sent", sentAt, source: "quick_engage"
}
```

### What Data Is Lost or Unreliable?

1. **SMS/LinkedIn/Call completion** — No way to confirm these happened
2. **Email opens/clicks** — Not tracked (would require email tracking pixels or Gmail API polling)
3. **Replies** — Not automatically detected; user must manually mark outcomes in Campaign view
4. **Message content for native handoffs** — We log what we intended to send, not what the user actually sent (they can edit in the native app)

### UI State vs Database State

The `HunterContactDrawer` component uses local React state (`useState`) for:
- `activeView` — which screen is showing
- `userIntent`, `messageOptions`, `selectedStrategy`, `selectedWeapon`
- `message`, `subject` — current editable message content
- `sendResult` — the outcome of the send action

This state is **not persisted**. If the user closes the drawer and reopens it, all state resets. The only persistence is the final `activity_log` entry and `last_contacted` update.

### Known Race Conditions or Sync Issues

1. **Activity log writes are non-blocking** — If `logActivity()` fails, the error is caught and logged but doesn't surface to the user
2. **No optimistic updates** — The UI waits for Firestore writes to complete before showing success
3. **No conflict resolution** — If two tabs update the same contact simultaneously, last-write-wins

---

## 6. After Engagement: What Changes?

### What Does the User See Next?

The success view shows what happened (email sent, app opened, etc.) with options to:
- "Send Another Message" — starts a new engagement flow
- "Add to Mission" — adds contact to an existing mission
- "Close" — closes the drawer

The user returns to the contact profile page. The only visible change might be:
- `last_contacted` timestamp (if displayed somewhere)
- New entry in activity history (if `ContactHunterActivity` component displays it)

### What Does Hunter Do Next?

**Nothing.** Hunter doesn't:
- Schedule follow-ups
- Create reminders
- Trigger any automation
- Update the contact's pipeline stage
- Notify the user to check for replies

### Does Barry Reference This Action Later?

**No.** Barry has no awareness of previous engagements. Each message generation is independent. The `activity_log` exists but Barry doesn't read it when generating new messages.

### Are Follow-Ups, Reminders, or Campaigns Triggered?

**No.** There is no automated follow-up system in HunterContactDrawer flow.

The **Campaign flow** (`CreateCampaign.jsx` → `CampaignDetail.jsx`) has:
- Outcome tracking (replied, meeting booked, etc.)
- `OutcomeSuggestions` component that suggests next steps
- `FollowUpComposer` component for manual follow-up creation

But these are **separate from HunterContactDrawer**. The Campaign flow is batch-oriented (multiple contacts, same message template) while HunterContactDrawer is single-contact, intent-driven.

---

## 7. Known Gaps, Workarounds, and Sharp Edges

### Where Do Users Get Stuck?

1. **"No email" / "No phone" blocks weapons** — Users must manually add contact info or enrich first
2. **Gmail not connected** — Users expecting real sends are surprised by mailto: handoff
3. **RECON not completed** — Warning banner appears but messages still generate (just less personalized)
4. **LinkedIn URL missing** — LinkedIn weapon is disabled even if user knows their LinkedIn
5. **Message generation fails** — No fallback; user must retry and hope Claude cooperates

### Where Do You Have to Explain Things Manually?

1. **"Your email was opened" doesn't mean it was sent** — Users may think "Email Draft Opened" = sent
2. **No tracking for SMS/LinkedIn/Call** — Users ask "did my message send?" and we can't answer
3. **Campaign vs HunterContactDrawer** — Two separate systems that don't share state
4. **Outcome tracking is campaign-only** — HunterContactDrawer engagements don't have outcome tracking

### Where Do You Rely on "Happy Path" Assumptions?

1. **Gmail tokens stay valid** — Token refresh can fail, leaving users unable to send
2. **Claude returns valid JSON** — Parsing failures happen, no graceful degradation
3. **RECON data exists and is well-formed** — If RECON sections have unexpected structure, Barry proceeds without them
4. **Native apps are installed** — `tel:` and `sms:` URLs assume the user has phone/SMS capability
5. **User completes the flow** — Closing the drawer mid-flow loses all state

### Where Does Hunter Feel Misleading or Unfinished?

1. **"Engage with Hunter" implies tracking** — But native handoffs aren't tracked
2. **"Send Email" button when Gmail isn't connected** — Actually opens a draft, not sends
3. **No visibility into what Barry used** — Users don't see which RECON sections influenced the message
4. **No way to save draft messages** — If you generate messages but don't send, they're gone when you close
5. **Weapons show "Opens App" but don't explain the limitation** — Users expect tracking
6. **"Add to Mission" after engagement** — Missions exist but aren't integrated with HunterContactDrawer outcomes
7. **Calendar weapon exists in code but not in UI** — `sendActionResolver.js` handles it but HunterContactDrawer doesn't show it
8. **No "mark as contacted" for native handoffs** — User must manually update lead status elsewhere

### Architectural Gaps

| Gap | Impact |
|-----|--------|
| HunterContactDrawer doesn't update `lead_status` | Contacts stay "active" even after engagement |
| No engagement confirmation for native handoffs | Can't build reliable reports on engagement volume |
| Campaign and HunterContactDrawer are siloed | User must choose between batch and single-contact flows |
| Barry doesn't learn from outcomes | Same types of messages generated regardless of what worked before |
| No follow-up automation | Users must remember to follow up manually |
| No reply detection | Users must manually check email and mark outcomes |

---

## Summary Tables

### Data Flow: HunterContactDrawer Engagement

```
User clicks "Engage with Hunter"
    ↓
HunterContactDrawer opens (main view)
    ↓
User types intent, clicks "Generate Messages"
    ↓
[Optional] Select relationship context (prospect/warm/customer/partner)
    ↓
Frontend calls generate-engagement-message API
    ↓
Backend loads: contact, RECON, user profile, barryContext
    ↓
Backend calls Claude Sonnet 4.5 with detailed prompt
    ↓
Claude returns 3 message strategies (JSON)
    ↓
User picks a strategy
    ↓
User selects weapon (email/text/linkedin/call)
    ↓
User reviews/edits message, clicks send/open
    ↓
executeSendAction() runs:
  - Gmail connected → real send via Gmail API
  - Gmail not connected → mailto: link
  - Text → sms: link
  - LinkedIn → open URL, copy to clipboard
  - Call → tel: link
    ↓
logActivity() writes to contact's activity_log
    ↓
Success view shows result
    ↓
User closes drawer → back to contact profile
```

### What Gets Persisted

| Data | Location | When |
|------|----------|------|
| Activity log entry | `contacts/{id}.activity_log` | After send/open action |
| Last contacted | `contacts/{id}.last_contacted` | After send/open action |
| Engagement intent | `contacts/{id}.engagementIntent` | After relationship selection or send |
| Email log | `email_logs` collection | After Gmail send only |
| Gmail message ID | Activity log entry | After Gmail send only |

### What Does NOT Get Persisted

- Generated messages (unless sent)
- User's typed intent (after closing)
- Barry's reasoning for strategies
- Draft state (no save draft feature)
- Send attempts that fail
- Native app completion status

---

*This document reflects Hunter as of February 4, 2026. No solutions, improvements, or roadmap items included—just the current state of the system.*
