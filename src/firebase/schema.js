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
//   ├── section1Answers (object) - Section 1: Company Identity & Foundation answers
//   ├── section1Output (object) - Section 1 Executive Summary output
//   ├── reconProgress (object) - RECON questionnaire progress tracking
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
  section1Answers: 'section1Answers',
  section1Output: 'section1Output',
  reconProgress: 'reconProgress',
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

// ============================================================================
// SECTION 1: COMPANY IDENTITY & FOUNDATION - Schema Documentation
// ============================================================================

/**
 * section1Answers
 * Stores user's raw answers to Section 1 questionnaire
 *
 * Schema:
 * {
 *   companyName: string,
 *   whatYouDo: string,
 *   industry: string,
 *   stage: string,
 *   role: string,
 *   mainProduct: string,
 *   problemSolved: string,
 *   currentCustomers: string,
 *   ninetyDayGoal: string,
 *   biggestChallenge: string,
 *   lastSaved: Timestamp
 * }
 */

/**
 * section1Output
 * Stores the generated Executive Summary for Section 1
 *
 * Schema:
 * {
 *   section: 1,
 *   title: "Company Identity & Foundation",
 *   status: "completed",
 *   completedAt: string (ISO timestamp),
 *   version: 1,
 *   executiveSummary: {
 *     companyOverview: {
 *       name: string,
 *       industry: string,
 *       stage: string,
 *       elevatorPitch: string
 *     },
 *     coreOffering: {
 *       product: string,
 *       problemSolved: string,
 *       targetCustomer: string
 *     },
 *     currentState: {
 *       ninetyDayGoal: string,
 *       biggestChallenge: string,
 *       implication: string
 *     },
 *     idealCustomerGlance: string,
 *     perfectFitIndicators: string[],
 *     antiProfile: string[],
 *     keyInsight: string
 *   },
 *   rawAnswers: {
 *     // Copy of section1Answers
 *   },
 *   metadata: {
 *     generationTime: number,
 *     model: string,
 *     tokensUsed: number,
 *     editHistory: any[]
 *   },
 *   generatedAt: Timestamp
 * }
 */

/**
 * reconProgress
 * Tracks overall RECON questionnaire progress
 *
 * Schema:
 * {
 *   currentSection: number,
 *   completedSections: number[],
 *   section1Completed: boolean,
 *   lastUpdated: Timestamp
 * }
 */

// ============================================================================
// SECTION 2: PRODUCT/SERVICE DEEP DIVE - Schema Documentation
// ============================================================================

/**
 * section2Answers
 * Stores user's raw answers to Section 2 questionnaire
 *
 * Schema:
 * {
 *   productName: string,
 *   category: string,
 *   coreFeatures: string[],
 *   differentiation: string,
 *   useCases: string[],
 *   implementationTime: string,
 *   supportLevel: string,
 *   pricingModel: string,
 *   startingPrice: string,
 *   techStack: string,
 *   integrations: string[],
 *   lastSaved: Timestamp
 * }
 */

/**
 * section2Output
 * Stores the generated output for Section 2
 *
 * Schema:
 * {
 *   section: 2,
 *   title: "Product/Service Deep Dive",
 *   status: "completed",
 *   completedAt: string (ISO timestamp),
 *   version: 1,
 *   analysis: {
 *     productOverview: {
 *       name: string,
 *       category: string,
 *       description: string
 *     },
 *     valueAnalysis: {
 *       coreCapabilities: string[],
 *       uniqueDifferentiators: string[],
 *       competitiveAdvantages: string[]
 *     },
 *     targetUseCases: {
 *       primary: string[],
 *       secondary: string[]
 *     },
 *     technicalProfile: {
 *       stack: string,
 *       integrations: string[],
 *       implementationTime: string,
 *       supportModel: string
 *     },
 *     pricingIntelligence: {
 *       model: string,
 *       startingPrice: string,
 *       valueMetric: string,
 *       pricePositioning: string
 *     },
 *     icpAlignment: string,
 *     strategicRecommendations: string[]
 *   },
 *   rawAnswers: object,
 *   metadata: {
 *     generationTime: number,
 *     model: string,
 *     tokensUsed: number,
 *     editHistory: any[]
 *   },
 *   generatedAt: Timestamp
 * }
 */
