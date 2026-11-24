import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactDetails from '../pages/ContactHub/actionCenter/ContactDetails';

const { saveAffiliations } = vi.hoisted(() => ({ saveAffiliations: vi.fn() }));
vi.mock('../utils/contactAffiliations', async (importOriginal) => ({ ...(await importOriginal()), saveContactAffiliations: (...args) => saveAffiliations(...args) }));
vi.mock('../pages/ContactHub/actionCenter/relationship.js', () => ({ canWriteRelationship: () => true }));
vi.mock('../components/contacts/IdentityCard', () => ({ default: () => null }));

describe('Contact Profile affiliations', () => {
  it('converts legacy primary fields, adds a second role, and persists the selected compatibility projection', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const returned = [
      { id: 'legacy-id', organization_name: 'T-Mobile', company_id: 'company-1', title: 'Director', type: null, status: 'current', primary: false, provenance: [{ source: 'business_card', contact_id: 'c1' }] },
      { id: 'role-2', organization_name: 'Youth League', company_id: null, title: 'Coach', type: 'Volunteer', status: 'current', primary: true, provenance: [{ source: 'user', contact_id: 'c1' }] },
    ];
    saveAffiliations.mockResolvedValue({ affiliations: returned, contactVersion: '13:0' });
    render(<ContactDetails uid="u1" canWrite contact={{ id: 'c1', _contactHubVersion: '12:0', title: 'Director', company_name: 'T-Mobile', company_id: 'company-1' }} onUpdate={onUpdate} />);
    await user.click(screen.getByRole('button', { name: 'Add affiliation' }));
    await user.type(screen.getByRole('textbox', { name: 'Organization' }), 'Youth League');
    await user.type(screen.getByRole('textbox', { name: 'Job title or role' }), 'Coach');
    await user.type(screen.getByRole('textbox', { name: 'Affiliation type (optional)' }), 'Volunteer');
    await user.click(screen.getByRole('checkbox', { name: 'Use as primary affiliation' }));
    await user.click(screen.getByRole('button', { name: 'Save affiliation' }));
    expect(saveAffiliations).toHaveBeenCalledWith('u1', 'c1', '12:0', expect.arrayContaining([
      expect.objectContaining({ title: 'Director', organization_name: 'T-Mobile', company_id: 'company-1' }),
      expect.objectContaining({ title: 'Coach', organization_name: 'Youth League', primary: true }),
    ]));
    expect(onUpdate).toHaveBeenCalledWith({ id: 'c1' }, expect.objectContaining({
      title: 'Coach', company_name: 'Youth League', company_id: null, contact_affiliations: returned, _contactHubVersion: '13:0',
    }));
    expect(screen.getAllByText('Director').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Coach')).toBeInTheDocument();
  });

  it('does not expose affiliation editing in a read-only profile', () => {
    render(<ContactDetails uid="u1" canWrite={false} contact={{ id: 'c1', title: 'Director', company_name: 'T-Mobile' }} />);
    expect(screen.queryByRole('button', { name: 'Add affiliation' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
  });
});
