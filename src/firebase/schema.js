// Module 2: Database Schema - Firestore Collections Structure
//
// This file documents the Firestore collections structure for the MVP
//
// Collections Structure:
//
// users/{userId}/
//   ├── profile (document)
//   ├── subscription (document)
//   ├── icp (document)
//   ├── icpBrief (document)
//   ├── weights/ (subcollection)
//   │   ├── current (document)
//   │   └── history/{versionId} (documents)
//   ├── companies/{companyId} (subcollection)
//   ├── leads/{leadId} (subcollection)
//   ├── events/{eventId} (subcollection)
//   └── quotas/ (subcollection)
//       ├── daily_enrichments (document)
//       └── weekly_enrichments (document)

export const COLLECTION_PATHS = {
  users: 'users',
  profile: 'profile',
  subscription: 'subscription',
  icp: 'icp',
  icpBrief: 'icpBrief',
  weights: 'weights',
  weightsCurrent: 'weights/current',
  weightsHistory: 'weights/history',
  companies: 'companies',
  leads: 'leads',
  events: 'events',
  quotas: 'quotas',
  dailyEnrichments: 'quotas/daily_enrichments',
  weeklyEnrichments: 'quotas/weekly_enrichments'
};

// Helper functions to get document/collection paths
export const getPath = {
  userProfile: (userId) => `users/${userId}/profile`,
  userSubscription: (userId) => `users/${userId}/subscription`,
  userICP: (userId) => `users/${userId}/icp`,
  userICPBrief: (userId) => `users/${userId}/icpBrief`,
  userWeightsCurrent: (userId) => `users/${userId}/weights/current`,
  userWeightsHistory: (userId) => `users/${userId}/weights/history`,
  userCompanies: (userId) => `users/${userId}/companies`,
  userCompany: (userId, companyId) => `users/${userId}/companies/${companyId}`,
  userLeads: (userId) => `users/${userId}/leads`,
  userLead: (userId, leadId) => `users/${userId}/leads/${leadId}`,
  userEvents: (userId) => `users/${userId}/events`,
  userEvent: (userId, eventId) => `users/${userId}/events/${eventId}`,
  userQuotas: (userId) => `users/${userId}/quotas`,
  userDailyEnrichments: (userId) => `users/${userId}/quotas/daily_enrichments`,
  userWeeklyEnrichments: (userId) => `users/${userId}/quotas/weekly_enrichments`
};
