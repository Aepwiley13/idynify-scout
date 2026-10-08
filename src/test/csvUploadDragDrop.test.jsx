/**
 * CSV upload — drag & drop, the file bar, incomplete-profile preview and the
 * dark theme.
 *
 * Drop and Browse hand the File to the same handler, so a dropped file goes
 * through exactly the parse → classify → preview path a picked file does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

const mockPreview = vi.hoisted(() => vi.fn());

vi.mock('../services/csvImportService', async (importOriginal) => ({
  ...(await importOriginal()),
  previewCsvImport: mockPreview,
  commitCsvImport: vi.fn(),
}));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }) }));
vi.mock('../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({}));
vi.mock('../services/companyIdentityService', () => ({ resolveCompany: vi.fn() }));

import CSVUpload from '../components/scout/CSVUpload';
import { ThemeCtx } from '../theme/ThemeContext';
import { THEMES } from '../theme/tokens';
import { PREVIEW_OUTCOME } from '../services/csvImportService';
import { ROW_STATUS } from '../utils/csvContactImport';

const CSV = [
  'First Name,Last Name,Email,Company',
  'Ana,Lopez,ana@x.com,Acme',          // row 2 — complete
  ',,person@example.com,',             // row 3 — incomplete: email only
  ',,not-an-email,Initech',            // row 4 — invalid
].join('\n');

const csvFile = (name = 'People Pitch.csv', text = CSV) => new File([text], name, { type: 'text/csv' });

beforeEach(() => {
  mockPreview.mockReset();
  mockPreview.mockImplementation(async (_uid, rows) => rows.map(r => (
    r.status !== ROW_STATUS.READY ? r : { ...r, outcome: PREVIEW_OUTCOME.NEW, decision: {} }
  )));
});

function openContacts(theme) {
  const ui = <CSVUpload onContactsAdded={vi.fn()} onCancel={() => {}} />;
  const utils = render(theme ? <ThemeCtx.Provider value={{ T: theme, themeId: theme.id, setThemeId: () => {} }}>{ui}</ThemeCtx.Provider> : ui);
  fireEvent.click(screen.getByText('Lead / Contact List'));
  return utils;
}

const zone = () => screen.getByTestId('csv-upload-dropzone');
const drag = (type, el, files = [], types = ['Files']) => fireEvent[type](el, { dataTransfer: { files, types, dropEffect: 'none' } });

describe('drag & drop', () => {
  it('a dropped CSV takes the same parse → preview path as a picked one', async () => {
    openContacts();
    drag('dragEnter', zone());
    expect(zone()).toHaveAttribute('data-dragging', 'true');
    expect(screen.getByText('Drop your CSV to upload')).toBeInTheDocument();
    drag('drop', zone(), [csvFile()]);

    await screen.findByText('Preview: People Pitch.csv');
    expect(mockPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('csv-file-bar')).toHaveTextContent('People Pitch.csv');
    expect(screen.getByTestId('csv-file-bar')).toHaveTextContent('3 rows in file');
  });

  it('clears the drag-over state when the file leaves the zone', () => {
    openContacts();
    drag('dragEnter', zone());
    drag('dragLeave', zone());
    expect(zone()).toHaveAttribute('data-dragging', 'false');
    expect(screen.getByText('Drag & drop your CSV here')).toBeInTheDocument();
  });

  it('rejects a non-CSV with a message naming the file, and reads nothing', () => {
    openContacts();
    drag('drop', zone(), [new File(['x'], 'People Pitch.xlsx', { type: 'application/vnd.ms-excel' })]);
    expect(screen.getByRole('alert')).toHaveTextContent('"People Pitch.xlsx" is not a CSV file');
    expect(mockPreview).not.toHaveBeenCalled();
    expect(zone()).toBeInTheDocument();
  });

  it('rejects a non-CSV picked with Browse the same way', () => {
    openContacts();
    fireEvent.change(screen.getByTestId('csv-upload'), { target: { files: [new File(['x'], 'list.pdf')] } });
    expect(screen.getByRole('alert')).toHaveTextContent('"list.pdf" is not a CSV file');
  });

  it('asks for one file at a time', () => {
    openContacts();
    drag('drop', zone(), [csvFile('a.csv'), csvFile('b.csv')]);
    expect(screen.getByRole('alert')).toHaveTextContent('Drop one CSV file at a time.');
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('browse is reachable from the keyboard', () => {
    openContacts();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    expect(zone()).toHaveAttribute('tabindex', '0');
    expect(zone()).toHaveAttribute('role', 'button');
    fireEvent.keyDown(zone(), { key: 'Enter' });
    fireEvent.keyDown(zone(), { key: ' ' });
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });
});

describe('file bar — replace / remove', () => {
  it('Remove returns to the drop zone; Replace re-runs the preview with the new file', async () => {
    openContacts();
    fireEvent.change(screen.getByTestId('csv-upload'), { target: { files: [csvFile()] } });
    await screen.findByText('Preview: People Pitch.csv');

    fireEvent.change(screen.getByTestId('csv-replace-input'), {
      target: { files: [csvFile('Second list.csv', 'Email\nz@x.com')] },
    });
    await screen.findByText('Preview: Second list.csv');
    expect(screen.getByLabelText('Name this import')).toHaveValue('Second list');

    fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));
    expect(zone()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull();
  });

  it('there is no Import button until a valid file has been checked', async () => {
    openContacts();
    expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull();
    fireEvent.change(screen.getByTestId('csv-upload'), { target: { files: [csvFile('empty.csv', 'Favorite Color\nblue')] } });
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('None of the columns look like contact fields');
    expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull();
    expect(zone()).toBeInTheDocument();
  });
});

describe('preview — incomplete vs invalid', () => {
  it('imports the email-only row as an incomplete profile and keeps the bad email out', async () => {
    openContacts();
    fireEvent.change(screen.getByTestId('csv-upload'), { target: { files: [csvFile()] } });
    await screen.findByText('Preview: People Pitch.csv');

    expect(within(screen.getByTestId('tile-ready')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-incomplete')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-invalid')).getByText('1')).toBeInTheDocument();

    const incomplete = screen.getByTestId('csv-incomplete-row-3');
    expect(incomplete).toHaveTextContent('Row 3: Unknown contact · person@example.com');
    expect(incomplete).toHaveTextContent('Missing: first name, last name');
    expect(screen.getByTestId('csv-attention')).toHaveTextContent('Row 4: Invalid email address: not-an-email');
    expect(screen.getByTestId('csv-attention')).not.toHaveTextContent('person@example.com');

    // The sample never shows the address as the person's name.
    expect(screen.getByText('Incomplete profile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 2 contacts' })).toBeEnabled();
  });
});

describe('dark theme', () => {
  it('uses the active theme tokens, not light-only classes', async () => {
    const T = THEMES.mission;
    const { container } = render(
      <ThemeCtx.Provider value={{ T, themeId: 'mission', setThemeId: () => {} }}>
        <CSVUpload onContactsAdded={vi.fn()} onCancel={() => {}} />
      </ThemeCtx.Provider>,
    );
    const rgb = (hex) => `rgb(${hex.slice(1).match(/../g).slice(0, 3).map((h) => parseInt(h, 16)).join(', ')})`;
    expect(screen.getByText('What are you uploading?')).toHaveStyle({ color: rgb(T.text) });
    const option = screen.getByText('Lead / Contact List').closest('button');
    expect(option).toHaveStyle({ background: rgb(T.cardBg) });

    fireEvent.click(screen.getByText('Lead / Contact List'));
    fireEvent.change(screen.getByTestId('csv-upload'), { target: { files: [csvFile()] } });
    await screen.findByText('Preview: People Pitch.csv');
    await waitFor(() => expect(container.querySelector('[class*="bg-white"], [class*="bg-gray-50"], [class*="text-gray-900"]')).toBeNull());
    expect(screen.getByText('Preview: People Pitch.csv')).toHaveStyle({ color: rgb(T.text) });
  });

  it('Company List upload is themed and accepts a dropped CSV too', async () => {
    openContacts(THEMES.mission);
    fireEvent.click(screen.getByText('Change Type'));
    fireEvent.click(screen.getByText('Company List'));
    drag('drop', screen.getByTestId('csv-company-upload-dropzone'), [csvFile('accounts.csv', 'Company Name\nAcme')]);
    await screen.findByText('Preview: accounts.csv');
    expect(screen.getByRole('button', { name: /Upload 1 Companies/ })).toBeEnabled();
  });
});
