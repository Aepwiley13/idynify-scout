/**
 * What the contact profile shows after Barry Enrich finds a different title
 * or company (#733): the title can be taken with one tap, the company is for
 * information only, and nothing shows when there is no difference. An email
 * found on the company website is offered, with a tap to use it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EnrichSuggestions from '../components/contacts/EnrichSuggestions';

const TITLE = { field: 'title', current: 'VP Sales', suggested: 'Chief Revenue Officer', actionable: true };
const COMPANY = { field: 'company', current: 'Northwind', suggested: 'Contoso', actionable: false };
const EMAIL = { field: 'email', current: null, suggested: 'info@northwind.com', actionable: true, source: 'website' };

describe('EnrichSuggestions', () => {
  it('shows both differences; only the title has an action', () => {
    render(<EnrichSuggestions suggestions={[TITLE, COMPANY]} onAcceptTitle={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('enrich-title-suggestion')).toHaveTextContent('lists the title as Chief Revenue Officer. This contact says VP Sales.');
    expect(screen.getByTestId('enrich-company-difference')).toHaveTextContent('lists the company as Contoso. This contact says Northwind, and that stays.');
    expect(screen.getAllByRole('button', { name: /Use this/ })).toHaveLength(1);
  });

  it('Use this title hands over the suggestion and confirms', async () => {
    const onAcceptTitle = vi.fn(async () => {});
    render(<EnrichSuggestions suggestions={[TITLE]} onAcceptTitle={onAcceptTitle} onDismiss={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use this title' }));
    expect(onAcceptTitle).toHaveBeenCalledWith(TITLE);
    expect(await screen.findByText('Title updated')).toBeInTheDocument();
  });

  it('a failed save says so and leaves the button', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<EnrichSuggestions suggestions={[TITLE]} onAcceptTitle={vi.fn(async () => { throw new Error('offline'); })} onDismiss={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use this title' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't update the title");
    expect(screen.getByRole('button', { name: 'Use this title' })).toBeEnabled();
  });

  it('dismiss, and nothing at all without a difference', async () => {
    const onDismiss = vi.fn();
    const { container, rerender } = render(<EnrichSuggestions suggestions={[COMPANY]} onAcceptTitle={vi.fn()} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
    rerender(<EnrichSuggestions suggestions={[]} onAcceptTitle={vi.fn()} onDismiss={onDismiss} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a website email is offered, never shown as theirs; using it hands over the suggestion', async () => {
    const onAcceptEmail = vi.fn(async () => {});
    render(<EnrichSuggestions suggestions={[EMAIL]} onAcceptTitle={vi.fn()} onAcceptEmail={onAcceptEmail} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('enrich-email-suggestion')).toHaveTextContent('Found on their company website: info@northwind.com. It may be a shared inbox rather than theirs.');
    await userEvent.click(screen.getByRole('button', { name: 'Use this email' }));
    expect(onAcceptEmail).toHaveBeenCalledWith(EMAIL);
    expect(await screen.findByText('Email added')).toBeInTheDocument();
  });

  it('a website email that could not be saved says so', async () => {
    render(<EnrichSuggestions suggestions={[EMAIL]} onAcceptTitle={vi.fn()} onAcceptEmail={vi.fn(async () => { throw new Error('has one'); })} onDismiss={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use this email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't add the email");
  });
});
