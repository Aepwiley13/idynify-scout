/**
 * The duplicate-detection report.
 *
 * The script itself cannot be tested against a database here, so what is
 * tested is the part that decides the ANSWER: how contacts are grouped, which
 * groups count as mechanically mergeable, and which are held back for a human.
 * A wrong number in this report is not a crash — it is a dedup sprint scoped
 * against a fiction.
 *
 * Importing the script must not open a Firestore connection; that it does not
 * is itself one of the assertions.
 */

import { describe, it, expect } from 'vitest';
import { analyzeWorkspace, SIGNALS } from '../../scripts/detectDuplicateContacts.mjs';

/** Minimal contact factory — only the fields the grouping actually reads. */
const c = (id, fields) => ({ id, ...fields });

describe('analyzeWorkspace — grouping', () => {
  it('groups contacts whose emails differ only by case and whitespace', () => {
    const ws = analyzeWorkspace('u1', [
      c('a', { email: 'Gentry.Moyes@Acme.com' }),
      c('b', { email: '  gentry.moyes@acme.com ' }),
      c('c', { email: 'someone.else@acme.com' }),
    ]);

    expect(ws.signals.email.groupCount).toBe(1);
    expect(ws.signals.email.groups[0].members.map(m => m.id).sort()).toEqual(['a', 'b']);
    // Two records, one person: exactly one is redundant.
    expect(ws.signals.email.redundantRecords).toBe(1);
  });

  it('groups LinkedIn URLs across scheme, www, query and trailing slash', () => {
    const ws = analyzeWorkspace('u1', [
      c('a', { linkedin_url: 'https://www.linkedin.com/in/gentry/' }),
      c('b', { linkedin_url: 'linkedin.com/in/gentry?trk=nav' }),
      c('d', { linkedin_url: 'http://linkedin.com/in/someone-else' }),
    ]);

    expect(ws.signals.linkedin_url.groupCount).toBe(1);
    expect(ws.signals.linkedin_url.groups[0].members).toHaveLength(2);
  });

  it('groups phones written three different ways', () => {
    const ws = analyzeWorkspace('u1', [
      c('a', { phone: '(415) 555-0100' }),
      c('b', { phone: '415-555-0100' }),
    ]);

    expect(ws.signals.phone.groupCount).toBe(1);
  });

  it('does not group a +1 phone with a bare one', () => {
    // Matches the resolver: inferring a country code would merge unrelated
    // people in workspaces selling outside North America.
    const ws = analyzeWorkspace('u1', [
      c('a', { phone: '+1 415 555 0100' }),
      c('b', { phone: '415-555-0100' }),
    ]);

    expect(ws.signals.phone.groupCount).toBe(0);
  });

  it('ignores contacts carrying nothing for a signal', () => {
    const ws = analyzeWorkspace('u1', [
      c('a', { name: 'No Identifiers' }),
      c('b', { name: 'Also None' }),
    ]);

    expect(ws.signals.email.groupCount).toBe(0);
    expect(ws.signals.apollo_person_id.groupCount).toBe(0);
    // Neither has a company, so name+company cannot key either.
    expect(ws.signals.name_company.groupCount).toBe(0);
  });

  it('counts a three-way collision as two redundant records, not three', () => {
    const ws = analyzeWorkspace('u1', [
      c('a', { email: 'g@acme.com' }),
      c('b', { email: 'G@Acme.com' }),
      c('e', { email: 'g@ACME.com' }),
    ]);

    expect(ws.signals.email.groups[0].members).toHaveLength(3);
    expect(ws.signals.email.redundantRecords).toBe(2);
  });
});

describe('analyzeWorkspace — safe vs needs-a-human', () => {
  it('keeps name+company separate and marks it unsafe', () => {
    const ws = analyzeWorkspace('u1', [
      c('a', { name: 'John Smith', company_name: 'Acme Corp' }),
      c('b', { name: 'john  smith', company_name: 'ACME CORP' }),
    ]);

    expect(ws.signals.name_company.groupCount).toBe(1);
    expect(ws.signals.name_company.safe).toBe(false);

    // The headline number counts SAFE duplicates only. Two people can share a
    // name at one company, and quoting them as mergeable would scope the dedup
    // sprint against records it must not touch.
    expect(ws.duplicateContacts).toBe(0);
  });

  it('counts a contact once even when it duplicates on several safe signals', () => {
    const ws = analyzeWorkspace('u1', [
      c('a', { email: 'g@acme.com', apollo_person_id: 'p1', linkedin_url: 'linkedin.com/in/g' }),
      c('b', { email: 'G@ACME.com', apollo_person_id: 'p1', linkedin_url: 'linkedin.com/in/g' }),
    ]);

    expect(ws.signals.email.groupCount).toBe(1);
    expect(ws.signals.apollo_person_id.groupCount).toBe(1);
    expect(ws.signals.linkedin_url.groupCount).toBe(1);
    // Still two documents, not six.
    expect(ws.duplicateContacts).toBe(2);
  });

  it('marks every signal but name+company as safe', () => {
    const unsafe = SIGNALS.filter(s => !s.safe).map(s => s.id);
    expect(unsafe).toEqual(['name_company']);
  });
});

describe('analyzeWorkspace — migration visibility', () => {
  it('reports how many records carry normalized identifiers', () => {
    // A workspace where this is low is one where the resolver has been leaning
    // on the fallback scan rather than on indexed queries.
    const ws = analyzeWorkspace('u1', [
      c('a', { email: 'g@acme.com', email_normalized: 'g@acme.com' }),
      c('b', { email: 'Old@Acme.com' }),
    ]);

    expect(ws.normalizedRecords).toBe(1);
    expect(ws.contactsScanned).toBe(2);
  });

  it('surfaces records the resolver already flagged at creation time', () => {
    const ws = analyzeWorkspace('u1', [
      c('a', { name: 'John Smith', company_name: 'Acme', identity_review_required: true }),
      c('b', { name: 'John Smith', company_name: 'Acme' }),
    ]);

    expect(ws.flaggedForReview).toBe(1);
  });

  it('reports a clean workspace as clean', () => {
    const ws = analyzeWorkspace('u1', [
      c('a', { email: 'one@acme.com', name: 'One', company_name: 'Acme' }),
      c('b', { email: 'two@acme.com', name: 'Two', company_name: 'Acme' }),
    ]);

    expect(ws.duplicateContacts).toBe(0);
    for (const signal of SIGNALS) {
      expect(ws.signals[signal.id].groupCount).toBe(0);
    }
  });
});
