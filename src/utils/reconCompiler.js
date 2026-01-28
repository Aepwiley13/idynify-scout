import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

/**
 * RECON Data Compiler
 *
 * Compiles all RECON section data into a structured context object
 * that Barry can use for intelligent context generation.
 *
 * This is the bridge between RECON (training) and Barry (intelligence).
 */

/**
 * Compile all RECON data for a user into a Barry-ready context object.
 * Returns null if no RECON data exists.
 */
export async function compileReconContext(userId) {
  try {
    const dashboardRef = doc(db, 'dashboards', userId);
    const dashboardDoc = await getDoc(dashboardRef);

    if (!dashboardDoc.exists()) return null;

    const data = dashboardDoc.data();
    const reconModule = data.modules?.find(m => m.id === 'recon');

    if (!reconModule) return null;

    const sections = reconModule.sections || [];
    const completedSections = sections.filter(s => s.status === 'completed');

    if (completedSections.length === 0) return null;

    const context = {
      completionLevel: Math.round((completedSections.length / sections.length) * 100),
      completedModules: completedSections.map(s => s.sectionId),
      business: extractBusinessContext(sections),
      product: extractProductContext(sections),
      targetMarket: extractTargetMarketContext(sections),
      customerPsychographics: extractPsychographicsContext(sections),
      painPoints: extractPainPointsContext(sections),
      buyingBehavior: extractBuyingBehaviorContext(sections),
      decisionProcess: extractDecisionProcessContext(sections),
      competitiveLandscape: extractCompetitiveContext(sections),
      messaging: extractMessagingContext(sections),
      behavioralSignals: extractBehavioralSignalsContext(sections)
    };

    // Remove null entries
    Object.keys(context).forEach(key => {
      if (context[key] === null) delete context[key];
    });

    return context;
  } catch (error) {
    console.error('Error compiling RECON context:', error);
    return null;
  }
}

/**
 * Build a concise prompt injection from RECON data for Barry.
 * This is the text that gets injected into Barry's system prompt.
 */
export function buildReconPromptContext(reconData) {
  if (!reconData) return '';

  const parts = [];

  parts.push(`RECON TRAINING DATA (${reconData.completionLevel}% complete):`);
  parts.push('The user has trained this AI with the following business context. Use this to provide more relevant, personalized intelligence.\n');

  if (reconData.business) {
    parts.push('BUSINESS IDENTITY:');
    if (reconData.business.companyName) parts.push(`- Company: ${reconData.business.companyName}`);
    if (reconData.business.industry) parts.push(`- Industry: ${reconData.business.industry}`);
    if (reconData.business.stage) parts.push(`- Stage: ${reconData.business.stage}`);
    if (reconData.business.whatTheyDo) parts.push(`- What they do: ${reconData.business.whatTheyDo}`);
    parts.push('');
  }

  if (reconData.product) {
    parts.push('PRODUCT/SERVICE:');
    if (reconData.product.mainProduct) parts.push(`- Main offering: ${reconData.product.mainProduct}`);
    if (reconData.product.problemSolved) parts.push(`- Problem solved: ${reconData.product.problemSolved}`);
    if (reconData.product.currentCustomers) parts.push(`- Current customers: ${reconData.product.currentCustomers}`);
    parts.push('');
  }

  if (reconData.targetMarket) {
    parts.push('TARGET MARKET:');
    Object.entries(reconData.targetMarket).forEach(([key, value]) => {
      if (value) parts.push(`- ${formatKey(key)}: ${value}`);
    });
    parts.push('');
  }

  if (reconData.customerPsychographics) {
    parts.push('IDEAL CUSTOMER PSYCHOGRAPHICS:');
    Object.entries(reconData.customerPsychographics).forEach(([key, value]) => {
      if (value) parts.push(`- ${formatKey(key)}: ${value}`);
    });
    parts.push('');
  }

  if (reconData.painPoints) {
    parts.push('CUSTOMER PAIN POINTS & MOTIVATIONS:');
    Object.entries(reconData.painPoints).forEach(([key, value]) => {
      if (value) parts.push(`- ${formatKey(key)}: ${value}`);
    });
    parts.push('');
  }

  if (reconData.buyingBehavior) {
    parts.push('BUYING BEHAVIOR & TRIGGERS:');
    Object.entries(reconData.buyingBehavior).forEach(([key, value]) => {
      if (value) parts.push(`- ${formatKey(key)}: ${value}`);
    });
    parts.push('');
  }

  if (reconData.decisionProcess) {
    parts.push('DECISION PROCESS:');
    Object.entries(reconData.decisionProcess).forEach(([key, value]) => {
      if (value) parts.push(`- ${formatKey(key)}: ${value}`);
    });
    parts.push('');
  }

  if (reconData.competitiveLandscape) {
    parts.push('COMPETITIVE LANDSCAPE:');
    Object.entries(reconData.competitiveLandscape).forEach(([key, value]) => {
      if (value) parts.push(`- ${formatKey(key)}: ${value}`);
    });
    parts.push('');
  }

  if (reconData.messaging) {
    parts.push('MESSAGING & VALUE PROPOSITION:');
    Object.entries(reconData.messaging).forEach(([key, value]) => {
      if (value) parts.push(`- ${formatKey(key)}: ${value}`);
    });
    parts.push('');
  }

  if (reconData.behavioralSignals) {
    parts.push('BEHAVIORAL & TIMING SIGNALS:');
    Object.entries(reconData.behavioralSignals).forEach(([key, value]) => {
      if (value) parts.push(`- ${formatKey(key)}: ${value}`);
    });
    parts.push('');
  }

  parts.push('INSTRUCTION: Use the above RECON training data to make your context generation more specific to this user\'s business, product, and ideal customer profile. Reference their competitive position and messaging framework where relevant. Do NOT quote RECON data directly — integrate it naturally into your analysis.');

  return parts.join('\n');
}

// ─── Section Extractors ───

function extractBusinessContext(sections) {
  const s1 = getSectionData(sections, 1);
  if (!s1) return null;

  return {
    companyName: s1.companyName || null,
    whatTheyDo: s1.whatYouDo || null,
    industry: s1.industry || null,
    stage: s1.stage || null,
    role: s1.role || null,
    ninetyDayGoal: s1.ninetyDayGoal || null,
    biggestChallenge: s1.biggestChallenge || null
  };
}

function extractProductContext(sections) {
  const s1 = getSectionData(sections, 1);
  const s2 = getSectionData(sections, 2);

  if (!s1 && !s2) return null;

  return {
    mainProduct: s1?.mainProduct || null,
    problemSolved: s1?.problemSolved || null,
    currentCustomers: s1?.currentCustomers || null,
    ...(s2 || {})
  };
}

function extractTargetMarketContext(sections) {
  const s3 = getSectionData(sections, 3);
  return s3 || null;
}

function extractPsychographicsContext(sections) {
  const s4 = getSectionData(sections, 4);
  return s4 || null;
}

function extractPainPointsContext(sections) {
  const s5 = getSectionData(sections, 5);
  return s5 || null;
}

function extractBuyingBehaviorContext(sections) {
  const s6 = getSectionData(sections, 6);
  return s6 || null;
}

function extractDecisionProcessContext(sections) {
  const s7 = getSectionData(sections, 7);
  return s7 || null;
}

function extractCompetitiveContext(sections) {
  const s8 = getSectionData(sections, 8);
  return s8 || null;
}

function extractMessagingContext(sections) {
  const s9 = getSectionData(sections, 9);
  return s9 || null;
}

function extractBehavioralSignalsContext(sections) {
  const s10 = getSectionData(sections, 10);
  return s10 || null;
}

// ─── Helpers ───

function getSectionData(sections, sectionId) {
  const section = sections.find(s => s.sectionId === sectionId);
  if (!section || section.status !== 'completed' || !section.data) return null;
  return section.data;
}

function formatKey(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}
