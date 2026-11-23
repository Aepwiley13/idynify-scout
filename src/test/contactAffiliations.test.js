import { describe, expect, it } from 'vitest';
import { affiliationsForContact, combineContactAffiliations, legacyContactAffiliation, projectPrimaryAffiliation, validateContactAffiliations } from '../utils/contactAffiliations.js';

describe('additive contact affiliations', () => {
  it('projects legacy scalar fields together without requiring migration', () => {
    const row = { id: 'legacy-contact', title: 'Director', company_name: 'T-Mobile', company_id: 'company-1', source: 'business_card' };
    const affiliations = affiliationsForContact(row);
    expect(affiliations).toHaveLength(1);
    expect(affiliations[0]).toMatchObject({ title: 'Director', organization_name: 'T-Mobile', company_id: 'company-1', primary: true, status: 'current' });
    expect(projectPrimaryAffiliation(affiliations)).toEqual({ title: 'Director', company_name: 'T-Mobile', company_id: 'company-1' });
  });

  it('retains distinct roles, organizations, primary association and combined provenance', () => {
    const left = { id: 'a', company_name: 'T-Mobile', company_id: 'tmobile', title: 'Director', source: 'business_card' };
    const right = { id: 'b', contact_affiliations: [{ id: 'coach', organization_name: 'Youth League', company_id: null, title: 'Coach', type: 'Volunteer', status: 'current', primary: true, provenance: [{ source: 'community_import', contact_id: 'b' }] }] };
    const affiliations = combineContactAffiliations(left, right);
    expect(affiliations).toHaveLength(2);
    expect(affiliations).toEqual(expect.arrayContaining([
      expect.objectContaining({ organization_name: 'T-Mobile', title: 'Director', primary: true }),
      expect.objectContaining({ organization_name: 'Youth League', title: 'Coach', primary: false }),
    ]));
    expect(validateContactAffiliations(affiliations)).toEqual({ ok: true, reason: null });
  });

  it('rejects excessive, malformed, duplicate-id or ambiguously primary data', () => {
    const valid = legacyContactAffiliation({ id: 'one', title: 'Director' });
    expect(validateContactAffiliations([valid, { ...valid, id: 'two', primary: true }])).toMatchObject({ ok: false, reason: 'primary' });
    expect(validateContactAffiliations(Array.from({ length: 21 }, (_, index) => ({ ...valid, id: `affiliation-${index}` })))).toMatchObject({ ok: false, reason: 'count' });
    expect(validateContactAffiliations([{ ...valid, organization_name: 'x'.repeat(161) }])).toMatchObject({ ok: false, reason: 'shape' });
  });
});
