// Module 2: Database Schema - Firestore Collections Structure
//
// This file documents the Firestore collections structure for the MVP
//
// Collections Structure:
//
// users/{userId}/
//   ├── profile (document)
//   ├── subscription (document)
//   ├── credits (number) - Current credit balance
//   ├── monthlyCredits (number) - Monthly allotment based on tier
//   ├── lastCreditReset (Timestamp) - Last monthly reset date
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
//   ├── events/{eventId} (subcollection) - Includes credit usage events
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
// CREDIT SYSTEM - Schema Documentation (Module 15)
// ============================================================================

/**
 * User Credits
 * Stored in users/{userId} document
 *
 * Fields:
 * {
 *   credits: number,              // Current available credits
 *   monthlyCredits: number,       // Monthly allotment (400 for Starter, 1250 for Pro)
 *   lastCreditReset: Timestamp,   // Last monthly reset date
 *   lastCreditUpdate: Timestamp,  // Last credit transaction
 *   subscriptionTier: string      // 'starter' or 'pro'
 * }
 */

/**
 * Credit Usage Event
 * Stored in users/{userId}/events/{eventId} subcollection
 *
 * Schema:
 * {
 *   type: 'company_enrichment',
 *   companyId: string,
 *   companyName: string,
 *   creditsDeducted: number,      // Should be 10 for full enrichment
 *   costBreakdown: {
 *     companyData: 1,
 *     contactNames: 3,
 *     emails: 3,
 *     phones: 3
 *   },
 *   creditsRemaining: number,
 *   timestamp: Timestamp,
 *   contactsEnriched: number,     // Number of contacts enriched (3)
 *   metadata: {
 *     enrichedFields: string[]    // ['companyData', 'contacts', 'emails', 'phones']
 *   }
 * }
 */

/**
 * Credit Pricing
 * Cost per enrichment: 10 credits
 *
 * Breakdown:
 * - Company data: 1 credit
 * - 3 contact names: 3 credits
 * - 3 emails: 3 credits
 * - 3 phone numbers: 3 credits
 *
 * Monthly Plans:
 * - Starter ($20/mo): 400 credits = 40 companies/month
 * - Pro ($50/mo): 1,250 credits = 125 companies/month
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