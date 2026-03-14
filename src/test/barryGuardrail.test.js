/**
 * BARRY GUARDRAIL — Unit Tests
 *
 * Tests the pre-generation relationship mismatch guardrail
 * and the guardrail → prompt modifier mapping.
 */
import { describe, it, expect } from 'vitest';
import { checkRelationshipGuardrail, getGuardrailPromptModifier } from '../../netlify/functions/utils/barryGuardrail';

// ── checkRelationshipGuardrail ──────────────────────────────────────────────

describe('checkRelationshipGuardrail', () => {

  // ── Rule 1: Warm contact + cold intent ──

  it('returns tone_mismatch when warm contact is treated as prospect', () => {
    const contact = { warmth_level: 'warm', first_name: 'Sarah' };
    const result = checkRelationshipGuardrail(contact, 'prospect', 'reach out cold');
    expect(result).not.toBeNull();
    expect(result.type).toBe('tone_mismatch');
    expect(result.severity).toBe('high');
    expect(result.actions).toHaveLength(3);
  });

  it('returns tone_mismatch for hot contacts with prospect intent', () => {
    const contact = { warmth_level: 'hot', first_name: 'Mike' };
    const result = checkRelationshipGuardrail(contact, 'prospect', 'intro email');
    expect(result.type).toBe('tone_mismatch');
    expect(result.message).toContain('Mike');
  });

  it('returns tone_mismatch for known contacts with prospect intent', () => {
    const contact = { known_contact: true, first_name: 'Alex' };
    const result = checkRelationshipGuardrail(contact, 'prospect', 'intro');
    expect(result.type).toBe('tone_mismatch');
    expect(result.message).toContain('added Alex manually');
  });

  it('returns tone_mismatch when relationship_state is trusted and intent is prospect', () => {
    const contact = { relationship_state: 'trusted', first_name: 'Pat' };
    const result = checkRelationshipGuardrail(contact, 'prospect', 'cold email');
    expect(result.type).toBe('tone_mismatch');
  });

  it('returns null for cold contact with prospect intent (no mismatch)', () => {
    const contact = { warmth_level: 'cold', first_name: 'New Person' };
    const result = checkRelationshipGuardrail(contact, 'prospect', 'intro');
    expect(result).toBeNull();
  });

  it('returns null for warm contact with warm intent (aligned)', () => {
    const contact = { warmth_level: 'warm', first_name: 'Friend' };
    const result = checkRelationshipGuardrail(contact, 'warm', 'follow up');
    expect(result).toBeNull();
  });

  // ── Rule 2: Prior engagement + no shared context ──

  it('returns missing_context when contact has prior replies but intent is generic', () => {
    const contact = {
      first_name: 'Dan',
      engagement_summary: { replies_received: 2, total_messages_sent: 3 }
    };
    const result = checkRelationshipGuardrail(contact, 'prospect', 'send a message');
    expect(result).not.toBeNull();
    expect(result.type).toBe('missing_context');
    expect(result.severity).toBe('medium');
  });

  it('returns null when user references shared history in intent', () => {
    const contact = {
      first_name: 'Dan',
      engagement_summary: { replies_received: 2, total_messages_sent: 3 }
    };
    const result = checkRelationshipGuardrail(contact, 'prospect', 'follow up on our last conversation');
    expect(result).toBeNull();
  });

  it('returns null when not enough messages sent (under threshold)', () => {
    const contact = {
      first_name: 'Lisa',
      engagement_summary: { replies_received: 1, total_messages_sent: 1 }
    };
    const result = checkRelationshipGuardrail(contact, 'prospect', 'hello');
    expect(result).toBeNull();
  });

  // ── Rule 3: Manually added with no classification ──

  it('returns unknown_relationship for manually added unclassified contact', () => {
    const contact = {
      first_name: 'Unknown',
      addedFrom: 'manual'
    };
    const result = checkRelationshipGuardrail(contact, 'prospect', 'intro');
    expect(result).not.toBeNull();
    expect(result.type).toBe('unknown_relationship');
    expect(result.severity).toBe('low');
  });

  it('returns null for manually added contact that HAS classification', () => {
    const contact = {
      first_name: 'Known',
      addedFrom: 'manual',
      relationship_type: 'partner'
    };
    const result = checkRelationshipGuardrail(contact, 'prospect', 'intro');
    expect(result).toBeNull();
  });

  // ── Priority: highest severity wins ──

  it('returns tone_mismatch (high) over missing_context (medium) when both fire', () => {
    const contact = {
      warmth_level: 'warm',
      first_name: 'Multi',
      engagement_summary: { replies_received: 3, total_messages_sent: 5 }
    };
    const result = checkRelationshipGuardrail(contact, 'prospect', 'generic message');
    expect(result.type).toBe('tone_mismatch');
    expect(result.severity).toBe('high');
  });

  // ── Rule 4: Cold contact + warm intent (reverse mismatch) ──

  it('returns reverse_tone_mismatch for cold contact with warm intent', () => {
    const contact = { first_name: 'Stranger', warmth_level: 'cold' };
    const result = checkRelationshipGuardrail(contact, 'warm', 'reconnect');
    expect(result).not.toBeNull();
    expect(result.type).toBe('reverse_tone_mismatch');
    expect(result.severity).toBe('medium');
    expect(result.actions).toHaveLength(3);
    expect(result.actions.map(a => a.id)).toContain('cool_down');
    expect(result.actions.map(a => a.id)).toContain('actually_know');
  });

  it('returns reverse_tone_mismatch for unknown contact with customer intent', () => {
    const contact = { first_name: 'Nobody' };
    const result = checkRelationshipGuardrail(contact, 'customer', 'check in');
    expect(result).not.toBeNull();
    expect(result.type).toBe('reverse_tone_mismatch');
  });

  it('returns null for cold contact with prospect intent (aligned)', () => {
    const contact = { first_name: 'Cold' };
    const result = checkRelationshipGuardrail(contact, 'prospect', 'intro');
    expect(result).toBeNull();
  });

  it('does NOT flag reverse mismatch if contact has prior replies', () => {
    const contact = {
      first_name: 'Replied',
      engagement_summary: { replies_received: 1 }
    };
    const result = checkRelationshipGuardrail(contact, 'warm', 'catch up');
    // Should not fire reverse_tone_mismatch because they have engagement history
    if (result) {
      expect(result.type).not.toBe('reverse_tone_mismatch');
    }
  });

  // ── Edge cases ──

  it('returns null when contact is empty object with prospect intent', () => {
    const result = checkRelationshipGuardrail({}, 'prospect', '');
    expect(result).toBeNull();
  });

  it('returns reverse_tone_mismatch for empty contact with warm intent', () => {
    const result = checkRelationshipGuardrail({}, 'warm', '');
    expect(result).not.toBeNull();
    expect(result.type).toBe('reverse_tone_mismatch');
  });

  it('handles missing first_name gracefully (falls back to "this contact")', () => {
    const contact = { warmth_level: 'warm' };
    const result = checkRelationshipGuardrail(contact, 'prospect', 'cold');
    expect(result).not.toBeNull();
    expect(result.message).toContain('this contact');
  });
});

// ── getGuardrailPromptModifier ──────────────────────────────────────────────

describe('getGuardrailPromptModifier', () => {

  it('returns warm_up modifier with GUARDRAIL INSTRUCTION prefix', () => {
    const mod = getGuardrailPromptModifier('warm_up', 'tone_mismatch', { first_name: 'Sam' });
    expect(mod).toContain('GUARDRAIL INSTRUCTION');
    expect(mod).toContain('Sam');
    expect(mod).toContain('warm and familiar');
  });

  it('returns keep_professional modifier', () => {
    const mod = getGuardrailPromptModifier('keep_professional', 'tone_mismatch', { first_name: 'Jo' });
    expect(mod).toContain('professional tone');
  });

  it('returns empty string for send_anyway (no modification)', () => {
    const mod = getGuardrailPromptModifier('send_anyway', 'tone_mismatch', {});
    expect(mod).toBe('');
  });

  it('returns reference_history modifier for missing_context guardrail', () => {
    const mod = getGuardrailPromptModifier('reference_history', 'missing_context', { first_name: 'Russ' });
    expect(mod).toContain('shared history');
    expect(mod).toContain('Russ');
  });

  it('returns empty string for start_fresh', () => {
    const mod = getGuardrailPromptModifier('start_fresh', 'missing_context', {});
    expect(mod).toBe('');
  });

  it('returns classify_known modifier for unknown_relationship', () => {
    const mod = getGuardrailPromptModifier('classify_known', 'unknown_relationship', { first_name: 'Ed' });
    expect(mod).toContain('warm relationship');
  });

  it('returns cool_down modifier for reverse_tone_mismatch', () => {
    const mod = getGuardrailPromptModifier('cool_down', 'reverse_tone_mismatch', {});
    expect(mod).toContain('GUARDRAIL INSTRUCTION');
    expect(mod).toContain('cold contact');
  });

  it('returns actually_know modifier for reverse_tone_mismatch', () => {
    const mod = getGuardrailPromptModifier('actually_know', 'reverse_tone_mismatch', { first_name: 'Pal' });
    expect(mod).toContain('GUARDRAIL INSTRUCTION');
    expect(mod).toContain('Pal');
    expect(mod).toContain('warm relationship');
  });

  it('returns empty string for unknown action id', () => {
    const mod = getGuardrailPromptModifier('nonexistent_action', 'tone_mismatch', {});
    expect(mod).toBe('');
  });
});
