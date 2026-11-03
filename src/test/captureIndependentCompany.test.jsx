/**
 * Independent professionals on Capture: a card that is a person, not a
 * company. The review leaves Company empty when the text read as the company
 * is not one (the person's name, a service line…) and offers it as a
 * suggestion; the match step always lets the user choose No company, and
 * starts there for a company read only weakly that the user has not confirmed.
 * Every person and company here is fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const T = { cardBg: '#fff', surface: '#fafafa', border: '#ddd', text: '#111', textMuted: '#555', textFaint: '#888', input: '#fff', isDark: false };
const api = vi.hoisted(() => ({ preview: vi.fn(), save: vi.fn() }));

vi.mock('../theme/ThemeContext', () => ({ useT: () => T }));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }) }));
vi.mock('../components/capture/captureSave.js', () => ({
  previewCapturePerson: (...a) => api.preview(...a),
  saveCapturePerson: (...a) => api.save(...a),
}));

const { default: CaptureReview } = await import('../components/capture/CaptureReview.jsx');
const { default: CaptureSavePanel } = await import('../components/capture/CaptureSavePanel.jsx');

const person = (over = {}) => ({
  key: 'person-1', name: 'Kristin Sokol', title: 'Dating Strategy & Matchmaking', company: '', companySuggestion: null,
  email: 'kristin@kristinsokol.example', otherEmails: [], linkedinUrl: '', website: 'kristinsokol.example', phones: [], socials: [], toCheck: [],
  ...over,
});

/** The review and the match step holding their own state, as CaptureFlow does. */
function Flow({ initial, onPeople }) {
  const [people, setPeople] = useState(initial);
  return (
    <>
      <CaptureReview people={people} T={T} onChange={(i, next) => { const list = people.map((p, j) => (j === i ? next : p)); setPeople(list); onPeople?.(list); }} />
      <CaptureSavePanel operationId="cap_3f2a9c1e" people={people} onSaved={() => {}} T={T} />
    </>
  );
}

const newPerson = { status: 'new' };
beforeEach(() => {
  api.preview.mockReset();
  api.save.mockReset();
  api.save.mockResolvedValue({ status: 'saved', contactId: 'cap_3f2a9c1e_p1', companyId: null, outcome: 'created' });
});

describe('review: Company for a card that is a person, not a company', () => {
  it('the person\'s name read as the company: Company is empty ("No company"), the reason is shown, and it can still be taken', async () => {
    const user = userEvent.setup();
    const seen = [];
    render(<Flow initial={[person({ companySuggestion: { name: 'Kristin Sokol', reason: 'PERSON_NAME_AS_COMPANY' } })]} onPeople={list => seen.push(list)} />);

    const company = screen.getByLabelText('Company');
    expect(company).toHaveValue('');
    expect(company).toHaveAttribute('placeholder', 'No company');
    expect(screen.getByTestId('capture-company-suggestion')).toHaveTextContent('The card shows “Kristin Sokol”, but that\'s the person\'s name, so no company is added.');

    await user.click(screen.getByRole('button', { name: 'Use as company' }));
    expect(company).toHaveValue('Kristin Sokol');
    expect(screen.queryByTestId('capture-company-suggestion')).toBeNull();
    expect(seen.at(-1)[0].company).toBe('Kristin Sokol');
  });

  it('a service line read as the company says so', () => {
    render(<Flow initial={[person({ companySuggestion: { name: 'Dating Strategy & Matchmaking', reason: 'TITLE_AS_COMPANY' } })]} />);
    expect(screen.getByTestId('capture-company-suggestion')).toHaveTextContent('that looks like a job title');
  });

  it('no company text at all: just "No company", nothing to suggest, and the match says No company', async () => {
    const user = userEvent.setup();
    api.preview.mockResolvedValue({ person: newPerson, company: { status: 'none' } });
    render(<Flow initial={[person()]} />);
    expect(screen.getByLabelText('Company')).toHaveAttribute('placeholder', 'No company');
    expect(screen.queryByTestId('capture-company-suggestion')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByTestId('company-match')).toHaveTextContent('No company.');
  });
});

describe('match: a new company is a choice, and No company is always one of the answers', () => {
  it('a clearly printed company starts at "New company"; choosing No company saves without one', async () => {
    const user = userEvent.setup();
    api.preview.mockResolvedValue({ person: newPerson, company: { status: 'new', name: 'Example Robotics' } });
    render(<Flow initial={[person({ name: 'Avery Quinn', company: 'Example Robotics' })]} />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const add = await screen.findByRole('radio', { name: /New company: Example Robotics/ });
    const none = screen.getByRole('radio', { name: 'No company' });
    expect(add).toBeChecked();
    expect(none).not.toBeChecked();
    expect(screen.queryByText(/unclear or only in a logo/)).toBeNull();

    await user.click(none);
    await user.click(screen.getByRole('button', { name: /Add Person/ }));
    expect(api.save).toHaveBeenCalledWith('u1', expect.objectContaining({ choices: { person: null, company: 'none' } }));
  });

  it('a company read only weakly (a logo, an unclear read) that the user has not confirmed starts at No company', async () => {
    const user = userEvent.setup();
    api.preview.mockResolvedValue({ person: newPerson, company: { status: 'new', name: 'Sokol Studio' } });
    render(<Flow initial={[person({ company: 'Sokol Studio', toCheck: ['company'] })]} />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('radio', { name: 'No company' })).toBeChecked();
    expect(screen.getByRole('radio', { name: /New company: Sokol Studio/ })).not.toBeChecked();
    expect(screen.getByText(/unclear or only in a logo, so it isn't added unless you choose it/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Add Person/ }));
    expect(api.save).toHaveBeenCalledWith('u1', expect.objectContaining({ choices: { person: null, company: 'none' } }));
  });

  it('once the user edits that company, it is theirs: the match starts at "New company"', async () => {
    const user = userEvent.setup();
    api.preview.mockResolvedValue({ person: newPerson, company: { status: 'new', name: 'Sokol Studios' } });
    render(<Flow initial={[person({ company: 'Sokol Studio', toCheck: ['company'] })]} />);
    await user.type(screen.getByLabelText(/^Company/), 's');   // labelled "Company Check" until touched
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('radio', { name: /New company: Sokol Studios/ })).toBeChecked();
  });

  it('a possible company match: "Link to …" or "No company"; a weak read starts at No company there too', async () => {
    const user = userEvent.setup();
    api.preview.mockResolvedValue({ person: newPerson, company: { status: 'possible', companyId: 'co_1', name: 'Example Corp' } });
    render(<Flow initial={[person({ name: 'Avery Quinn', company: 'Example Robotics', toCheck: ['company'] })]} />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('radio', { name: 'No company' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Link to Example Corp' })).not.toBeChecked();
  });

  it('an existing company is linked as before, whatever the read', async () => {
    const user = userEvent.setup();
    api.preview.mockResolvedValue({ person: newPerson, company: { status: 'existing', companyId: 'co_1', name: 'Example Robotics' } });
    render(<Flow initial={[person({ name: 'Avery Quinn', company: 'Example Robotics', toCheck: ['company'] })]} />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByTestId('company-match')).toHaveTextContent('Existing company: Example Robotics');
    await user.click(screen.getByRole('button', { name: /Add Person/ }));
    expect(api.save).toHaveBeenCalledWith('u1', expect.objectContaining({ choices: { person: null, company: 'link' } }));
  });
});
