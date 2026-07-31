/**
 * Contact Matching Waterfall — Sprint 2 Team B
 *
 * Attempts to link an inbound message to a Firestore contact using a
 * hierarchy of match methods. First successful match wins.
 *
 * Waterfall order:
 *   1. Exact primary email
 *   2. Exact secondary email
 *   3. Thread-linked contact (via communication_records)
 *   4. Communication record linked (same sender, prior match)
 *   5. Alias match (domain + name similarity)
 *   6. Name + company suggestion (fuzzy — LOW confidence only)
 *   7. Unmatched
 */

import {
  MATCH_METHODS,
  MATCH_CONFIDENCE,
  createMatchResult,
} from '../../../src/types/contactMatchResult.js';

/**
 * Run the contact matching waterfall for an inbound message.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {import('../../../src/types/normalizedMessage.js').NormalizedMessage} message
 * @returns {Promise<import('../../../src/types/contactMatchResult.js').ContactMatchResult>}
 */
export async function matchContact(db, message) {
  const { idynifyUserId, fromEmail, fromName, gmailThreadId } = message;
  const normalizedEmail = fromEmail.toLowerCase().trim();

  // Step 1 — Exact primary email
  const primarySnap = await db
    .collection('users').doc(idynifyUserId)
    .collection('contacts')
    .where('primaryEmail', '==', normalizedEmail)
    .limit(2)
    .get();

  if (primarySnap.size === 1) {
    const doc = primarySnap.docs[0];
    return createMatchResult({
      contactId: doc.id,
      companyId: doc.data().companyId || null,
      matchMethod: MATCH_METHODS.EXACT_PRIMARY_EMAIL,
      matchConfidence: MATCH_CONFIDENCE.HIGH,
      matchedAutomatically: true,
      requiresReview: false,
    });
  }

  // Step 2 — Exact secondary email
  const secondarySnap = await db
    .collection('users').doc(idynifyUserId)
    .collection('contacts')
    .where('secondaryEmails', 'array-contains', normalizedEmail)
    .limit(2)
    .get();

  if (secondarySnap.size === 1) {
    const doc = secondarySnap.docs[0];
    return createMatchResult({
      contactId: doc.id,
      companyId: doc.data().companyId || null,
      matchMethod: MATCH_METHODS.EXACT_SECONDARY_EMAIL,
      matchConfidence: MATCH_CONFIDENCE.HIGH,
      matchedAutomatically: true,
      requiresReview: false,
    });
  }

  // Step 3 — Thread-linked contact
  const threadSnap = await db
    .collection('communication_records')
    .where('gmailThreadId', '==', gmailThreadId)
    .where('idynifyUserId', '==', idynifyUserId)
    .where('contactId', '!=', null)
    .limit(1)
    .get();

  if (!threadSnap.empty) {
    const record = threadSnap.docs[0].data();
    return createMatchResult({
      contactId: record.contactId,
      companyId: record.companyId || null,
      matchMethod: MATCH_METHODS.THREAD_LINKED_CONTACT,
      matchConfidence: MATCH_CONFIDENCE.HIGH,
      matchedAutomatically: true,
      requiresReview: false,
    });
  }

  // Step 4 — Communication record linked (same sender, prior match)
  const priorSnap = await db
    .collection('communication_records')
    .where('fromEmail', '==', normalizedEmail)
    .where('idynifyUserId', '==', idynifyUserId)
    .where('contactId', '!=', null)
    .limit(1)
    .get();

  if (!priorSnap.empty) {
    const record = priorSnap.docs[0].data();
    return createMatchResult({
      contactId: record.contactId,
      companyId: record.companyId || null,
      matchMethod: MATCH_METHODS.COMMUNICATION_RECORD_LINKED,
      matchConfidence: MATCH_CONFIDENCE.MEDIUM,
      matchedAutomatically: true,
      requiresReview: true,
      reviewReason: 'Matched via prior communication record — verify correct contact',
    });
  }

  // Step 5 — Alias match (domain + name)
  const emailDomain = normalizedEmail.split('@')[1];
  if (emailDomain) {
    const domainSnap = await db
      .collection('users').doc(idynifyUserId)
      .collection('contacts')
      .where('companyDomain', '==', emailDomain)
      .limit(10)
      .get();

    if (!domainSnap.empty && fromName) {
      const nameLower = fromName.toLowerCase();
      for (const doc of domainSnap.docs) {
        const contact = doc.data();
        const contactName = (contact.name || '').toLowerCase();
        if (contactName && nameLower.includes(contactName.split(' ')[0])) {
          return createMatchResult({
            contactId: doc.id,
            companyId: contact.companyId || null,
            matchMethod: MATCH_METHODS.ALIAS_MATCH,
            matchConfidence: MATCH_CONFIDENCE.MEDIUM,
            matchedAutomatically: true,
            requiresReview: true,
            reviewReason: `Alias match: domain ${emailDomain} + name similarity to "${contact.name}"`,
            candidateContactIds: domainSnap.docs.map(d => d.id),
          });
        }
      }
    }
  }

  // Step 6 — Name and company suggestion (fuzzy — LOW confidence)
  if (fromName) {
    const candidates = [];
    const nameParts = fromName.toLowerCase().split(/\s+/);

    const allContactsSnap = await db
      .collection('users').doc(idynifyUserId)
      .collection('contacts')
      .limit(200)
      .get();

    for (const doc of allContactsSnap.docs) {
      const contact = doc.data();
      const contactName = (contact.name || '').toLowerCase();
      const contactDomain = (contact.companyDomain || '').toLowerCase();

      const nameOverlap = nameParts.some(part =>
        part.length > 2 && contactName.includes(part)
      );
      const domainMatch = emailDomain && contactDomain === emailDomain;

      if (nameOverlap || domainMatch) {
        candidates.push(doc.id);
      }
    }

    if (candidates.length > 0) {
      return createMatchResult({
        matchMethod: MATCH_METHODS.NAME_COMPANY_SUGGESTION,
        matchConfidence: MATCH_CONFIDENCE.LOW,
        matchedAutomatically: false,
        requiresReview: true,
        reviewReason: `Fuzzy match: ${candidates.length} candidate(s) by name/domain similarity`,
        candidateContactIds: candidates.slice(0, 5),
      });
    }
  }

  // Step 7 — Unmatched
  return createMatchResult({
    matchMethod: MATCH_METHODS.UNMATCHED,
    matchConfidence: MATCH_CONFIDENCE.NONE,
    matchedAutomatically: false,
    requiresReview: true,
    reviewReason: 'No matching contact found',
  });
}
