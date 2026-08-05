/**
 * CommandBar — the global ⌘K search overlay.
 *
 * The sprint reduces to six steps: Aaron is anywhere in Idynify, he presses
 * ⌘K, the overlay opens, he types a name, he opens the record, he gets back
 * to work. These tests hold each of those, plus the things that make an
 * overlay tolerable rather than merely present — focus in, focus back out,
 * focus trapped in between, and exactly one keyboard listener no matter how
 * many times the shell re-renders.
 *
 * The search behaviour itself (queries, cache, ranking, archived exclusion)
 * is covered by quickSearch.test.jsx and is not re-tested here: both surfaces
 * run the same useQuickSearch hook, so testing it twice would only assert
 * that the import works.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../theme/ThemeContext';
import CommandBar from '../components/layout/CommandBar';
import { isCommandBarShortcut } from '../components/layout/commandBarShortcut';

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
];

const MOCK_COMPANY_DOCS = [
  { id: 'co1', data: () => ({ name: 'Acme Corp', industry: 'Technology', domain: 'acme.com', status: 'accepted' }) },
];

function setupDefaultMock() {
  let callCount = 0;
  mockGetDocs.mockImplementation(() => {
    callCount++;
    if (callCount === 1) return Promise.resolve({ docs: MOCK_CONTACT_DOCS });
    return Promise.resolve({ docs: MOCK_COMPANY_DOCS });
  });
}

/**
 * Mirrors MainLayout's wiring: a top-bar trigger button, open state above the
 * overlay, and the overlay mounted once whether or not it is open.
 */
function Host({ onOpenSpy }) {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <ThemeProvider>
        <button onClick={() => setOpen(true)} aria-label="Search contacts and companies">
          search icon
        </button>
        <input aria-label="unrelated page field" />
        <CommandBar
          isOpen={open}
          onOpen={() => { onOpenSpy?.(); setOpen(true); }}
          onClose={() => setOpen(false)}
        />
      </ThemeProvider>
    </MemoryRouter>
  );
}

function renderHost(onOpenSpy) {
  return render(<Host onOpenSpy={onOpenSpy} />);
}

const searchInput = () => screen.getByPlaceholderText('Search contacts or companies...');

async function openViaIcon() {
  fireEvent.click(screen.getByLabelText('Search contacts and companies'));
  await waitFor(() => expect(searchInput()).toHaveFocus());
}

beforeEach(() => {
  mockNavigate.mockClear();
  mockGetDocs.mockReset();
});

afterEach(() => {
  document.body.style.overflow = '';
});

describe('shortcut matching', () => {
  it('matches ⌘K and Ctrl+K, upper or lower case', () => {
    expect(isCommandBarShortcut({ metaKey: true, key: 'k' })).toBe(true);
    expect(isCommandBarShortcut({ ctrlKey: true, key: 'k' })).toBe(true);
    expect(isCommandBarShortcut({ metaKey: true, key: 'K' })).toBe(true);
  });

  it('ignores bare k, and the modifier combinations other features already own', () => {
    // Cmd+Z (SavedCompanies undo) and Cmd+Enter (ICP / service profile "next")
    // are the only pre-existing modifier shortcuts in the app. None use K.
    expect(isCommandBarShortcut({ key: 'k' })).toBe(false);
    expect(isCommandBarShortcut({ metaKey: true, key: 'z' })).toBe(false);
    expect(isCommandBarShortcut({ metaKey: true, key: 'Enter' })).toBe(false);
    expect(isCommandBarShortcut({ metaKey: true, altKey: true, key: 'k' })).toBe(false);
  });
});

describe('opening and closing', () => {
  it('renders nothing until it is opened', () => {
    renderHost();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens from the top nav search icon', async () => {
    renderHost();
    fireEvent.click(screen.getByLabelText('Search contacts and companies'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(searchInput()).toBeInTheDocument();
  });

  it('opens on ⌘K from anywhere on the page', () => {
    renderHost();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens on Ctrl+K for Windows and Linux', () => {
    renderHost();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens even when focus is inside another input on the page', () => {
    renderHost();
    const pageField = screen.getByLabelText('unrelated page field');
    pageField.focus();
    fireEvent.keyDown(pageField, { key: 'k', metaKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('registers the shortcut once, however many times the shell re-renders', () => {
    const onOpenSpy = vi.fn();
    const { rerender } = renderHost(onOpenSpy);
    rerender(<Host onOpenSpy={onOpenSpy} />);
    rerender(<Host onOpenSpy={onOpenSpy} />);

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(onOpenSpy).toHaveBeenCalledTimes(1);
  });

  it('removes the shortcut listener on unmount', () => {
    const onOpenSpy = vi.fn();
    const { unmount } = renderHost(onOpenSpy);
    unmount();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(onOpenSpy).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    renderHost();
    await openViaIcon();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stops Escape reaching page-level handlers behind the overlay', async () => {
    // Mission Control clears its open dossier on window Escape. With the
    // overlay up, one Escape must close the overlay only.
    const pageEscapeHandler = vi.fn();
    window.addEventListener('keydown', pageEscapeHandler);
    try {
      renderHost();
      await openViaIcon();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(pageEscapeHandler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', pageEscapeHandler);
    }
  });

  it('closes on click outside the panel', async () => {
    renderHost();
    await openViaIcon();
    const backdrop = screen.getByRole('dialog').parentElement;
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays open when the click lands inside the panel', async () => {
    renderHost();
    await openViaIcon();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('locks page scroll while open and restores it on close', async () => {
    renderHost();
    await openViaIcon();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('reopens empty rather than showing the previous query', async () => {
    setupDefaultMock();
    renderHost();
    await openViaIcon();
    await userEvent.type(searchInput(), 'Acme');
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());

    fireEvent.keyDown(window, { key: 'Escape' });
    await openViaIcon();

    expect(searchInput().value).toBe('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('focus', () => {
  it('moves focus to the search input on open', async () => {
    renderHost();
    fireEvent.click(screen.getByLabelText('Search contacts and companies'));
    await waitFor(() => expect(searchInput()).toHaveFocus());
  });

  it('returns focus to the previously focused element on close', async () => {
    renderHost();
    const trigger = screen.getByLabelText('Search contacts and companies');
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(searchInput()).toHaveFocus());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });

  it('keeps focus inside the overlay when Tab is pressed with no results', async () => {
    renderHost();
    await openViaIcon();
    fireEvent.keyDown(searchInput(), { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('walks the results with Tab while results are showing', async () => {
    setupDefaultMock();
    renderHost();
    await openViaIcon();
    await userEvent.type(searchInput(), 'Acme');
    await waitFor(() => expect(screen.getByText('Angela Phillips')).toBeInTheDocument());

    fireEvent.keyDown(searchInput(), { key: 'Tab' });
    expect(searchInput()).toHaveAttribute('aria-activedescendant', 'cmd-item-0');
    expect(searchInput()).toHaveFocus();
  });
});

describe('search and navigation', () => {
  it('shows no results panel until two characters are typed', async () => {
    setupDefaultMock();
    renderHost();
    await openViaIcon();
    await userEvent.type(searchInput(), 'A');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('groups contacts and companies, reusing the PR #506 row content', async () => {
    setupDefaultMock();
    renderHost();
    await openViaIcon();
    await userEvent.type(searchInput(), 'Acme');

    await waitFor(() => {
      expect(screen.getByText('Contacts')).toBeInTheDocument();
      expect(screen.getByText('Angela Phillips')).toBeInTheDocument();
      expect(screen.getByText('VP of Partnerships · Acme Corp')).toBeInTheDocument();
      expect(screen.getByText('Companies')).toBeInTheDocument();
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
      expect(screen.getByText('Technology · acme.com')).toBeInTheDocument();
    });
  });

  it('opens a contact on click and closes the overlay', async () => {
    setupDefaultMock();
    renderHost();
    await openViaIcon();
    await userEvent.type(searchInput(), 'Angela');
    await waitFor(() => expect(screen.getByText('Angela Phillips')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Angela Phillips'));
    expect(mockNavigate).toHaveBeenCalledWith('/contact/ct1', {
      state: {
        navigationIntent: {
          entityType: 'contact',
          entityId: 'ct1',
          entryPoint: 'command_bar',
          reason: 'search_result',
          returnTo: '/',
          displayMode: 'page',
        },
      },
      replace: false,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a company on click and closes the overlay', async () => {
    setupDefaultMock();
    renderHost();
    await openViaIcon();
    await userEvent.type(searchInput(), 'Acme');
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Acme Corp'));
    expect(mockNavigate).toHaveBeenCalledWith('/company/co1', {
      state: {
        navigationIntent: {
          entityType: 'company',
          entityId: 'co1',
          entryPoint: 'command_bar',
          reason: 'search_result',
          returnTo: '/',
          displayMode: 'page',
        },
      },
      replace: false,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the highlighted result with arrow keys and Enter', async () => {
    setupDefaultMock();
    renderHost();
    await openViaIcon();
    await userEvent.type(searchInput(), 'Acme');
    await waitFor(() => expect(screen.getByText('Angela Phillips')).toBeInTheDocument());

    const input = searchInput();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'cmd-item-0');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'cmd-item-1');
    fireEvent.keyDown(input, { key: 'Enter' });

    // Index 1 is the company — contacts are listed first.
    expect(mockNavigate).toHaveBeenCalledWith('/company/co1', {
      state: {
        navigationIntent: {
          entityType: 'company',
          entityId: 'co1',
          entryPoint: 'command_bar',
          reason: 'search_result',
          returnTo: '/',
          displayMode: 'page',
        },
      },
      replace: false,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('wraps the highlight from the last result back to the first', async () => {
    setupDefaultMock();
    renderHost();
    await openViaIcon();
    await userEvent.type(searchInput(), 'Acme');
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());

    const input = searchInput();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveAttribute('aria-activedescendant', 'cmd-item-1');
  });

  it('shows the empty state when nothing matches', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    renderHost();
    await openViaIcon();
    await userEvent.type(searchInput(), 'zzzzzz');
    await waitFor(() => {
      expect(screen.getByText('No matching contacts or companies')).toBeInTheDocument();
    });
  });

  it('shows the error state when the search cannot be completed, and logs why', async () => {
    // The user-facing copy is deliberately vague. The console line is not:
    // staging hit this state with nothing logged to go on, which is what the
    // logging exists to prevent happening twice.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const failure = Object.assign(new Error('Missing or insufficient permissions.'), {
        code: 'permission-denied',
      });
      mockGetDocs.mockRejectedValue(failure);
      renderHost();
      await openViaIcon();
      await userEvent.type(searchInput(), 'Acme');
      await waitFor(() => {
        expect(screen.getByText('Search could not be completed. Try again.')).toBeInTheDocument();
      });

      const messages = logged.mock.calls.map(c => c[0]);
      expect(messages).toContain('[quick-search] contacts query failed');
      expect(messages).toContain('[quick-search] companies query failed');
      // The Firestore code is the diagnosis — it has to survive into the log.
      const detail = logged.mock.calls.find(c => c[0] === '[quick-search] contacts query failed')[1];
      expect(detail).toMatchObject({ code: 'permission-denied', activeUserId: 'test-user' });
      expect(detail.path).toBe('users/test-user/contacts');
    } finally {
      logged.mockRestore();
    }
  });

  it('reads only the authenticated workspace, and writes nothing', async () => {
    setupDefaultMock();
    const { collection: collectionFn } = await import('firebase/firestore');
    collectionFn.mockClear();

    renderHost();
    await openViaIcon();
    await userEvent.type(searchInput(), 'Acme');
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());

    // Every collection touched is under users/{activeUserId}/… — no
    // cross-user path, and no enrichment or mutation call exists to make.
    for (const call of collectionFn.mock.calls) {
      expect(call.slice(1, 3)).toEqual(['users', 'test-user']);
    }
    expect(collectionFn.mock.calls.map(c => c[3])).toEqual(
      expect.arrayContaining(['contacts', 'companies'])
    );
  });
});

describe('the overlay does not disturb what is behind it', () => {
  it('leaves the page mounted while open', async () => {
    renderHost();
    await openViaIcon();
    expect(screen.getByLabelText('unrelated page field')).toBeInTheDocument();
  });

  it('survives being opened, closed and opened again without leaking listeners', async () => {
    const onOpenSpy = vi.fn();
    renderHost(onOpenSpy);

    for (let i = 0; i < 3; i++) {
      await act(async () => { fireEvent.keyDown(window, { key: 'k', metaKey: true }); });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
    expect(onOpenSpy).toHaveBeenCalledTimes(3);
  });
});
