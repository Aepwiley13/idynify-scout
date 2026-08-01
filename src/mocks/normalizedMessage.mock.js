/**
 * Mock NormalizedMessage objects for Team B development and QA.
 * Used by /barry/test-message endpoint until Team A delivers real Gmail ingestion.
 */

const BASE = {
  idynifyUserId: 'user_abc123',
  gmailAccountId: 'aaron@idynify.com',
  toEmails: ['aaron@idynify.com'],
  ccEmails: [],
  direction: 'inbound',
  bodyHtml: null,
  quotedReplyText: null,
  signature: null,
  attachments: [],
  isFirstMessageInThread: false,
  ingestionVersion: '1.0.0',
};

function ts(minutesAgo = 0) {
  return new Date(Date.now() - minutesAgo * 60000).toISOString();
}

export const MOCK_SCENARIOS = {
  reply_with_questions: {
    ...BASE,
    gmailMessageId: 'mock_msg_questions_001',
    gmailThreadId: 'mock_thread_questions',
    category: 'reply',
    fromEmail: 'sarah.chen@techcorp.io',
    fromName: 'Sarah Chen',
    subject: 'Re: Scaling your outbound motion',
    receivedAt: ts(1),
    sentAt: null,
    bodyText: "Hi Aaron, thanks for reaching out. We're actually evaluating a few options right now and your timing is good. What does the onboarding process look like? Also — do you work with Series B companies specifically? We closed our B round in March.",
    quotedReplyText: 'On Jul 29, Aaron Wiley wrote: Hi Sarah, I wanted to reach out about...',
    signature: 'Sarah Chen\nVP of Sales, TechCorp\nsarah.chen@techcorp.io',
    threadMessageCount: 2,
    ingestedAt: ts(0),
  },

  reply_positive: {
    ...BASE,
    gmailMessageId: 'mock_msg_positive_001',
    gmailThreadId: 'mock_thread_positive',
    category: 'reply',
    fromEmail: 'james.park@growthworks.co',
    fromName: 'James Park',
    subject: 'Re: Quick question about your outbound strategy',
    receivedAt: ts(3),
    sentAt: null,
    bodyText: "This is really interesting — I've been looking for exactly this kind of solution. We're growing fast and outbound is becoming a bottleneck. Love what you're building. Let me loop in my co-founder next week.",
    threadMessageCount: 2,
    ingestedAt: ts(2),
  },

  reply_objection: {
    ...BASE,
    gmailMessageId: 'mock_msg_objection_001',
    gmailThreadId: 'mock_thread_objection',
    category: 'reply',
    fromEmail: 'lisa.martinez@scaleup.io',
    fromName: 'Lisa Martinez',
    subject: 'Re: Helping ScaleUp hit pipeline targets',
    receivedAt: ts(5),
    sentAt: null,
    bodyText: "Thanks for the note. Honestly, we've been burned by outbound tools before — spent $2k/mo on Apollo and got almost nothing from it. What makes your approach different? I'm skeptical but willing to listen if you can show real ROI data.",
    threadMessageCount: 2,
    ingestedAt: ts(4),
  },

  reply_scheduling: {
    ...BASE,
    gmailMessageId: 'mock_msg_scheduling_001',
    gmailThreadId: 'mock_thread_scheduling',
    category: 'reply',
    fromEmail: 'david.kim@nextstep.dev',
    fromName: 'David Kim',
    subject: 'Re: Intro — Idynify for developer agencies',
    receivedAt: ts(2),
    sentAt: null,
    bodyText: "Hey Aaron, yeah this looks relevant. Can we set up a time to chat this week? I'm free Thursday after 2pm EST or Friday morning. Would love to hop on a call and learn more about how you handle ICP building.",
    threadMessageCount: 2,
    ingestedAt: ts(1),
  },

  out_of_office: {
    ...BASE,
    gmailMessageId: 'mock_msg_ooo_001',
    gmailThreadId: 'mock_thread_ooo',
    category: 'automated',
    fromEmail: 'rachel.wong@bigcorp.com',
    fromName: 'Rachel Wong',
    subject: 'Out of Office: Re: Partnership opportunity',
    receivedAt: ts(10),
    sentAt: null,
    bodyText: "Thank you for your email. I am currently out of the office with limited access to email and will return on August 11th. For urgent matters, please contact my colleague Mark Stevens at mark.stevens@bigcorp.com.",
    threadMessageCount: 2,
    ingestedAt: ts(9),
  },

  unmatched_sender: {
    ...BASE,
    gmailMessageId: 'mock_msg_unmatched_001',
    gmailThreadId: 'mock_thread_unmatched',
    category: 'unknown',
    fromEmail: 'unknown.person@randomdomain.net',
    fromName: 'Unknown Person',
    subject: 'Saw your post on LinkedIn',
    receivedAt: ts(7),
    sentAt: null,
    bodyText: "Hey, I came across your LinkedIn post about outbound sales and wanted to reach out. We might have some synergies. Would love to connect.",
    isFirstMessageInThread: true,
    threadMessageCount: 1,
    ingestedAt: ts(6),
  },

  new_contact_inbound: {
    ...BASE,
    gmailMessageId: 'mock_msg_new_contact_001',
    gmailThreadId: 'mock_thread_new_contact',
    category: 'new_inbound',
    fromEmail: 'sarah.chen@techcorp.io',
    fromName: 'Sarah Chen',
    subject: 'Interested in Idynify',
    receivedAt: ts(4),
    sentAt: null,
    bodyText: "Hi Aaron, I found Idynify through a colleague's recommendation. We're a Series B SaaS company looking to scale our outbound motion. Can you tell me more about how it works?",
    isFirstMessageInThread: true,
    threadMessageCount: 1,
    ingestedAt: ts(3),
  },

  reply_no_response_needed: {
    ...BASE,
    gmailMessageId: 'mock_msg_ack_001',
    gmailThreadId: 'mock_thread_ack',
    category: 'reply',
    fromEmail: 'james.park@growthworks.co',
    fromName: 'James Park',
    subject: 'Re: Follow-up — next steps',
    receivedAt: ts(1),
    sentAt: null,
    bodyText: "Got it, thanks!",
    threadMessageCount: 3,
    ingestedAt: ts(0),
  },
};

export function getMockMessage(mockKey) {
  const mock = MOCK_SCENARIOS[mockKey];
  if (!mock) {
    const available = Object.keys(MOCK_SCENARIOS).join(', ');
    throw new Error(`Unknown mock key: "${mockKey}". Available: ${available}`);
  }
  return { ...mock };
}
