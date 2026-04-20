import { auth, db } from '../firebase/config';
import { doc, getDoc } from 'firebase/firestore';

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
 * Get completed RECON sections for current user.
 * Returns a map of sectionId → true for every completed section.
 */
export const getCompletedReconSections = async () => {
  const user = auth.currentUser;
  if (!user) return {};

  const dashboardDoc = await getDoc(doc(db, 'dashboards', user.uid));

  if (!dashboardDoc.exists()) return {};

  const data = dashboardDoc.data();
  const reconModule = (data.modules || []).find(m => m.id === 'recon');
  if (!reconModule?.sections) return {};

  const sections = {};
  for (const section of reconModule.sections) {
    if (section.status === 'completed') {
      sections[section.sectionId] = true;
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
