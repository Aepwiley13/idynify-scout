/**
 * BARRY RELATIONSHIP GUARDRAIL — Sprint 2
 *
 * Rule-based pre-generation mismatch check.
 * No AI call — runs against structured fields only. Fast, zero latency impact.
 *
 * Checks for mismatches between contact's relationship signal and the
 * tone of the message being requested. If mismatch detected, returns a
 * barry_warning object that the UI renders as a conversational Barry card.
 *
 * Mismatch rules:
 *   1. Warm/trusted contact + cold/prospecting intent → Barry flags
 *   2. Prior engagement history + no shared context referenced → Barry flags
 *   3. Manually added contact with no relationship classification → Barry asks
 *
 * Returns null if no mismatch detected.
 */

/**
 * Run the pre-generation guardrail check.
 *
 * @param {Object} contact - Full contact document data
 * @param {string} engagementIntent - 'prospect' | 'warm' | 'customer' | 'partner'
 * @param {string} userIntent - Free-form text of what user wants to do
 * @param {Object} [barryContext] - Assembled Barry context (from barryContextAssembler)
 * @returns {Object|null} barry_warning object, or null if no mismatch
 */
export function checkRelationshipGuardrail(contact, engagementIntent, userIntent, barryContext) {
  const warnings = [];

  // Resolve relationship signals
  const warmth = contact.warmth_level;
  const relState = contact.relationship_state;
  const isKnown = contact.known_contact === true;
  const addedManually = contact.addedFrom === 'manual' || contact.addedFrom === 'business_card';
  const hasReplied = (contact.engagement_summary?.replies_received || 0) > 0;
  const hasPositiveReply = (contact.engagement_summary?.positive_replies || 0) > 0;
  const messagesSent = contact.engagement_summary?.total_messages_sent || 0;
  const firstName = contact.first_name || contact.firstName || contact.name?.split(' ')[0] || 'this contact';

  // ── Rule 1: Warm/trusted contact + cold prospecting intent ──────────────
  const isWarmRelationship = (
    warmth === 'warm' || warmth === 'hot' ||
    relState === 'warm' || relState === 'trusted' || relState === 'advocate' ||
    relState === 'strategic_partner' || relState === 'engaged' ||
    isKnown
  );

  const isColdIntent = engagementIntent === 'prospect';

  if (isWarmRelationship && isColdIntent) {
    const warmthReason = isKnown
      ? `you added ${firstName} manually — looks like you know them personally`
      : warmth === 'hot'
        ? `${firstName} is marked as a hot contact`
        : hasPositiveReply
          ? `${firstName} has replied positively before`
          : `${firstName} has an existing relationship with you`;

    warnings.push({
      type: 'tone_mismatch',
      severity: 'high',
      message: `Heads up — ${warmthReason}. The message I'm about to generate might feel a little cold for that relationship. Want me to warm it up, or keep it professional?`,
      actions: [
        { id: 'warm_up', label: 'Warm it up', description: 'Barry adjusts tone to match the relationship' },
        { id: 'keep_professional', label: 'Keep professional', description: 'Proceed with the current approach' },
        { id: 'send_anyway', label: 'Send anyway', description: 'Skip this check and generate as-is' }
      ]
    });
  }

  // ── Rule 2: Prior engagement + user not referencing shared context ───────
  if (hasReplied && messagesSent >= 2) {
    const intentLower = (userIntent || '').toLowerCase();
    const referencesHistory = (
      intentLower.includes('follow up') ||
      intentLower.includes('followup') ||
      intentLower.includes('last conversation') ||
      intentLower.includes('mentioned') ||
      intentLower.includes('continue') ||
      intentLower.includes('we spoke') ||
      intentLower.includes('we talked') ||
      intentLower.includes('our call') ||
      intentLower.includes('our meeting') ||
      intentLower.includes('catching up') ||
      intentLower.includes('check in') ||
      intentLower.includes('reconnect')
    );

    if (!referencesHistory && isColdIntent) {
      warnings.push({
        type: 'missing_context',
        severity: 'medium',
        message: `You've exchanged ${messagesSent} messages with ${firstName} and they've replied before. Want me to reference your shared history, or start fresh?`,
        actions: [
          { id: 'reference_history', label: 'Reference history', description: 'Barry pulls in prior conversation context' },
          { id: 'start_fresh', label: 'Start fresh', description: 'Treat this as a new conversation thread' }
        ]
      });
    }
  }

  // ── Rule 3: Manually added contact with no classification ───────────────
  if (addedManually && !contact.relationship_type && !contact.warmth_level && !contact.relationship_state) {
    warnings.push({
      type: 'unknown_relationship',
      severity: 'low',
      message: `You added ${firstName} manually but haven't told me about the relationship yet. Who is ${firstName} to you? This helps me get the tone right.`,
      actions: [
        { id: 'classify_known', label: 'Someone I know', description: 'Barry treats as warm relationship' },
        { id: 'classify_prospect', label: 'New prospect', description: 'Barry treats as cold outreach' },
        { id: 'skip', label: 'Skip for now', description: 'Generate without classification' }
      ]
    });
  }

  // Return the highest-severity warning (only one at a time to avoid noise)
  if (warnings.length === 0) return null;

  // Sort by severity: high > medium > low
  const severityOrder = { high: 3, medium: 2, low: 1 };
  warnings.sort((a, b) => (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0));

  return warnings[0];
}
