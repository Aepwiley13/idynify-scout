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

const mockGetDocs = vi.fn().mockResolvedValue({ docs: [] });
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

const MOCK_COMPANIES = [
  { id: 'co1', name: 'Acme Corp', industry: 'Technology', domain: 'acme.com', status: 'accepted' },
  { id: 'co2', name: 'Beta Industries', industry: 'Manufacturing', domain: 'beta.io', status: 'accepted' },
  { id: 'co3', name: 'Utah Valley University', industry: 'Higher Education', domain: 'uvu.edu', status: 'accepted' },
];

function renderQuickSearch(companies = MOCK_COMPANIES) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <QuickSearch companies={companies} />
      </ThemeProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockNavigate.mockClear();
  mockGetDocs.mockClear();
  mockGetDocs.mockResolvedValue({ docs: [] });
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
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Acme');

    await waitFor(() => {
      expect(screen.getByText('Companies')).toBeInTheDocument();
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });
  });

  it('shows empty state when no results match', async () => {
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'zzzzzzz');

    await waitFor(() => {
      expect(screen.getByText('No matching contacts or companies')).toBeInTheDocument();
    });
  });

  it('closes panel on Escape', async () => {
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
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Acme');

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith('/scout/company/co1');
  });

  it('shows contact results when contacts match', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
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
      ],
    });

    renderQuickSearch([]);
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Angela');

    await waitFor(() => {
      expect(screen.getByText('Contacts')).toBeInTheDocument();
      expect(screen.getByText('Angela Phillips')).toBeInTheDocument();
      expect(screen.getByText('VP of Partnerships · Acme Corp')).toBeInTheDocument();
    });
  });

  it('navigates to contact on click', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'ct1',
          data: () => ({
            name: 'Angela Phillips',
            is_archived: false,
          }),
        },
      ],
    });

    renderQuickSearch([]);
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Angela');

    await waitFor(() => {
      expect(screen.getByText('Angela Phillips')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Angela Phillips'));
    expect(mockNavigate).toHaveBeenCalledWith('/scout/contact/ct1');
  });

  it('clears input and closes panel when clear button is clicked', async () => {
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
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'uvu.edu');

    await waitFor(() => {
      expect(screen.getByText('Utah Valley University')).toBeInTheDocument();
    });
  });

  it('searches by industry', async () => {
    renderQuickSearch();
    const input = screen.getByPlaceholderText('Search contacts or companies...');
    await userEvent.type(input, 'Manufacturing');

    await waitFor(() => {
      expect(screen.getByText('Beta Industries')).toBeInTheDocument();
    });
  });
});
