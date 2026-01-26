import { auth, db } from '../firebase/config';

/**
 * Track campaign outcome
 */
export const trackOutcome = async ({ campaignId, contactId, outcome }) => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const idToken = await user.getIdToken();

  const response = await fetch('/.netlify/functions/track-outcome', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      campaignId,
      contactId,
      outcome,
      idToken
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to track outcome');
  }

  return await response.json();
};

/**
 * Get completed RECON sections for current user
 */
export const getCompletedReconSections = async () => {
  const user = auth.currentUser;
  if (!user) return {};

  const reconRef = db.collection(`dashboards/${user.uid}/modules`).doc('recon');
  const reconDoc = await reconRef.get();

  if (!reconDoc.exists) return {};

  const sections = {};
  const data = reconDoc.data();

  if (data.sections) {
    for (const [key, section] of Object.entries(data.sections)) {
      if (section.isComplete) {
        sections[key] = true;
      }
    }
  }

  return sections;
};

/**
 * Check if user has completed any RECON sections
 */
export const hasCompletedRecon = async () => {
  const sections = await getCompletedReconSections();
  return Object.keys(sections).length > 0;
};
