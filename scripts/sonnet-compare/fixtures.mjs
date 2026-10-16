/**
 * Synthetic inputs for the Sonnet comparison (#699).
 *
 * Every person, company and address here is fictional (example.com/.org
 * domains, 555 numbers). Nothing is read from production: the capture step
 * runs against an in-memory Firestore that holds only DOCS below.
 *
 * To add a case, append to CASES with the call site it exercises. Keep the
 * inputs on-topic: barryICPConversation answers off-topic input itself,
 * without calling Claude, and capture reports any case that sends nothing.
 */

export const USER_ID = 'compare-user';
export const AUTH_TOKEN = 'compare-token';

// ─── In-memory Firestore documents (path → data) ────────────────────────────

const PAIN = {
  primaryPain: 'Fresh-food spoilage', painCost: 'About 3% of fresh sales written off',
  successLooksLike: 'Half the write-offs within two quarters', whyFailed: 'Spreadsheet forecasts ignore weather and promotions',
  urgentTrigger: 'A bad holiday quarter on produce',
};

const MESSAGING = {
  emailTone: 'Plain and practical', emailLength: 'short',
  keyMessages: ['Less spoilage', 'Fewer empty shelves'], callsToAction: ['A 15-minute call'],
};

const RECON = {
  modules: [{
    id: 'recon',
    sections: [
      { sectionId: 1, status: 'completed', data: {
        companyName: 'Harborlight Analytics', whatYouDo: 'Forecasting software for regional grocery chains',
        industry: 'Retail software', stage: 'Series A', mainProduct: 'Shelfcast demand forecasting',
        problemSolved: 'Fresh-food waste and out-of-stocks from manual ordering', currentCustomers: '14 regional chains',
      } },
      { sectionId: 2, status: 'completed', data: { keyFeatures: 'Store-level daily forecasts, automated reorder suggestions', pricing: 'Per-store annual subscription' } },
      { sectionId: 3, status: 'completed', data: {
        idealCompanySize: '20-200 stores', geography: 'United States, Midwest first',
        companySize: ['201-500'], targetIndustries: ['Supermarkets', 'Grocery'], companyType: 'Regional chain',
      } },
      // generate-campaign-messages reads these from userInput; the other endpoints from data.
      { sectionId: 5, status: 'completed', data: PAIN, userInput: PAIN },
      { sectionId: 9, status: 'completed', data: MESSAGING, userInput: MESSAGING },
      { sectionId: 10, status: 'not_started' },
    ],
  }],
};

const CONTACTS = {
  'c-maria': {
    name: 'Maria Okafor', firstName: 'Maria', lastName: 'Okafor', first_name: 'Maria', last_name: 'Okafor',
    title: 'VP of Merchandising', company: 'Northfield Markets', company_name: 'Northfield Markets',
    company_industry: 'Supermarkets', email: 'maria.okafor@example.com', city: 'Madison', state: 'WI', country: 'United States',
    seniority: 'vp', department: 'Merchandising', relationship_type: 'prospect', warmth_level: 'cold',
    strategic_value: 'high', engagement_intent: 'prospect',
  },
  'c-dev': {
    name: 'Dev Raman', firstName: 'Dev', lastName: 'Raman', first_name: 'Dev', last_name: 'Raman',
    title: 'Director of Supply Chain', company: 'Prairie Fresh Co-op', company_name: 'Prairie Fresh Co-op',
    company_industry: 'Grocery', email: 'dev.raman@example.org', city: 'Des Moines', state: 'IA', country: 'United States',
    seniority: 'director', department: 'Operations', relationship_type: 'warm_intro', warmth_level: 'warm',
    strategic_value: 'medium', engagement_intent: 'warm',
  },
  'c-lena': {
    name: 'Lena Fischer', firstName: 'Lena', lastName: 'Fischer', first_name: 'Lena', last_name: 'Fischer',
    title: 'Chief Operating Officer', company: 'Lakeshore Grocers', company_name: 'Lakeshore Grocers',
    company_industry: 'Supermarkets', email: 'lena.fischer@example.com', city: 'Grand Rapids', state: 'MI', country: 'United States',
    seniority: 'c_suite', department: 'Executive', relationship_type: 'customer', warmth_level: 'hot',
    strategic_value: 'high', engagement_intent: 'customer',
  },
};

export const DOCS = {
  [`dashboards/${USER_ID}`]: RECON,
  [`users/${USER_ID}`]: { displayName: 'Sam Rivera', firstName: 'Sam' },
  ...Object.fromEntries(Object.entries(CONTACTS).map(([id, data]) => [`users/${USER_ID}/contacts/${id}`, data])),
  [`users/${USER_ID}/campaigns/camp-1`]: { name: 'Q4 spoilage outreach', engagementIntent: 'cold' },
};

const contact = (id) => ({ id, ...CONTACTS[id] });

// ─── Cases: one entry per request a call site sends ─────────────────────────

const base = { userId: USER_ID, authToken: AUTH_TOKEN };

const MISSION = {
  outcome_goal: 'schedule_meeting', engagement_style: 'moderate', timeframe: 'this_month', next_step_type: 'video_call',
};

const PENDING_ICP = {
  industries: ['Supermarkets'], companySizes: ['201-500'], locations: ['Wisconsin', 'Iowa'],
  targetTitles: ['VP of Merchandising', 'Director of Supply Chain'], companyKeywords: ['grocery'],
};

const ICP_HISTORY = [
  { role: 'user', content: 'Regional grocery chains in the Midwest' },
  { role: 'assistant', content: 'Got it. Which roles do you usually sell to?' },
  { role: 'user', content: 'Merchandising and supply chain leaders' },
];

export const CASES = [
  // barryGenerateMissionSequence.js — 1 call
  { site: 'mission-sequence', file: 'barryGenerateMissionSequence.js', label: 'cold VP, meeting this month',
    body: { ...base, missionFields: MISSION, contacts: [contact('c-maria')] } },
  { site: 'mission-sequence', file: 'barryGenerateMissionSequence.js', label: 'warm director, light touch',
    body: { ...base, missionFields: { ...MISSION, engagement_style: 'light_touch', outcome_goal: 'get_introduction' }, contacts: [contact('c-dev')] } },
  { site: 'mission-sequence', file: 'barryGenerateMissionSequence.js', label: 'customer COO, referral',
    body: { ...base, missionFields: { ...MISSION, engagement_style: 'high_touch', outcome_goal: 'ask_for_referral', timeframe: 'this_quarter' }, contacts: [contact('c-lena'), contact('c-dev')] } },

  // barryICPConversation.js — 4 calls, one per action
  { site: 'icp-initial', file: 'barryICPConversation.js', label: 'industry + geography',
    body: { ...base, action: 'process_initial_input', userInput: 'Regional grocery chains in Wisconsin and Iowa with 200-500 employees', existingICP: null } },
  { site: 'icp-initial', file: 'barryICPConversation.js', label: 'roles + size',
    body: { ...base, action: 'process_initial_input', userInput: 'Supply chain directors at mid-size supermarket companies in the Midwest', existingICP: null } },
  { site: 'icp-initial', file: 'barryICPConversation.js', label: 'lookalike',
    body: { ...base, action: 'process_initial_input', userInput: 'Companies like Northfield Markets', existingICP: null } },

  { site: 'icp-followup', file: 'barryICPConversation.js', label: 'adds titles',
    body: { ...base, action: 'process_followup', userInput: 'VPs of merchandising and category managers', currentStep: 'titles', conversationHistory: ICP_HISTORY, pendingICP: PENDING_ICP } },
  { site: 'icp-followup', file: 'barryICPConversation.js', label: 'narrows size',
    body: { ...base, action: 'process_followup', userInput: 'Only chains with more than 50 stores', currentStep: 'size', conversationHistory: ICP_HISTORY, pendingICP: PENDING_ICP } },
  { site: 'icp-followup', file: 'barryICPConversation.js', label: 'adds a state',
    body: { ...base, action: 'process_followup', userInput: 'Add Michigan too', currentStep: 'locations', conversationHistory: ICP_HISTORY, pendingICP: PENDING_ICP } },

  { site: 'icp-example-company', file: 'barryICPConversation.js', label: 'one example',
    body: { ...base, action: 'process_example_company', userInput: 'Lakeshore Grocers is a good example', conversationHistory: ICP_HISTORY, pendingICP: PENDING_ICP } },
  { site: 'icp-example-company', file: 'barryICPConversation.js', label: 'two examples',
    body: { ...base, action: 'process_example_company', userInput: 'Prairie Fresh Co-op and Northfield Markets', conversationHistory: ICP_HISTORY, pendingICP: PENDING_ICP } },
  { site: 'icp-example-company', file: 'barryICPConversation.js', label: 'example with a reason',
    body: { ...base, action: 'process_example_company', userInput: 'Northfield Markets, because they run 80 stores and still order by hand', conversationHistory: ICP_HISTORY, pendingICP: PENDING_ICP } },

  { site: 'icp-summary', file: 'barryICPConversation.js', label: 'short conversation',
    body: { ...base, action: 'generate_summary', conversationHistory: ICP_HISTORY } },
  { site: 'icp-summary', file: 'barryICPConversation.js', label: 'longer conversation',
    body: { ...base, action: 'generate_summary', conversationHistory: [...ICP_HISTORY,
      { role: 'assistant', content: 'Any company size range?' }, { role: 'user', content: '200 to 500 employees' },
      { role: 'assistant', content: 'Any states to focus on?' }, { role: 'user', content: 'Wisconsin, Iowa and Michigan' }] } },
  { site: 'icp-summary', file: 'barryICPConversation.js', label: 'lookalike conversation',
    body: { ...base, action: 'generate_summary', conversationHistory: [
      { role: 'user', content: 'Companies like Lakeshore Grocers' }, { role: 'assistant', content: 'What do they have in common?' },
      { role: 'user', content: 'Regional, 50+ stores, fresh-heavy' }] } },

  // barryGenerateContext.js — 1 call
  { site: 'context', file: 'barryGenerateContext.js', label: 'cold VP',
    body: { ...base, contact: contact('c-maria'), companyData: { name: 'Northfield Markets', industry: 'Supermarkets', size: '201-500', description: 'Regional grocery chain with 62 stores', website: 'northfield.example.com', founded_year: 1974 } } },
  { site: 'context', file: 'barryGenerateContext.js', label: 'warm director',
    body: { ...base, contact: contact('c-dev'), companyData: { name: 'Prairie Fresh Co-op', industry: 'Grocery', size: '51-200', description: 'Member-owned co-op, 18 stores', website: 'prairiefresh.example.org' } } },
  { site: 'context', file: 'barryGenerateContext.js', label: 'customer COO, no company data',
    body: { ...base, contact: contact('c-lena'), companyData: null } },

  // barryGenerateSequenceStep.js — 1 call
  { site: 'sequence-step', file: 'barryGenerateSequenceStep.js', label: 'first email',
    body: { ...base, contact: contact('c-maria'), missionFields: MISSION, stepIndex: 0, stepHistory: [], previousOutcome: null,
      stepPlan: { stepType: 'message', channel: 'email', purpose: 'Open the conversation', action: 'Send a short intro email about spoilage' } } },
  { site: 'sequence-step', file: 'barryGenerateSequenceStep.js', label: 'follow-up after no reply',
    body: { ...base, contact: contact('c-maria'), missionFields: MISSION, stepIndex: 1, previousOutcome: 'no_reply',
      stepHistory: [{ stepType: 'message', channel: 'email', outcome: 'no_reply', summary: 'Intro email about spoilage' }],
      stepPlan: { stepType: 'follow_up', channel: 'email', purpose: 'Re-engage', action: 'Share a one-line customer result' } } },
  { site: 'sequence-step', file: 'barryGenerateSequenceStep.js', label: 'LinkedIn after positive reply',
    body: { ...base, contact: contact('c-dev'), missionFields: { ...MISSION, outcome_goal: 'get_introduction' }, stepIndex: 1, previousOutcome: 'positive_reply',
      stepHistory: [{ stepType: 'message', channel: 'linkedin', outcome: 'positive_reply', summary: 'Asked about their ordering process' }],
      stepPlan: { stepType: 'message', channel: 'linkedin', purpose: 'Ask for the introduction', action: 'Ask who owns forecasting' } } },

  // barryValidateContact.js — 1 call
  { site: 'validate-contact', file: 'barryValidateContact.js', label: 'clear best match',
    body: { ...base, searchParams: { name: 'Maria Okafor', company_name: 'Northfield Markets' }, results: [
      { name: 'Maria Okafor', title: 'VP of Merchandising', organization_name: 'Northfield Markets', email: 'maria.okafor@example.com', city: 'Madison', state: 'WI', match_quality: 0.94 },
      { name: 'Maria Okafor', title: 'Store Manager', organization_name: 'Okafor Family Foods', city: 'Tulsa', state: 'OK', match_quality: 0.61 }] } },
  { site: 'validate-contact', file: 'barryValidateContact.js', label: 'ambiguous same-name',
    body: { ...base, searchParams: { name: 'Dev Raman', company_name: 'Prairie Fresh' }, results: [
      { name: 'Dev Raman', title: 'Director of Supply Chain', organization_name: 'Prairie Fresh Co-op', city: 'Des Moines', state: 'IA', match_quality: 0.82 },
      { name: 'Devendra Raman', title: 'Supply Chain Analyst', organization_name: 'Prairie Fresh Co-op', city: 'Ames', state: 'IA', match_quality: 0.79 },
      { name: 'Dev Raman', title: 'Software Engineer', organization_name: 'Fresh Prairie Labs', match_quality: 0.55 }] } },
  { site: 'validate-contact', file: 'barryValidateContact.js', label: 'LinkedIn URL given',
    body: { ...base, searchParams: { name: 'Lena Fischer', linkedin_url: 'https://www.linkedin.com/in/lena-fischer-example' }, results: [
      { name: 'Lena Fischer', title: 'COO', organization_name: 'Lakeshore Grocers', linkedin_url: 'https://www.linkedin.com/in/lena-fischer-example', match_quality: 0.97 }] } },

  // generate-campaign-messages.js — 1 call per contact
  { site: 'campaign-message', file: 'generate-campaign-messages.js', label: 'cold VP',
    body: { ...base, contactIds: ['c-maria'], campaignName: 'Q4 spoilage outreach', engagementIntent: 'cold' } },
  { site: 'campaign-message', file: 'generate-campaign-messages.js', label: 'warm director',
    body: { ...base, contactIds: ['c-dev'], campaignName: 'Co-op intros', engagementIntent: 'warm' } },
  { site: 'campaign-message', file: 'generate-campaign-messages.js', label: 'customer COO',
    body: { ...base, contactIds: ['c-lena'], campaignName: 'Customer expansion', engagementIntent: 'customer' } },

  // generate-followup.js — 1 call (CommonJS)
  { site: 'followup', file: 'generate-followup.js', label: 'no response',
    body: { idToken: AUTH_TOKEN, contactId: 'c-maria', originalCampaignId: 'camp-1', outcome: 'no_response',
      originalMessage: 'Hi Maria, regional chains like yours lose a lot to fresh-food spoilage. Open to a 15-minute call?' } },
  { site: 'followup', file: 'generate-followup.js', label: 'replied',
    body: { idToken: AUTH_TOKEN, contactId: 'c-dev', originalCampaignId: 'camp-1', outcome: 'replied',
      originalMessage: 'Hi Dev, how does Prairie Fresh decide reorder quantities today?' } },
  { site: 'followup', file: 'generate-followup.js', label: 'no campaign',
    body: { idToken: AUTH_TOKEN, contactId: 'c-lena', originalCampaignId: null, outcome: 'no_response',
      originalMessage: 'Hi Lena, would a quarterly review of forecast accuracy be useful?' } },

  // generate-engagement-message.js — 1 call
  { site: 'engagement-message', file: 'generate-engagement-message.js', label: 'book a meeting',
    body: { ...base, contactId: 'c-maria', contact: contact('c-maria'), engagementIntent: 'prospect', userIntent: 'Get a 20-minute call about spoilage on their fresh departments' } },
  { site: 'engagement-message', file: 'generate-engagement-message.js', label: 'ask for an intro',
    body: { ...base, contactId: 'c-dev', contact: contact('c-dev'), engagementIntent: 'warm', userIntent: 'Ask Dev to introduce me to whoever owns forecasting' } },
  { site: 'engagement-message', file: 'generate-engagement-message.js', label: 'customer check-in',
    body: { ...base, contactId: 'c-lena', contact: contact('c-lena'), engagementIntent: 'customer', userIntent: 'Check in after their first quarter and ask for a case study' } },
];
