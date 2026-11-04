/**
 * IdentityCard's email list saves through saveContactEmailEdit
 * (src/services/contactEmailService.js): one edit at a time, by entry id, so
 * the service can apply it to the contact as stored and write email and
 * email_normalized with the list. A failed save puts the stored list back.
 *
 * The service is mocked with a plain delegating function rather than a vi.fn:
 * under Vitest 4 a hoisted vi.fn whose async implementation throws fails the
 * test even when the caller catches the rejection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const service = vi.hoisted(() => ({ calls: [], impl: async () => ({}) }));
vi.mock('../services/contactEmailService', () => ({
  saveContactEmailEdit: (...args) => { service.calls.push(args); return service.impl(...args); },
}));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  doc: (_db, ...path) => ({ path: path.join('/') }),
  updateDoc: vi.fn(async () => {}),
}));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }) }));
vi.mock('../services/peopleService', () => ({ getUniqueTags: async () => [] }));
vi.mock('../components/scout/CompanyDetailModal', () => ({ default: () => null }));

const { default: IdentityCard } = await import('../components/contacts/IdentityCard');

const CONTACT = { id: 'c1', name: 'Jane Doe', email: 'old@acme.test', email_normalized: 'old@acme.test' };
const entryRow = (value) => screen.getByText(value).closest('.idc-field-entry');

beforeEach(() => { service.calls.length = 0; service.impl = async () => ({}); });

describe('IdentityCard email edits', () => {
  it('editing the primary sends one upsert by id, then shows what was stored', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const saved = { ...CONTACT, email: 'Jane@Acme.test', email_normalized: 'jane@acme.test', emails: [{ id: '0', value: 'Jane@Acme.test', label: 'work' }] };
    service.impl = async () => saved;
    render(<IdentityCard contact={CONTACT} onUpdate={onUpdate} />);

    await user.click(within(entryRow('old@acme.test')).getByTitle('Edit'));
    const input = screen.getByPlaceholderText('Email address');
    await user.clear(input);
    await user.type(input, 'Jane@Acme.test{Enter}');

    expect(service.calls).toEqual([['u1', 'c1', { type: 'upsert', entry: { id: '0', value: 'Jane@Acme.test', label: 'work' } }]]);
    expect(await screen.findByText('Jane@Acme.test')).not.toBeNull();
    expect(onUpdate).toHaveBeenCalledWith(saved);
  });

  it('clearing an address removes that entry', async () => {
    const user = userEvent.setup();
    service.impl = async () => ({ ...CONTACT, email: null, email_normalized: null, emails: [] });
    render(<IdentityCard contact={CONTACT} onUpdate={vi.fn()} />);

    await user.click(within(entryRow('old@acme.test')).getByTitle('Edit'));
    await user.clear(screen.getByPlaceholderText('Email address'));
    await user.keyboard('{Enter}');

    expect(service.calls).toEqual([['u1', 'c1', { type: 'remove', id: '0' }]]);
  });

  it('the remove button removes that entry', async () => {
    const user = userEvent.setup();
    service.impl = async () => ({ ...CONTACT, email: null, email_normalized: null, emails: [] });
    render(<IdentityCard contact={CONTACT} onUpdate={vi.fn()} />);

    await user.click(within(entryRow('old@acme.test')).getByTitle('Remove'));
    expect(service.calls).toEqual([['u1', 'c1', { type: 'remove', id: '0' }]]);
  });

  it('a failed save puts the stored list back', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    service.impl = async () => { throw Object.assign(new Error('denied'), { code: 'permission-denied' }); };
    render(<IdentityCard contact={CONTACT} onUpdate={onUpdate} />);

    await user.click(within(entryRow('old@acme.test')).getByTitle('Remove'));
    expect(await screen.findByText('old@acme.test')).not.toBeNull();
    expect(onUpdate).toHaveBeenLastCalledWith(CONTACT);
  });
});
