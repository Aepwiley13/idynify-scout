/**
 * Contact Enrichment Utility
 *
 * Handles async enrichment of contacts via barryEnrich.
 * Used by CSV upload, manual add, and business card capture.
 *
 * Enrichment Status Values:
 * - 'pending_enrichment' - Queued for enrichment
 * - 'enriching' - Currently being enriched
 * - 'enriched' - Successfully enriched with data found
 * - 'partial' - Enrichment ran but some fields still missing
 * - 'failed' - Enrichment failed (no match or error)
 * - 'user_added' - User-uploaded, not yet enriched (legacy)
 */

import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';

/**
 * Determine if a contact has enough identifiers for reliable enrichment.
 * Returns an object with canEnrich boolean and reason.
 */
export function assessEnrichmentViability(contact) {
  const hasLinkedIn = !!(contact.linkedin_url && contact.linkedin_url.includes('linkedin.com'));
  const hasApolloId = !!contact.apollo_person_id;
  const hasName = !!(contact.name && contact.name.trim());
  const hasCompany = !!(contact.company || contact.company_name);
  const hasEmail = !!(contact.email && contact.email.includes('@'));

  if (hasApolloId) {
    return { canEnrich: true, quality: 'high', reason: 'Has Apollo ID' };
  }
  if (hasLinkedIn) {
    return { canEnrich: true, quality: 'high', reason: 'Has LinkedIn URL' };
  }
  if (hasName && hasCompany) {
    return { canEnrich: true, quality: 'medium', reason: 'Has name + company' };
  }
  if (hasName && hasEmail) {
    return { canEnrich: true, quality: 'medium', reason: 'Has name + email' };
  }
  if (hasName) {
    return { canEnrich: false, quality: 'low', reason: 'Name only - needs LinkedIn or company' };
  }
  return { canEnrich: false, quality: 'none', reason: 'Insufficient data for enrichment' };
}

/**
 * Compute enrichment status based on results.
 */
function computeEnrichmentStatus(enrichedData, originalContact) {
  if (!enrichedData) {
    return 'failed';
  }

  const summary = enrichedData.enrichment_summary;
  if (!summary) {
    return 'failed';
  }

  // Check what was found
  const fieldsFound = summary.fields_found || [];
  const fieldsMissing = summary.fields_missing || [];

  // Key fields we care about
  const hasEmail = !!(enrichedData.email || originalContact.email);
  const hasLinkedIn = !!(enrichedData.linkedin_url || originalContact.linkedin_url);
  const hasPhoto = !!(enrichedData.photo_url || originalContact.photo_url);

  // If we found email and linkedin, it's a success
  if (hasEmail && hasLinkedIn) {
    return 'enriched';
  }

  // If we found some fields but not all key ones, it's partial
  if (fieldsFound.length > 0) {
    return 'partial';
  }

  // Nothing found
  return 'failed';
}

/**
 * Enrich a single contact asynchronously.
 * Updates Firestore with enrichment status and results.
 *
 * @param {Object} contact - Contact object with id and data
 * @param {string} userId - User ID
 * @param {string} authToken - Firebase auth token
 * @returns {Promise<Object>} - Enrichment result
 */
export async function enrichContact(contact, userId, authToken) {
  const contactRef = doc(db, 'users', userId, 'contacts', contact.id);

  try {
    // Update status to enriching
    await updateDoc(contactRef, {
      enrichment_status: 'enriching',
      enrichment_started_at: new Date().toISOString()
    });

    // Call barryEnrich
    const response = await fetch('/.netlify/functions/barryEnrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        authToken,
        contact: {
          ...contact,
          apollo_person_id: contact.apollo_person_id || null,
          linkedin_url: contact.linkedin_url || null,
          name: contact.name || null,
          company_name: contact.company_name || contact.company || null,
          title: contact.title || null,
          email: contact.email || null
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Enrichment request failed: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Enrichment failed');
    }

    // Compute final status
    const enrichmentStatus = computeEnrichmentStatus(result.enrichedData, contact);

    // Update contact with enriched data
    await updateDoc(contactRef, {
      ...result.enrichedData,
      enrichment_status: enrichmentStatus,
      enrichment_completed_at: new Date().toISOString()
    });

    return {
      success: true,
      contactId: contact.id,
      status: enrichmentStatus,
      enrichedData: result.enrichedData,
      summary: result.summary
    };

  } catch (error) {
    console.error(`Enrichment failed for ${contact.name}:`, error);

    // Update status to failed
    try {
      await updateDoc(contactRef, {
        enrichment_status: 'failed',
        enrichment_error: error.message,
        enrichment_completed_at: new Date().toISOString()
      });
    } catch (updateError) {
      console.error('Failed to update enrichment status:', updateError);
    }

    return {
      success: false,
      contactId: contact.id,
      status: 'failed',
      error: error.message
    };
  }
}

/**
 * Enrich multiple contacts asynchronously.
 * Returns immediately with a promise that resolves when all are done.
 *
 * @param {Array} contacts - Array of contact objects with id and data
 * @param {Function} onProgress - Callback for progress updates (optional)
 * @returns {Promise<Object>} - Summary of enrichment results
 */
export async function enrichContactsBatch(contacts, onProgress = null) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }

  const userId = user.uid;
  const authToken = await user.getIdToken();

  // Filter contacts that can be enriched
  const enrichableContacts = contacts.filter(contact => {
    const viability = assessEnrichmentViability(contact);
    return viability.canEnrich;
  });

  const nonEnrichableContacts = contacts.filter(contact => {
    const viability = assessEnrichmentViability(contact);
    return !viability.canEnrich;
  });

  // Mark non-enrichable contacts
  for (const contact of nonEnrichableContacts) {
    try {
      const contactRef = doc(db, 'users', userId, 'contacts', contact.id);
      const viability = assessEnrichmentViability(contact);
      await updateDoc(contactRef, {
        enrichment_status: 'needs_info',
        enrichment_reason: viability.reason
      });
    } catch (err) {
      console.error('Failed to mark non-enrichable contact:', err);
    }
  }

  const results = {
    total: contacts.length,
    enrichable: enrichableContacts.length,
    needsInfo: nonEnrichableContacts.length,
    completed: 0,
    enriched: 0,
    partial: 0,
    failed: 0,
    contacts: []
  };

  // Enrich contacts sequentially to avoid rate limits
  for (let i = 0; i < enrichableContacts.length; i++) {
    const contact = enrichableContacts[i];

    const result = await enrichContact(contact, userId, authToken);
    results.completed++;
    results.contacts.push(result);

    if (result.status === 'enriched') {
      results.enriched++;
    } else if (result.status === 'partial') {
      results.partial++;
    } else {
      results.failed++;
    }

    // Report progress
    if (onProgress) {
      onProgress({
        current: i + 1,
        total: enrichableContacts.length,
        contact: contact.name,
        status: result.status,
        results: { ...results }
      });
    }

    // Small delay between requests to avoid rate limiting
    if (i < enrichableContacts.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Start background enrichment for contacts.
 * Returns immediately, enrichment happens in background.
 *
 * @param {Array} contacts - Array of contact objects
 * @param {Function} onComplete - Callback when all enrichment is done
 * @param {Function} onProgress - Callback for progress updates
 */
export function startBackgroundEnrichment(contacts, onComplete = null, onProgress = null) {
  // Mark all as pending first
  const user = auth.currentUser;
  if (!user) {
    console.error('Cannot start enrichment: user not authenticated');
    return;
  }

  const userId = user.uid;

  // Mark pending synchronously
  contacts.forEach(async (contact) => {
    try {
      const contactRef = doc(db, 'users', userId, 'contacts', contact.id);
      await updateDoc(contactRef, {
        enrichment_status: 'pending_enrichment'
      });
    } catch (err) {
      console.error('Failed to mark contact as pending:', err);
    }
  });

  // Start async enrichment
  enrichContactsBatch(contacts, onProgress)
    .then(results => {
      console.log('Background enrichment complete:', results);
      if (onComplete) {
        onComplete(results);
      }
    })
    .catch(error => {
      console.error('Background enrichment failed:', error);
      if (onComplete) {
        onComplete({ error: error.message });
      }
    });
}

/**
 * Enrich a single contact by adding/updating LinkedIn URL.
 * Used for manual LinkedIn URL entry.
 *
 * @param {string} contactId - Contact document ID
 * @param {string} linkedinUrl - LinkedIn URL to use for enrichment
 * @returns {Promise<Object>} - Enrichment result
 */
export async function enrichWithLinkedIn(contactId, linkedinUrl) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }

  const userId = user.uid;
  const authToken = await user.getIdToken();
  const contactRef = doc(db, 'users', userId, 'contacts', contactId);

  // First update the contact with the LinkedIn URL
  await updateDoc(contactRef, {
    linkedin_url: linkedinUrl
  });

  // Then trigger enrichment
  return enrichContact({ id: contactId, linkedin_url: linkedinUrl }, userId, authToken);
}
