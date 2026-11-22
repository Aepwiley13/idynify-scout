import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DuplicateReview from '../pages/ContactHub/duplicates/DuplicateReview';
import { buildDuplicatePreview, detectPossibleDuplicates } from '../pages/ContactHub/duplicates/duplicateReviewModel';

vi.mock('../theme/ThemeContext', () => ({ useT: () => ({}) }));

const a = { id: 'a', name: 'Jordan Lee', email: 'Jordan@EXAMPLE.org', company_name: 'Volunteer Network', title: 'Coordinator' };
const b = { id: 'b', name: 'Jordan Lee', email: 'jordan@example.org', company_name: 'Volunteer Network', title: 'Director' };
const possibleDuplicate = (left, right) => detectPossibleDuplicates([left, right])[0];

describe('account snapshot duplicate evidence', () => {
  it('combines exact email, LinkedIn and organization evidence in one pair', () => {
    const [match] = detectPossibleDuplicates([
      { ...a, linkedin_url: 'https://www.linkedin.com/in/jordan/' },
      { ...b, linkedin_url: 'https://linkedin.com/in/jordan' },
    ]);
    expect(match.confidence).toBe('Strong match');
    expect(match.evidence).toEqual(expect.arrayContaining(['Same email address', 'Same LinkedIn profile', 'Same name and organization']));
  });

  it('flags a one-edit name at the same organization and excludes uncorroborated names and main lines', () => {
    const similar = { id: 'similar', name: 'Jorden Lee', company_name: a.company_name };
    expect(possibleDuplicate(a, similar)).toMatchObject({ confidence: 'Possible match', evidence: ['Similar name and same organization'] });
    expect(detectPossibleDuplicates([a, { ...similar, company_name: 'Another place' }])).toEqual([]);
    const main = [{ value: '8015550100', label: 'main' }];
    expect(detectPossibleDuplicates([{ id: 'x', name: 'Sam', phones: main }, { id: 'y', name: 'Al', phones: main }])).toEqual([]);
  });

  it('flags shared addresses and conflicting authoritative identifiers without inferring identity', () => {
    const shared = { id: 'c', name: 'Pat Lee', emails: ['jordan@example.org'] };
    const pairs = detectPossibleDuplicates([a, b, shared]);
    expect(pairs).toHaveLength(3);
    expect(pairs.every((pair) => pair.confidence === 'Needs review' && pair.shared)).toBe(true);
    const conflict = possibleDuplicate({ ...a, apollo_person_id: 'one' }, { ...b, apollo_person_id: 'two' });
    expect(conflict).toMatchObject({ confidence: 'Needs review', conflicts: ['External person IDs differ'] });
  });

  it('keeps all available relationship values in a simulation and leaves choices unresolved until selected', () => {
    const left = { ...a, notes: [{ id: 'note' }], phone: '8015550100', sticker_ids: ['s1'], source: 'manual', email_opt_out: true };
    const right = { ...b, emails: ['other@example.org'], sticker_assignments: { s2: {} }, photo_url: 'https://example.org/photo.jpg', photo_source: 'apollo' };
    const result = buildDuplicatePreview([left, right]);
    expect(result).toMatchObject({
      emails: ['jordan@example.org', 'other@example.org'], phones: ['8015550100'],
      notes: 1, stickers: ['s1', 's2'], sources: ['manual'],
    });
    expect(result.details[0].permission).toBe('Opt-out or suppression recorded');
    expect(result.fields.find(({ label }) => label === 'Job title')).toMatchObject({ conflict: true, value: undefined });
    expect(buildDuplicatePreview([left, right], { 'Job title': '1' }).fields.find(({ label }) => label === 'Job title').value).toBe('Director');
    expect(left.title).toBe('Coordinator');
    expect(detectPossibleDuplicates([{ id: 'missing' }, { id: 'no-data' }])).toEqual([]);
  });
});

describe('Duplicate review', () => {
  afterEach(() => vi.restoreAllMocks());

  it('compares contacts and persists a false-match dismissal locally when no trusted service is supplied', async () => {
    const user = userEvent.setup();
    render(<DuplicateReview contacts={[a, b]} />);
    await user.click(screen.getByRole('button', { name: 'Review possible duplicates 1' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('table', { name: 'Compare the saved contact details' })).toBeInTheDocument();
    await user.click(within(dialog.getByRole('navigation', { name: 'Possible matches' })).getByRole('button', { name: 'Not a duplicate' }));
    expect(dialog.getByText('No possible duplicates to review.')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Restore dismissed matches' }));
    expect(dialog.getByRole('button', { name: 'Not a duplicate' })).toBeInTheDocument();
  });

  it('resolves only conflicting values with source labels, previews and commits through the trusted request', async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (action, fields) => {
      if (action === 'dismissals') return { pairs: [], latest: null };
      if (action === 'preview' && !Number.isInteger(fields.choices.title)) return { blockers: [], conflicts: [{ key: 'title', options: ['Director', 'Coordinator'] }], combined: { name: 'Jordan Lee', emails: ['jordan@example.org'], phones: [], notes: 0, stickers: 0 }, token: null };
      if (action === 'preview') return { blockers: [], conflicts: [{ key: 'title', options: ['Director', 'Coordinator'] }], combined: { name: 'Jordan Lee', emails: ['jordan@example.org'], phones: [], notes: 0, stickers: 0 }, activityCount: 0, token: 'signed-preview' };
      if (action === 'commit') return { receipt: { status: 'merged', operationId: fields.operationId } };
      throw new Error(`Unexpected ${action}`);
    });
    render(<DuplicateReview contacts={[a, b]} request={request} />);
    await user.click(await screen.findByRole('button', { name: 'Review possible duplicates 1' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getAllByRole('radio', { name: /Jordan Lee/ })[0]);
    await user.click(dialog.getByRole('button', { name: 'Continue' }));
    const titleOptions = await dialog.findAllByRole('radio', { name: /From Jordan Lee/ });
    expect(titleOptions).toHaveLength(2);
    await user.click(titleOptions[0]);
    await user.click(dialog.getByRole('button', { name: 'Review combined contact' }));
    expect(await dialog.findByText('Contact that will remain')).toBeInTheDocument();
    expect(dialog.queryByText('Existing email opt-outs')).toBeNull();
    await user.click(dialog.getByRole('button', { name: 'Merge contacts' }));
    expect(await dialog.findByRole('heading', { name: 'Contacts merged' })).toBeInTheDocument();
    expect(request.mock.calls.map(([action]) => action)).toEqual(['dismissals', 'preview', 'preview', 'commit']);
  });

  it('requires confirmation before discarding choices, and supports Escape and outside dismissal', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<DuplicateReview contacts={[a, b]} request={async (action) => action === 'dismissals' ? { pairs: [], latest: null } : { blockers: [], conflicts: [], combined: {}, token: 'token' }} />);
    await user.click(await screen.findByRole('button', { name: 'Review possible duplicates 1' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getAllByRole('radio', { name: /Jordan Lee/ })[0]);
    await user.keyboard('{Escape}');
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    vi.mocked(window.confirm).mockReturnValue(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps read-only comparison available and account review state isolated', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DuplicateReview key="account-1" contacts={[a, b]} />);
    await user.click(screen.getByRole('button', { name: 'Review possible duplicates 1' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Possible matches' })).getByRole('button', { name: 'Not a duplicate' }));
    // Identical local document IDs in another account must not inherit a dismissal.
    rerender(<DuplicateReview key="account-2" contacts={[{ ...a, title: 'Member' }, b]} readOnly />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review possible duplicates 1' }));
    expect(screen.queryByRole('button', { name: 'Not a duplicate' })).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Member' })).toBeInTheDocument();
  });
});
