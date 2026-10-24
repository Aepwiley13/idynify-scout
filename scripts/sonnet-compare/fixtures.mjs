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
  'c-omar': {
    name: 'Omar Haddad', firstName: 'Omar', lastName: 'Haddad', first_name: 'Omar', last_name: 'Haddad',
    title: 'Category Manager, Produce', company: 'Cedar Valley Foods', company_name: 'Cedar Valley Foods',
    company_industry: 'Supermarkets', email: 'omar.haddad@example.com', city: 'Fargo', state: 'ND', country: 'United States',
    seniority: 'manager', department: 'Merchandising', relationship_type: 'prospect', warmth_level: 'cold',
    strategic_value: 'medium', engagement_intent: 'prospect',
  },
  'c-grace': {
    name: 'Grace Liu', firstName: 'Grace', lastName: 'Liu', first_name: 'Grace', last_name: 'Liu',
    title: 'Chief Financial Officer', company: 'Bluewater Markets', company_name: 'Bluewater Markets',
    company_industry: 'Supermarkets', email: 'grace.liu@example.com', city: 'Milwaukee', state: 'WI', country: 'United States',
    seniority: 'c_suite', department: 'Finance', relationship_type: 'prospect', warmth_level: 'cold',
    strategic_value: 'high', engagement_intent: 'prospect',
  },
  'c-tom': {
    name: 'Tom Becker', firstName: 'Tom', lastName: 'Becker', first_name: 'Tom', last_name: 'Becker',
    title: 'Store Operations Manager', company: 'Northfield Markets', company_name: 'Northfield Markets',
    company_industry: 'Supermarkets', email: 'tom.becker@example.com', city: 'Madison', state: 'WI', country: 'United States',
    seniority: 'manager', department: 'Operations', relationship_type: 'known', warmth_level: 'warm',
    strategic_value: 'low', engagement_intent: 'warm',
  },
  'c-ana': {
    name: 'Ana Ruiz', firstName: 'Ana', lastName: 'Ruiz', first_name: 'Ana', last_name: 'Ruiz',
    title: 'Director of IT', company: 'Lakeshore Grocers', company_name: 'Lakeshore Grocers',
    company_industry: 'Supermarkets', email: 'ana.ruiz@example.com', city: 'Grand Rapids', state: 'MI', country: 'United States',
    seniority: 'director', department: 'Information Technology', relationship_type: 'customer', warmth_level: 'warm',
    strategic_value: 'medium', engagement_intent: 'customer',
  },
  'c-priya': {
    name: 'Priya Natarajan', firstName: 'Priya', lastName: 'Natarajan', first_name: 'Priya', last_name: 'Natarajan',
    title: 'VP, Partnerships', company: 'Freshline Distribution', company_name: 'Freshline Distribution',
    company_industry: 'Food & Beverages', email: 'priya.natarajan@example.org', city: 'Toronto', state: 'ON', country: 'Canada',
    seniority: 'vp', department: 'Business Development', relationship_type: 'partner', warmth_level: 'warm',
    strategic_value: 'high', engagement_intent: 'partner',
  },
  // Sparse on purpose: what a hand-added contact often looks like.
  'c-jordan': {
    name: 'Jordan Pike', firstName: 'Jordan', lastName: 'Pike', first_name: 'Jordan', last_name: 'Pike',
    title: 'Owner', company: "Pike's Corner Grocery", company_name: "Pike's Corner Grocery",
    relationship_type: 'prospect', warmth_level: 'cold', strategic_value: 'low', engagement_intent: 'prospect',
  },
};

export const DOCS = {
  [`dashboards/${USER_ID}`]: RECON,
  [`users/${USER_ID}`]: { displayName: 'Sam Rivera', firstName: 'Sam' },
  ...Object.fromEntries(Object.entries(CONTACTS).map(([id, data]) => [`users/${USER_ID}/contacts/${id}`, data])),
  [`users/${USER_ID}/campaigns/camp-1`]: { name: 'Q4 spoilage outreach', engagementIntent: 'cold' },
  [`users/${USER_ID}/campaigns/camp-2`]: { name: 'Co-op intros', engagementIntent: 'warm' },
  [`users/${USER_ID}/campaigns/camp-3`]: { name: 'Customer expansion', engagementIntent: 'hot' },
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
  // barryGenerateMissionSequence.js — 1 call. The multi-contact cases are the
  // longest replies in the comparison and test the max_tokens headroom.
  ...[
    ['cold VP, meeting this month', MISSION, ['c-maria']],
    ['warm director, light touch', { ...MISSION, engagement_style: 'light_touch', outcome_goal: 'get_introduction' }, ['c-dev']],
    ['customer COO, referral', { ...MISSION, engagement_style: 'high_touch', outcome_goal: 'ask_for_referral', timeframe: 'this_quarter' }, ['c-lena', 'c-dev']],
    ['three contacts, close this week', { outcome_goal: 'close_deal', engagement_style: 'high_touch', timeframe: 'this_week', next_step_type: 'send_message' }, ['c-maria', 'c-tom', 'c-grace']],
    ['five contacts, meetings this quarter', { outcome_goal: 'schedule_meeting', engagement_style: 'moderate', timeframe: 'this_quarter', next_step_type: 'request_meeting' }, ['c-maria', 'c-dev', 'c-omar', 'c-grace', 'c-jordan']],
    ['sparse contact, rebuild', { outcome_goal: 'rebuild_relationship', engagement_style: 'light_touch', timeframe: 'no_deadline', next_step_type: 'follow_up' }, ['c-jordan']],
    ['customer IT, feedback', { outcome_goal: 'gather_feedback', engagement_style: 'moderate', timeframe: 'this_month', next_step_type: 'book_call' }, ['c-ana']],
    ['CFO, commitment this week', { outcome_goal: 'secure_commitment', engagement_style: 'high_touch', timeframe: 'this_week', next_step_type: 'request_meeting' }, ['c-grace']],
    ['two at one company, intro', { outcome_goal: 'get_introduction', engagement_style: 'moderate', timeframe: 'this_month', next_step_type: 'make_introduction' }, ['c-tom', 'c-maria']],
    ['four contacts incl. partner', { outcome_goal: 'close_deal', engagement_style: 'high_touch', timeframe: 'this_quarter', next_step_type: 'send_resource' }, ['c-priya', 'c-grace', 'c-omar', 'c-dev']],
  ].map(([label, missionFields, ids]) => ({
    site: 'mission-sequence', file: 'barryGenerateMissionSequence.js', label,
    body: { ...base, missionFields, contacts: ids.map(contact) },
  })),

  // barryICPConversation.js — 4 calls, one per action
  ...[
    ['industry + geography', 'Regional grocery chains in Wisconsin and Iowa with 200-500 employees'],
    ['roles + size', 'Supply chain directors at mid-size supermarket companies in the Midwest'],
    ['lookalike', 'Companies like Northfield Markets'],
    ['other industry', 'Hospitals in Texas with 1,000 to 5,000 employees'],
    ['role + industry + region', 'CFOs at food distributors with 50-200 employees in the Southeast'],
    ['broad industry', 'Banks in Ohio'],
    ['company age', 'Companies founded in the last 5 years that sell to grocery stores'],
    ['nationwide, large', 'Grocery chains nationwide with more than 1,000 employees'],
    ['loose region', 'Operations leaders at convenience store chains around the Great Lakes'],
    ['two lookalikes', 'Same as my current customers: Lakeshore Grocers and Prairie Fresh Co-op'],
  ].map(([label, userInput]) => ({
    site: 'icp-initial', file: 'barryICPConversation.js', label,
    body: { ...base, action: 'process_initial_input', userInput, existingICP: null },
  })),

  ...[
    ['adds titles', 'VPs of merchandising and category managers', 'titles'],
    ['narrows size', 'Only chains with more than 50 stores', 'size'],
    ['adds a state', 'Add Michigan too', 'locations'],
    ['goes nationwide', 'Actually, make it nationwide', 'locations'],
    ['founded before 2000', 'Only companies founded before 2000', 'foundedAge'],
    ['drops a title', 'Just the VPs, no directors', 'titles'],
    ['defers to Barry', "Not sure, whatever you think is best", 'size'],
    ['adds an industry', 'Add convenience store chains as well', 'industry'],
    ['several states', 'Iowa, Nebraska and the Dakotas', 'locations'],
    ['size range', 'Between 500 and 5,000 employees', 'size'],
  ].map(([label, userInput, currentStep]) => ({
    site: 'icp-followup', file: 'barryICPConversation.js', label,
    body: { ...base, action: 'process_followup', userInput, currentStep, conversationHistory: ICP_HISTORY, pendingICP: PENDING_ICP },
  })),

  ...[
    ['one example', 'Lakeshore Grocers is a good example'],
    ['two examples', 'Prairie Fresh Co-op and Northfield Markets'],
    ['example with a reason', 'Northfield Markets, because they run 80 stores and still order by hand'],
    ['three examples', 'Lakeshore Grocers, Bluewater Markets and Cedar Valley Foods'],
    ['domain only', 'cedarvalleyfoods.example.com'],
    ['name and domain', 'Northfield Markets (northfield.example.com)'],
    ['relative example', 'Something like Bluewater Markets, but a bit smaller'],
    ['size mismatch', "Pike's Corner Grocery, a single-store independent"],
    ['no example', "I don't have a specific company in mind"],
    ['lowercase, terse', 'prairie fresh'],
  ].map(([label, userInput]) => ({
    site: 'icp-example-company', file: 'barryICPConversation.js', label,
    body: { ...base, action: 'process_example_company', userInput, conversationHistory: ICP_HISTORY, pendingICP: PENDING_ICP },
  })),

  ...[
    ['short conversation', ICP_HISTORY],
    ['longer conversation', [...ICP_HISTORY,
      { role: 'assistant', content: 'Any company size range?' }, { role: 'user', content: '200 to 500 employees' },
      { role: 'assistant', content: 'Any states to focus on?' }, { role: 'user', content: 'Wisconsin, Iowa and Michigan' }]],
    ['lookalike conversation', [
      { role: 'user', content: 'Companies like Lakeshore Grocers' }, { role: 'assistant', content: 'What do they have in common?' },
      { role: 'user', content: 'Regional, 50+ stores, fresh-heavy' }]],
    ['user changed their mind', [...ICP_HISTORY,
      { role: 'assistant', content: 'Any states?' }, { role: 'user', content: 'Wisconsin only' },
      { role: 'assistant', content: 'Got it, Wisconsin.' }, { role: 'user', content: 'Actually, the whole Midwest' }]],
    ['other industry', [
      { role: 'user', content: 'Hospitals in Texas' }, { role: 'assistant', content: 'Which roles?' },
      { role: 'user', content: 'Supply chain and materials management directors' },
      { role: 'assistant', content: 'Any size?' }, { role: 'user', content: '1,000 to 5,000 employees' }]],
    ['founded-age filter', [...ICP_HISTORY,
      { role: 'assistant', content: 'Anything about company age?' }, { role: 'user', content: 'Founded before 2000' }]],
    ['one-line conversation', [{ role: 'user', content: 'Grocery chains in Iowa' }]],
    ['long, detailed conversation', [...ICP_HISTORY,
      { role: 'assistant', content: 'Any company size range?' }, { role: 'user', content: '200 to 5,000 employees' },
      { role: 'assistant', content: 'Any states?' }, { role: 'user', content: 'Wisconsin, Iowa, Michigan, Minnesota, Illinois and Indiana' },
      { role: 'assistant', content: 'Which titles exactly?' }, { role: 'user', content: 'VP of Merchandising, Director of Supply Chain, Category Manager for produce, and Head of Store Operations' },
      { role: 'assistant', content: 'Any keywords?' }, { role: 'user', content: 'fresh, perishables, regional chain, private label' },
      { role: 'assistant', content: 'An example company?' }, { role: 'user', content: 'Northfield Markets is the model customer' }]],
    ['two examples', [
      { role: 'user', content: 'Chains like Bluewater Markets and Cedar Valley Foods' },
      { role: 'assistant', content: 'Who do you sell to there?' }, { role: 'user', content: 'Finance and operations leaders' }]],
    ['nationwide', [
      { role: 'user', content: 'Grocery chains nationwide with more than 1,000 employees' },
      { role: 'assistant', content: 'Which roles?' }, { role: 'user', content: 'Heads of supply chain' }]],
  ].map(([label, conversationHistory]) => ({
    site: 'icp-summary', file: 'barryICPConversation.js', label,
    body: { ...base, action: 'generate_summary', conversationHistory },
  })),

  // barryGenerateContext.js — 1 call
  ...[
    ['cold VP', 'c-maria', { name: 'Northfield Markets', industry: 'Supermarkets', size: '201-500', description: 'Regional grocery chain with 62 stores', website: 'northfield.example.com', founded_year: 1974 }],
    ['warm director', 'c-dev', { name: 'Prairie Fresh Co-op', industry: 'Grocery', size: '51-200', description: 'Member-owned co-op, 18 stores', website: 'prairiefresh.example.org' }],
    ['customer COO, no company data', 'c-lena', null],
    ['category manager', 'c-omar', { name: 'Cedar Valley Foods', industry: 'Supermarkets', size: '501-1,000', description: 'Family-owned chain of 31 stores across North Dakota and Minnesota', website: 'cedarvalleyfoods.example.com', founded_year: 1958 }],
    ['CFO', 'c-grace', { name: 'Bluewater Markets', industry: 'Supermarkets', size: '1,001-2,000', description: 'Upscale grocery chain with 44 stores and a growing prepared-foods business', website: 'bluewater.example.com', founded_year: 1991 }],
    ['second contact, same company', 'c-tom', { name: 'Northfield Markets', industry: 'Supermarkets', size: '201-500', description: 'Regional grocery chain with 62 stores', website: 'northfield.example.com', founded_year: 1974 }],
    ['customer IT director', 'c-ana', { name: 'Lakeshore Grocers', industry: 'Supermarkets', size: '501-1,000', description: 'Michigan grocery chain, customer since last year' }],
    ['sparse contact, no company data', 'c-jordan', null],
    ['partner in Canada', 'c-priya', { name: 'Freshline Distribution', industry: 'Food & Beverages', size: '201-500', description: 'Produce distributor serving independent grocers in Ontario and the Great Lakes states', website: 'freshline.example.org' }],
    ['long company description', 'c-maria', { name: 'Northfield Markets', industry: 'Supermarkets', size: '201-500', founded_year: 1974, website: 'northfield.example.com',
      description: 'Regional grocery chain with 62 stores across Wisconsin and northern Illinois. Known for a large produce section, an in-house bakery and a loyalty program with about 400,000 members. Opened a central distribution center in 2019 and is piloting curbside pickup in 12 stores. Recently announced a remodel program for its oldest locations.' }],
  ].map(([label, id, companyData]) => ({
    site: 'context', file: 'barryGenerateContext.js', label,
    body: { ...base, contact: contact(id), companyData },
  })),

  // barryGenerateSequenceStep.js — 1 call
  ...[
    ['first email', 'c-maria', MISSION, 0, null, [],
      { stepType: 'message', channel: 'email', purpose: 'Open the conversation', action: 'Send a short intro email about spoilage' }],
    ['follow-up after no reply', 'c-maria', MISSION, 1, 'no_reply',
      [{ stepIndex: 0, action: 'Intro email about spoilage', outcome: 'no_reply' }],
      { stepType: 'follow_up', channel: 'email', purpose: 'Re-engage', action: 'Share a one-line customer result' }],
    ['LinkedIn after positive reply', 'c-dev', { ...MISSION, outcome_goal: 'get_introduction' }, 1, 'replied_positive',
      [{ stepIndex: 0, action: 'Asked about their ordering process', outcome: 'replied_positive' }],
      { stepType: 'message', channel: 'linkedin', purpose: 'Ask for the introduction', action: 'Ask who owns forecasting' }],
    ['after a decline', 'c-grace', { ...MISSION, outcome_goal: 'secure_commitment' }, 2, 'replied_negative',
      [{ stepIndex: 0, action: 'Intro email on write-off costs', outcome: 'no_reply' }, { stepIndex: 1, action: 'Shared a margin benchmark', outcome: 'replied_negative' }],
      { stepType: 'follow_up', channel: 'email', purpose: 'Close gracefully', action: 'Acknowledge and leave the door open' }],
    ['unclear outcome', 'c-omar', MISSION, 1, 'not_sure',
      [{ stepIndex: 0, action: 'Intro email about produce shrink', outcome: 'not_sure' }],
      { stepType: 'follow_up', channel: 'email', purpose: 'Soft follow-up', action: 'Check whether the first note landed' }],
    ['call script', 'c-ana', { ...MISSION, outcome_goal: 'gather_feedback', next_step_type: 'book_call' }, 0, null, [],
      { stepType: 'call', channel: 'phone', purpose: 'Get feedback on the rollout', action: 'Call to ask how the first quarter went' }],
    ['resource share, nothing given', 'c-dev', MISSION, 2, 'replied_positive',
      [{ stepIndex: 0, action: 'Intro email', outcome: 'no_reply' }, { stepIndex: 1, action: 'Short follow-up', outcome: 'replied_positive' }],
      { stepType: 'resource', channel: 'email', purpose: 'Send proof', action: 'Share a one-page result from a similar co-op' }],
    // The resource exists: the user put its link in the step.
    ['resource share, link given', 'c-maria', MISSION, 1, 'no_reply',
      [{ stepIndex: 0, action: 'Intro email about spoilage', outcome: 'no_reply' }],
      { stepType: 'resource', channel: 'email', purpose: 'Give something useful before asking again',
        action: 'Share our holiday-quarter produce forecasting checklist: https://harborlight.example.com/holiday-produce-checklist.pdf' }],
    ['text message', 'c-tom', { ...MISSION, engagement_style: 'light_touch', timeframe: 'this_week' }, 0, null, [],
      { stepType: 'message', channel: 'text', purpose: 'Quick check-in', action: 'Text to ask for 10 minutes this week' }],
    ['introduction request', 'c-lena', { ...MISSION, outcome_goal: 'ask_for_referral', engagement_style: 'high_touch' }, 1, 'replied_positive',
      [{ stepIndex: 0, action: 'Results check-in call', outcome: 'replied_positive' }],
      { stepType: 'introduction', channel: 'email', purpose: 'Ask for a peer intro', action: 'Ask Lena to introduce one peer chain' }],
    ['final step, sparse contact', 'c-jordan', { ...MISSION, engagement_style: 'light_touch', timeframe: 'no_deadline' }, 2, 'no_reply',
      [{ stepIndex: 0, action: 'Intro email', outcome: 'no_reply' }, { stepIndex: 1, action: 'Follow-up email', outcome: 'no_reply' }],
      { stepType: 'follow_up', channel: 'email', purpose: 'Last touch', action: 'Send a brief final note' }],
  ].map(([label, id, missionFields, stepIndex, previousOutcome, stepHistory, stepPlan]) => ({
    site: 'sequence-step', file: 'barryGenerateSequenceStep.js', label,
    body: { ...base, contact: contact(id), missionFields, stepIndex, stepHistory, previousOutcome, stepPlan },
  })),

  // barryValidateContact.js — 1 call. match_quality is 0-100, as findContact.js computes it.
  ...[
    ['clear best match', { name: 'Maria Okafor', company_name: 'Northfield Markets' }, [
      { name: 'Maria Okafor', title: 'VP of Merchandising', organization_name: 'Northfield Markets', email: 'maria.okafor@example.com', city: 'Madison', state: 'WI', match_quality: 94 },
      { name: 'Maria Okafor', title: 'Store Manager', organization_name: 'Okafor Family Foods', city: 'Tulsa', state: 'OK', match_quality: 61 }]],
    ['ambiguous same-name', { name: 'Dev Raman', company_name: 'Prairie Fresh' }, [
      { name: 'Dev Raman', title: 'Director of Supply Chain', organization_name: 'Prairie Fresh Co-op', city: 'Des Moines', state: 'IA', match_quality: 82 },
      { name: 'Devendra Raman', title: 'Supply Chain Analyst', organization_name: 'Prairie Fresh Co-op', city: 'Ames', state: 'IA', match_quality: 79 },
      { name: 'Dev Raman', title: 'Software Engineer', organization_name: 'Fresh Prairie Labs', match_quality: 55 }]],
    ['LinkedIn URL given', { name: 'Lena Fischer', linkedin_url: 'https://www.linkedin.com/in/lena-fischer-example' }, [
      { name: 'Lena Fischer', title: 'COO', organization_name: 'Lakeshore Grocers', linkedin_url: 'https://www.linkedin.com/in/lena-fischer-example', match_quality: 97 }]],
    ['second result is better', { name: 'Omar Haddad', company_name: 'Cedar Valley Foods' }, [
      { name: 'Omar Haddad', title: 'Software Engineer', organization_name: 'Cedar Valley Tech', city: 'Austin', state: 'TX', match_quality: 71 },
      { name: 'Omar Haddad', title: 'Category Manager, Produce', organization_name: 'Cedar Valley Foods', email: 'omar.haddad@example.com', city: 'Fargo', state: 'ND', match_quality: 68 }]],
    ['no good match', { name: 'Grace Liu', company_name: 'Bluewater Markets' }, [
      { name: 'Grace Liu', title: 'Nurse Practitioner', organization_name: 'Lakeview Health', city: 'Seattle', state: 'WA', match_quality: 40 },
      { name: 'Gracie Lu', title: 'Marketing Coordinator', organization_name: 'Blue Water Media', match_quality: 35 }]],
    ['name only', { name: 'Tom Becker' }, [
      { name: 'Tom Becker', title: 'Store Operations Manager', organization_name: 'Northfield Markets', city: 'Madison', state: 'WI', match_quality: 60 },
      { name: 'Thomas Becker', title: 'Regional Sales Director', organization_name: 'Becker Freight', city: 'Chicago', state: 'IL', match_quality: 58 },
      { name: 'Tom Becker', title: 'Teacher', organization_name: 'Oak Hill School District', match_quality: 52 }]],
    ['title in search', { name: 'Ana Ruiz', company_name: 'Lakeshore Grocers', title: 'Director of IT' }, [
      { name: 'Ana Ruiz', title: 'IT Director', organization_name: 'Lakeshore Grocers', email: 'ana.ruiz@example.com', match_quality: 90 },
      { name: 'Ana Ruiz', title: 'Cashier', organization_name: 'Lakeshore Grocers', match_quality: 85 }]],
    ['company renamed', { name: 'Priya Natarajan', company_name: 'Freshline Produce' }, [
      { name: 'Priya Natarajan', title: 'VP, Partnerships', organization_name: 'Freshline Distribution', city: 'Toronto', state: 'ON', match_quality: 76 }]],
    ['five candidates', { name: 'Jordan Pike' }, [
      { name: 'Jordan Pike', title: 'Owner', organization_name: "Pike's Corner Grocery", match_quality: 64 },
      { name: 'Jordan Pike', title: 'Accountant', organization_name: 'Pike & Co CPAs', match_quality: 63 },
      { name: 'Jordan Pike', title: 'Student', organization_name: 'State University', match_quality: 50 },
      { name: 'Jordyn Pike', title: 'Store Clerk', organization_name: "Pike's Corner Grocery", match_quality: 48 },
      { name: 'J. Pike', title: 'Owner', organization_name: 'Pike Hardware', match_quality: 45 }]],
    ['exact email match', { name: 'Maria Okafor', email: 'maria.okafor@example.com' }, [
      { name: 'Maria Okafor', title: 'VP of Merchandising', organization_name: 'Northfield Markets', email: 'maria.okafor@example.com', match_quality: 100 },
      { name: 'Maria Okafor-Reyes', title: 'Buyer', organization_name: 'Northfield Markets', match_quality: 70 }]],
  ].map(([label, searchParams, results]) => ({
    site: 'validate-contact', file: 'barryValidateContact.js', label,
    body: { ...base, searchParams, results },
  })),

  // generate-campaign-messages.js — 1 call per contact. Intents: cold, warm, hot, followup.
  ...[
    ['cold VP', 'c-maria', 'Q4 spoilage outreach', 'cold'],
    ['warm director', 'c-dev', 'Co-op intros', 'warm'],
    ['customer COO', 'c-lena', 'Customer expansion', 'hot'],
    ['category manager', 'c-omar', 'Produce shrink', 'cold'],
    ['CFO', 'c-grace', 'Margin recovery', 'cold'],
    ['follow-up campaign', 'c-maria', 'Q4 spoilage outreach, round 2', 'followup'],
    ['same company, second contact', 'c-tom', 'Store ops', 'warm'],
    ['customer IT', 'c-ana', 'Integration check-in', 'hot'],
    ['sparse contact', 'c-jordan', 'Independent grocers', 'cold'],
    ['no intent given', 'c-priya', 'Partner outreach', undefined],
  ].map(([label, id, campaignName, engagementIntent]) => ({
    site: 'campaign-message', file: 'generate-campaign-messages.js', label,
    body: { ...base, contactIds: [id], campaignName, engagementIntent },
  })),

  // generate-followup.js — 1 call (CommonJS). Outcomes: replied, no_response.
  // The endpoint never receives the reply's text, so the 'replied' cases test
  // that the draft does not pretend to know it.
  ...[
    ['no response', 'c-maria', 'camp-1', 'no_response', 'Hi Maria, regional chains like yours lose a lot to fresh-food spoilage. Open to a 15-minute call?'],
    ['replied', 'c-dev', 'camp-1', 'replied', 'Hi Dev, how does Prairie Fresh decide reorder quantities today?'],
    ['no campaign', 'c-lena', null, 'no_response', 'Hi Lena, would a quarterly review of forecast accuracy be useful?'],
    ['replied, warm campaign', 'c-tom', 'camp-2', 'replied', 'Hi Tom, Maria mentioned you run store operations. Could we compare notes on produce ordering?'],
    ['replied, customer', 'c-ana', 'camp-3', 'replied', 'Hi Ana, how is the Shelfcast integration holding up after the POS upgrade?'],
    ['replied, empty original', 'c-grace', null, 'replied', ''],
    ['no response, empty original', 'c-omar', null, 'no_response', ''],
    ['no response, long original', 'c-grace', 'camp-1', 'no_response',
      'Hi Grace,\n\nMost grocery chains write off around 3% of fresh sales. For a chain the size of Bluewater, that is a meaningful number on the P&L, and it usually traces back to ordering that cannot see weather or promotions coming.\n\nWe help finance and operations teams cut those write-offs roughly in half within two quarters. Would a 15-minute call to walk through the numbers be useful?\n\nBest,\nSam'],
    ['replied, sparse contact', 'c-jordan', null, 'replied', 'Hi Jordan, do you still place produce orders by hand at the store?'],
    ['no response, partner', 'c-priya', 'camp-2', 'no_response', 'Hi Priya, would Freshline be open to a referral partnership for independent grocers?'],
  ].map(([label, contactId, originalCampaignId, outcome, originalMessage]) => ({
    site: 'followup', file: 'generate-followup.js', label,
    body: { idToken: AUTH_TOKEN, contactId, originalCampaignId, outcome, originalMessage },
  })),

  // generate-engagement-message.js — 1 call. Intents: prospect, warm, customer, partner.
  ...[
    ['book a meeting', 'c-maria', 'prospect', 'Get a 20-minute call about spoilage on their fresh departments'],
    ['ask for an intro', 'c-dev', 'warm', 'Ask Dev to introduce me to whoever owns forecasting'],
    ['customer check-in', 'c-lena', 'customer', 'Check in after their first quarter and ask for a case study'],
    ['category manager, cold', 'c-omar', 'prospect', 'Offer a free produce shrink benchmark for Cedar Valley'],
    ['CFO, ROI angle', 'c-grace', 'prospect', 'Get a meeting with the CFO about the cost of fresh write-offs'],
    ['second contact, same company', 'c-tom', 'warm', "Ask Tom what store teams think about ordering, since Maria hasn't replied"],
    ['customer, technical', 'c-ana', 'customer', 'Ask Ana to join a beta for the new POS integration'],
    ['partner', 'c-priya', 'partner', 'Propose a co-marketing webinar for independent grocers'],
    ['sparse contact', 'c-jordan', 'prospect', 'Introduce ourselves to a single-store owner'],
    ['long, specific intent', 'c-maria', 'prospect',
      'Follow up on the trade show where we met briefly at the produce panel. Mention the panel, offer the holiday-quarter forecasting checklist we handed out, and ask for 15 minutes in the next two weeks. Keep it short and do not mention pricing.'],
  ].map(([label, id, engagementIntent, userIntent]) => ({
    site: 'engagement-message', file: 'generate-engagement-message.js', label,
    body: { ...base, contactId: id, contact: contact(id), engagementIntent, userIntent },
  })),
];
