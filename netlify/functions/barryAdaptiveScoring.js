import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';

const DEFAULT_WEIGHTS = { industry: 50, location: 25, employeeSize: 15, revenue: 10 };

async function loadAllFeedback(userId) {
  const [acceptedSnap, rejectedSnap] = await Promise.all([
    db.collection('users').doc(userId)
      .collection('companies')
      .where('status', '==', 'accepted')
      .orderBy('swipedAt', 'desc')
      .limit(200)
      .get(),
    db.collection('users').doc(userId)
      .collection('companies')
      .where('status', '==', 'rejected')
      .orderBy('swipedAt', 'desc')
      .limit(200)
      .get(),
  ]);

  return {
    accepted: acceptedSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    rejected: rejectedSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}

function computeLearnedWeights(accepted, rejected, icpProfile) {
  if (accepted.length + rejected.length < 10) return DEFAULT_WEIGHTS;

  const dimensions = ['industry', 'location', 'employeeSize', 'revenue'];
  const rates = {};

  for (const dim of dimensions) {
    let matchedAccepted = 0, matchedTotal = 0;
    let unmatchedAccepted = 0, unmatchedTotal = 0;

    for (const c of [...accepted, ...rejected]) {
      const isAccepted = c.status === 'accepted';
      const matched = didMatch(c, icpProfile, dim);

      if (matched) {
        matchedTotal++;
        if (isAccepted) matchedAccepted++;
      } else {
        unmatchedTotal++;
        if (isAccepted) unmatchedAccepted++;
      }
    }

    const matchedRate = matchedTotal > 0 ? matchedAccepted / matchedTotal : 0.5;
    const unmatchedRate = unmatchedTotal > 0 ? unmatchedAccepted / unmatchedTotal : 0.5;
    rates[dim] = matchedRate - unmatchedRate;
  }

  const totalSignal = Object.values(rates).reduce((s, v) => s + Math.abs(v), 0) || 1;
  const weights = {};
  for (const dim of dimensions) {
    weights[dim] = Math.round((Math.abs(rates[dim]) / totalSignal) * 100);
  }

  const sum = Object.values(weights).reduce((s, v) => s + v, 0);
  if (sum !== 100) {
    weights.industry += (100 - sum);
  }

  return weights;
}

function didMatch(company, icpProfile, dimension) {
  if (!icpProfile) return false;

  switch (dimension) {
    case 'industry': {
      const industries = icpProfile.industries || [];
      if (industries.length === 0) return false;
      return industries.some(i => i.toLowerCase() === (company.industry || '').toLowerCase());
    }
    case 'location': {
      if (icpProfile.isNationwide) return true;
      const locs = icpProfile.locations || [];
      if (locs.length === 0) return false;
      return locs.includes(company.state || company.location);
    }
    case 'employeeSize': {
      const sizes = icpProfile.companySizes || [];
      if (sizes.length === 0) return false;
      return sizes.includes(company.employee_count || company.company_size);
    }
    case 'revenue': {
      const revs = icpProfile.revenueRanges || [];
      if (revs.length === 0) return false;
      return revs.includes(company.revenue);
    }
    default:
      return false;
  }
}

async function detectSignals(accepted, rejected, claudeApiKey) {
  const notes = [];
  for (const c of accepted.slice(0, 30)) {
    if (c.barryFeedback?.note) notes.push({ dir: 'accept', note: c.barryFeedback.note.slice(0, 100), name: c.name });
    if (c.barryFeedback?.reasons?.length) notes.push({ dir: 'accept', reasons: c.barryFeedback.reasons, name: c.name });
  }
  for (const c of rejected.slice(0, 30)) {
    if (c.barryRejectionFeedback?.note) notes.push({ dir: 'reject', note: c.barryRejectionFeedback.note.slice(0, 100), name: c.name });
    if (c.barryRejectionFeedback?.reasons?.length) notes.push({ dir: 'reject', reasons: c.barryRejectionFeedback.reasons, name: c.name });
  }

  if (notes.length < 5) return [];

  const anthropic = new Anthropic({ apiKey: claudeApiKey });
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: 'You are a B2B sales pattern analyst. Extract decision patterns from swipe feedback. Return only valid JSON.',
    messages: [{
      role: 'user',
      content: `Analyze these lead triage decisions and extract 3-5 patterns.\n\n${JSON.stringify(notes)}\n\nReturn JSON array: [{"signal": "description", "direction": "positive|negative", "strength": 0.1-1.0}]`
    }]
  });

  const text = message.content[0]?.text || '[]';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    return JSON.parse(match[0]).slice(0, 5);
  } catch {
    return [];
  }
}

function scoreCompany(company, icpProfile, learnedWeights, learnedSignals) {
  const weights = learnedWeights || DEFAULT_WEIGHTS;

  const industryMatch = didMatch(company, icpProfile, 'industry') ? 100 : 0;
  const locationMatch = didMatch(company, icpProfile, 'location') ? 100 : 0;
  const sizeMatch = didMatch(company, icpProfile, 'employeeSize') ? 100 : 0;
  const revenueMatch = didMatch(company, icpProfile, 'revenue') ? 100 : 0;

  const baseScore = (
    (industryMatch * weights.industry / 100) +
    (locationMatch * weights.location / 100) +
    (sizeMatch * weights.employeeSize / 100) +
    (revenueMatch * weights.revenue / 100)
  );

  let signalBonus = 0;
  const signalMatches = [];
  for (const sig of (learnedSignals || [])) {
    const desc = (sig.signal || '').toLowerCase();
    const companyText = `${company.name} ${company.industry} ${company.description || ''} ${(company.keywords || []).join(' ')}`.toLowerCase();
    if (companyText.includes(desc.split(' ')[0])) {
      const bonus = sig.direction === 'positive' ? sig.strength * 10 : -(sig.strength * 10);
      signalBonus += bonus;
      signalMatches.push(sig.signal);
    }
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(baseScore + signalBonus)));

  let confidence, recommendation;
  if (finalScore >= 70) {
    confidence = 'high';
    recommendation = 'approve';
  } else if (finalScore >= 40) {
    confidence = 'medium';
    recommendation = 'review';
  } else {
    confidence = finalScore <= 20 ? 'high' : 'medium';
    recommendation = finalScore <= 20 ? 'reject' : 'review';
  }

  return {
    icpScore: finalScore,
    barryConfidence: confidence,
    barryRecommendation: recommendation,
    reasoning: `Score ${finalScore}: industry ${industryMatch}%, location ${locationMatch}%, size ${sizeMatch}%, revenue ${revenueMatch}%` +
      (signalMatches.length > 0 ? ` + signals: ${signalMatches.join(', ')}` : ''),
    signalMatches
  };
}

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { userId, authToken, companies, icpId } = JSON.parse(event.body);

    if (!userId || !authToken) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Auth required' }) };
    }

    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    const verifyResp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: authToken }) }
    );
    if (!verifyResp.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
    const vData = await verifyResp.json();
    if (vData.users[0].localId !== userId) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Token mismatch' }) };

    const profileId = icpId || 'current';
    let icpProfile;
    if (profileId === 'current') {
      const snap = await db.collection('users').doc(userId).collection('companyProfile').doc('current').get();
      icpProfile = snap.exists ? snap.data() : {};
    } else {
      const snap = await db.collection('users').doc(userId).collection('icpProfiles').doc(profileId).get();
      icpProfile = snap.exists ? snap.data() : {};
    }

    const { accepted, rejected } = await loadAllFeedback(userId);
    const totalSwipes = accepted.length + rejected.length;

    const learnedWeights = computeLearnedWeights(accepted, rejected, icpProfile);

    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    let learnedSignals = [];
    if (claudeApiKey && totalSwipes >= 20) {
      learnedSignals = await detectSignals(accepted, rejected, claudeApiKey);
    }

    const companiesInput = companies || [];
    const scored = companiesInput.map(c => ({
      companyId: c.id,
      ...scoreCompany(c, icpProfile, learnedWeights, learnedSignals)
    }));

    await db.collection('users').doc(userId).collection('barryLearning').doc('state').set({
      learnedWeights,
      learnedSignals,
      totalSwipesAnalyzed: totalSwipes,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    await logApiUsage(userId, 'barryAdaptiveScoring', 'success', {
      metadata: { totalSwipes, companiesScored: scored.length }
    }).catch(() => {});

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        scored,
        learnedWeights,
        learnedSignals,
        totalSwipesAnalyzed: totalSwipes
      })
    };

  } catch (error) {
    console.error('barryAdaptiveScoring error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
}
