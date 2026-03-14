/**
 * BARRY CONTEXT ASSEMBLER (server-side) — Unit Tests
 *
 * Tests buildPromptContext logic, priority-based truncation,
 * and strategy insights extraction. Exercises the pure functions
 * without needing Firestore (mocks the DB layer).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assembleBarryContext, clearContextCache } from '../../netlify/functions/utils/barryContextAssembler';

// ── Mock Firestore ──────────────────────────────────────────────────────────

function mockDoc(data, exists = true) {
  return { exists, data: () => data, id: 'mock-id' };
}

function mockQuery(docs = []) {
  return { empty: docs.length === 0, docs: docs.map(d => mockDoc(d)) };
}

function createMockDb({
  contactData = null,
  userMemoryData = null,
  sessionsData = [],
  strategyStatsData = null,
  attributionsData = []
} = {}) {
  const mockDb = {
    collection: vi.fn().mockReturnThis(),
    doc: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn()
  };

  // Track call sequences to return different data
  let callCount = 0;
  const getResponses = [
    mockDoc(contactData || { first_name: 'Test', last_name: 'User' }, contactData !== null),
    mockDoc(userMemoryData || {}, userMemoryData !== null),
    mockQuery(sessionsData),
    mockDoc(strategyStatsData || {}, strategyStatsData !== null),
    mockQuery(attributionsData)
  ];

  mockDb.get.mockImplementation(() => {
    const response = getResponses[callCount] || mockDoc({}, false);
    callCount++;
    return Promise.resolve(response);
  });

  return mockDb;
}

// ── assembleBarryContext ─────────────────────────────────────────────────────

describe('assembleBarryContext', () => {

  beforeEach(() => {
    clearContextCache();
  });

  it('returns null context when contact does not exist', async () => {
    const db = createMockDb({ contactData: null });
    // Override first get to return non-existent
    let callCount = 0;
    db.get.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ exists: false, data: () => null, id: 'x' });
      return Promise.resolve({ exists: false, data: () => ({}), id: 'x', empty: true, docs: [] });
    });

    const { context, promptContext } = await assembleBarryContext(db, 'user1', 'contact1');
    expect(context).toBeNull();
    expect(promptContext).toBe('');
  });

  it('returns structured context for a valid contact', async () => {
    const db = createMockDb({
      contactData: {
        first_name: 'Alice',
        last_name: 'Smith',
        company: 'Acme Corp',
        title: 'VP Sales',
        warmth_level: 'warm',
        contact_status: 'Active',
        barry_memory: {
          who_they_are: 'A key decision maker',
          current_goal: 'Schedule a demo',
          what_has_worked: ['email — positive reply'],
          what_has_not_worked: ['linkedin — no response'],
          what_has_been_tried: ['email', 'linkedin'],
          known_facts: ['Met at conference'],
          tone_preference: 'casual',
          channel_preference: 'email',
          relationship_summary: 'Good rapport'
        },
        engagement_summary: {
          total_sessions: 3,
          total_messages_sent: 5,
          replies_received: 2,
          positive_replies: 1,
          consecutive_no_replies: 0
        }
      }
    });

    const { context, promptContext } = await assembleBarryContext(db, 'user1', 'contact1');

    expect(context).not.toBeNull();
    expect(context.person.name).toBe('Alice Smith');
    expect(context.person.company).toBe('Acme Corp');
    expect(context.memory.who_they_are).toBe('A key decision maker');
    expect(context.memory.what_has_worked).toContain('email — positive reply');
    expect(context.stats.total_sent).toBe(5);
    expect(promptContext).toBeTruthy();
    expect(promptContext).toContain("BARRY'S MEMORY");
  });

  it('handles missing barry_memory gracefully (uses empty defaults)', async () => {
    const db = createMockDb({
      contactData: {
        first_name: 'Bob',
        last_name: 'Jones'
        // no barry_memory field
      }
    });

    const { context } = await assembleBarryContext(db, 'user1', 'contact1');
    expect(context).not.toBeNull();
    expect(context.memory.who_they_are).toBeNull();
    expect(context.memory.what_has_worked).toEqual([]);
    expect(context.memory.known_facts).toEqual([]);
  });

  it('handles errors gracefully without throwing', async () => {
    const db = createMockDb();
    db.get.mockRejectedValue(new Error('Firestore unavailable'));

    const { context, promptContext } = await assembleBarryContext(db, 'user1', 'contact1');
    expect(context).toBeNull();
    expect(promptContext).toBe('');
  });
});

// ── buildPromptContext (tested indirectly through assembleBarryContext) ──────

describe('buildPromptContext — priority truncation', () => {

  beforeEach(() => {
    clearContextCache();
  });

  it('includes P0 sections (who_they_are, current_goal) in prompt context', async () => {
    const db = createMockDb({
      contactData: {
        first_name: 'Alice',
        barry_memory: {
          who_they_are: 'My college friend who runs a startup',
          current_goal: 'Introduce our product',
          what_has_worked: [],
          what_has_not_worked: [],
          what_has_been_tried: [],
          known_facts: [],
          tone_preference: null,
          channel_preference: null,
          relationship_summary: null
        }
      }
    });

    const { promptContext } = await assembleBarryContext(db, 'user1', 'contact1');
    expect(promptContext).toContain('My college friend who runs a startup');
    expect(promptContext).toContain('Introduce our product');
  });

  it('includes known_contact flag as P0 section', async () => {
    const db = createMockDb({
      contactData: {
        first_name: 'Carl',
        known_contact: true,
        barry_memory: {
          who_they_are: null,
          current_goal: null,
          what_has_worked: [],
          what_has_not_worked: [],
          what_has_been_tried: [],
          known_facts: [],
          tone_preference: null,
          channel_preference: null,
          relationship_summary: null
        }
      }
    });

    const { promptContext } = await assembleBarryContext(db, 'user1', 'contact1');
    expect(promptContext).toContain('KNOWN contact');
  });

  it('includes consecutive no-reply warning as P1', async () => {
    const db = createMockDb({
      contactData: {
        first_name: 'Dawn',
        engagement_summary: { consecutive_no_replies: 4, total_messages_sent: 5 },
        barry_memory: {
          who_they_are: null,
          current_goal: null,
          what_has_worked: [],
          what_has_not_worked: [],
          what_has_been_tried: [],
          known_facts: [],
          tone_preference: null,
          channel_preference: null,
          relationship_summary: null
        }
      }
    });

    const { promptContext } = await assembleBarryContext(db, 'user1', 'contact1');
    expect(promptContext).toContain('4 consecutive messages with no reply');
  });
});
