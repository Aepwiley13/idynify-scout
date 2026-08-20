/**
 * The first conversation, end to end.
 *
 * WHO ─► INTENT ─► FIRST VALUE, driven the way a user drives it. The source
 * assertions elsewhere pin structure; this pins behaviour, and in particular
 * the one thing that would be catastrophic to get wrong quietly: a user who
 * came to do something other than prospect must never be dropped into a
 * targeting conversation, and must never cause an ICP to be extracted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: null } }));

let contactsEmpty = true;
let gmailStatus = null;

vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => ({ __path: path.join('/') }),
  getDoc: async (ref) => {
    if (ref.__path.endsWith('integrations/gmail')) {
      return { exists: () => gmailStatus !== null, data: () => ({ status: gmailStatus }) };
    }
    // The user document and the conversation document: a genuinely new user.
    return { exists: () => false, data: () => null };
  },
  getDocs: async () => ({ empty: contactsEmpty, docs: [] }),
  collection: (_db, ...path) => ({ __path: path.join('/') }),
  query: (c) => c,
  limit: () => ({}),
  where: () => ({}),
  orderBy: () => ({}),
  setDoc: async () => {},
  serverTimestamp: () => 'ts',
}));

vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1', displayName: null, getIdToken: async () => 'tok' }),
  getActiveUserId: () => 'u1',
  useActiveUserId: () => 'u1',
  useImpersonation: () => ({ isReadOnly: false }),
  ImpersonationProvider: ({ children }) => children,
}));

// B8's relationship branch reads the user's own contacts through the local
// people search. What that branch produces is asserted in its own test; here
// it only has to exist so the routing can be driven end to end.
let peopleInWorkspace = [];
vi.mock('../services/peopleService', () => ({
  searchPeople: async (_uid, term) => (term && term.trim().length >= 2 ? peopleInWorkspace : []),
  loadPeopleForLens: async () => ({ people: peopleInWorkspace, hasMore: false, total: peopleInWorkspace.length }),
}));

vi.mock('../services/analytics', () => ({
  logEvent: vi.fn(),
  EVENTS: {
    ENRICHMENT_ATTEMPTED: 'enrichment_attempted',
    ENRICHMENT_SUCCEEDED: 'enrichment_succeeded',
    ENRICHMENT_FAILED: 'enrichment_failed',
  },
}));

vi.mock('../theme/ThemeContext', () => ({
  useT: () => ({ text: '#000', textMuted: '#666', border: '#ccc', surface: '#fff', accent: '#409' }),
}));

// A genuinely new user has no ICP. The three unresolved reasons stay distinct
// upstream; here the only thing that matters is that nothing resolved.
vi.mock('../utils/resolveActiveIcp', () => ({
  resolveActiveIcp: async () => ({ status: 'unresolved', reason: 'no-profiles', candidates: [] }),
  isResolved: (r) => r?.status === 'resolved',
}));

// Stands in for the real targeting conversation. Its only job here is to be
// unmistakable when it renders — and to be absent when it must not.
vi.mock('../pages/Onboarding/BarryOnboarding', () => ({
  default: () => <div data-testid="targeting-conversation">Who are you hunting?</div>,
}));

import FirstExperience from '../pages/Onboarding/FirstExperience';

// ── Harness ─────────────────────────────────────────────────────────────────

let fetchSpy;
let classification;

function mockClassifier() {
  fetchSpy = vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, mode: 'FIRST_EXPERIENCE', classification }),
  }));
  globalThis.fetch = fetchSpy;
}

beforeEach(() => {
  contactsEmpty = true;
  gmailStatus = null;
  peopleInWorkspace = [];
  classification = null;
  sessionStorage.clear();
  mockClassifier();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mount() {
  return render(
    <MemoryRouter initialEntries={['/onboarding']}>
      <Routes>
        <Route path="/onboarding" element={<FirstExperience />} />
        <Route path="/mission-control-v2" element={<div data-testid="mission-control" />} />
        <Route path="/hunter" element={<div data-testid="hunter" />} />
        <Route path="/settings" element={<div data-testid="settings" />} />
      </Routes>
    </MemoryRouter>
  );
}

/** Answer the WHO question, then answer the INTENT question with `said`. */
async function converse(user, said, { name = 'Dana' } = {}) {
  await screen.findByText('What should I call you?');
  await user.type(screen.getByLabelText('Your name'), name);
  await user.click(screen.getByRole('button', { name: 'Continue' }));

  const input = await screen.findByLabelText('What you want to get done');
  await user.type(input, said);
  await act(async () => {
    await user.click(screen.getByRole('button', { name: 'Continue' }));
  });
}

// ── The shape of a first conversation ───────────────────────────────────────

describe('WHO comes first, and is one question', () => {
  it('asks for a name, then asks what the user wants to get done', async () => {
    const user = userEvent.setup();
    mount();

    await screen.findByText('What should I call you?');
    await user.type(screen.getByLabelText('Your name'), 'Dana');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByLabelText('What you want to get done')).toBeTruthy();
  });

  it('skipping the name still reaches the intent question', async () => {
    const user = userEvent.setup();
    mount();

    await screen.findByText('What should I call you?');
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(await screen.findByLabelText('What you want to get done')).toBeTruthy();
  });

  it('greets by name without turning the question into a form', async () => {
    const user = userEvent.setup();
    mount();

    await screen.findByText('What should I call you?');
    await user.type(screen.getByLabelText('Your name'), 'Dana');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/^Dana — /)).toBeTruthy();
  });

  it('does not open by presuming the user came to prospect', async () => {
    const user = userEvent.setup();
    mount();

    await screen.findByText('What should I call you?');
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByLabelText('What you want to get done');

    expect(screen.queryByTestId('targeting-conversation')).toBeNull();
  });
});

describe('each intent reaches something real', () => {
  it('prospecting continues here, in the targeting conversation', async () => {
    classification = { intent: 'PROSPECTING', confidence: 0.95 };
    const user = userEvent.setup();
    mount();

    await converse(user, 'I need to find more manufacturers in Texas');

    expect(await screen.findByTestId('targeting-conversation')).toBeTruthy();
  });

  it('exploration hands off to Mission Control', async () => {
    classification = { intent: 'EXPLORATION', confidence: 0.9 };
    const user = userEvent.setup();
    mount();

    await converse(user, 'just having a look around');
    await user.click(await screen.findByRole('button', { name: 'Take me there' }));

    expect(await screen.findByTestId('mission-control')).toBeTruthy();
  });

  it('pipeline hands off once there are people to have a pipeline of', async () => {
    contactsEmpty = false;
    classification = { intent: 'PIPELINE', confidence: 0.9 };
    const user = userEvent.setup();
    mount();

    await converse(user, 'where do things stand with my deals');
    await user.click(await screen.findByRole('button', { name: 'Take me there' }));

    expect(await screen.findByTestId('hunter')).toBeTruthy();
  });

  it('outreach names the person back before handing off', async () => {
    contactsEmpty = false;
    classification = { intent: 'OUTREACH', confidence: 0.9, subject: 'Dana at Acme' };
    const user = userEvent.setup();
    mount();

    await converse(user, 'I need to email Dana at Acme');

    expect(await screen.findByText(/Dana at Acme/)).toBeTruthy();
  });

  it('communication with no mailbox connected offers to connect one', async () => {
    contactsEmpty = false;
    classification = { intent: 'COMMUNICATION', confidence: 0.9 };
    const user = userEvent.setup();
    mount();

    await converse(user, 'I have replies I have not answered');
    await user.click(await screen.findByRole('button', { name: 'Set that up' }));

    expect(await screen.findByTestId('settings')).toBeTruthy();
  });

  it('communication with a connected mailbox goes to the replies', async () => {
    contactsEmpty = false;
    gmailStatus = 'connected';
    classification = { intent: 'COMMUNICATION', confidence: 0.9 };
    const user = userEvent.setup();
    mount();

    await converse(user, 'anyone written back?');
    await user.click(await screen.findByRole('button', { name: 'Take me there' }));

    expect(await screen.findByTestId('hunter')).toBeTruthy();
  });

  it('engagement answers about a named person from records already owned', async () => {
    contactsEmpty = false;
    peopleInWorkspace = [{
      id: 'c1', name: 'Dana Whitfield', company: 'Acme Roofing', email: 'd@acme.com',
      engagement_summary: { last_contact_at: new Date(Date.now() - 120 * 864e5).toISOString() },
    }];
    classification = { intent: 'ENGAGEMENT', confidence: 0.9, subject: 'Dana at Acme Roofing' };
    const user = userEvent.setup();
    mount();

    await converse(user, 'I should reconnect with Dana at Acme Roofing');

    expect(await screen.findByText(/where things stand with Dana Whitfield/)).toBeTruthy();
    expect(screen.queryByTestId('targeting-conversation')).toBeNull();
  });

  it('engagement with nobody named surfaces who has gone quiet', async () => {
    contactsEmpty = false;
    peopleInWorkspace = [{
      id: 'c1', name: 'Dana Whitfield', company: 'Acme Roofing',
      engagement_summary: { last_contact_at: new Date(Date.now() - 200 * 864e5).toISOString() },
    }];
    classification = { intent: 'ENGAGEMENT', confidence: 0.9, subject: 'old clients' };
    const user = userEvent.setup();
    mount();

    await converse(user, 'I should reconnect with old clients');

    expect(await screen.findByText(/longest with/i)).toBeTruthy();
  });

  it('preparation is bounded to what the platform holds', async () => {
    contactsEmpty = false;
    peopleInWorkspace = [{ id: 'c2', name: 'Sam Okafor', company: 'Acme' }];
    classification = { intent: 'PREPARATION', confidence: 0.9, subject: 'Sam at Acme' };
    const user = userEvent.setup();
    mount();

    await converse(user, 'I have a call with Sam at Acme on Thursday');

    const panel = await screen.findByText(/what I have on Sam Okafor/);
    expect(panel).toBeTruthy();
    expect(screen.queryByText(/news|competitor|brief/i)).toBeNull();
  });

  it('a named person who is not in the workspace is said so plainly', async () => {
    contactsEmpty = false;
    peopleInWorkspace = [];
    classification = { intent: 'ENGAGEMENT', confidence: 0.9, subject: 'Riley Chen' };
    const user = userEvent.setup();
    mount();

    await converse(user, 'reconnect with Riley Chen');

    expect(await screen.findByText(/don.t have Riley Chen in your workspace/)).toBeTruthy();
  });

  it('referral drafts the ask without claiming to see who knows whom', async () => {
    contactsEmpty = false;
    classification = { intent: 'REFERRAL', confidence: 0.9, subject: 'Sam' };
    const user = userEvent.setup();
    mount();

    await converse(user, 'could Sam introduce me to someone at Acme');

    expect(await screen.findByText(/can't see who's connected to whom/)).toBeTruthy();
  });
});

describe('an empty workspace is answered, not routed into a dead end', () => {
  it('outreach with nobody to write to says so and offers a real next step', async () => {
    classification = { intent: 'OUTREACH', confidence: 0.9 };
    const user = userEvent.setup();
    mount();

    await converse(user, 'I want to send a message');

    expect(await screen.findByText(/There's nobody in your workspace yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Help me find people first' })).toBeTruthy();
  });

  it('taking that offer moves into the targeting conversation', async () => {
    classification = { intent: 'PIPELINE', confidence: 0.9 };
    const user = userEvent.setup();
    mount();

    await converse(user, 'how is my pipeline doing');
    await user.click(await screen.findByRole('button', { name: 'Help me find people first' }));

    expect(await screen.findByTestId('targeting-conversation')).toBeTruthy();
  });
});

describe('ambiguity confirms; failure asks', () => {
  it('a low-confidence reading is read back before anything happens', async () => {
    classification = {
      intent: 'ENGAGEMENT',
      confidence: 0.3,
      restatement: 'You want to reconnect with people you already know.',
    };
    const user = userEvent.setup();
    mount();

    await converse(user, 'people');

    expect(await screen.findByText('You want to reconnect with people you already know.')).toBeTruthy();
    expect(screen.getByRole('button', { name: "Yes, that's it" })).toBeTruthy();
  });

  it('"not quite" returns to the question rather than guessing again', async () => {
    classification = { intent: 'PROSPECTING', confidence: 0.3, restatement: 'You want to find new companies.' };
    const user = userEvent.setup();
    mount();

    await converse(user, 'people');
    await user.click(await screen.findByRole('button', { name: 'Not quite' }));

    expect(await screen.findByLabelText('What you want to get done')).toBeTruthy();
    expect(screen.queryByTestId('targeting-conversation')).toBeNull();
  });

  it('an unreadable classification asks one question instead of assuming', async () => {
    classification = { intent: 'SOMETHING_ELSE', confidence: 0.9 };
    const user = userEvent.setup();
    mount();

    await converse(user, '...');

    expect(await screen.findByLabelText('What you want to get done')).toBeTruthy();
    expect(screen.queryByTestId('targeting-conversation')).toBeNull();
  });

  it('a failed classifier asks rather than defaulting to prospecting', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); });
    const user = userEvent.setup();
    mount();

    await converse(user, 'help me with something');

    await waitFor(() => expect(screen.getByLabelText('What you want to get done')).toBeTruthy());
    expect(screen.queryByTestId('targeting-conversation')).toBeNull();
  });
});

describe('compound intent is served one at a time', () => {
  it('acts on the more actionable half and holds the other in the conversation', async () => {
    contactsEmpty = false;
    classification = { intent: 'PROSPECTING', secondaryIntent: 'PIPELINE', confidence: 0.9 };
    const user = userEvent.setup();
    mount();

    await converse(user, 'I need more leads and I should chase the Acme deal');

    // Pipeline acts on something that exists; prospecting is a conversation
    // first, so it is offered second rather than dropped.
    expect(await screen.findByText(/what's moving and what's gone quiet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Then work out who to reach/ })).toBeTruthy();
  });

  it('the held half is reachable, and the ICP conversation is where it lands', async () => {
    contactsEmpty = false;
    classification = { intent: 'PROSPECTING', secondaryIntent: 'PIPELINE', confidence: 0.9 };
    const user = userEvent.setup();
    mount();

    await converse(user, 'more leads, and the Acme deal');
    await user.click(await screen.findByRole('button', { name: /Then work out who to reach/ }));

    expect(await screen.findByTestId('targeting-conversation')).toBeTruthy();
  });
});

describe('only prospecting ever touches the ICP path', () => {
  const nonProspecting = [
    ['EXPLORATION', 'show me around'],
    ['COMMUNICATION', 'clear my inbox'],
    ['OUTREACH', 'email someone'],
    ['PIPELINE', 'where do things stand'],
    ['ENGAGEMENT', 'reconnect with old clients'],
    ['PREPARATION', 'meeting tomorrow'],
    ['REFERRAL', 'ask for an intro'],
  ];

  it.each(nonProspecting)('%s never calls barryICPConversation', async (intent, said) => {
    contactsEmpty = false;
    gmailStatus = 'connected';
    classification = { intent, confidence: 0.9 };
    const user = userEvent.setup();
    mount();

    await converse(user, said);

    const urls = fetchSpy.mock.calls.map(c => c[0]);
    expect(urls.some(u => String(u).includes('barryICPConversation'))).toBe(false);
    expect(urls.some(u => String(u).includes('barryMissionChat'))).toBe(true);
  });

  it.each(nonProspecting)('%s never renders the targeting conversation', async (intent, said) => {
    contactsEmpty = false;
    gmailStatus = 'connected';
    classification = { intent, confidence: 0.9 };
    const user = userEvent.setup();
    mount();

    await converse(user, said);

    expect(screen.queryByTestId('targeting-conversation')).toBeNull();
  });

  it('classification asks for no ICP and sends no targeting state', async () => {
    classification = { intent: 'EXPLORATION', confidence: 0.9 };
    const user = userEvent.setup();
    mount();

    await converse(user, 'looking around');

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.firstExperience).toBe(true);
    expect(body).not.toHaveProperty('icpId');
    expect(body).not.toHaveProperty('existingICP');
    expect(body).not.toHaveProperty('pendingICP');
  });

  it('and prospecting does reach it', async () => {
    classification = { intent: 'PROSPECTING', confidence: 0.9 };
    const user = userEvent.setup();
    mount();

    await converse(user, 'find me hospitals in Ohio');

    expect(await screen.findByTestId('targeting-conversation')).toBeTruthy();
  });
});
