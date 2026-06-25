import { schedule } from '@netlify/functions';
import { db } from './firebase-admin.js';

const AUTONOMY_LEVELS = {
  DISABLED: 'disabled',
  RECOMMEND: 'recommend_only',
  AUTO: 'auto_triage'
};

async function triageUser(userId) {
  const learningSnap = await db.collection('users').doc(userId)
    .collection('barryLearning').doc('state').get();
  const learning = learningSnap.exists ? learningSnap.data() : {};

  if (learning.autonomyLevel === AUTONOMY_LEVELS.DISABLED) return null;

  const pendingSnap = await db.collection('users').doc(userId)
    .collection('companies')
    .where('status', '==', 'pending')
    .orderBy('fit_score', 'desc')
    .limit(100)
    .get();

  if (pendingSnap.empty) return null;

  const companies = pendingSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  let icpProfile = {};
  const profilesSnap = await db.collection('users').doc(userId)
    .collection('icpProfiles')
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (!profilesSnap.empty) {
    icpProfile = profilesSnap.docs[0].data();
  } else {
    const legacySnap = await db.collection('users').doc(userId)
      .collection('companyProfile').doc('current').get();
    if (legacySnap.exists) icpProfile = legacySnap.data();
  }

  const learnedWeights = learning.learnedWeights || null;
  const learnedSignals = learning.learnedSignals || [];

  const autoApproved = [];
  const autoRejected = [];
  const needsReview = [];

  for (const company of companies) {
    const result = quickScore(company, icpProfile, learnedWeights, learnedSignals);

    if (learning.autonomyLevel === AUTONOMY_LEVELS.AUTO && result.barryConfidence === 'high') {
      if (result.barryRecommendation === 'approve') {
        autoApproved.push({ ...company, ...result });
        await db.collection('users').doc(userId)
          .collection('companies').doc(company.id)
          .update({
            status: 'accepted',
            barryAutoApproved: true,
            barryScore: result.icpScore,
            barryConfidence: result.barryConfidence,
            barryRecommendation: result.barryRecommendation,
            barryReasoning: result.reasoning,
            swipedAt: new Date().toISOString(),
            swipeSource: 'barry_auto'
          });
      } else if (result.barryRecommendation === 'reject') {
        autoRejected.push({ ...company, ...result });
        await db.collection('users').doc(userId)
          .collection('companies').doc(company.id)
          .update({
            status: 'rejected',
            barryAutoRejected: true,
            barryScore: result.icpScore,
            barryConfidence: result.barryConfidence,
            barryRecommendation: result.barryRecommendation,
            barryReasoning: result.reasoning,
            swipedAt: new Date().toISOString(),
            swipeSource: 'barry_auto'
          });
      }
    } else {
      needsReview.push({ ...company, ...result });
      await db.collection('users').doc(userId)
        .collection('companies').doc(company.id)
        .update({
          barryScore: result.icpScore,
          barryConfidence: result.barryConfidence,
          barryRecommendation: result.barryRecommendation,
          barryReasoning: result.reasoning
        });
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const briefing = {
    autoApproved: autoApproved.map(c => ({ id: c.id, name: c.name, score: c.icpScore, reasoning: c.reasoning })),
    autoRejected: autoRejected.map(c => ({ id: c.id, name: c.name, score: c.icpScore, reasoning: c.reasoning })),
    needsReview: needsReview.map(c => ({ id: c.id, name: c.name, score: c.icpScore, recommendation: c.barryRecommendation, reasoning: c.reasoning })),
    summary: `Barry processed ${companies.length} leads: ${autoApproved.length} auto-approved, ${autoRejected.length} auto-rejected, ${needsReview.length} need your review.`,
    learningStats: {
      totalSwipes: learning.totalSwipesAnalyzed || 0,
      autonomyLevel: learning.autonomyLevel,
      learnedWeights: learnedWeights
    },
    createdAt: new Date().toISOString()
  };

  await db.collection('users').doc(userId)
    .collection('barryBriefings').doc(today).set(briefing);

  return briefing;
}

function quickScore(company, icpProfile, learnedWeights, learnedSignals) {
  const weights = learnedWeights || { industry: 50, location: 25, employeeSize: 15, revenue: 10 };

  const industryMatch = matchDim(company, icpProfile, 'industry') ? 100 : 0;
  const locationMatch = matchDim(company, icpProfile, 'location') ? 100 : 0;
  const sizeMatch = matchDim(company, icpProfile, 'employeeSize') ? 100 : 0;
  const revenueMatch = matchDim(company, icpProfile, 'revenue') ? 100 : 0;

  const score = Math.round(
    (industryMatch * weights.industry / 100) +
    (locationMatch * weights.location / 100) +
    (sizeMatch * weights.employeeSize / 100) +
    (revenueMatch * weights.revenue / 100)
  );

  let confidence, recommendation;
  if (score >= 70) { confidence = 'high'; recommendation = 'approve'; }
  else if (score >= 40) { confidence = 'medium'; recommendation = 'review'; }
  else if (score <= 20) { confidence = 'high'; recommendation = 'reject'; }
  else { confidence = 'medium'; recommendation = 'review'; }

  return {
    icpScore: score,
    barryConfidence: confidence,
    barryRecommendation: recommendation,
    reasoning: `Score ${score}: ind=${industryMatch} loc=${locationMatch} size=${sizeMatch} rev=${revenueMatch}`
  };
}

function matchDim(company, icp, dim) {
  if (!icp) return false;
  switch (dim) {
    case 'industry':
      return (icp.industries || []).some(i => i.toLowerCase() === (company.industry || '').toLowerCase());
    case 'location':
      if (icp.isNationwide) return true;
      return (icp.locations || []).includes(company.state || company.location);
    case 'employeeSize':
      return (icp.companySizes || []).includes(company.employee_count || company.company_size);
    case 'revenue':
      return (icp.revenueRanges || []).includes(company.revenue);
    default: return false;
  }
}

async function runTriage() {
  console.log('🤖 Barry Daily Triage starting...');

  const usersSnap = await db.collection('users').get();
  let processed = 0;

  for (const userDoc of usersSnap.docs) {
    try {
      const learningSnap = await db.collection('users').doc(userDoc.id)
        .collection('barryLearning').doc('state').get();

      if (!learningSnap.exists) continue;
      const learning = learningSnap.data();
      if (learning.autonomyLevel === AUTONOMY_LEVELS.DISABLED || !learning.autonomyLevel) continue;

      await triageUser(userDoc.id);
      processed++;
    } catch (err) {
      console.error(`Triage failed for user ${userDoc.id}:`, err.message);
    }
  }

  console.log(`✅ Barry Daily Triage complete: ${processed} users processed`);
}

export const handler = schedule('0 9 * * 1-5', async () => {
  await runTriage();
  return { statusCode: 200 };
});

export { triageUser, quickScore };
