/**
 * The rules that decide which real person gets filed under which real company.
 *
 * `backfillEngagedContactCompany.mjs` writes `company_id` onto contacts in
 * production. A wrong link is worse than no link at all: it attributes a
 * person to a company they do not work for, and every downstream surface — the
 * company's contact list, Barry's context assembly, exports — inherits that
 * claim silently. The link is also not self-correcting, because the script
 * refuses to overwrite a company_id that is already set.
 *
 * So the matching rules are exported from the migration and pinned here,
 * rather than living inside a loop whose only test is running it against real
 * data. Same posture as `backfillArchivalRule.test.js`.
 *
 * The cases below are the ones the production audit actually turned up.
 */

import { describe, it, expect } from 'vitest';
import {
  isEngaged,
  isArchived,
  normalizeName,
  normalizeDomain,
  workDomainFromEmail,
  matchAcceptedCompany,
} from '../../scripts/backfillEngagedContactCompany.mjs';

const company = (id, data) => ({ id, data });

describe('who the backfill considers', () => {
  it('recognises engagement from either status dimension', () => {
    expect(isEngaged({ hunter_status: 'awaiting_reply' })).toBe(true);
    expect(isEngaged({ hunter_status: 'engaged_pending' })).toBe(true);
    expect(isEngaged({ contact_status: 'In Conversation' })).toBe(true);
    expect(isEngaged({ contact_status: 'Past Customer' })).toBe(true);

    expect(isEngaged({ hunter_status: 'new' })).toBe(false);
    expect(isEngaged({ contact_status: 'New' })).toBe(false);
    expect(isEngaged({})).toBe(false);
  });

  it('recognises archival from the boolean and from the archive status', () => {
    expect(isArchived({ is_archived: true })).toBe(true);
    expect(isArchived({ status: 'people_mode_archived' })).toBe(true);

    expect(isArchived({ is_archived: false, status: 'active' })).toBe(false);
    expect(isArchived({})).toBe(false);
  });

  it('does NOT treat a skipped contact as archived', () => {
    // A skip defers someone to a later day; DailyLeads re-offers them once
    // skipped_date is not today. The sibling backfill's inferIsArchived has
    // always agreed, and this rule used to contradict it.
    //
    // Harmless in practice either way — the skip write path always sets
    // company_id, so a skipped row fails repair 1's `!company_id` gate and
    // repair 2's `isEngaged` gate whatever this says — but an exported,
    // unit-tested rule should not assert the opposite of what the product
    // means. See src/test/skipIsNotArchive.test.js.
    expect(isArchived({ status: 'people_mode_skipped', skipped_date: '2026-01-04' })).toBe(false);
  });
});

describe('normalization', () => {
  it('collapses case and punctuation in a company name', () => {
    expect(normalizeName('R&D Advantage')).toBe('rdadvantage');
    expect(normalizeName('r&d advantage')).toBe('rdadvantage');
    expect(normalizeName('Trü Frü')).toBe('trfr');
    expect(normalizeName(null)).toBe('');
  });

  it('reduces a stored domain to a bare host', () => {
    expect(normalizeDomain('https://www.acme.com/about')).toBe('acme.com');
    expect(normalizeDomain('ACME.com')).toBe('acme.com');
    expect(normalizeDomain('nonsense')).toBeNull();
  });

  it('never treats a mailbox provider as a company domain', () => {
    expect(workDomainFromEmail('brandyp@rd-advantage.com')).toBe('rd-advantage.com');
    expect(workDomainFromEmail('maryparry73@gmail.com')).toBeNull();
    expect(workDomainFromEmail('x@outlook.com')).toBeNull();
  });
});

describe('matchAcceptedCompany', () => {
  const ACCEPTED = [
    company('domo', { name: 'Domo', status: 'accepted' }),
    company('rda', { name: 'R&D Advantage', domain: 'rd-advantage.com', status: 'accepted' }),
    company('fbfs', { name: 'Farm Bureau Financial Services', domain: 'fbfs.com', status: 'accepted' }),
    company('tfsc', { name: 'The Family Support Center', status: 'accepted' }),
  ];

  it('matches the four contacts the audit found linkable', () => {
    // Macy Jessee — company_name carried, company already accepted.
    expect(matchAcceptedCompany(
      { name: 'Macy Jessee', company_name: 'Domo', email: 'macy.jessee@domo.com' }, ACCEPTED,
    )).toMatchObject({ companyId: 'domo', signal: 'name' });

    // Brandy Price — no company name at all; the domain is the only signal.
    expect(matchAcceptedCompany(
      { name: 'Brandy Price', email: 'brandyp@rd-advantage.com' }, ACCEPTED,
    )).toMatchObject({ companyId: 'rda', signal: 'domain' });

    // Rebecca Layton — name and domain agree.
    expect(matchAcceptedCompany(
      { name: 'Rebecca Layton', company_name: 'Farm Bureau Financial Services', email: 'rebecca.layton@fbfs.com' },
      ACCEPTED,
    )).toMatchObject({ companyId: 'fbfs', signal: 'name' });

    // The Family Support Center — a generic info@ address; name carries it.
    expect(matchAcceptedCompany(
      { name: 'The Family Support Center', company_name: 'The Family Support Center', email: 'info@familysupportcenter.org' },
      ACCEPTED,
    )).toMatchObject({ companyId: 'tfsc', signal: 'name' });
  });

  it('reads the free-text `company` field the manual form writes', () => {
    expect(matchAcceptedCompany({ company: 'domo' }, ACCEPTED)).toMatchObject({ companyId: 'domo' });
  });

  it('returns null for the contact that is genuinely homeless', () => {
    // Melissa Parry: a personal Gmail address and no company name anywhere.
    // Hunter mode is her home and the backfill must leave her alone.
    expect(matchAcceptedCompany({ name: 'Melissa Parry', email: 'maryparry73@gmail.com' }, ACCEPTED)).toBeNull();
  });

  it('returns null when the company signal matches nothing in the workspace', () => {
    // Strike Visual and Sunny Street App: a real company name, no company
    // document. The script does not create one — that is the app's job at save
    // time, with the user present.
    expect(matchAcceptedCompany({ company_name: 'Strike Visual', email: 'dan@strikenow.com' }, ACCEPTED)).toBeNull();
    expect(matchAcceptedCompany({ email: 'todd@esslyo.com' }, ACCEPTED)).toBeNull();
  });

  // ── The refusals that keep this safe ──

  it('refuses every company status except accepted', () => {
    for (const status of ['pending', 'rejected', 'replaced', 'archived']) {
      const companies = [company('c1', { name: 'Trü Frü', domain: 'trufru.com', status })];
      expect(matchAcceptedCompany({ company_name: 'Trü Frü', email: 'sarah@trufru.com' }, companies)).toBeNull();
    }
  });

  it('refuses to choose when a normalized name is ambiguous', () => {
    // A duplicate in the workspace is for a human to merge. Picking one would
    // file a real person under a coin toss.
    const companies = [
      company('a', { name: 'Acme', status: 'accepted' }),
      company('b', { name: 'ACME', status: 'accepted' }),
    ];
    expect(matchAcceptedCompany({ company_name: 'acme' }, companies)).toBeNull();
  });

  it('does not fall through to the domain when the name was ambiguous', () => {
    // An ambiguous name means the workspace is confused about this company.
    // Silently resolving it by a weaker signal would defeat the refusal above.
    const companies = [
      company('a', { name: 'Acme', status: 'accepted' }),
      company('b', { name: 'ACME', domain: 'acme.com', status: 'accepted' }),
    ];
    expect(matchAcceptedCompany({ company_name: 'acme', email: 'x@acme.com' }, companies)).toBeNull();
  });

  it('refuses to choose when a domain is ambiguous', () => {
    const companies = [
      company('a', { name: 'Acme', domain: 'acme.com', status: 'accepted' }),
      company('b', { name: 'Acme Holdings', website_url: 'https://acme.com', status: 'accepted' }),
    ];
    expect(matchAcceptedCompany({ email: 'x@acme.com' }, companies)).toBeNull();
  });

  it('is not fuzzy — a prefix is a different company', () => {
    const companies = [company('a', { name: 'Acme Corp', status: 'accepted' })];
    expect(matchAcceptedCompany({ company_name: 'Acme' }, companies)).toBeNull();
  });

  it('handles an empty workspace without throwing', () => {
    expect(matchAcceptedCompany({ company_name: 'Anything' }, [])).toBeNull();
  });
});
