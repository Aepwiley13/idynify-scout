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
