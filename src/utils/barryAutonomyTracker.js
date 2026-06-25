import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const PROMOTE_THRESHOLD = { minSwipes: 50, minAgreement: 80 };
const DEMOTE_THRESHOLD = { minAgreement: 70, maxOverrides: 5, overrideDays: 7 };
const ROLLING_WINDOW = 100;

export async function trackSwipeAgreement(userId, companyId, userDecision, barryRecommendation) {
  if (!barryRecommendation) return null;

  const agreed = (
    (userDecision === 'accepted' && barryRecommendation === 'approve') ||
    (userDecision === 'rejected' && barryRecommendation === 'reject')
  );

  const ref = doc(db, 'users', userId, 'barryLearning', 'state');
  const snap = await getDoc(ref);
  const state = snap.exists() ? snap.data() : {};

  const history = state.agreementHistory || [];
  history.push({
    companyId,
    barryRec: barryRecommendation,
    userDecision,
    agreed,
    timestamp: new Date().toISOString()
  });

  const trimmed = history.slice(-ROLLING_WINDOW);

  const agreementRate = trimmed.length > 0
    ? Math.round((trimmed.filter(h => h.agreed).length / trimmed.length) * 100)
    : 0;

  const overrides = state.overrides || { userOverrodeBarry: 0, barryCorrect: 0 };
  if (!agreed) {
    overrides.userOverrodeBarry++;
  } else {
    overrides.barryCorrect++;
  }

  let autonomyLevel = state.autonomyLevel || 'disabled';
  const totalSwipes = state.totalSwipesAnalyzed || 0;

  if (autonomyLevel === 'recommend_only') {
    if (totalSwipes >= PROMOTE_THRESHOLD.minSwipes && agreementRate >= PROMOTE_THRESHOLD.minAgreement) {
      autonomyLevel = 'auto_triage';
    }
  } else if (autonomyLevel === 'auto_triage') {
    const recentOverrides = countRecentOverrides(trimmed, DEMOTE_THRESHOLD.overrideDays);
    if (agreementRate < DEMOTE_THRESHOLD.minAgreement || recentOverrides >= DEMOTE_THRESHOLD.maxOverrides) {
      autonomyLevel = 'recommend_only';
    }
  }

  await setDoc(ref, {
    agreementHistory: trimmed,
    agreementRate,
    overrides,
    autonomyLevel,
    updatedAt: new Date().toISOString()
  }, { merge: true });

  return { agreed, agreementRate, autonomyLevel };
}

function countRecentOverrides(history, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffISO = cutoff.toISOString();

  return history.filter(h => !h.agreed && h.timestamp > cutoffISO).length;
}

export async function getBarryLearningState(userId) {
  const ref = doc(db, 'users', userId, 'barryLearning', 'state');
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export async function setAutonomyLevel(userId, level) {
  const ref = doc(db, 'users', userId, 'barryLearning', 'state');
  await setDoc(ref, {
    autonomyLevel: level,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}
