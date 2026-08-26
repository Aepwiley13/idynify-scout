/**
 * GATE 3 — the selection experience, walked end to end.
 *
 * Asserts what the user actually SEES at each step of:
 *   result_set → selection → resolution_preview → ambiguity → approval
 *
 * The point is the conversational quality, not just wiring: Barry asks rather
 * than guesses, approval is blocked until the question is answered, and nothing
 * claims to have been saved.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('../theme/ThemeContext', () => ({
  useT: () => ({ text: '#111', textFaint: '#888', textMuted: '#666', border: '#ddd', border2: '#ccc', surface: '#fff' }),
}));
vi.mock('../theme/tokens', () => ({ BRAND: { pink: '#E91E63', cyan: '#00BCD4' }, ASSETS: { barryAvatar: '' } }));

import BarryResultSet from '../components/barry/BarryResultSet';
import BarryResolutionPreview from '../components/barry/BarryResolutionPreview';
import { RESOLVED_PREVIEW } from './fixtures/resolveSaveFixtures';
import { mintClientRef } from '../utils/candidatePayload';
import { MOCK_PEOPLE, MOCK_SOURCE } from '../utils/mockPersonResults';

const rows = () => MOCK_PEOPLE.map((p, i) => ({ ...p, clientRef: mintClientRef(i) }));

describe('result_set turn', () => {
  it('presents people with title and company, and no contact details', () => {
    const results = rows();
    render(<BarryResultSet resultSet={{ kind: 'person', source: MOCK_SOURCE, results }} />);
    expect(screen.getByText('Sarah Chen')).toBeInTheDocument();
    expect(screen.getByText('VP of Operations · Northwind Logistics')).toBeInTheDocument();
    // Proposals: we do not parade email/phone before the user has chosen to act.
    expect(screen.queryByText(/S\.Chen@Northwind\.com/)).not.toBeInTheDocument();
    expect(screen.queryByText(/555-0198/)).not.toBeInTheDocument();
  });

  it('starts with nothing selected and the action disabled', () => {
    render(<BarryResultSet resultSet={{ kind: 'person', source: MOCK_SOURCE, results: rows() }} />);
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pick the ones you want/i })).toBeDisabled();
  });

  it('selecting updates the count and the action reads back the choice', () => {
    render(<BarryResultSet resultSet={{ kind: 'person', source: MOCK_SOURCE, results: rows() }} />);
    fireEvent.click(screen.getByText('Sarah Chen'));
    fireEvent.click(screen.getByText('Marcus Webb'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check these 2 against what I know/i })).toBeEnabled();
  });

  it('select-all then clear returns to zero', () => {
    const results = rows();
    render(<BarryResultSet resultSet={{ kind: 'person', source: MOCK_SOURCE, results }} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`select all ${results.length}`, 'i') }));
    expect(screen.getByText(`${results.length} selected`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('hands back only the selected clientRefs', () => {
    const results = rows();
    const onConfirm = vi.fn();
    render(<BarryResultSet resultSet={{ kind: 'person', source: MOCK_SOURCE, results }} onConfirmSelection={onConfirm} />);
    fireEvent.click(screen.getByText('Priya Raman'));
    fireEvent.click(screen.getByRole('button', { name: /check these 1/i }));
    expect(onConfirm).toHaveBeenCalledWith([results[2].clientRef]);
  });

  it('after a reload the proposals are gone and the turn says so honestly', () => {
    render(<BarryResultSet resultSet={null} />);
    expect(screen.getByText(/no longer selectable/i)).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
});

describe('resolution_preview turn', () => {
  // Real server shape, not a mock — see fixtures/resolveSaveFixtures.js
  async function preview() { return RESOLVED_PREVIEW; }

  it('shows the tallies Barry reported', async () => {
    render(<BarryResolutionPreview preview={await preview()} />);
    expect(screen.getByText(/already yours/i)).toBeInTheDocument();
    expect(screen.getByText(/would be new/i)).toBeInTheDocument();
    expect(screen.getByText(/needs you/i)).toBeInTheDocument();
  });

  it('ASKS about the ambiguous person instead of guessing', async () => {
    render(<BarryResolutionPreview preview={await preview()} />);
    expect(screen.getByText(/which one did you mean\?/i)).toBeInTheDocument();
    expect(screen.getByText(/— Acme/)).toBeInTheDocument();
    expect(screen.getByText(/— Contoso/)).toBeInTheDocument();
    expect(screen.getByText(/this is someone new/i)).toBeInTheDocument();
  });

  it('BLOCKS approval until the question is answered', async () => {
    render(<BarryResolutionPreview preview={await preview()} />);
    const btn = screen.getByRole('button', { name: /answer 1 question first/i });
    expect(btn).toBeDisabled();
  });

  it('answering unblocks approval and reads the choice back', async () => {
    render(<BarryResolutionPreview preview={await preview()} />);
    fireEvent.click(screen.getByText(/— Acme/));
    await waitFor(() => expect(screen.getByText(/Got it — Acme/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^save \d/i })).toBeEnabled();
  });

  it('"Neither" is treated as a new person, not an error', async () => {
    render(<BarryResolutionPreview preview={await preview()} />);
    fireEvent.click(screen.getByText(/this is someone new/i));
    await waitFor(() => expect(screen.getByText(/treat .* as someone new/i)).toBeInTheDocument());
  });

  it('states the refusal reason plainly rather than hiding it', async () => {
    render(<BarryResolutionPreview preview={await preview()} />);
    expect(screen.getByText(/needs an email, phone, LinkedIn/i)).toBeInTheDocument();
    expect(screen.getByText(/I'll leave them out/i)).toBeInTheDocument();
  });

  it('approval reports the counts it will act on', async () => {
    const onApprove = vi.fn();
    render(<BarryResolutionPreview preview={await preview()} onApprove={onApprove} />);
    fireEvent.click(screen.getByText(/— Contoso/));
    await waitFor(() => expect(screen.getByRole('button', { name: /^save \d/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /^save \d/i }));
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({ willSave: expect.any(Number) }));
  });

  it('"Not now" cancels without implying anything was saved', async () => {
    const onCancel = vi.fn();
    render(<BarryResolutionPreview preview={await preview()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /not now/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('once settled it renders as history, not a live control', async () => {
    render(<BarryResolutionPreview preview={await preview()} settled={{ approved: false }} />);
    expect(screen.getByText(/Nothing was saved/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^save/i })).not.toBeInTheDocument();
  });
});
