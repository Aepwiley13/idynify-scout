/**
 * Regression, the profile's half: the real ContactProfile tells its host
 * about each saved update from IdentityCard (where the Stickers row saves),
 * through onContactChange, and keeps showing it itself. People uses this to
 * refresh its card (peopleCardRefresh.test.jsx). Heavy children are stubbed;
 * IdentityCard is a probe that saves the way the Stickers row does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, configure } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

configure({ asyncUtilTimeout: 5000 });

const stored = vi.hoisted(() => ({ contact: null }));
const probe = vi.hoisted(() => ({ props: null }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...p) => ({ path: p.join('/') })),
  collection: vi.fn((_db, ...p) => ({ path: p.join('/') })),
  query: vi.fn((ref) => ref),
  orderBy: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => true, id: stored.contact.id, data: () => stored.contact })),
  getDocs: vi.fn(async () => ({ docs: [] })),
  updateDoc: vi.fn(async () => {}),
  // Imported by the sticker services the profile loads; unused here.
  setDoc: vi.fn(async () => {}),
  runTransaction: vi.fn(async () => {}),
  deleteField: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
  arrayUnion: vi.fn((...v) => v),
  arrayRemove: vi.fn((...v) => v),
  serverTimestamp: vi.fn(() => ({})),
}));
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1', getIdToken: async () => 't' }),
  useActiveUserId: () => 'u1',
  useImpersonation: () => ({ isImpersonating: false }),
}));
vi.mock('../components/stickers/stickersApi.js', () => ({ fetchStickersConfig: async () => ({ status: 200, body: { enabled: false, mode: 'off', readOnly: false } }) }));
vi.mock('../services/referralIntelligenceService', () => ({ getContactReferralAnalytics: async () => null }));
vi.mock('../services/contactSuggestions', () => ({ acceptTitleSuggestion: vi.fn(), acceptEmailSuggestion: vi.fn(), USER_ACCEPTED: 'user_accepted' }));
vi.mock('../services/barryEnrichment', () => ({ writeBarryEnrichment: vi.fn() }));
vi.mock('../services/peopleService', () => ({ archivePerson: vi.fn() }));
vi.mock('../components/contacts/IdentityCard', () => ({
  default: (props) => {
    probe.props = props;
    return <div data-testid="identity">{(props.contact.sticker_ids ?? []).join(',') || 'none'}</div>;
  },
}));
for (const path of [
  'MeetSection', 'RecessiveActions', 'DetailDrawer', 'EngagementTimeline', 'InlineEngagementSection', 'BarryInsightPanel',
  'PersistentEngageBar', 'StageEngagementPanel', 'NextBestStep', 'StageTabBar', 'EngagementScoreRing', 'RelationshipArc',
  'KeyMetricsGrid', 'ReferralHub', 'LinkedInImportModal', 'EnrichSuggestions', 'ReinforcementsEngagementPanel',
]) vi.doMock(`../components/contacts/${path}`, () => ({ default: () => null }));
vi.mock('../components/recon/BarryKnowledgeButton', () => ({ default: () => null }));
vi.mock('../components/capture/FindLinkedIn.jsx', () => ({ default: () => null }));

const { default: ContactProfile } = await import('../pages/Scout/ContactProfile');

beforeEach(() => {
  stored.contact = { id: 'c1', name: 'Pat Lee', tags: ['vip'], sticker_ids: [], barryContext: { summary: 'cached' } };
  probe.props = null;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('ContactProfile reports saved updates to its host', () => {
  it('passes the updated contact to onContactChange and shows it itself', async () => {
    const onContactChange = vi.fn();
    render(<MemoryRouter><ContactProfile contactId="c1" onClose={() => {}} onContactChange={onContactChange} /></MemoryRouter>);
    expect(await screen.findByTestId('identity')).toHaveTextContent('none');

    // As the Stickers row does after a confirmed add: the whole contact, one sticker more.
    const updated = { ...probe.props.contact, sticker_ids: ['S1'] };
    act(() => probe.props.onUpdate(updated));

    expect(onContactChange).toHaveBeenCalledTimes(1);
    expect(onContactChange).toHaveBeenCalledWith(updated);
    expect(onContactChange.mock.calls[0][0]).toMatchObject({ id: 'c1', tags: ['vip'], sticker_ids: ['S1'] });
    expect(screen.getByTestId('identity')).toHaveTextContent('S1');
  });

  it('works with no host listening (the full-page profile)', async () => {
    render(<MemoryRouter><ContactProfile contactId="c1" onClose={() => {}} /></MemoryRouter>);
    await screen.findByTestId('identity');
    act(() => probe.props.onUpdate({ ...probe.props.contact, sticker_ids: ['S2'] }));
    expect(screen.getByTestId('identity')).toHaveTextContent('S2');
  });
});
