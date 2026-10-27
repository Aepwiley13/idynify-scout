/**
 * The contact profile shows what a confirmed LinkedIn profile added: the
 * headline and location in the details drawer, and the user's own
 * confirmation in the enrichment panel's sources.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('../firebase/config', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => null }));
vi.mock('../services/referralIntelligenceService', () => ({ getContactReferralAnalytics: async () => null }));
vi.mock('../components/contacts/StickyNotes', () => ({ default: () => null }));

import DetailDrawer from '../components/contacts/DetailDrawer.jsx';
import EnrichmentPanel from '../components/contacts/EnrichmentPanel.jsx';

const LINKED = {
  id: 'cap_x_p1', name: 'Kristin Sokol', title: 'Instructional Matchmaker', company_name: 'Bright Path Learning',
  linkedin_url: 'https://www.linkedin.com/in/kristin-sokol', headline: 'Matching learners with the right teachers',
  location: 'Salt Lake City, Utah', city: 'Salt Lake City', state: 'Utah',
  last_enriched_at: '2026-10-26T12:00:00.000Z',
  enrichment_provenance: { linkedin_url: 'user_confirmed', headline: 'apollo_match', location: 'apollo_match', title: 'user_accepted' },
};

describe('a contact completed from LinkedIn', () => {
  it('the details drawer shows the headline, location and LinkedIn link', () => {
    render(<DetailDrawer contact={LINKED} onUpdate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /View details/ }));
    expect(screen.getByText('Headline').nextSibling.textContent).toBe('Matching learners with the right teachers');
    expect(screen.getByText('Location').nextSibling.textContent).toBe('Salt Lake City, Utah');
    expect(screen.getByRole('link', { name: /View Profile/ }).getAttribute('href')).toBe(LINKED.linkedin_url);
  });

  it('no headline: no empty row', () => {
    render(<DetailDrawer contact={{ ...LINKED, headline: null }} onUpdate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /View details/ }));
    expect(screen.queryByText('Headline')).toBeNull();
  });

  it('the enrichment panel names the user as the source of what they confirmed or chose', () => {
    const { container } = render(<EnrichmentPanel contact={LINKED} onEnrich={() => {}} enriching={false} enrichResult={null} />);
    fireEvent.click(container.querySelector('.enrichment-header'));
    fireEvent.click(screen.getByRole('button', { name: /Data Sources/ }));
    const rows = [...container.querySelectorAll('.provenance-item')].map(row => [
      within(row).getByText(/./, { selector: '.provenance-field' }).textContent,
      row.querySelector('.provenance-source').textContent,
    ]);
    expect(rows).toEqual([
      ['LinkedIn', 'You confirmed'],
      ['Headline', 'Apollo (Exact)'],
      ['Location', 'Apollo (Exact)'],
      ['Title', 'You chose'],
    ]);
  });
});
