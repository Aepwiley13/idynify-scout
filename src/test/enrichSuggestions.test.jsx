/**
 * What the contact profile shows after Barry Enrich finds a different title
 * or company (#733): the title can be taken with one tap, the company is for
 * information only, and nothing shows when there is no difference.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EnrichSuggestions from '../components/contacts/EnrichSuggestions';

const TITLE = { field: 'title', current: 'VP Sales', suggested: 'Chief Revenue Officer', actionable: true };
const COMPANY = { field: 'company', current: 'Northwind', suggested: 'Contoso', actionable: false };

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
});
