import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeContext';
import QuickSearch from '../components/mission-control/QuickSearch';

vi.mock('../firebase/config', () => ({
  auth: { currentUser: { uid: 'test-user' } },
  db: {},
}));

vi.mock('../context/ImpersonationContext', () => ({
  useActiveUserId: () => 'test-user',
}));

const mockGetDocs = vi.fn();
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: (...args) => mockGetDocs(...args),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const MOCK_COMPANY_DOCS = [
  { id: 'co1', data: () => ({ name: 'Acme Corp', industry: 'Technology', domain: 'acme.com', status: 'accepted' }) },
  { id: 'co2', data: () => ({ name: 'Beta Industries', industry: 'Manufacturing', domain: 'beta.io', status: 'accepted' }) },
  { id: 'co3', data: () => ({ name: 'Utah Valley University', industry: 'Higher Education', domain: 'uvu.edu', status: 'accepted' }) },
];

const MOCK_CONTACT_DOCS = [
  {
    id: 'ct1',
    data: () => ({
      name: 'Angela Phillips',
      first_name: 'Angela',
      last_name: 'Phillips',
      title: 'VP of Partnerships',
      company: 'Acme Corp',
      email: 'angela@acme.com',
      is_archived: false,
    }),
  },
  {
    id: 'ct2',
    data: () => ({
      name: 'Aaron Wiley',
      first_name: 'Aaron',
      last_name: 'Wiley',
      title: 'CEO',
      company: 'Idynify',
      email: 'aaron@idynify.com',
      is_archived: false,
    }),
  },
];

function renderQuickSearch() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <QuickSearch />
      </ThemeProvider>
    </MemoryRouter>
  );
}

function setupDefaultMock() {
  let callCount = 0;
  mockGetDocs.mockImplementation(() => {
    callCount++;
    // First call is contacts (has where/orderBy/limit), second is companies
    if (callCount === 1) return Promise.resolve({ docs: MOCK_CONTACT_DOCS });
    return Promise.resolve({ docs: MOCK_COMPANY_DOCS });
  });
}

beforeEach(() => {
  mockNavigate.mockClear();
  mockGetDocs.mockReset();
});

describe('QuickSearch', () => {
  it('renders with the correct placeholder', () => {
    renderQuickSearch();
    expect(screen.getByPlaceholderText('Search contacts or companies...')).toBeInTheDocument();
  });

  it('does not open panel before 2 characters', async () => {
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'A');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('opens panel and shows company results for matching input', async () => {
    setupDefaultMock();
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Acme');

    await waitFor(() => {
      expect(screen.getByText('Companies')).toBeInTheDocument();
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });
  });

  it('shows empty state when no results match', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'zzzzzzz');

    await waitFor(() => {
      expect(screen.getByText('No matching contacts or companies')).toBeInTheDocument();
    });
  });

  it('closes panel on Escape', async () => {
    setupDefaultMock();
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Acme');

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('navigates to company on click', async () => {
    setupDefaultMock();
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Acme');

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Acme Corp'));
    expect(mockNavigate).toHaveBeenCalledWith('/scout/company/co1');
  });

  it('navigates to company via keyboard Enter on highlighted item', async () => {
    setupDefaultMock();
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Beta');

    await waitFor(() => {
      expect(screen.getByText('Beta Industries')).toBeInTheDocument();
    });

    // Contacts section may have Angela (no match for "Beta"), so company is first or only.
    // Arrow down to first result and Enter.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('shows contact results when contacts match', async () => {
    setupDefaultMock();
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Angela');

    await waitFor(() => {
      expect(screen.getByText('Contacts')).toBeInTheDocument();
      expect(screen.getByText('Angela Phillips')).toBeInTheDocument();
      expect(screen.getByText('VP of Partnerships · Acme Corp')).toBeInTheDocument();
    });
  });

  it('navigates to contact on click', async () => {
    setupDefaultMock();
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Angela');

    await waitFor(() => {
      expect(screen.getByText('Angela Phillips')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Angela Phillips'));
    expect(mockNavigate).toHaveBeenCalledWith('/scout/contact/ct1');
  });

  it('clears input and closes panel when clear button is clicked', async () => {
    setupDefaultMock();
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Acme');

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    const clearBtn = screen.getByLabelText('Clear search');
    fireEvent.click(clearBtn);
    expect(input.value).toBe('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('has correct ARIA attributes', () => {
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-haspopup', 'listbox');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
  });

  it('searches by domain', async () => {
    setupDefaultMock();
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'uvu.edu');

    await waitFor(() => {
      expect(screen.getByText('Utah Valley University')).toBeInTheDocument();
    });
  });

  it('searches by industry', async () => {
    setupDefaultMock();
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Manufacturing');

    await waitFor(() => {
      expect(screen.getByText('Beta Industries')).toBeInTheDocument();
    });
  });

  it('caches contact and company data after first load', async () => {
    setupDefaultMock();
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');

    await userEvent.type(input, 'Acme');
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    const firstCallCount = mockGetDocs.mock.calls.length;

    // Clear and search again — should reuse cached data
    await userEvent.clear(input);
    await userEvent.type(input, 'Beta');
    await waitFor(() => {
      expect(screen.getByText('Beta Industries')).toBeInTheDocument();
    });

    // No additional Firestore calls
    expect(mockGetDocs.mock.calls.length).toBe(firstCallCount);
  });

  it('excludes archived companies from results', async () => {
    let callCount = 0;
    mockGetDocs.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ docs: MOCK_CONTACT_DOCS });
      // Company docs include an archived company
      return Promise.resolve({ docs: [
        ...MOCK_COMPANY_DOCS,
        { id: 'co-archived', data: () => ({ name: 'Dead Company', industry: 'Defunct', domain: 'dead.com', status: 'archived' }) },
      ] });
    });
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Dead');

    // The archived company was returned by Firestore in the mock, but the
    // real query uses where('status', '!=', 'archived') so it would never
    // arrive. Since we're mocking getDocs, we verify the query construction
    // is correct by checking that the where() mock was called with the
    // archived-exclusion filter. The integration contract is: archived
    // companies are excluded at the Firestore query level.
    const { where: whereFn } = await import('firebase/firestore');
    expect(whereFn).toHaveBeenCalledWith('status', '!=', 'archived');
  });

  it('finds contacts that have no is_archived field at all', async () => {
    // The bug this guards. Almost no write path in the app sets is_archived —
    // only AddFromEmailButton does — so the old
    // where('is_archived','==',false) matched almost nothing, and contacts
    // visible everywhere else in the product were unfindable by search.
    // Firestore does not match documents that lack the filtered field.
    let callCount = 0;
    mockGetDocs.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ docs: [
          // Exactly what CompanyDetail / DailyLeads / ManualContactForm write:
          // a name, no is_archived.
          { id: 'ct-legacy', data: () => ({ name: 'Gentry Moyes', title: 'Founder', company: 'Northwind' }) },
        ] });
      }
      return Promise.resolve({ docs: [] });
    });
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Gentry');

    await waitFor(() => {
      expect(screen.getByText('Gentry Moyes')).toBeInTheDocument();
    });
  });

  it('excludes archived contacts in memory rather than in the query', async () => {
    let callCount = 0;
    mockGetDocs.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ docs: [
          { id: 'ct-live', data: () => ({ name: 'Archie Live', is_archived: false }) },
          { id: 'ct-gone', data: () => ({ name: 'Archie Gone', is_archived: true }) },
        ] });
      }
      return Promise.resolve({ docs: [] });
    });
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Archie');

    await waitFor(() => {
      expect(screen.getByText('Archie Live')).toBeInTheDocument();
    });
    expect(screen.queryByText('Archie Gone')).not.toBeInTheDocument();

    // And the exclusion must not have come from the query — the whole point is
    // that Firestore is no longer asked to filter on a field most records lack.
    const { where: whereFn } = await import('firebase/firestore');
    expect(whereFn).not.toHaveBeenCalledWith('is_archived', '==', false);
  });

  it('shows both contacts and companies together', async () => {
    setupDefaultMock();
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Acme');

    await waitFor(() => {
      expect(screen.getByText('Contacts')).toBeInTheDocument();
      expect(screen.getByText('Companies')).toBeInTheDocument();
      expect(screen.getByText('Angela Phillips')).toBeInTheDocument();
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });
  });
});
