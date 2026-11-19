/* global process */
/**
 * H2-2 — PersonHeader's inline editing, as PRESENTATION: it draws the editing state it is handed, calls the
 * callbacks it is handed, and keeps no draft, no service and no account of its own.
 *
 * Held here: which edit controls exist (and which never do), the 44px targets, Enter / Escape / blur and what each
 * is allowed to cause, the refusal and failure messages and their accessibility wiring, the saving state, and
 * where focus goes (and where it must not). The last block drives the header with the REAL H2-1a hook, to show the
 * two fit. How it looks is checked in real Chrome (scripts/visual/person-header).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState, useCallback, useEffect } from 'react';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fake = vi.hoisted(() => ({ writes: [] }));
const viewer = vi.hoisted(() => ({ value: { uid: 'u1' } }));
vi.mock('../firebase/config', () => ({ db: { __db: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...segments) => ({ path: segments.join('/') }),
  updateDoc: (ref, data) => new Promise((resolveWrite, rejectWrite) => { fake.writes.push({ path: ref.path, data, resolve: resolveWrite, reject: rejectWrite }); }),
}));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => viewer.value,
  useImpersonation: () => ({ isImpersonating: Boolean(viewer.value?._isImpersonated) }),
}));

import PersonHeader from '../components/contacts/personHeader/PersonHeader';
import { buildPersonHeaderModel } from '../components/contacts/personHeader/personHeaderModel';
import { editState, EDIT_FIELDS } from '../components/contacts/personHeader/personHeaderContract';
import { useContactIdentityEdit } from '../components/contacts/personHeader/useContactIdentityEdit';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const JORDAN = {
  id: 'c1', name: 'Jordan Lee', title: 'Community Partner', company_name: 'Community Partners', city: 'Salt Lake City', state: 'UT',
  phones: [{ id: '1', value: '(801) 555-0199', label: 'mobile' }], emails: [{ id: '0', value: 'jordan@communityslc.org' }],
  linkedin_url: 'https://www.linkedin.com/in/jordan-lee',
};
const CSV = { id: 'c9', first_name: 'Jane', last_name: 'Doe', title: 'Analyst', company_name: 'Acme' };
const model = (contact) => buildPersonHeaderModel(contact, { stickersById: null, now: NOW });
const ALL = { name: true, title: true, organization: true };
const BLANK_NAME = "Name can't be empty.";

const editBtn = (field) => screen.getByRole('button', { name: field === 'name' ? 'Edit name' : `Edit ${field}` });
const inputOf = (label) => screen.getByRole('textbox', { name: label });
const live = () => document.querySelector('[role="status"]');

/** A parent that owns the editing state, as the connected wrapper will, with spies on every callback. */
function Stateful({ person, editable = ALL, spies, onControl, initial = null }) {
  const [active, setActive] = useState(initial);
  const [problem, setProblem] = useState(null);
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState({});
  useEffect(() => { onControl?.({ setActive, setProblem, setFailure, setSaving }); }, [onControl]);
  const start = { name: person.name, title: person.title ?? '', organization: person.organization ?? '' };
  const editing = {
    editable, active, saving, problem, failure,
    onChange: (value) => { spies.onChange(value); setProblem(null); setActive((a) => (a ? { ...a, value } : a)); },
    onSubmit: () => {
      spies.onSubmit();
      if (active?.field === 'name' && active.value.trim() === '') { setProblem({ field: 'name', message: BLANK_NAME }); return; }
      setActive(null); setProblem(null);
    },
    onCancel: () => { spies.onCancel(); setActive(null); setProblem(null); },
  };
  return (
    <>
      <PersonHeader person={person} actions={{ onEdit: (field) => { spies.onEdit(field); setActive({ field, value: start[field] }); } }} editing={editing} />
      <button type="button">Elsewhere</button>
    </>
  );
}
const spies = () => ({ onEdit: vi.fn(), onChange: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn() });
const drawStateful = (contact = JORDAN, props = {}) => {
  const s = spies();
  const control = { current: null };
  const user = userEvent.setup();
  const view = render(<Stateful person={model(contact)} spies={s} onControl={(c) => { control.current = c; }} {...props} />);
  return { ...view, s, control, user };
};

// ─── The pure rules ──────────────────────────────────────────────────────────

describe('editState (the contract)', () => {
  const handlers = { onChange() {}, onSubmit() {}, onCancel() {} };
  const actions = { onEdit() {} };

  it('draws a control only for a line that is editable AND only when the parent can begin an edit', () => {
    expect(editState(actions, { editable: ALL }).canEdit).toEqual(ALL);
    expect(editState(actions, { editable: { name: true } }).canEdit).toEqual({ name: true, title: false, organization: false });
    expect(editState({}, { editable: ALL }).anyEdit).toBe(false);
    expect(editState(undefined, { editable: ALL }).anyEdit).toBe(false);
    expect(editState(actions, undefined).anyEdit).toBe(false);
    expect(editState(actions, { editable: { name: 'yes' } }).canEdit.name).toBe(false);
  });

  it('draws the open editor only for an editable line, only with all three handlers, and only with text', () => {
    const base = { editable: ALL, active: { field: 'title', value: 'x' }, ...handlers };
    expect(editState(actions, base).active).toEqual({ field: 'title', value: 'x' });
    expect(editState(actions, { ...base, onSubmit: undefined }).active).toBeNull();
    expect(editState(actions, { ...base, onCancel: undefined }).active).toBeNull();
    expect(editState(actions, { ...base, onChange: undefined }).active).toBeNull();
    expect(editState(actions, { ...base, editable: { name: true } }).active).toBeNull();
    expect(editState(actions, { ...base, active: { field: 'email', value: 'x' } }).active).toBeNull();
    expect(editState(actions, { ...base, active: { field: 'title', value: 7 } }).active).toBeNull();
  });

  it('shows a refusal only for the open editor, a failure for any editable line, and ignores empty messages', () => {
    const base = { editable: ALL, active: { field: 'name', value: '' }, ...handlers };
    expect(editState(actions, { ...base, problem: { field: 'name', message: 'No' } }).problem).toEqual({ field: 'name', message: 'No' });
    expect(editState(actions, { ...base, problem: { field: 'title', message: 'No' } }).problem).toBeNull();
    expect(editState(actions, { ...base, problem: { field: 'name', message: '  ' } }).problem).toBeNull();
    expect(editState(actions, { ...base, active: null, problem: { field: 'name', message: 'No' } }).problem).toBeNull();
    expect(editState(actions, { editable: ALL, failure: { field: 'title', message: 'Failed' } }).failure).toEqual({ field: 'title', message: 'Failed' });
    expect(editState(actions, { editable: { name: true }, failure: { field: 'title', message: 'Failed' } }).failure).toBeNull();
  });

  it('says one sentence for the live region: the refusal, else the failure, else saving', () => {
    const base = { editable: ALL, ...handlers };
    expect(editState(actions, { ...base, saving: { title: true } }).message).toBe('Saving title…');
    expect(editState(actions, { ...base, saving: { title: true }, failure: { field: 'name', message: 'Failed' } }).message).toBe('Failed');
    expect(editState(actions, { ...base, active: { field: 'name', value: '' }, problem: { field: 'name', message: 'No' }, failure: { field: 'name', message: 'Failed' } }).message).toBe('No');
    expect(editState(actions, { ...base }).message).toBe('');
    expect(editState(actions, { editable: { name: true }, saving: { title: true } }).message).toBe('');
  });

  it('knows exactly three lines', () => {
    expect(EDIT_FIELDS).toEqual(['name', 'title', 'organization']);
  });
});

// ─── Which controls exist ────────────────────────────────────────────────────

describe('edit controls: visibility and names', () => {
  it('draws none, and the same page as before, without editing props', () => {
    const { container } = render(<PersonHeader person={model(JORDAN)} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('.ph-line, .ph-edit, .ph-editor')).toBeNull();
    expect(live()).toBeNull();
  });

  it('draws none when editing is handed over but the parent cannot begin an edit', () => {
    render(<PersonHeader person={model(JORDAN)} editing={{ editable: ALL, onChange() {}, onSubmit() {}, onCancel() {} }} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('draws none for a read-only session (nothing editable), though the parent can begin an edit', () => {
    render(<PersonHeader person={model(JORDAN)} actions={{ onEdit() {} }} editing={{ editable: { name: false, title: false, organization: false } }} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Jordan Lee' })).toBeInTheDocument();
    expect(screen.getByText('Community Partner')).toBeInTheDocument();
  });

  it('draws an edit button per editable line, named for the line', () => {
    drawStateful();
    expect(editBtn('name')).toBeInTheDocument();
    expect(editBtn('title')).toBeInTheDocument();
    expect(editBtn('organization')).toBeInTheDocument();
    expect(screen.getByText('Community Partner')).toBeInTheDocument();
    expect(screen.getByText('Community Partners')).toBeInTheDocument();
  });

  it('a company-linked organization is shown as text with no edit control', () => {
    drawStateful(JORDAN, { editable: { name: true, title: true, organization: false } });
    expect(screen.queryByRole('button', { name: 'Edit organization' })).toBeNull();
    expect(screen.getByText('Community Partners')).toBeInTheDocument();
    expect(editBtn('title')).toBeInTheDocument();
  });

  it('a line with no value gets an "Add" control when it may be edited, and nothing when it may not', () => {
    const sparse = { id: 'c2', name: 'Sam Okafor' };
    const { unmount } = drawStateful(sparse);
    expect(screen.getByRole('button', { name: 'Add title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add organization' })).toBeInTheDocument();
    unmount();
    drawStateful(sparse, { editable: { name: true, title: false, organization: false } });
    expect(screen.queryByRole('button', { name: /Add / })).toBeNull();
  });

  it('only a name edit is offered when only the name is editable, and no empty subtitle is drawn', () => {
    drawStateful({ id: 'c2', name: 'Sam Okafor' }, { editable: { name: true, title: false, organization: false } });
    expect(editBtn('name')).toBeInTheDocument();
    expect(document.querySelector('.ph-subtitle')).toBeNull();
  });

  it('pressing a control asks the parent to begin that edit, once', async () => {
    const { s, user } = drawStateful();
    await user.click(editBtn('title'));
    expect(s.onEdit).toHaveBeenCalledTimes(1);
    expect(s.onEdit).toHaveBeenCalledWith('title');
  });

  it('a CSV contact is shown by its first and last name, and that is what "Edit name" opens', async () => {
    const { user } = drawStateful(CSV);
    expect(screen.getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    await user.click(editBtn('name'));
    expect(inputOf('Name')).toHaveValue('Jane Doe');
  });
});

// ─── The editor ──────────────────────────────────────────────────────────────

describe('the open editor', () => {
  it('shows the text it is handed, in a labelled box, and keeps no draft of its own', async () => {
    const { s, user } = drawStateful();
    await user.click(editBtn('title'));
    const input = inputOf('Title');
    expect(input).toHaveValue('Community Partner');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input).toHaveAttribute('dir', 'auto');
    // A parent that ignores the change leaves the text as it was: the box is controlled, nothing is held here.
    const ignored = render(<PersonHeader person={model(JORDAN)} actions={{ onEdit() {} }} editing={{ editable: ALL, active: { field: 'name', value: 'Fixed' }, onChange: s.onChange, onSubmit() {}, onCancel() {} }} />);
    const fixed = within(ignored.container).getByRole('textbox', { name: 'Name' });
    await user.type(fixed, 'abc');
    expect(s.onChange).toHaveBeenCalled();
    expect(fixed).toHaveValue('Fixed');
  });

  it('typing reports the new text to the parent', async () => {
    const { s, user } = drawStateful();
    await user.click(editBtn('title'));
    await user.clear(inputOf('Title'));
    await user.type(inputOf('Title'), 'VP');
    expect(s.onChange).toHaveBeenLastCalledWith('VP');
    expect(inputOf('Title')).toHaveValue('VP');
  });

  it('is drawn instead of the line it edits, and the other lines keep their controls', async () => {
    const { user } = drawStateful();
    await user.click(editBtn('name'));
    expect(screen.queryByRole('heading', { name: 'Jordan Lee' })).toBeNull();
    expect(inputOf('Name')).toBeInTheDocument();
    expect(editBtn('title')).toBeInTheDocument();
    expect(editBtn('organization')).toBeInTheDocument();
  });

  it('an editor for a line that is not editable is not drawn', () => {
    render(<PersonHeader person={model(JORDAN)} actions={{ onEdit() {} }} editing={{ editable: { name: false }, active: { field: 'name', value: 'x' }, onChange() {}, onSubmit() {}, onCancel() {} }} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('Enter, Escape and blur', () => {
  it('Enter submits once', async () => {
    const { s, user } = drawStateful();
    await user.click(editBtn('title'));
    await user.type(inputOf('Title'), '{Enter}');
    expect(s.onSubmit).toHaveBeenCalledTimes(1);
    expect(s.onCancel).not.toHaveBeenCalled();
  });

  it('Escape cancels, and does not submit', async () => {
    const { s, user } = drawStateful();
    await user.click(editBtn('title'));
    await user.type(inputOf('Title'), 'x{Escape}');
    expect(s.onCancel).toHaveBeenCalledTimes(1);
    expect(s.onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('blur submits', async () => {
    const { s, user } = drawStateful();
    await user.click(editBtn('title'));
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(s.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a blur after an Enter that left the box open (a refused name) does not submit again', async () => {
    const { s, user } = drawStateful({ id: 'c2', name: 'Sam Okafor' }, { initial: { field: 'name', value: '' } });
    fireEvent.keyDown(inputOf('Name'), { key: 'Enter' });
    fireEvent.blur(inputOf('Name'));
    expect(s.onSubmit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(s.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a blur after Escape does not submit', async () => {
    const { s } = drawStateful(JORDAN, { initial: { field: 'title', value: 'Community Partner' } });
    fireEvent.keyDown(inputOf('Title'), { key: 'Escape' });
    fireEvent.blur(screen.queryByRole('textbox') ?? document.body);
    expect(s.onCancel).toHaveBeenCalledTimes(1);
    expect(s.onSubmit).not.toHaveBeenCalled();
  });

  it('holding Enter down is one submit, not many (the box stays open here, as it does for a refused name)', () => {
    const { s } = drawStateful({ id: 'c2', name: 'Sam Okafor' }, { initial: { field: 'name', value: '' } });
    const input = inputOf('Name');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter', repeat: true });
    fireEvent.keyDown(input, { key: 'Enter', repeat: true });
    expect(s.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Enter while an input method is composing text is not a submit', () => {
    const { s } = drawStateful(JORDAN, { initial: { field: 'title', value: 'x' } });
    fireEvent.keyDown(inputOf('Title'), { key: 'Enter', isComposing: true });
    expect(s.onSubmit).not.toHaveBeenCalled();
  });

  it('typing again after an Enter that was refused makes the next blur count', async () => {
    const { s, user } = drawStateful({ id: 'c2', name: 'Sam Okafor' }, { initial: { field: 'name', value: '' } });
    fireEvent.keyDown(inputOf('Name'), { key: 'Enter' });
    expect(s.onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.blur(inputOf('Name'));
    expect(s.onSubmit).toHaveBeenCalledTimes(1);
    await user.type(inputOf('Name'), 'S');
    fireEvent.blur(inputOf('Name'));
    expect(s.onSubmit).toHaveBeenCalledTimes(2);
  });

  it('moving focus onto the editor\'s own Cancel or Try again button is not a blur-submit', async () => {
    const { s, control } = drawStateful();
    act(() => { control.current.setActive({ field: 'title', value: 'VP' }); control.current.setFailure({ field: 'title', message: 'Failed' }); });
    fireEvent.blur(inputOf('Title'), { relatedTarget: screen.getByRole('button', { name: 'Cancel' }) });
    expect(s.onSubmit).not.toHaveBeenCalled();
  });
});

// ─── Messages ────────────────────────────────────────────────────────────────

describe('refusal and failure', () => {
  it('a refused blank name keeps the editor open and says so, wired for assistive technology', async () => {
    const { s, user } = drawStateful({ id: 'c2', name: 'Sam Okafor' });
    await user.click(editBtn('name'));
    await user.clear(inputOf('Name'));
    await user.type(inputOf('Name'), '{Enter}');
    const input = inputOf('Name');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const message = screen.getAllByText(BLANK_NAME).find((el) => el.id);
    expect(message).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toContain(message.id);
    expect(live()).toHaveTextContent(BLANK_NAME);
    expect(s.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('typing clears the message and the invalid state', async () => {
    const { user } = drawStateful({ id: 'c2', name: 'Sam Okafor' });
    await user.click(editBtn('name'));
    await user.clear(inputOf('Name'));
    await user.type(inputOf('Name'), '{Enter}');
    await user.type(inputOf('Name'), 'S');
    expect(screen.queryByText(BLANK_NAME)).toBeNull();
    expect(inputOf('Name')).toHaveAttribute('aria-invalid', 'false');
  });

  it('a failed save shows its message with the text kept, a Try again and a Cancel', async () => {
    const { s, control, user } = drawStateful();
    act(() => { control.current.setActive({ field: 'title', value: 'VP of Everything' }); control.current.setFailure({ field: 'title', message: "Couldn't save title. Try again." }); });
    const input = inputOf('Title');
    expect(input).toHaveValue('VP of Everything');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(live()).toHaveTextContent("Couldn't save title. Try again.");
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(s.onSubmit).toHaveBeenCalledTimes(1);
    act(() => { control.current.setActive({ field: 'title', value: 'VP of Everything' }); control.current.setFailure({ field: 'title', message: "Couldn't save title. Try again." }); });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(s.onCancel).toHaveBeenCalledTimes(1);
  });

  it('Try again and Cancel do not take focus from the box first (so the blur-save cannot fire ahead of them)', () => {
    const { control } = drawStateful();
    act(() => { control.current.setActive({ field: 'title', value: 'VP' }); control.current.setFailure({ field: 'title', message: 'Failed' }); });
    for (const name of ['Try again', 'Cancel']) {
      const notPrevented = fireEvent.mouseDown(screen.getByRole('button', { name }));
      expect(notPrevented, name).toBe(false);
    }
  });

  it('a failure with no editor open is still shown, beside its line, and announced', () => {
    const { control } = drawStateful();
    act(() => control.current.setFailure({ field: 'title', message: "Couldn't save title. Try again." }));
    // The visible message beside the line (not only the live region's copy of it).
    expect(document.querySelector('.ph-field-msg')).toHaveTextContent("Couldn't save title. Try again.");
    expect(live()).toHaveTextContent("Couldn't save title. Try again.");
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('a failed NAME save with no editor open is shown beside the name', () => {
    const { control } = drawStateful();
    act(() => control.current.setFailure({ field: 'name', message: "Couldn't save name. Try again." }));
    expect(document.querySelector('.ph-field-msg')).toHaveTextContent("Couldn't save name. Try again.");
    expect(screen.getByRole('heading', { name: 'Jordan Lee' })).toBeInTheDocument();
  });

  it('a Cancel is offered for a refused name too, so a touch screen has a way out', () => {
    drawStateful({ id: 'c2', name: 'Sam Okafor' }, { initial: { field: 'name', value: '' } });
    fireEvent.keyDown(inputOf('Name'), { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('saving', () => {
  it('shows a quiet busy state on the line, keeps the new value on screen, and announces it politely', () => {
    const { control } = drawStateful();
    act(() => control.current.setSaving({ title: true }));
    expect(editBtn('title')).toHaveAttribute('aria-busy', 'true');
    expect(editBtn('title').querySelector('.ph-spinner')).not.toBeNull();
    expect(screen.getByText('Community Partner')).toBeInTheDocument();
    expect(live()).toHaveTextContent('Saving title…');
    expect(live()).toHaveAttribute('aria-live', 'polite');
    expect(editBtn('name')).not.toHaveAttribute('aria-busy', 'true');
  });

  it('shows nothing when the line may not be edited', () => {
    render(<PersonHeader person={model(JORDAN)} actions={{ onEdit() {} }} editing={{ editable: { name: true }, saving: { title: true } }} />);
    expect(document.querySelector('.ph-spinner')).toBeNull();
    expect(live()).toHaveTextContent('');
  });
});

// ─── Focus ───────────────────────────────────────────────────────────────────

describe('focus', () => {
  it('opening an editor puts the cursor in it, with its text selected ready to replace', async () => {
    const { user } = drawStateful();
    await user.click(editBtn('title'));
    expect(inputOf('Title')).toHaveFocus();
    expect(inputOf('Title').selectionStart).toBe(0);
    expect(inputOf('Title').selectionEnd).toBe('Community Partner'.length);
  });

  it('Enter returns focus to the edit button of that line', async () => {
    const { user } = drawStateful();
    await user.click(editBtn('title'));
    await user.type(inputOf('Title'), '{Enter}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(editBtn('title')).toHaveFocus();
  });

  it('Escape returns focus to the edit button of that line', async () => {
    const { user } = drawStateful();
    await user.click(editBtn('organization'));
    await user.type(inputOf('Organization'), '{Escape}');
    expect(editBtn('organization')).toHaveFocus();
  });

  it('a blur save does NOT take focus from where the person went', async () => {
    const { user } = drawStateful();
    await user.click(editBtn('title'));
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    await user.click(elsewhere);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(elsewhere).toHaveFocus();
    expect(editBtn('title')).not.toHaveFocus();
  });

  it('a refused Enter keeps focus in the box, and a later blur save does not pull focus back to the button', async () => {
    const { user } = drawStateful({ id: 'c2', name: 'Sam Okafor' });
    await user.click(editBtn('name'));
    await user.clear(inputOf('Name'));
    await user.type(inputOf('Name'), '{Enter}');
    expect(inputOf('Name')).toHaveFocus();
    await user.type(inputOf('Name'), 'Sam');
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    await user.click(elsewhere);
    expect(elsewhere).toHaveFocus();
  });

  it('Try again that succeeds returns focus to the edit button; Cancel does too', async () => {
    const { control, user } = drawStateful();
    act(() => { control.current.setActive({ field: 'title', value: 'VP' }); control.current.setFailure({ field: 'title', message: 'Failed' }); });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(editBtn('title')).toHaveFocus();
    act(() => { control.current.setActive({ field: 'name', value: 'Jo' }); control.current.setFailure({ field: 'name', message: 'Failed' }); });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(editBtn('name')).toHaveFocus();
  });

  describe('an editor that reopens by itself after a failed save', () => {
    it('takes focus when nothing else has it, with the caret at the end so the entered text is not wiped by the next key', () => {
      const { control } = drawStateful();
      expect(document.body).toHaveFocus();
      act(() => { control.current.setActive({ field: 'title', value: 'VP' }); control.current.setFailure({ field: 'title', message: 'Failed' }); });
      expect(inputOf('Title')).toHaveFocus();
      expect(inputOf('Title').selectionStart).toBe(2);
      expect(inputOf('Title').selectionEnd).toBe(2);
    });

    it('takes focus when the person is resting on that line\'s own edit button', () => {
      const { control } = drawStateful();
      editBtn('title').focus();
      act(() => { control.current.setActive({ field: 'title', value: 'VP' }); control.current.setFailure({ field: 'title', message: 'Failed' }); });
      expect(inputOf('Title')).toHaveFocus();
    });

    it('does NOT take focus from anything else the person has moved on to', () => {
      const { control } = drawStateful();
      const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
      elsewhere.focus();
      act(() => { control.current.setActive({ field: 'title', value: 'VP' }); control.current.setFailure({ field: 'title', message: 'Failed' }); });
      expect(inputOf('Title')).toBeInTheDocument();
      expect(elsewhere).toHaveFocus();
    });

    it('does NOT take focus from a link in the header the person is using', () => {
      const { control } = drawStateful();
      const link = screen.getByRole('link', { name: /Call/ });
      link.focus();
      act(() => { control.current.setActive({ field: 'title', value: 'VP' }); control.current.setFailure({ field: 'title', message: 'Failed' }); });
      expect(link).toHaveFocus();
    });
  });
});

// ─── The rest of the header is untouched ─────────────────────────────────────

describe('the phone, email and profile links', () => {
  it('are still links to the same places, with the same names, while editing is available', async () => {
    const onContactAction = vi.fn();
    const s = spies();
    render(<Stateful person={model(JORDAN)} spies={s} />);
    expect(screen.getByRole('link', { name: 'Call (801) 555-0199' })).toHaveAttribute('href', 'tel:8015550199');
    expect(screen.getByRole('link', { name: 'Email jordan@communityslc.org' })).toHaveAttribute('href', 'mailto:jordan@communityslc.org');
    expect(screen.getByRole('link', { name: /LinkedIn profile of Jordan Lee/ })).toHaveAttribute('href', 'https://www.linkedin.com/in/jordan-lee');
    const { container } = render(<PersonHeader person={model(JORDAN)} actions={{ onContactAction, onEdit() {} }} editing={{ editable: ALL }} />);
    await userEvent.setup().click(within(container).getByRole('link', { name: 'Call (801) 555-0199' }));
    expect(onContactAction).toHaveBeenCalledWith('phone', {});
  });

  it('are still drawn while an editor is open', async () => {
    const { user } = drawStateful();
    await user.click(editBtn('name'));
    expect(screen.getByRole('link', { name: 'Call (801) 555-0199' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Email jordan@communityslc.org' })).toBeInTheDocument();
  });
});

// ─── Presentation only ───────────────────────────────────────────────────────

describe('PersonHeader stays presentation-only', () => {
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const source = strip(readFileSync(resolve(process.cwd(), 'src/components/contacts/personHeader/PersonHeader.jsx'), 'utf8'));

  it('imports no Firebase, service, account, router or editing hook', () => {
    const imports = [...source.matchAll(/(?:^|\n)\s*import\b[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const from of imports) {
      expect(from, from).not.toMatch(/firebase|services|ImpersonationContext|useContactIdentityEdit|contactFields|react-router/);
    }
    expect(source).not.toMatch(/updateDoc|getEffectiveUser|saveContactFields/);
  });
});

// ─── The stylesheet ──────────────────────────────────────────────────────────

describe('the editing stylesheet', () => {
  const stripCss = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
  const css = stripCss(readFileSync(resolve(process.cwd(), 'src/components/contacts/personHeader/PersonHeader.css'), 'utf8'));
  const indexCss = stripCss(readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8'));
  const decl = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [...css.matchAll(new RegExp(`(?:^|[};{])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(';');
  };

  it('every edit control is at least 44px to hit', () => {
    expect(decl('.ph-edit')).toMatch(/width:\s*44px/);
    expect(decl('.ph-edit')).toMatch(/height:\s*44px/);
    for (const selector of ['.ph-add-field', '.ph-editor-btn', '.ph-input']) {
      expect(decl(selector), selector).toMatch(/min-height:\s*44px/);
    }
  });

  it('the boxes are 16px or larger, so a phone does not zoom into them', () => {
    expect(decl('.ph-input')).toMatch(/font-size:\s*(?:1[6-9]|[2-9]\d)px/);
  });

  it('a focused control always has a visible outline', () => {
    for (const selector of ['.ph-edit:focus-visible', '.ph-add-field:focus-visible', '.ph-editor-btn:focus-visible', '.ph-input:focus-visible']) {
      expect(decl(selector), selector).toMatch(/outline:\s*2px solid/);
    }
    expect(css).not.toMatch(/outline:\s*(?:none|0)\b/);
  });

  it('the spinner stands still for a person who asks for less motion', () => {
    const motion = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(motion).toMatch(/\.ph-spinner/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^@]*\.ph-spinner[^}]*animation/);
  });

  const themeVars = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = indexCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  };
  const rootVars = themeVars(':root');
  const rgb = (hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const mix = (a, pct, b) => a.map((c, i) => c * (pct / 100) + b[i] * (1 - pct / 100));
  const lum = (c) => { const [x, y, z] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
  const contrast = (f, b) => { const [hi, lo] = [lum(f), lum(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };

  it('the message text is readable on the card in every theme (4.5:1)', () => {
    const color = decl('.ph-editor-msg, .ph-field-msg');
    const m = color.match(/color:\s*color-mix\(in srgb, var\(--status-error\) (\d+)%, var\(--text-primary\)\)/);
    expect(m, 'the message colour mixes the error colour toward the text colour').toBeTruthy();
    for (const id of ['workspace', 'mission', 'navy', 'sand', 'darkSide', 'lightSide', 'theForce']) {
      const vars = { ...rootVars, ...themeVars(`html[data-theme="${id}"]`) };
      const text = mix(rgb(vars['--status-error']), Number(m[1]), rgb(vars['--text-primary']));
      expect(contrast(text, rgb(vars['--bg-card'])), id).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// ─── Driven by the real hook ─────────────────────────────────────────────────

describe('driven by useContactIdentityEdit (the H2-1a hook)', () => {
  const REASON = { blank_name: BLANK_NAME };
  function WithHook({ initial }) {
    const [contact, setContact] = useState(initial);
    const onPatch = useCallback((id, fields) => setContact((c) => (c.id === id ? { ...c, ...fields } : c)), []);
    const edit = useContactIdentityEdit({ contact, onPatch });
    const editing = {
      editable: Object.fromEntries(EDIT_FIELDS.map((f) => [f, edit.editable(f)])),
      active: edit.editing,
      saving: Object.fromEntries(EDIT_FIELDS.map((f) => [f, edit.isSaving(f)])),
      problem: edit.problem ? { field: edit.problem.field, message: REASON[edit.problem.reason] } : null,
      failure: edit.error ? { field: edit.error.field, message: `Couldn't save ${edit.error.field}. Try again.` } : null,
      onChange: edit.setValue, onSubmit: edit.commit, onCancel: edit.cancel,
    };
    return (
      <>
        <PersonHeader person={model(contact)} actions={{ onEdit: edit.start }} editing={editing} />
        <button type="button">Elsewhere</button>
      </>
    );
  }
  const okWrite = (i) => act(async () => { fake.writes[i].resolve(); });
  const failWrite = (i) => act(async () => { const e = new Error('x'); e.code = 'unavailable'; fake.writes[i].reject(e); });

  beforeEach(() => { fake.writes = []; viewer.value = { uid: 'u1' }; vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it('edits a title: the new text shows at once, one write, focus back on the button, a quiet saving state until it lands', async () => {
    const user = userEvent.setup();
    render(<WithHook initial={JORDAN} />);
    await user.click(editBtn('title'));
    await user.clear(inputOf('Title'));
    await user.type(inputOf('Title'), 'Chief of Staff{Enter}');
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].path).toBe('users/u1/contacts/c1');
    expect(fake.writes[0].data.title).toBe('Chief of Staff');
    expect(screen.getByText('Chief of Staff')).toBeInTheDocument();
    expect(editBtn('title')).toHaveFocus();
    expect(editBtn('title')).toHaveAttribute('aria-busy', 'true');
    await okWrite(0);
    expect(editBtn('title')).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Chief of Staff')).toBeInTheDocument();
  });

  it('refuses a blank name: the box stays open with the message, nothing is written, and typing a name then saves', async () => {
    const user = userEvent.setup();
    render(<WithHook initial={JORDAN} />);
    await user.click(editBtn('name'));
    await user.clear(inputOf('Name'));
    await user.keyboard('{Enter}');
    expect(inputOf('Name')).toHaveFocus();
    expect(inputOf('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(live()).toHaveTextContent(BLANK_NAME);
    expect(fake.writes).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(fake.writes).toEqual([]);
    expect(inputOf('Name')).toBeInTheDocument();
    await user.type(inputOf('Name'), 'Jo');
    expect(screen.queryByText(BLANK_NAME)).toBeNull();
    await user.keyboard('{Enter}');
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].data.name).toBe('Jo');
  });

  it('a failed save puts the old text back on the line, reopens the box with what was typed, and Try again writes it', async () => {
    const user = userEvent.setup();
    render(<WithHook initial={JORDAN} />);
    await user.click(editBtn('title'));
    await user.clear(inputOf('Title'));
    await user.type(inputOf('Title'), 'VP{Enter}');
    await failWrite(0);
    expect(inputOf('Title')).toHaveValue('VP');
    expect(inputOf('Title')).toHaveFocus();
    expect(inputOf('Title')).toHaveAttribute('aria-invalid', 'true');
    expect(live()).toHaveTextContent("Couldn't save title. Try again.");
    expect(screen.queryByText('Community Partner')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fake.writes).toHaveLength(2);
    expect(fake.writes[1].data.title).toBe('VP');
    await okWrite(1);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('VP')).toBeInTheDocument();
    expect(editBtn('title')).toHaveFocus();
  });

  it('a failure that arrives after the person moved on to something else does not steal their focus', async () => {
    const user = userEvent.setup();
    render(<WithHook initial={JORDAN} />);
    await user.click(editBtn('title'));
    await user.clear(inputOf('Title'));
    await user.type(inputOf('Title'), 'VP{Enter}');
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    await user.click(elsewhere);
    await failWrite(0);
    expect(inputOf('Title')).toHaveValue('VP');
    expect(elsewhere).toHaveFocus();
  });

  it('a CSV contact is shown and edited by its display name, and only name is written', async () => {
    const user = userEvent.setup();
    render(<WithHook initial={CSV} />);
    expect(screen.getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    await user.click(editBtn('name'));
    expect(inputOf('Name')).toHaveValue('Jane Doe');
    await user.type(inputOf('Name'), ' Q.{Enter}');
    expect(Object.keys(fake.writes[0].data).sort()).toEqual(['name', 'updated_at']);
    expect(fake.writes[0].data.name).toBe('Jane Doe Q.');
    expect(screen.getByRole('heading', { name: 'Jane Doe Q.' })).toBeInTheDocument();
  });

  it('a company-linked contact has no organization control', () => {
    render(<WithHook initial={{ ...JORDAN, company_id: 'co9' }} />);
    expect(screen.queryByRole('button', { name: 'Edit organization' })).toBeNull();
    expect(screen.getByText('Community Partners')).toBeInTheDocument();
    expect(editBtn('title')).toBeInTheDocument();
  });

  it('an impersonated session has no edit controls at all', () => {
    viewer.value = { uid: 'target', _isImpersonated: true };
    render(<WithHook initial={JORDAN} />);
    expect(screen.queryByRole('button', { name: /^(Edit|Add) / })).toBeNull();
  });
});
