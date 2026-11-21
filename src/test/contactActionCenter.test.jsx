import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactActionCenter from '../pages/ContactHub/actionCenter/ContactActionCenter';
import { saveRelationshipReminder } from '../pages/ContactHub/actionCenter/relationshipStore';
import { stepVersion } from '../pages/ContactHub/actionCenter/relationship';
import { clearFixtureDocs, getDoc, seedFixtureDoc } from '../../scripts/visual/contact-profile/stubs/firestore';
import { fixture } from '../../scripts/visual/contact-profile/stubs/fixture';

const viewer = vi.hoisted(() => ({ uid: 'user1', _isImpersonated: false }));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => viewer }));
vi.mock('../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => import('../../scripts/visual/contact-profile/stubs/firestore'));
vi.mock('../components/contacts/IdentityCard', () => ({ default: () => <div>Contact details</div> }));
vi.mock('../components/contacts/StickyNotes', () => ({ default: () => <div>Sticky notes</div> }));
vi.mock('../components/stickers/ContactStickersRow', () => ({ default: () => <div>Sticker editor</div> }));
vi.mock('../theme/ThemeContext', () => ({ useT: () => ({}) }));

const uid = 'user1';
const contact = { id: 'person1', name: 'Jordan' };
const path = `users/${uid}/contacts/${contact.id}`;
const queued = (id) => `users/${uid}/nbs_queue/${id}`;
const timeline = (id) => path + '/timeline/' + id;
const read = async (path) => (await getDoc({ path })).data();
const draft = () => screen.getByRole('textbox', { name: 'What would you like to remember or do?' });
const click = (user, name) => user.click(screen.getByRole('button', { name }));
const tab = (user, name) => user.click(screen.getByRole('tab', { name }));

function Page({ item = contact, userId = uid, props = {}, afterPatch }) {
  const [current, setCurrent] = useState(item);
  return <ContactActionCenter uid={userId} contact={current} {...props} onUpdate={(next, patch) => {
    afterPatch?.(next);
    setCurrent((previous) => ({ ...previous, ...(typeof patch === 'function' ? patch(previous) : patch ?? next) }));
  }} />;
}

beforeEach(() => {
  viewer.uid = uid;
  viewer._isImpersonated = false;
  fixture.latency = 0;
  fixture.failNext = false;
  window.__writes.length = 0;
  clearFixtureDocs();
  seedFixtureDoc(path, contact);
});

describe('Action Center', () => {
  it('uses one capture field, preserves the draft after failure, skips a duplicate click and shows the note under both views', async () => {
    const user = userEvent.setup();
    render(<Page />);
    expect(screen.getByRole('tab', { name: 'Action Center', selected: true })).toBeInTheDocument();
    expect(await screen.findByText('Notes and logged interactions will appear here.')).toBeInTheDocument();
    await click(user, 'Add note');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter something');
    await user.type(draft(), 'Met at the library');
    fixture.failNext = true;
    await click(user, 'Add note');
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
    expect(draft()).toHaveValue('Met at the library');
    const submit = screen.getByRole('button', { name: 'Add note' });
    act(() => { submit.click(); submit.click(); });
    await screen.findByText('Note added.');
    expect((await read(path)).notes).toHaveLength(1);
    expect(screen.getAllByText('Met at the library')).toHaveLength(1);
    await tab(user, 'Activity');
    expect(screen.getAllByText('Met at the library')).toHaveLength(1);
    expect(window.__writes.filter((row) => row.path === path)).toHaveLength(2);
  });

  it('logs a meeting through the typed timeline and keeps the same entry in both views', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.type(draft(), 'Met at the project kickoff');
    await click(user, 'Log update');
    await user.selectOptions(screen.getByLabelText('Interaction type'), 'meeting');
    await click(user, 'Save update');
    expect(await screen.findByText('Met at the project kickoff')).toBeInTheDocument();
    await tab(user, 'Activity');
    expect(screen.getAllByText('Met at the project kickoff')).toHaveLength(1);
    const saved = window.__writes.find((row) => row.path.startsWith(path + '/timeline/'));
    expect(saved.data).toMatchObject({ type: 'outreach_logged', actor: 'user', metadata: { channel: 'meeting' } });
  });

  it('requires explicit rescheduling and records completion', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.type(draft(), 'Follow up next week');
    await click(user, 'Set reminder');
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2027-01-04' } });
    await click(user, 'Save reminder');
    expect(await screen.findByRole('button', { name: 'Done' })).toBeEnabled();
    const original = (await read(path)).next_best_step;
    await click(user, 'Reschedule');
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2027-02-08' } });
    expect((await read(path)).next_best_step.due_at).toBe(original.due_at);
    await click(user, 'Confirm reminder change');
    await screen.findByText('Reminder saved.');
    const moved = (await read(path)).next_best_step;
    expect(moved).toMatchObject({ id: original.id, due_at: '2027-02-08' + original.due_at.slice(10) });
    await click(user, 'Done');
    expect(await screen.findByText('No reminder set.')).toBeInTheDocument();
    expect((await read(queued(original.id))).status).toBe('completed');
  });

  it('drops stale results on account switch and restores an empty draft for the next contact', async () => {
    const user = userEvent.setup();
    const afterPatch = vi.fn();
    fixture.latency = 200;
    const view = render(<Page key="first" afterPatch={afterPatch} />);
    await user.type(draft(), 'First user note');
    await click(user, 'Add note');
    viewer.uid = 'user2';
    view.rerender(<Page key="second" userId="user2" item={{ id: 'person2', name: 'Kim' }} afterPatch={afterPatch} />);
    await waitFor(async () => expect((await read(path)).notes).toHaveLength(1));
    expect(draft()).toHaveValue('');
    expect(screen.queryByText('First user note')).toBeNull();
    expect(afterPatch).not.toHaveBeenCalled();
  });

  it('hides paid actions from Free, opens paid Barry only on click and removes capture in read-only mode', async () => {
    const user = userEvent.setup();
    const openBarry = vi.fn();
    const view = render(<Page props={{ openBarry }} />);
    expect(screen.queryByRole('tab', { name: 'Emails' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Barry' })).toBeNull();
    const paid = { openBarry, scout: true };
    view.rerender(<Page props={paid} />);
    expect(screen.getByRole('tab', { name: 'Emails' })).toBeVisible();
    expect(openBarry).not.toHaveBeenCalled();
    await click(user, 'Open Barry');
    expect(openBarry).toHaveBeenCalledTimes(1);
    view.rerender(<Page props={{ readOnly: true }} />);
    expect(screen.getByText('This profile is read-only.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull();
  });
});

describe('reminder transaction', () => {
  const due = '2027-01-03T16:00:00.000Z';
  const request = { expected: null, id: 'reminder-new', due, text: 'Check in' };

  it('writes contact, one queue entry, and a user timeline event and tolerates retry of the same operation', async () => {
    const patch = await saveRelationshipReminder(uid, contact.id, request);
    await saveRelationshipReminder(uid, contact.id, request);
    expect(patch.next_step_due).toBe(due);
    expect(await read(queued(request.id))).toMatchObject({ status: 'confirmed', due_at: due, contact_id: contact.id });
    expect(await read(timeline(request.id))).toMatchObject({ actor: 'user', type: 'next_step_queued' });
    expect(window.__writes).toHaveLength(3);
  });

  it('preserves the existing Barry step, and rejects a stale confirmation and the wrong account', async () => {
    const legacy = { id: 'barry1', action: 'Existing step', due_at: due, status: 'pending' };
    seedFixtureDoc(path, { ...contact, next_best_step: legacy, next_step_due: due });
    await expect(saveRelationshipReminder(uid, contact.id, request)).rejects.toThrow('step_changed');
    await expect(saveRelationshipReminder(uid, contact.id, { ...request, expected: stepVersion(legacy) })).rejects.toThrow('legacy_step');
    viewer.uid = 'user2';
    expect(() => saveRelationshipReminder(uid, contact.id, request)).toThrow('read_only');
    expect((await read(path)).next_best_step).toEqual(legacy);
    expect(window.__writes).toHaveLength(0);
  });
});
