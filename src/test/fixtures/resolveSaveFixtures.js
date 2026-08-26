/**
 * REAL RESOLVE_SAVE response fixtures.
 *
 * Transcribed from netlify/functions/barryResolveSave.js — the shapes the server
 * actually returns, not an approximation. Tests render against these so drift in
 * the real contract surfaces here rather than in production.
 */

export const RESOLVED_PREVIEW = {
  success: true,
  operationId: 'op_fixture_1',
  committed: false,
  results: [
    { clientRef: 'ui_a', outcome: 'matched', contactId: 'c_existing_1', matchedOn: 'email', existingName: 'Sarah Chen' },
    { clientRef: 'ui_b', outcome: 'matched', contactId: 'c_existing_2', matchedOn: 'linkedin_url', existingName: 'Marcus Webb' },
    { clientRef: 'ui_c', outcome: 'created', contactId: null, matchedOn: null },
    {
      clientRef: 'ui_d', outcome: 'ambiguous', contactId: null, matchedOn: 'name_company',
      name: 'Sarah Johnson',
      // Exactly three fields — the server sends no title and no lastInteraction.
      candidates: [
        { contactId: 'c_amb_1', existingName: 'Sarah Johnson', company_name: 'Acme' },
        { contactId: 'c_amb_2', existingName: 'Sarah Johnson', company_name: 'Contoso' },
      ],
    },
    {
      clientRef: 'ui_e', outcome: 'refused', contactId: null, matchedOn: null,
      name: 'Daniel Brooks',
      reason: 'insufficient_identity',
      detail: 'needs an email, phone, LinkedIn or Apollo id — or a name together with a company — before it can become a contact',
    },
  ],
  summary: { matched: 2, created: 1, ambiguous: 1, refused: 1 },
};

/** A rejected disambiguation answer comes back ambiguous WITH a reason. */
export const STALE_RESOLUTION_PREVIEW = {
  success: true, operationId: 'op_fixture_1', committed: false,
  results: [{
    clientRef: 'ui_d', outcome: 'ambiguous', contactId: null, matchedOn: 'name_company',
    reason: 'candidate_not_offered', name: 'Sarah Johnson', existingName: 'Sarah Johnson',
    candidates: [
      { contactId: 'c_amb_1', existingName: 'Sarah Johnson', company_name: 'Acme' },
      { contactId: 'c_amb_2', existingName: 'Sarah Johnson', company_name: 'Contoso' },
    ],
  }],
  summary: { matched: 0, created: 0, ambiguous: 1, refused: 0 },
};

export const LINK_ALL_ALREADY_THERE = {
  success: true, operationId: 'op_fixture_1', targetStage: 'scout',
  results: [], summary: { total: 20, moved: 0, alreadyThere: 20, notFound: 0 },
};
