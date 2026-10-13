/**
 * Re-sending the same cadence — the cadence page shows every delivery.
 *
 * "People Pitch" was sent Oct 1 (invite) and again Oct 7 (reminder). Each send
 * is its own cadence doc with the same name; the reminder's page lists, for a
 * person who got both, "Sent Oct 1 · Sent Oct 7" — the earlier delivery is
 * never overwritten.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const day = (d) => ({ toMillis: () => new Date(2026, 9, d, 12).getTime(), toDate: () => new Date(2026, 9, d, 12) });

const DOCS = {
  invite: {
    name: 'People Pitch', status: 'completed', completedAt: day(1), createdAt: day(1),
    contacts: [{ contactId: 'a', name: 'Ana Lopez', email: 'ana@x.com', status: 'sent' }],
  },
  reminder: {
    name: 'People Pitch', status: 'completed', completedAt: day(7), createdAt: day(7),
    resendPreviousRecipients: true, resentContactIds: ['a'],
    contacts: [
      { contactId: 'a', name: 'Ana Lopez', email: 'ana@x.com', status: 'sent', resend: true },
      { contactId: 'b', name: 'Ben Ito', email: 'ben@x.com', status: 'sent', resend: false },
    ],
  },
};

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...p) => ({ id: p[p.length - 1] })),
  getDoc: vi.fn(async (ref) => ({ exists: () => true, id: ref.id, data: () => DOCS[ref.id] })),
  updateDoc: vi.fn(async () => {}),
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  getDocs: vi.fn(async () => ({ docs: Object.entries(DOCS).map(([id, d]) => ({ id, data: () => d })) })),
}));
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('../context/ImpersonationContext', () => ({
  useActiveUser: () => ({ uid: 'u1' }),
  getEffectiveUser: () => ({ uid: 'u1' }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ cadenceId: 'reminder' }),
}));
vi.mock('../components/scout/BulkComposeModal', () => ({ default: () => null }));

import CadenceDetail from '../pages/Scout/CadenceDetail';

describe('cadence send history', () => {
  it('shows both deliveries for a person who was sent the cadence again', async () => {
    render(<CadenceDetail />);
    expect(await screen.findByTestId('send-history-a')).toHaveTextContent('Sent Oct 1 · Sent Oct 7');
    // Ben only received the reminder: no history line needed.
    expect(screen.queryByTestId('send-history-b')).toBeNull();
  });
});
