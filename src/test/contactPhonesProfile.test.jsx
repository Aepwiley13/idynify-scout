/**
 * The contact profile's phone numbers: each shown with its type, editable,
 * and saved as the canonical list (src/utils/contactPhones.js).
 *
 * Pins that a type is shown and never guessed (an older plain `phone` reads
 * "Type not set", not "Mobile"), that changing a type or a number or removing
 * one saves the whole list, that a type can be picked before the number is
 * typed, that a fax is not a call link, that IdentityCard writes the list and
 * the single fields derived from it, and which number a call or a text uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactPhones from '../components/contacts/ContactPhones';
import { buildPhoneWrite, makePhone } from '../utils/contactPhones';
import { textNumber, callNumber, resolveSendMethod } from '../utils/sendActionResolver';

const T = { cardBg: '#fff', border: '#ddd', isDark: false, textMuted: '#666', input: '#fff', text: '#111', textFaint: '#999' };

const updateDoc = vi.fn(async () => {});
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  doc: (_db, ...path) => ({ path: path.join('/') }),
  updateDoc: (...args) => updateDoc(...args),
}));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }) }));
vi.mock('../services/peopleService', () => ({ getUniqueTags: async () => [] }));
vi.mock('../components/scout/CompanyDetailModal', () => ({ default: () => null }));

beforeEach(() => updateDoc.mockClear());

const phone = (id, value, label, extra = {}) => makePhone({ id, value, label, labelSource: 'card', ...extra });

function renderPhones(contact) {
  const onSave = vi.fn();
  const view = render(<ContactPhones contact={contact} onSave={onSave} T={T} />);
  return { onSave, ...view };
}

/** The rows as "Type number" strings, in display order. */
const rows = () => screen.queryAllByRole('button', { name: /^Phone type:/ }).map((pill) => {
  const row = pill.closest('.idc-field-entry');
  return `${pill.textContent} ${row.querySelector('.idc-entry-val')?.textContent ?? ''}`.trim();
});

// ─── Showing numbers ────────────────────────────────────────────────────────

describe('the profile shows every number with its type', () => {
  it('Mobile, Direct, Main… in that order, each a call link except a fax', () => {
    renderPhones(buildPhoneWrite([
      phone('1', '801-555-1001', 'fax'), phone('2', '801-555-1000', 'main'), phone('3', '801-555-1234 x12', 'direct'), phone('4', '801-555-5678', 'mobile'),
    ]));
    expect(rows()).toEqual(['Mobile 801-555-5678', 'Direct 801-555-1234 ext. 12', 'Main 801-555-1000', 'Fax 801-555-1001']);
    expect(screen.getByText('801-555-5678').closest('a')).toHaveAttribute('href', 'tel:801-555-5678');
    expect(screen.getByText('801-555-1001').closest('a')).toBeNull();                    // a fax is not dialled
  });

  it('an older record: typed fields keep their type, a plain `phone` is "Type not set", not "Mobile"', () => {
    renderPhones({ phone: '801-555-0000', phone_direct: '801-555-1234' });
    expect(rows()).toEqual(['Direct 801-555-1234', 'Type not set 801-555-0000']);
  });

  it('says what the card printed', () => {
    renderPhones(buildPhoneWrite([phone('1', '801-555-5678', 'mobile', { observedLabel: 'C' })]));
    expect(screen.getByRole('button', { name: /^Phone type: Mobile/ })).toHaveAttribute('title', 'Mobile · printed on the card as “C”');
  });

  it('every row has its copy, edit and remove buttons in the page, not only on hover', () => {
    renderPhones(buildPhoneWrite([phone('1', '801-555-5678', 'mobile'), phone('2', '801-555-1000', 'main')]));
    expect(screen.getAllByRole('button', { name: 'Copy number' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Edit number' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Remove number' })).toHaveLength(2);
  });
});

// ─── Editing ────────────────────────────────────────────────────────────────

describe('editing numbers', () => {
  it('changing a type saves the list with the user\'s choice', async () => {
    const user = userEvent.setup();
    const { onSave } = renderPhones({ phone: '801-555-1000' });
    await user.click(screen.getByRole('button', { name: /^Phone type: Type not set/ }));
    await user.click(within(screen.getByRole('listbox', { name: 'Phone type' })).getByRole('option', { name: 'Main' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toEqual([expect.objectContaining({ value: '801-555-1000', label: 'main', labelSource: 'user' })]);
  });

  it('the type picker offers Mobile, Direct, Main, Work, Home, Fax, Other and Type not set', async () => {
    const user = userEvent.setup();
    renderPhones({ phone: '801-555-1000' });
    await user.click(screen.getByRole('button', { name: /^Phone type:/ }));
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent))
      .toEqual(['Mobile', 'Direct', 'Main', 'Work', 'Home', 'Fax', 'Other', 'Type not set']);
  });

  it('editing a number keeps an extension apart', async () => {
    const user = userEvent.setup();
    const { onSave } = renderPhones(buildPhoneWrite([phone('1', '801-555-1234', 'direct')]));
    await user.click(screen.getByRole('button', { name: 'Edit number' }));
    const input = screen.getByRole('textbox', { name: 'Phone number' });
    await user.clear(input);
    await user.type(input, '801-555-1234 x12{Enter}');
    expect(onSave.mock.calls[0][0]).toEqual([expect.objectContaining({ id: '1', value: '801-555-1234', extension: '12', label: 'direct' })]);
  });

  it('a number too short to be one is refused, and nothing is saved', async () => {
    const user = userEvent.setup();
    const { onSave } = renderPhones(buildPhoneWrite([phone('1', '801-555-1234', 'direct')]));
    await user.click(screen.getByRole('button', { name: 'Edit number' }));
    const input = screen.getByRole('textbox', { name: 'Phone number' });
    await user.clear(input);
    await user.type(input, '555{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('at least 7 digits');
    expect(onSave).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(rows()).toEqual(['Direct 801-555-1234']);
  });

  it('removing a number saves the list without it; removing the last saves an empty list, which stays empty', async () => {
    const user = userEvent.setup();
    const { onSave, rerender } = renderPhones({ phone_mobile: '801-555-5678' });
    await user.click(screen.getByRole('button', { name: 'Remove number' }));
    expect(onSave).toHaveBeenCalledWith([]);
    // What the profile then writes, read back with the old field still set: nothing comes back.
    rerender(<ContactPhones contact={{ phone_mobile: '801-555-5678', ...buildPhoneWrite([]) }} onSave={onSave} T={T} />);
    expect(rows()).toEqual([]);
  });

  it('a new number starts with its type unset; nothing is guessed', async () => {
    const user = userEvent.setup();
    const { onSave } = renderPhones({});
    await user.click(screen.getByRole('button', { name: 'add phone' }));
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '801-555-4444{Enter}');
    expect(onSave.mock.calls[0][0]).toEqual([expect.objectContaining({ value: '801-555-4444', label: 'unknown', labelSource: null })]);
  });

  it('a type can be picked before the number is typed', async () => {
    const user = userEvent.setup();
    const { onSave } = renderPhones(buildPhoneWrite([phone('1', '801-555-1000', 'main')]));
    await user.click(screen.getByRole('button', { name: 'add phone' }));
    const pills = screen.getAllByRole('button', { name: /^Phone type:/ });
    await user.click(pills[pills.length - 1]);
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Mobile' }));
    expect(onSave).not.toHaveBeenCalled();                                               // waiting for the number
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '801-555-5678{Enter}');
    expect(onSave.mock.calls[0][0]).toEqual([
      expect.objectContaining({ value: '801-555-1000', label: 'main' }),
      expect.objectContaining({ value: '801-555-5678', label: 'mobile', labelSource: 'user' }),
    ]);
  });
});

// ─── IdentityCard writes the canonical list ─────────────────────────────────

describe('IdentityCard saves numbers as the canonical list and the fields derived from it', () => {
  it('one write: phones[], phone / phone_mobile / … and an identity key from a person-level number only', async () => {
    const { default: IdentityCard } = await import('../components/contacts/IdentityCard');
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const contact = { id: 'c1', name: 'Avery Quinn', phone: '801-555-1000', phone_mobile: '801-555-5678' };
    render(<IdentityCard contact={contact} onUpdate={onUpdate} />);

    expect(screen.queryByText('801-555-5678')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /^Phone type: Type not set/ }));
    await user.click(within(screen.getByRole('listbox', { name: 'Phone type' })).getByRole('option', { name: 'Main' }));

    expect(updateDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = updateDoc.mock.calls[0];
    expect(ref.path).toBe('users/u1/contacts/c1');
    expect(data).toMatchObject({
      phone: '801-555-5678', phone_mobile: '801-555-5678', phone_direct: null, phone_work: null, phone_home: null,
      phone_normalized: '8015555678',
    });
    expect(data.phones.map(p => [p.label, p.value])).toEqual([['mobile', '801-555-5678'], ['main', '801-555-1000']]);
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ phones: data.phones }));
  });
});

// ─── Which number a call or a text uses ─────────────────────────────────────

describe('call and text', () => {
  it('a text goes to a mobile, else an unset number; never a main, direct or fax line', () => {
    expect(textNumber(buildPhoneWrite([phone('1', '801-555-1000', 'main'), phone('2', '801-555-5678', 'mobile')]))).toBe('801-555-5678');
    expect(textNumber({ phone: '801-555-0000' })).toBe('801-555-0000');                 // older record, type unknown
    expect(textNumber(buildPhoneWrite([phone('1', '801-555-1000', 'main'), phone('2', '801-555-1234', 'direct')]))).toBe('');
  });

  it('a call goes to mobile, then direct, then main…; never a fax', () => {
    expect(callNumber(buildPhoneWrite([phone('1', '801-555-1000', 'main'), phone('2', '801-555-1234', 'direct')]))).toBe('801-555-1234');
    expect(callNumber(buildPhoneWrite([phone('1', '801-555-1001', 'fax')]))).toBe('');
    expect(callNumber({ phone: '801-555-0000', phone_mobile: '801-555-5678' })).toBe('801-555-5678');
  });

  it('Call is offered when there is a number to call, including a mobile-only record', async () => {
    expect(await resolveSendMethod('call', 'u1', { phone_mobile: '801-555-5678' })).toEqual({ method: 'native' });
    expect(await resolveSendMethod('call', 'u1', buildPhoneWrite([phone('1', '801-555-1001', 'fax')]))).toMatchObject({ method: 'disabled' });
  });
});
