/**
 * barryMissionChat.js — Barry Mission Control Command Interface
 *
 * Sprint 5 full rebuild.
 *
 * Two request types:
 *   A. Opening brief (message === '__OPENING_BRIEF__' or no message):
 *      - Server loads recommendations + stats (Admin SDK)
 *      - Determines mode (PRIORITIZE / SUGGEST / GROWTH)
 *      - Returns structured chat message with data-driven brief
 *
 *   B. Conversation (message present):
 *      - Receives contextStack from client (contacts, missions, RECON)
 *      - Injects full context into system prompt
 *      - Returns structured JSON: intent, step, angles, actions
 *
 * Output always matches the structured schema so BarryChatPanel
 * can render consistently: text response + optional 4-angle block.
 *
 * Model: Haiku (speed over power for chat interactions).
 */

import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { compileReconForPrompt } from './utils/reconCompiler.js';
import { getStaleContacts } from './utils/contactUtils.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysSince(dateVal) {
  if (!dateVal) return Infinity;
  const date = dateVal?.toDate ? dateVal.toDate() : new Date(dateVal);
  if (isNaN(date.getTime())) return Infinity;
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

// ── Auth verification ─────────────────────────────────────────────────────────

async function verifyAuthToken(authToken, userId) {
  const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  if (!firebaseApiKey) throw new Error('Firebase API key not configured');

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: authToken })
    }
  );

  if (!res.ok) throw new Error('Invalid authentication token');
  const data = await res.json();
  if (!data.users || data.users[0].localId !== userId) throw new Error('Token/userId mismatch');
}

// ── Server-side recommendation loader (for opening brief) ─────────────────────

async function loadServerSideRecommendations(userId) {
  const recommendations = [];
  const TIMEFRAME_DAYS = { this_week: 7, this_month: 30, this_quarter: 90 };

  try {
    const userRef = db.collection('users').doc(userId);

    const highValueSnap = await userRef
      .collection('contacts')
      .where('strategic_value', 'in', ['high', 'critical'])
      .where('contact_status', 'in', ['New', 'Engaged', 'Dormant'])
      .limit(20)
      .get();

    highValueSnap.forEach(docSnap => {
      const contact = docSnap.data();
      const isCritical = contact.strategic_value === 'critical';

      if (contact.contact_status === 'New') {
        const days = daysSince(contact.addedAt || contact.contact_status_updated_at);
        if (days >= 7) recommendations.push({ type: 'high_value_no_mission', priorityWeight: isCritical ? 0 : 2, contactName: contact.name || 'Unknown', contactId: docSnap.id });
      } else if (contact.contact_status === 'Engaged') {
        const days = daysSince(contact.contact_status_updated_at);
        if (days >= 7) recommendations.push({ type: 'high_value_no_engagement', priorityWeight: isCritical ? 0 : 2, contactName: contact.name || 'Unknown', contactId: docSnap.id });
      } else if (contact.contact_status === 'Dormant') {
        const days = daysSince(contact.contact_status_updated_at);
        if (days >= 30) recommendations.push({ type: 'high_value_dormant', priorityWeight: isCritical ? 0 : 2, contactName: contact.name || 'Unknown', contactId: docSnap.id });
      }
    });

    const staleContacts = await getStaleContacts(userRef, 14);
    staleContacts.forEach(contact => {
      const isCritical = contact.strategic_value === 'critical';
      recommendations.push({
        type: 'stalled_awaiting_reply',
        priorityWeight: isCritical ? 0 : contact.strategic_value === 'high' ? 1 : 3,
        contactName: contact.name || 'Unknown',
        contactId: contact.id,
        daysSinceContact: contact.daysSince
      });
    });

    const missionsSnap = await userRef.collection('missions').where('status', '==', 'autopilot').limit(20).get();
    missionsSnap.forEach(docSnap => {
      const mission = docSnap.data();
      const timeframeDays = TIMEFRAME_DAYS[mission.timeframe];
      if (!timeframeDays) return;
      const createdVal = mission.createdAt || mission.startedAt;
      const created = createdVal?.toDate ? createdVal.toDate() : new Date(createdVal);
      if (isNaN(created.getTime())) return;
      const deadline = new Date(created.getTime() + timeframeDays * 24 * 60 * 60 * 1000);
      const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 5 && daysLeft > 0) {
        recommendations.push({ type: 'momentum_compress', priorityWeight: 1, missionName: mission.name || 'Unnamed', missionId: docSnap.id, daysLeft });
      }
    });
  } catch (error) {
    console.warn('[barryMissionChat] Recommendations load failed (non-fatal):', error.message);
  }

  recommendations.sort((a, b) => a.priorityWeight - b.priorityWeight);
  return recommendations.slice(0, 5);
}

async function loadStats(userId) {
  try {
    const userRef = db.collection('users').doc(userId);
    const [companiesSnap, contactsSnap, missionsSnap] = await Promise.all([
      userRef.collection('companies').where('status', '==', 'accepted').limit(500).get(),
      userRef.collection('contacts').limit(500).get(),
      userRef.collection('missions').where('status', '==', 'autopilot').get()
    ]);
    return { scoutCompanies: companiesSnap.size, scoutContacts: contactsSnap.size, activeMissions: missionsSnap.size };
  } catch {
    return { scoutCompanies: 0, scoutContacts: 0, activeMissions: 0 };
  }
}

// ── Mode detection ────────────────────────────────────────────────────────────

function determineBarryMode(recommendations, stats) {
  const genuinelyUrgent = recommendations.filter(r =>
    r.priorityWeight === 0 ||
    (r.priorityWeight <= 1 && (r.type === 'momentum_compress' || r.type === 'stalled_awaiting_reply'))
  );
  if (genuinelyUrgent.length > 0) return 'PRIORITIZE';
  if (stats.activeMissions === 0 || stats.scoutContacts < 5) return 'GROWTH';
  return 'SUGGEST';
}

function detectModeShift(contextStack, intent, currentMode) {
  const urgentContacts = (contextStack?.contacts || []).filter(c =>
    c.strategic_value === 'critical' &&
    c.last_interaction &&
    Date.now() - new Date(c.last_interaction).getTime() > 7 * 24 * 60 * 60 * 1000
  );

  if (urgentContacts.length > 0 && currentMode !== 'PRIORITIZE') return 'PRIORITIZE';
  if (intent === 'NEW_OUTREACH' || intent === 'RESEARCH') return 'GROWTH';
  return currentMode || 'SUGGEST';
}

// ── ICP reclarification prompt ────────────────────────────────────────────────

function buildIcpReclarificationPrompt(icpProfile) {
  // Build a human-readable summary of the current ICP settings if available
  let currentIcpBlock = '';
  if (icpProfile) {
    const lines = [];
    if (icpProfile.industries?.length) lines.push(`- Industries: ${icpProfile.industries.join(', ')}`);
    if (icpProfile.isNationwide) {
      lines.push('- Location: Nationwide (all US)');
    } else if (icpProfile.locations?.length) {
      lines.push(`- Locations: ${icpProfile.locations.join(', ')}`);
    }
    if (icpProfile.companySizes?.length) lines.push(`- Company sizes: ${icpProfile.companySizes.join(', ')}`);
    if (icpProfile.revenueRanges?.length) lines.push(`- Revenue ranges: ${icpProfile.revenueRanges.join(', ')}`);
    if (icpProfile.targetTitles?.length) lines.push(`- Target titles: ${icpProfile.targetTitles.join(', ')}`);
    if (icpProfile.companyKeywords?.length) lines.push(`- Keywords: ${icpProfile.companyKeywords.join(', ')}`);

    if (lines.length > 0) {
      currentIcpBlock = `
CURRENT ICP SETTINGS (already saved by the user):
${lines.join('\n')}

The user has an existing ICP set up. Your job is to:
1. Briefly confirm you can see these settings (name the key ones — industries, sizes, locations)
2. Ask if this is still accurate or if anything has changed
3. Once confirmed or refined, you have enough context — summarize and offer to search

Do NOT ask from scratch if settings already exist. Start by acknowledging what's there.
`;
    }
  }

  const hasExistingIcp = currentIcpBlock.length > 0;

  return `You are Barry, an expert B2B sales intelligence AI. You are sharp, warm, and direct.
${hasExistingIcp ? currentIcpBlock : `
SITUATION: The user wants to define or refine their target company profile. Your job: have a focused, natural conversation to understand who they actually want to reach — then give the ICP parameters to run a better search.
`}
YOUR GOAL: Extract or confirm clear signals about:
1. Industry / type of company they target
2. Company size (employees, stage, or revenue range)
3. Who they sell to (titles/roles)
4. Any specific qualifiers ("PE-backed", "B2B SaaS", "has a sales team", "Series B")

APPROACH:
- One question at a time — never ask multiple things at once
- Be warm and conversational — like a sharp colleague helping them think through this
- Acknowledge what they share before asking the next thing
- If settings already exist, confirm them first — don't re-ask what you already know
- When confident, summarize what you heard and tell them you're ready to search

OUTPUT: Return ONLY valid JSON. No text outside the JSON.

While gathering context:
{
  "intent": "ICP_SCOUT_CLARIFY",
  "response_text": "Barry's single question or warm acknowledgment + next question",
  "has_enough_context": false,
  "icp_params": null
}

When you have enough context (immediately if existing ICP is confirmed, or after 2-4 turns otherwise):
{
  "intent": "ICP_SCOUT_CLARIFY",
  "response_text": "Alright — [1-2 sentence summary of what they're looking for]. Hit 'Find My Companies' and I'll pull a fresh batch.",
  "has_enough_context": true,
  "icp_params": {
    "industries": ["saas", "fintech"],
    "companySizes": ["51-200", "201-500"],
    "targetTitles": ["VP of Sales", "Head of Revenue"],
    "companyKeywords": ["b2b", "enterprise", "series b"]
  }
}

icp_params format:
- industries: array of lowercase strings (e.g. ["technology", "healthcare", "saas"])
- companySizes: match these ranges exactly: ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001+"]
- targetTitles: array of specific job titles they sell to
- companyKeywords: descriptive terms (e.g. ["startup", "b2b", "agency", "saas", "enterprise"])

All fields are optional — only include what the user actually mentioned or confirmed. ${hasExistingIcp ? 'Start by acknowledging the current ICP settings.' : 'Start with the first targeted question.'}`;
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildMissionControlSystemPrompt(mode, contextStack, reconContext, module = null) {
  const contacts = contextStack?.contacts || [];
  const missions = contextStack?.missions || [];
  const recon = contextStack?.recon || {};
  const userStyle = contextStack?.user_style || null;
  const icpProfile = contextStack?.icpProfile || null;
  const calendarEvents = contextStack?.calendarEvents || [];

  // Build ICP summary block from structured profile (same field set as buildIcpReclarificationPrompt)
  const icpLines = [];
  if (icpProfile) {
    if (icpProfile.industries?.length) icpLines.push(`Industries: ${icpProfile.industries.join(', ')}`);
    if (icpProfile.isNationwide) icpLines.push('Locations: Nationwide (all US)');
    else if (icpProfile.locations?.length) icpLines.push(`Locations: ${icpProfile.locations.join(', ')}`);
    if (icpProfile.companySizes?.length) icpLines.push(`Company sizes: ${icpProfile.companySizes.join(', ')}`);
    if (icpProfile.targetTitles?.length) icpLines.push(`Target titles: ${icpProfile.targetTitles.join(', ')}`);
    if (icpProfile.companyKeywords?.length) icpLines.push(`Keywords: ${icpProfile.companyKeywords.join(', ')}`);
    if (icpProfile.lookalikeSeed?.name) icpLines.push(`Lookalike anchor: ${icpProfile.lookalikeSeed.name}`);
  }
  const icpBlock = icpLines.length > 0 ? icpLines.join('\n') : 'Not configured';

  // Build a concise contact list for the prompt.
  // Priority: sniper + basecamp contacts always get full detail regardless of recency
  // (they are the most likely targets for engagement actions like "Bryan Baker in Homebase")
  const sortedByRecency = [...contacts].sort((a, b) => {
    const aTime = a.last_interaction ? new Date(a.last_interaction).getTime() : 0;
    const bTime = b.last_interaction ? new Date(b.last_interaction).getTime() : 0;
    return bTime - aTime;
  });

  const priorityContacts = sortedByRecency.filter(c =>
    c.stage === 'sniper' || c.stage === 'basecamp'
  ).slice(0, 40);
  const priorityIds = new Set(priorityContacts.map(c => c.id));
  const recentContacts = sortedByRecency
    .filter(c => !priorityIds.has(c.id))
    .slice(0, 100 - priorityContacts.length);

  const detailedPool = [...priorityContacts, ...recentContacts];
  const detailedIds = new Set(detailedPool.map(c => c.id));

  const formatDetailLine = (c) => {
    const lastDays = c.last_interaction
      ? Math.floor((Date.now() - new Date(c.last_interaction).getTime()) / 86400000)
      : null;
    const lastStr = lastDays === null ? 'never' : lastDays === 0 ? 'today' : `${lastDays}d ago`;
    return `  ${c.name} (${c.title || '?'} @ ${c.company || '?'}) — status:${c.contact_status || '?'}, stage:${c.stage || 'scout'}, type:${c.person_type || 'lead'}, value:${c.strategic_value || '?'}, last:${lastStr}, hunter:${c.hunter_status || 'none'}, id:${c.id}`;
  };

  const detailedContacts = detailedPool.map(formatDetailLine).join('\n');

  // Enriched overflow index — includes enough data to reason about who needs attention
  const overflowContacts = contacts.filter(c => !detailedIds.has(c.id));
  const contactIndex = overflowContacts.length > 0
    ? '\n\nALL OTHER CONTACTS:\n' +
      overflowContacts.map(c => {
        const lastDays = c.last_interaction
          ? Math.floor((Date.now() - new Date(c.last_interaction).getTime()) / 86400000)
          : null;
        const lastStr = lastDays === null ? 'never' : `${lastDays}d`;
        return `  ${c.name} @ ${c.company || '?'} | stage:${c.stage || 'scout'} | status:${c.contact_status || '?'} | value:${c.strategic_value || '?'} | last:${lastStr} | hunter:${c.hunter_status || 'none'} | id:${c.id}`;
      }).join('\n')
    : '';
  const contactSummary = detailedContacts + contactIndex;

  const missionSummary = missions.slice(0, 10).map(m => {
    const contact = contacts.find(c => c.id === m.contactId);
    return `  Mission for ${contact?.name || m.contactId}: goal=${m.outcome_goal}, step ${m.current_step}/${m.steps_total}, last_outcome=${m.last_outcome || 'none'}`;
  }).join('\n');

  // Extract user's company name from compiled RECON context so Barry never guesses
  let userCompanyName = null;
  if (reconContext) {
    const match = reconContext.match(/- Company:\s*(.+)/);
    if (match) userCompanyName = match[1].trim();
  }

  return `You are Barry, Idynify's AI sales intelligence assistant operating in Mission Control.

You are not a suggestion widget. You are the best analyst, strategist, and writing partner the user has ever had — and you know everything about their contacts, their ICP, their past messages, and their pipeline.

IMPORTANT — USER'S COMPANY: ${userCompanyName ? `The user's company is "${userCompanyName}". Always use this exact name when drafting messages or referring to their business. Never invent or substitute another company name.` : 'Company name not yet configured — user should complete RECON training (Section 1). Do NOT invent a company name.'}

Your vibe: calm confidence, zero fluff, maximum usefulness. You talk like a smart colleague who has already done the research. You ask one question at a time when you need to. You confirm before you act. You offer options, not commands.

━━━ CURRENT MODULE: ${module ? module.toUpperCase() : 'MISSION CONTROL'} | MODE: ${mode} ━━━
PRIORITIZE: Time-sensitive items need action now. Name names, be specific, give the single most important next move.
SUGGEST: Pipeline is healthy. Recommend next moves ranked by relational leverage.
GROWTH: Pipeline is sparse. Focus on what's missing and how to build it.
COACH (RECON): Build ICP through conversation. Ask questions one at a time, push back on vague answers, build intelligence reports.
TARGETING (SCOUT): Evaluate ICP match scores. Suggest better targets. Draft first-touch messages when asked.
PURSUE (HUNTER): Goal is a booked meeting. Write follow-ups. Surface who needs next action. Differentiate warm vs cold.
CLOSE (SNIPER): Post-demo conversion. Write trust-first follow-ups. Know close rate target and nudge toward it.
GUIDE (HOMEBASE): Help with settings, integrations, and platform configuration.
CONNECT (REINFORCEMENTS): Surface warm intro paths, referral opportunities, and network connections.

━━━ CALENDAR EVENTS (${calendarEvents.length} upcoming — matched to Hunter contacts) ━━━
${calendarEvents.length > 0
  ? calendarEvents.map(ev =>
      `  "${ev.title}" on ${ev.startDateTime ? new Date(ev.startDateTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'TBD'}${ev.contactName ? ` — with ${ev.contactName} (id: ${ev.contactId})` : ''}`
    ).join('\n')
  : 'No upcoming calendar meetings with Hunter contacts.'}

IMPORTANT: If you see a calendar event with a Hunter contact, that contact likely had a meeting booked and should be moved to Sniper. Proactively suggest this with a MOVE_TO_SNIPER action.

━━━ CONTACTS (${contacts.length} total) ━━━
${contactSummary || 'No contacts loaded.'}

━━━ ACTIVE MISSIONS (${missions.length} total) ━━━
${missionSummary || 'No active missions.'}

━━━ RECON CONTEXT (${recon.confidence || 0}% complete) ━━━
${recon.pain_points ? `Pain points: ${recon.pain_points}` : 'Pain points: not set'}
${recon.icp ? `ICP snapshot: ${recon.icp}` : 'ICP snapshot: not set'}
${recon.value_proposition ? `Value prop: ${recon.value_proposition}` : 'Value prop: not set'}
${reconContext ? reconContext.slice(0, 2000) : ''}

━━━ ICP PROFILE (configured settings) ━━━
${icpBlock}
Reference this when discussing prospecting or targeting. This is the user's confirmed ICP — always use it as the baseline when giving targeting advice or drafting outreach.

User's communication style preference: ${userStyle ? userStyle.replace(/_/g, ' ') : 'warm and conversational'}. Write all drafted messages in this style. When style is null, default to warm and conversational.

━━━ CRITICAL RULES ━━━
1. Never narrate internal thinking ("Now I'm looking at...")
2. Never write robotic intros ("Sure! I'd be happy to help!")
3. Never ask multiple questions at once — one question, then wait
4. Always use real contact names and real context — never generic
5. Fresh context the user provides always overrides database defaults
6. Barry mode affects prioritization, not voice or capability
7. When generating messages: 4 angles, each genuinely different
8. Field commander voice in reasoning. Calm guide voice in messages.
9. ALL contacts — Scout, Hunter, Sniper, Customer (Basecamp/Homebase), Network, Partner — are in ONE unified database above. NEVER say a contact "isn't in your system", "is in Homebase (outside Mission Control)", or "I can't pull their profile" unless their name genuinely does not appear ANYWHERE in the CONTACTS list (detailed OR overflow). A contact with stage=basecamp or person_type=customer IS fully accessible — you have their name, company, email, status, and everything else right here. Homebase/Basecamp is NOT a separate system — it's just a stage label. Search EVERY contact entry (including ALL OTHER CONTACTS section) before claiming someone is missing. If you find them, use their data confidently.

━━━ INTENT DETECTION ━━━
Classify the user's message into one of:
- FOLLOW_UP: follow up with contact, haven't heard back, check in
- NEW_OUTREACH: reach out to, draft email to, start sequence for
- MESSAGE_REVIEW: what did we send, recap on, where are we with
- SCHEDULE: set up a call, book time, send calendar invite
- RESEARCH: find out about, who is the decision maker, what do we know
- PIPELINE_CHECK: status of pipeline, how many contacts, what's active
- MOVE_TO_SNIPER: move contact from Hunter to Sniper — signals: "move X to sniper", "X had a meeting", "X is ready to close", "X booked a demo", "move X forward", "X is in the close zone" — OR you detect a calendar event with a Hunter contact
- ENGAGE_CONTACT: start working on a contact, kick off outreach, move into active pursuit — signals: "engage X", "let's start on X", "move X to hunter", "start working with X", "kick off X", "go after X", "add X to my pipeline", "let's pursue X"
- ORGANIZE_PIPELINE: analyze who should move stages or which contacts need attention — signals: "who should move to hunter", "organize my pipeline", "who's ready to close", "who's stalled", "show me who needs attention", "who should I promote", "who's gone cold", "pipeline review"
- LOG_OUTCOME: record what happened in a call, meeting, or interaction — signals: "X replied", "had a call with X", "X said no", "X went cold", "X booked a meeting", "log that X", "update X's status", "mark X as", "X is now interested"
- COMPLETE_STEP: mark a mission step as done and advance — signals: "sent the message to X", "done with step 1 for X", "mark X's step complete", "move to next step for X", "finished step X"
- ADD_NOTE: add context or a note to a contact's profile — signals: "note that X", "add a note to X", "remember that X", "X mentioned", "jot down for X", "X told me"
- ICP_CHANGE: user wants to target a new type of company/person, pivot targeting, add a new vertical, or change audience focus — signals: "what about X", "try X instead", "add X", "pivot to X", "forget Y focus on X", "what if we targeted X", "I'm thinking X", "let's do X"
- CUSTOM: anything else

━━━ THE THREE-STEP LOOP ━━━
1. INTAKE — understand what the user wants (one clarifying question if ambiguous, step="intake")
2. CONFIRM — briefly restate what you understand + key context (step="confirm")
3. EXECUTE — deliver output with clear options (step="execute")

━━━ MESSAGE GENERATION RULES ━━━
When generating outreach (FOLLOW_UP or NEW_OUTREACH intents in execute step):
- At least one specific detail from contact data or RECON per message
- Four angles: value_add / direct_ask / soft_reconnect / pattern_interrupt
- Each angle genuinely different — not same message, different opener
- One clear CTA per message — never two asks
- Subject lines under 8 words, no clickbait
- Under 120 words per message
- Write in the user's voice, not Barry's
- Include the contact's id in the response so the UI can wire Load into Hunter

━━━ OUTPUT FORMAT ━━━
Return ONLY valid JSON. No other text before or after.

For execute step with message angles:
{
  "intent": "FOLLOW_UP",
  "barry_mode": "${mode}",
  "step": "execute",
  "response_text": "Barry's conversational text here — grounded, specific, no fluff.",
  "contact_id": "the contact's id from the context above, or null if no specific contact",
  "has_message_angles": true,
  "angles": [
    {"id": "value_add", "label": "Value Add", "subject": "...", "message": "...", "recommended": false},
    {"id": "direct_ask", "label": "Direct Ask", "subject": "...", "message": "...", "recommended": true},
    {"id": "soft_reconnect", "label": "Soft Reconnect", "subject": "...", "message": "...", "recommended": false},
    {"id": "pattern_interrupt", "label": "Pattern Interrupt", "subject": "...", "message": "...", "recommended": false}
  ],
  "actions": ["load_into_hunter", "copy_message"],
  "clarifying_question": null
}

For execute step without message angles (analysis, pipeline check, etc.):
{
  "intent": "PIPELINE_CHECK",
  "barry_mode": "${mode}",
  "step": "execute",
  "response_text": "Barry's response here.",
  "contact_id": null,
  "has_message_angles": false,
  "angles": [],
  "actions": [],
  "clarifying_question": null
}

For intake step (Barry needs clarification):
{
  "intent": "FOLLOW_UP",
  "barry_mode": "${mode}",
  "step": "intake",
  "response_text": "Barry's single clarifying question.",
  "contact_id": null,
  "has_message_angles": false,
  "angles": [],
  "actions": [],
  "clarifying_question": "Which contact did you want to follow up with?"
}

For ICP_CHANGE intent (user signals a new targeting focus — client handles the add/replace confirmation):
{
  "intent": "ICP_CHANGE",
  "barry_mode": "${mode}",
  "step": "execute",
  "response_text": "",
  "new_target": "exact target type the user described, e.g. 'dental offices', 'plumbers', 'med spas'",
  "contact_id": null,
  "has_message_angles": false,
  "angles": [],
  "actions": [],
  "clarifying_question": null
}

For MOVE_TO_SNIPER intent (user asks to move a contact to Sniper, or you detected a calendar meeting with a Hunter contact — client will show a confirm button):
{
  "intent": "MOVE_TO_SNIPER",
  "barry_mode": "${mode}",
  "step": "execute",
  "response_text": "Barry's explanation of why this contact should move to Sniper — 1-2 sentences, specific.",
  "contact_id": "the contact's id from the context above",
  "contact_name": "the contact's full name",
  "sniper_reason": "meeting_booked | demo_completed | positive_discussion | calendar_detected | barry_suggested | manual",
  "has_message_angles": false,
  "angles": [],
  "actions": ["move_to_sniper"],
  "clarifying_question": null
}

For ENGAGE_CONTACT intent (user wants to start engaging a specific contact — client shows confirm button):
{
  "intent": "ENGAGE_CONTACT",
  "barry_mode": "${mode}",
  "step": "execute",
  "response_text": "Barry's 1-2 sentence rationale — reference their stage, strategic value, and why now is the right move.",
  "contact_id": "the contact's id from the context above",
  "contact_name": "the contact's full name",
  "current_stage": "scout | hunter | basecamp | fallback",
  "has_message_angles": false,
  "angles": [],
  "actions": ["engage_contact"],
  "clarifying_question": null
}

For ORGANIZE_PIPELINE intent (Barry surfaces contacts that should move stages — client renders per-contact move buttons):
{
  "intent": "ORGANIZE_PIPELINE",
  "barry_mode": "${mode}",
  "step": "execute",
  "response_text": "Barry's 2-3 sentence pipeline analysis — specific numbers, names, honest assessment.",
  "contact_id": null,
  "has_message_angles": false,
  "angles": [],
  "pipeline_moves": [
    {
      "contact_id": "xxx",
      "contact_name": "Full Name",
      "current_stage": "scout",
      "recommended_stage": "hunter",
      "action_type": "engage_contact",
      "reason": "High strategic value, 23 days cold, warm relationship state"
    }
  ],
  "actions": ["pipeline_moves"],
  "clarifying_question": null
}

For LOG_OUTCOME intent (record what happened — client executes immediately, no confirm needed):
{
  "intent": "LOG_OUTCOME",
  "barry_mode": "${mode}",
  "step": "execute",
  "response_text": "Barry's 1-sentence acknowledgment of what was logged.",
  "contact_id": "the contact's id from the context above",
  "contact_name": "the contact's full name",
  "outcome": "positive_reply | negative_reply | meeting_booked | no_reply | call_completed | demo_completed | custom",
  "outcome_note": "Short description of what happened, extracted from user's message",
  "status_update": "In Conversation | Awaiting Reply | Dormant | Active Customer | null",
  "has_message_angles": false,
  "angles": [],
  "actions": ["log_outcome"],
  "clarifying_question": null
}

For COMPLETE_STEP intent (mark mission step done — client executes immediately, no confirm):
{
  "intent": "COMPLETE_STEP",
  "barry_mode": "${mode}",
  "step": "execute",
  "response_text": "Barry's acknowledgment — reference the contact name and what's next.",
  "contact_id": "the contact's id from the context above",
  "contact_name": "the contact's full name",
  "mission_id": "the contact's active_mission_id or null to auto-lookup",
  "step_number": 1,
  "outcome": "sent | positive_reply | no_reply | completed",
  "has_message_angles": false,
  "angles": [],
  "actions": ["complete_step"],
  "clarifying_question": null
}

For ADD_NOTE intent (save a note on a contact — client executes immediately, no confirm):
{
  "intent": "ADD_NOTE",
  "barry_mode": "${mode}",
  "step": "execute",
  "response_text": "Got it — noted for [contact name].",
  "contact_id": "the contact's id from the context above",
  "contact_name": "the contact's full name",
  "note_text": "The exact note text to save, cleaned up from user's message",
  "has_message_angles": false,
  "angles": [],
  "actions": ["add_note"],
  "clarifying_question": null
}`;
}

// ── Fallback defaults ─────────────────────────────────────────────────────────

function getModeDefaultBrief(mode, stats, recommendations) {
  if (mode === 'PRIORITIZE') {
    const urgentItem = recommendations[0];
    const name = urgentItem?.contactName || urgentItem?.missionName || 'a contact';
    return `${name} needs your attention now. Act today to protect this opportunity.`;
  }
  if (mode === 'SUGGEST') {
    return `Your pipeline is active — ${stats.scoutContacts} contacts, ${stats.activeMissions} active mission${stats.activeMissions !== 1 ? 's' : ''}. Find the highest-leverage move and make it.`;
  }
  return `Let's build your pipeline. Start by exploring Scout to find companies that match your ICP. Your first lead is one search away.`;
}

function getModeDefaultPrompts(mode) {
  const defaults = {
    PRIORITIZE: ['What needs attention right now?', 'Which contacts are going cold?'],
    SUGGEST: ['Who should I reach out to today?', 'How\'s my pipeline looking?'],
    GROWTH: ['How do I find my first leads?', 'Help me set up a first mission.']
  };
  return defaults[mode] || defaults.SUGGEST;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const startTime = Date.now();
  let userId;

  try {
    const body = JSON.parse(event.body);
    userId = body.userId;
    const authToken = body.authToken;
    const message = body.message;
    const conversationHistory = body.conversationHistory || [];
    const module = body.module || null;
    const barryMode = body.barryMode || body.mode || 'SUGGEST';
    const contextStack = body.contextStack || null;
    const isIcpMode = body.icpMode === true;
    const icpProfile = body.icpProfile || null;
    const moduleContext = body.moduleContext && Object.keys(body.moduleContext).length > 0
      ? body.moduleContext
      : null;

    if (!userId || !authToken) throw new Error('Missing required parameters: userId, authToken');
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    await verifyAuthToken(authToken, userId);

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // ── Load RECON server-side (for additional context / security) ────────────
    let reconContext = '';
    try {
      const dashboardDoc = await db.collection('dashboards').doc(userId).get();
      if (dashboardDoc.exists) {
        reconContext = compileReconForPrompt(dashboardDoc.data()) || '';
      }
    } catch (err) {
      console.warn('[barryMissionChat] RECON load skipped:', err.message);
    }

    const isOpeningBrief = !message || message === '__OPENING_BRIEF__';

    if (isOpeningBrief) {
      // ── Opening Brief Path ─────────────────────────────────────────────────
      console.log('[barryMissionChat] Generating opening brief...');

      const [recommendations, stats] = await Promise.all([
        loadServerSideRecommendations(userId),
        loadStats(userId)
      ]);

      const currentMode = determineBarryMode(recommendations, stats);

      // For the opening brief, use a slimmed context — only top 50 contacts + missions
      // to reduce prompt size and speed up Claude's response time
      const effectiveContext = contextStack
        ? {
            ...contextStack,
            contacts: (contextStack.contacts || []).slice(0, 50)
          }
        : { contacts: [], missions: [], recon: {} };
      let systemPrompt = buildMissionControlSystemPrompt(currentMode, effectiveContext, reconContext);
      if (moduleContext) {
        systemPrompt += `\n\n━━━ CURRENT PAGE CONTEXT (module: ${module}) ━━━\n${JSON.stringify(moduleContext, null, 2)}`;
      }

      const topRecs = recommendations.slice(0, 3);
      const recContext = topRecs.length > 0
        ? `Pipeline signals:\n${topRecs.map(r => {
            if (r.contactName) return `- ${r.contactName}: ${r.type.replace(/_/g, ' ')}${r.daysSinceContact ? ` (${r.daysSinceContact} days)` : ''}`;
            if (r.missionName) return `- Mission ${r.missionName}: ${r.daysLeft} days left`;
            return `- ${r.type.replace(/_/g, ' ')}`;
          }).join('\n')}`
        : 'No urgent signals.';

      const briefPrompt = `Generate an opening brief for a user just landing on Mission Control. Mode: ${currentMode}.

Stats: ${stats.scoutContacts} contacts, ${stats.activeMissions} active missions, ${stats.scoutCompanies} companies tracked.
${recContext}

Format: 2-3 sentences. Specific about real numbers or names from the data. Barry's voice: confident, tactical, no fluff. No "Welcome back!" or "Great to see you!" openings. If pipeline is empty, orient the user on what to do first.

Return valid JSON only:
{
  "intent": "PIPELINE_CHECK",
  "barry_mode": "${currentMode}",
  "step": "execute",
  "response_text": "2-3 sentence opening brief here.",
  "contact_id": null,
  "has_message_angles": false,
  "angles": [],
  "actions": [],
  "clarifying_question": null,
  "suggested_prompts": ["Prompt 1", "Prompt 2", "Prompt 3"]
}`;

      const briefController = new AbortController();
      const briefTimeout = setTimeout(() => briefController.abort(), 10000);
      let parsed;

      try {
        const claudeResponse = await anthropic.messages.create(
          {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 600,
            system: systemPrompt,
            messages: [{ role: 'user', content: briefPrompt }]
          },
          { signal: briefController.signal }
        );

        const rawText = claudeResponse.content[0].text;
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        if (!parsed?.response_text) throw new Error('Invalid brief structure');

      } catch (err) {
        if (briefController.signal.aborted) console.warn('[barryMissionChat] Brief timed out — using fallback');
        else console.warn('[barryMissionChat] Brief parse failed — using fallback:', err.message);

        parsed = {
          intent: 'PIPELINE_CHECK',
          barry_mode: currentMode,
          step: 'execute',
          response_text: getModeDefaultBrief(currentMode, stats, recommendations),
          contact_id: null,
          has_message_angles: false,
          angles: [],
          actions: [],
          clarifying_question: null,
          suggested_prompts: getModeDefaultPrompts(currentMode)
        };
      } finally {
        clearTimeout(briefTimeout);
      }

      await logApiUsage(userId, 'barryMissionChat', 'success', {
        responseTime: Date.now() - startTime,
        metadata: { type: 'opening_brief', mode: currentMode }
      });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: true,
          mode: parsed.barry_mode || currentMode,
          // Legacy fields (for BarryChatPanel backward compat)
          brief: parsed.response_text,
          suggestedPrompts: parsed.suggested_prompts || getModeDefaultPrompts(currentMode),
          recommendations,
          // Structured fields (new)
          ...parsed
        })
      };

    } else if (isIcpMode) {
      // ── ICP Reclarification Path ───────────────────────────────────────────
      console.log('[barryMissionChat] ICP reclarification mode...');

      // Use client-provided ICP profile, or fall back to loading from Firestore
      let resolvedIcpProfile = icpProfile;
      if (!resolvedIcpProfile) {
        try {
          const profileDoc = await db.collection('users').doc(userId).collection('companyProfile').doc('current').get();
          if (profileDoc.exists) resolvedIcpProfile = profileDoc.data();
        } catch (icpErr) {
          console.warn('[barryMissionChat] Could not load ICP profile from Firestore:', icpErr.message);
        }
      }

      const icpSystemPrompt = buildIcpReclarificationPrompt(resolvedIcpProfile);
      const isOpening = message === '__ICP_RECLARIFICATION__';

      const icpMessages = isOpening
        ? [{ role: 'user', content: resolvedIcpProfile
            ? 'Review my current ICP settings and confirm what you see, then ask if I want to refine anything.'
            : 'Help me define who I should be targeting.' }]
        : [...conversationHistory.slice(-10), { role: 'user', content: message }];

      const icpController = new AbortController();
      const icpTimeout = setTimeout(() => icpController.abort(), 15000);
      let icpParsed;

      try {
        const icpResponse = await anthropic.messages.create(
          {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 800,
            system: icpSystemPrompt,
            messages: icpMessages,
          },
          { signal: icpController.signal }
        );

        const rawText = icpResponse.content[0].text;
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        icpParsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        if (!icpParsed?.response_text) throw new Error('Invalid ICP response structure');

      } catch (err) {
        if (icpController.signal.aborted) console.warn('[barryMissionChat] ICP chat timed out');
        else console.warn('[barryMissionChat] ICP parse failed:', err.message);

        icpParsed = {
          intent: 'ICP_SCOUT_CLARIFY',
          response_text: 'Who are you trying to reach — what type of company or role do you typically sell to?',
          has_enough_context: false,
          icp_params: null,
        };
      } finally {
        clearTimeout(icpTimeout);
      }

      // Build updated conversation history to return to the client
      const updatedIcpHistory = isOpening
        ? [{ role: 'assistant', content: icpParsed.response_text }]
        : [
            ...conversationHistory,
            { role: 'user', content: message },
            { role: 'assistant', content: icpParsed.response_text },
          ];

      // Persist conversation to Firestore (non-fatal)
      try {
        await db.collection('users').doc(userId).collection('barryConversations').doc('icpChat').set({
          messages: updatedIcpHistory,
          updatedAt: FieldValue.serverTimestamp(),
          icpProfile: resolvedIcpProfile || null,
        });
      } catch (persistErr) {
        console.warn('[barryMissionChat] Could not persist ICP conversation:', persistErr.message);
      }

      await logApiUsage(userId, 'barryMissionChat', 'success', {
        responseTime: Date.now() - startTime,
        metadata: { type: 'icp_reclarification' }
      });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, updatedHistory: updatedIcpHistory, ...icpParsed }),
      };

    } else {
      // ── Conversation Path ──────────────────────────────────────────────────
      console.log('[barryMissionChat] Conversation message, intent detection...');

      const effectiveMode = barryMode;
      // Load contacts server-side when contextStack is not provided (module drawer chats)
      let effectiveContextStack = contextStack;
      if (!effectiveContextStack) {
        try {
          const [contactsSnap, missionsSnap] = await Promise.all([
            db.collection('users').doc(userId).collection('contacts').limit(30).get(),
            db.collection('users').doc(userId).collection('missions')
              .where('status', '==', 'active').limit(10).get(),
          ]);
          effectiveContextStack = {
            contacts: contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            missions: missionsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            recon: {},
            module,
          };
        } catch (ctxErr) {
          console.warn('[barryMissionChat] Could not load context:', ctxErr.message);
          effectiveContextStack = { contacts: [], missions: [], recon: {}, module };
        }
      }

      // ── Fuzzy name search: if user mentions a name not in the context, find them ──
      try {
        const contextNames = (effectiveContextStack?.contacts || []).map(c =>
          (c.name || '').toLowerCase()
        );
        // Extract potential first names / full names from the user's message (simple heuristic)
        const words = message.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter(w => w.length > 1);
        const possibleNames = words.filter(w => w[0] === w[0].toUpperCase());

        if (possibleNames.length > 0) {
          const unmatchedNames = possibleNames.filter(name =>
            !contextNames.some(cn => cn.includes(name.toLowerCase()))
          );

          if (unmatchedNames.length > 0) {
            // Query Firestore for contacts matching any unmatched name (by first_name or name)
            const userRef = db.collection('users').doc(userId);
            const nameSearchResults = [];

            for (const name of unmatchedNames.slice(0, 3)) {
              const [byFirstName, byFullName, byLastName] = await Promise.all([
                userRef.collection('contacts')
                  .where('first_name', '==', name)
                  .limit(3).get(),
                userRef.collection('contacts')
                  .where('name', '>=', name)
                  .where('name', '<=', name + '\uf8ff')
                  .limit(3).get(),
                userRef.collection('contacts')
                  .where('last_name', '==', name)
                  .limit(3).get()
              ]);

              const seen = new Set((effectiveContextStack?.contacts || []).map(c => c.id));
              const addResult = (docSnap) => {
                if (seen.has(docSnap.id)) return;
                seen.add(docSnap.id);
                const c = docSnap.data();
                nameSearchResults.push({
                  id: docSnap.id,
                  name: c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim(),
                  first_name: c.first_name || null,
                  title: c.title || null,
                  company: c.company_name || null,
                  email: c.email || null,
                  relationship_state: c.relationship_state || 'unaware',
                  strategic_value: c.strategic_value || null,
                  last_interaction: c.last_interaction_at || null,
                  hunter_status: c.hunter_status || 'none',
                });
              };

              byFirstName.forEach(addResult);
              byFullName.forEach(addResult);
              byLastName.forEach(addResult);
            }

            if (nameSearchResults.length > 0) {
              effectiveContextStack = {
                ...effectiveContextStack,
                contacts: [...(effectiveContextStack?.contacts || []), ...nameSearchResults]
              };
            }
          }
        }
      } catch (searchErr) {
        console.warn('[barryMissionChat] Fuzzy name search failed (non-fatal):', searchErr.message);
      }

      let systemPrompt = buildMissionControlSystemPrompt(effectiveMode, effectiveContextStack, reconContext, module);
      if (moduleContext) {
        systemPrompt += `\n\n━━━ CURRENT PAGE CONTEXT (module: ${module}) ━━━\n${JSON.stringify(moduleContext, null, 2)}\nUse this as live context for the user's current view — prioritise it over generic contact lists above.`;
      }

      const messages = [
        ...conversationHistory,
        { role: 'user', content: message }
      ];

      const chatController = new AbortController();
      const chatTimeout = setTimeout(() => chatController.abort(), 15000);
      let parsed;

      try {
        const chatResponse = await anthropic.messages.create(
          {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2000,
            system: systemPrompt,
            messages
          },
          { signal: chatController.signal }
        );

        const rawText = chatResponse.content[0].text;
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON in response');
        }
      } catch (err) {
        if (chatController.signal.aborted) console.warn('[barryMissionChat] Chat timed out');
        else console.warn('[barryMissionChat] Chat parse failed:', err.message);

        // Graceful fallback — preserve the conversation
        parsed = {
          intent: 'CUSTOM',
          barry_mode: effectiveMode,
          step: 'execute',
          response_text: 'Intel processing hit a snag — try again in a moment.',
          contact_id: null,
          has_message_angles: false,
          angles: [],
          actions: [],
          clarifying_question: null
        };
      } finally {
        clearTimeout(chatTimeout);
      }

      // Auto-detect mode shift
      const updatedMode = detectModeShift(contextStack, parsed.intent, effectiveMode);
      parsed.barry_mode = updatedMode;

      // Append to history for next call
      const updatedHistory = [
        ...messages,
        { role: 'assistant', content: JSON.stringify(parsed) }
      ];

      await logApiUsage(userId, 'barryMissionChat', 'success', {
        responseTime: Date.now() - startTime,
        metadata: {
          type: 'conversation',
          intent: parsed.intent,
          has_angles: !!parsed.has_message_angles,
          mode: updatedMode
        }
      });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: true,
          // Legacy field
          response: parsed.response_text,
          updatedHistory,
          // Structured fields
          ...parsed
        })
      };
    }

  } catch (error) {
    console.error('[barryMissionChat] Error:', error.message);
    try {
      if (userId) {
        await logApiUsage(userId, 'barryMissionChat', 'error', {
          responseTime: Date.now() - startTime,
          errorCode: error.message,
          metadata: {}
        });
      }
    } catch (_) {}

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
