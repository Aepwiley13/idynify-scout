/**
 * ManualContactForm's `copy` prop, on the real form.
 *
 * Contact Hub rewords four things. The promise to every other caller is that
 * with no `copy` the form reads and behaves exactly as before, and that with
 * `copy` only the words (and the visibility of one optional field) change:
 * what is written to Firestore is the same document either way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const calls = vi.hoisted(() => ({ addDoc: [], ensureCompany: [], prepare: [], merge: [], referral: [], resolution: null }));

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  collection: (_db, ...path) => ({ path: path.join('/') }),
  addDoc: async (ref, data) => { calls.addDoc.push([ref.path, data]); return { id: 'new1' }; },
  getDocs: async () => ({ docs: [] }),
  query: (...a) => a,
  where: (...a) => a,
  orderBy: (...a) => a,
  limit: (...a) => a,
}));
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }) }));
vi.mock('../theme/ThemeContext', () => ({ useT: () => new Proxy({}, { get: () => '#888' }) }));
vi.mock('../services/companyIdentityService', () => ({
  NAME_SOURCE: { USER: 'user' },
  ensureCompanyForContact: async (...a) => { calls.ensureCompany.push(a); return { companyId: 'co1' }; },
}));
vi.mock('../services/contactWriteGuard', () => ({
  prepareContactWrite: async (...a) => { calls.prepare.push(a); return calls.resolution; },
  applyContactMerge: async (...a) => { calls.merge.push(a); },
}));
vi.mock('../services/referralIntelligenceService', () => ({ recordReferralReceived: async (...a) => { calls.referral.push(a); } }));

import ManualContactForm from '../components/scout/ManualContactForm';

const HUB_COPY = {
  hint: 'Only a name is needed. You can add the rest any time.',
  duplicate: (name) => `${name} is already in My People. Any new details you entered were added to them.`,
  submit: 'Add Person',
  showReferral: false,
};

beforeEach(() => {
  for (const key of ['addDoc', 'ensureCompany', 'prepare', 'merge', 'referral']) calls[key] = [];
  calls.resolution = { action: 'create', fields: { email_normalized: 'ana@x.test' } };
});

async function fillAndSubmit(user, submitName) {
  await user.type(screen.getByPlaceholderText('John Doe'), 'Ana Lopez');
  await user.type(screen.getByPlaceholderText('john.doe@company.com'), 'ana@x.test');
  await user.type(screen.getByPlaceholderText('Acme Corporation'), 'Acme');
  await user.click(screen.getByRole('button', { name: submitName }));
}

describe('with no copy (every caller outside Contact Hub)', () => {
  it('reads exactly as it always has', () => {
    render(<ManualContactForm onContactAdded={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Only name is required. Add more details now or enrich later.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scout+' })).toBeInTheDocument();
    expect(screen.getByText('Referred By')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search existing contacts...')).toBeInTheDocument();
  });

  it('copy={null} is the same as passing nothing', () => {
    const a = render(<ManualContactForm onContactAdded={() => {}} onCancel={() => {}} />);
    const before = a.container.innerHTML;
    a.unmount();
    const b = render(<ManualContactForm onContactAdded={() => {}} onCancel={() => {}} copy={null} />);
    expect(b.container.innerHTML).toBe(before);
  });

  it('a duplicate is reported in the original words', async () => {
    calls.resolution = { action: 'merge', existingId: 'c9' };
    const user = userEvent.setup();
    render(<ManualContactForm onContactAdded={() => {}} onCancel={() => {}} />);
    await fillAndSubmit(user, 'Scout+');
    expect(await screen.findByText(/Ana Lopez is already in your pipeline\. Any new details you entered have been added to the existing record\.$/)).toBeInTheDocument();
    expect(calls.merge).toHaveLength(1);
    expect(calls.addDoc).toHaveLength(0);
  });
});

describe('with Contact Hub copy', () => {
  it('rewords the hint and the button, and hides the optional Referred By field', () => {
    render(<ManualContactForm onContactAdded={() => {}} onCancel={() => {}} copy={HUB_COPY} />);
    expect(screen.getByText(HUB_COPY.hint)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Person' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scout+' })).toBeNull();
    expect(screen.queryByText('Referred By')).toBeNull();
    expect(document.body.textContent).not.toMatch(/enrich|pipeline|scout|referral/i);
  });

  it('keeps every other field', () => {
    render(<ManualContactForm onContactAdded={() => {}} onCancel={() => {}} copy={HUB_COPY} />);
    for (const placeholder of ['John Doe', 'john.doe@company.com', '+1 (555) 123-4567', 'Acme Corporation', 'VP of Sales', 'https://linkedin.com/in/johndoe', '123 Main St, City, State', 'https://example.com']) {
      expect(screen.getByPlaceholderText(placeholder)).toBeInTheDocument();
    }
  });

  it('a duplicate is reported in Contact Hub words, and is still merged, not added twice', async () => {
    calls.resolution = { action: 'merge', existingId: 'c9' };
    const user = userEvent.setup();
    render(<ManualContactForm onContactAdded={() => {}} onCancel={() => {}} copy={HUB_COPY} />);
    await fillAndSubmit(user, 'Add Person');
    expect(await screen.findByText(/Ana Lopez is already in My People\. Any new details you entered were added to them\.$/)).toBeInTheDocument();
    expect(calls.merge).toHaveLength(1);
    expect(calls.addDoc).toHaveLength(0);
  });

  it('partial copy overrides only what it names', () => {
    render(<ManualContactForm onContactAdded={() => {}} onCancel={() => {}} copy={{ submit: 'Save' }} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByText('Only name is required. Add more details now or enrich later.')).toBeInTheDocument();
    expect(screen.getByText('Referred By')).toBeInTheDocument();
  });
});

describe('what is saved is the same either way', () => {
  async function save(copy) {
    const added = [];
    const user = userEvent.setup();
    const view = render(<ManualContactForm onContactAdded={(c) => added.push(c)} onCancel={() => {}} copy={copy} />);
    await fillAndSubmit(user, copy ? 'Add Person' : 'Scout+');
    await waitFor(() => expect(added).toHaveLength(1));
    view.unmount();
    return { added: added[0] };
  }

  it('same collection, same document, same company and duplicate checks, no referral', async () => {
    const original = await save(undefined);
    const originalCalls = JSON.parse(JSON.stringify({ addDoc: calls.addDoc, ensureCompany: calls.ensureCompany, prepare: calls.prepare }));
    expect(originalCalls.addDoc).toHaveLength(1);
    expect(originalCalls.addDoc[0][0]).toBe('users/u1/contacts');
    expect(calls.referral).toHaveLength(0);

    for (const key of ['addDoc', 'ensureCompany', 'prepare', 'merge', 'referral']) calls[key] = [];
    const hub = await save(HUB_COPY);
    const hubCalls = JSON.parse(JSON.stringify({ addDoc: calls.addDoc, ensureCompany: calls.ensureCompany, prepare: calls.prepare }));
    expect(calls.referral).toHaveLength(0);

    // Timestamps are taken at save time; everything else must match exactly.
    const stable = (value) => JSON.parse(JSON.stringify(value, (key, v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? '<time>' : v)));
    expect(stable(hubCalls)).toEqual(stable(originalCalls));
    expect(stable(hub.added)).toEqual(stable(original.added));
    expect(hubCalls.addDoc[0][1].source).toBe('manual');
    expect(hubCalls.addDoc[0][1].addedFrom).toBe('manual');
  });
});
