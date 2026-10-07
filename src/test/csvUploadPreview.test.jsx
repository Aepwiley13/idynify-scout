/**
 * CSVUpload (contacts) — the preview the user sees before anything is written,
 * and what it hands to Scout+ after the import.
 *
 * Real parsing and classification; the workspace lookup and the writes
 * (csvImportService) are stubbed — they have their own suite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const mockPreview = vi.hoisted(() => vi.fn());
const mockCommit = vi.hoisted(() => vi.fn());

vi.mock('../services/csvImportService', async (importOriginal) => ({
  ...(await importOriginal()),
  previewCsvImport: mockPreview,
  commitCsvImport: mockCommit,
}));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }) }));
vi.mock('../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({}));
vi.mock('../services/companyIdentityService', () => ({ resolveCompany: vi.fn() }));

import CSVUpload from '../components/scout/CSVUpload';
import { PREVIEW_OUTCOME } from '../services/csvImportService';
import { ROW_STATUS } from '../utils/csvContactImport';

const CSV = [
  'First Name,Last Name,Email,Company,Favorite Color',
  'Ana,New,ana@x.com,"Acme, Inc.",blue',     // row 2 — new
  'Erin,Existing,erin@x.com,Globex,red',     // row 3 — already in IDYNIFY
  'Bad,Email,not-an-email,,',                // row 4 — invalid
  ',,,Initech,',                             // row 5 — missing name and email
  'Ana,Again,ANA@x.com,,',                   // row 6 — duplicate of row 2
].join('\n');

beforeEach(() => {
  mockPreview.mockReset();
  mockPreview.mockImplementation(async (_uid, rows) => rows.map(r => (
    r.status !== ROW_STATUS.READY ? r
      : { ...r, outcome: r.contact.email === 'erin@x.com' ? PREVIEW_OUTCOME.EXISTING : PREVIEW_OUTCOME.NEW, decision: {} }
  )));
  mockCommit.mockReset();
  mockCommit.mockResolvedValue({
    batchId: 'b1', tag: 'CSV Import - bw - 2026-10-02', failed: [],
    created: [{ id: 'n1', name: 'Ana New' }],
    updated: [{ id: 'e1', name: 'Erin Existing' }],
  });
});

async function upload(onContactsAdded = vi.fn()) {
  render(<CSVUpload onContactsAdded={onContactsAdded} onCancel={() => {}} />);
  fireEvent.click(screen.getByText('Lead / Contact List'));
  const file = new File([CSV], 'Beyond_Words.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByTestId('csv-upload'), { target: { files: [file] } });
  await screen.findByText(/Preview: Beyond_Words.csv/);
  return onContactsAdded;
}

describe('CSVUpload — contact preview', () => {
  it('shows ready, possible duplicate, invalid and missing counts', async () => {
    await upload();
    expect(within(screen.getByTestId('tile-ready')).getByText('2')).toBeInTheDocument();
    expect(screen.getByTestId('tile-ready')).toHaveTextContent('1 new · 1 already in IDYNIFY');
    expect(within(screen.getByTestId('tile-duplicates')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-invalid')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-missing')).getByText('1')).toBeInTheDocument();
  });

  it('lists every row it will not import, by row number, and the ignored column', async () => {
    await upload();
    const list = screen.getByTestId('csv-attention');
    expect(list).toHaveTextContent('Row 4: Invalid email address: not-an-email');
    expect(list).toHaveTextContent('Row 5: Needs a name or an email address');
    expect(list).toHaveTextContent('Row 6: Same person as row 2');
    expect(screen.getByText(/Columns not imported.*Favorite Color/)).toBeInTheDocument();
  });

  it('never sends invalid rows to the workspace lookup as importable', async () => {
    await upload();
    const ready = mockPreview.mock.calls[0][1].filter(r => r.status === ROW_STATUS.READY);
    expect(ready.map(r => r.contact.email)).toEqual(['ana@x.com', 'erin@x.com']);
  });

  it('imports under the named group and hands new AND existing contacts to Scout+', async () => {
    const onContactsAdded = await upload();
    expect(screen.getByLabelText('Name this import')).toHaveValue('Beyond Words');
    fireEvent.change(screen.getByLabelText('Name this import'), { target: { value: 'Beyond Words Gala' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 contacts' }));

    await vi.waitFor(() => expect(onContactsAdded).toHaveBeenCalled());
    expect(mockCommit.mock.calls[0][2]).toMatchObject({ importName: 'Beyond Words Gala', fileName: 'Beyond_Words.csv' });
    const [items, result] = onContactsAdded.mock.calls[0];
    expect(items.map(i => i.id)).toEqual(['n1', 'e1']);
    expect(items.every(i => i._uploadType === 'leads')).toBe(true);
    expect(result.tag).toBe('CSV Import - bw - 2026-10-02');
  });

  it('shows an email conflict before import, with both addresses, and counts it as existing', async () => {
    mockPreview.mockImplementation(async (_uid, rows) => rows.map(r => {
      if (r.status !== ROW_STATUS.READY) return r;
      if (r.contact.email === 'erin@x.com') {
        return {
          ...r, outcome: PREVIEW_OUTCOME.EMAIL_CONFLICT, decision: {},
          emailConflict: { signal: 'phone', signalLabel: 'phone', csvEmail: 'erin@x.com', storedEmail: 'erin.old@x.com' },
          reason: 'Erin Existing: matched by phone. CSV email erin@x.com ≠ IDYNIFY email erin.old@x.com. Imported without changing the email; not added to cadences until resolved in People',
        };
      }
      return { ...r, outcome: PREVIEW_OUTCOME.NEW, decision: {} };
    }));
    await upload();
    expect(screen.getByTestId('email-conflict-banner')).toHaveTextContent('1 email conflict');
    expect(screen.getByTestId('csv-attention')).toHaveTextContent('Row 3: Erin Existing: matched by phone. CSV email erin@x.com ≠ IDYNIFY email erin.old@x.com');
    expect(screen.getByTestId('tile-ready')).toHaveTextContent('1 new · 1 already in IDYNIFY');
    expect(screen.getByText('Email conflict')).toBeInTheDocument();
  });
});

