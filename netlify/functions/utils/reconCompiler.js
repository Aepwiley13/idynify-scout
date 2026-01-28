/**
 * Server-side RECON Data Compiler for Netlify Functions
 *
 * Compiles RECON section data into a prompt-ready context string
 * for Barry's Claude API calls.
 */

/**
 * Compile RECON data from a dashboard document into a prompt context string.
 * @param {Object} dashboardData - The dashboard Firestore document data
 * @returns {string} Prompt-ready context string, or empty string if no RECON data
 */
function compileReconForPrompt(dashboardData) {
  if (!dashboardData || !dashboardData.modules) return '';

  const reconModule = dashboardData.modules.find(m => m.id === 'recon');
  if (!reconModule) return '';

  const sections = reconModule.sections || [];
  const completedSections = sections.filter(s => s.status === 'completed' && s.data);

  if (completedSections.length === 0) return '';

  const completionPct = Math.round((completedSections.length / sections.length) * 100);
  const parts = [];

  parts.push(`\n--- RECON TRAINING DATA (${completionPct}% complete) ---`);
  parts.push('The user has trained this AI with business context. Use this to provide more relevant, personalized intelligence.\n');

  // Section 1: Business Foundation
  const s1 = getCompleted(sections, 1);
  if (s1) {
    parts.push('BUSINESS IDENTITY:');
    if (s1.companyName) parts.push(`- Company: ${s1.companyName}`);
    if (s1.whatYouDo) parts.push(`- What they do: ${s1.whatYouDo}`);
    if (s1.industry) parts.push(`- Industry: ${s1.industry}`);
    if (s1.stage) parts.push(`- Stage: ${s1.stage}`);
    if (s1.mainProduct) parts.push(`- Main product: ${s1.mainProduct}`);
    if (s1.problemSolved) parts.push(`- Problem solved: ${s1.problemSolved}`);
    if (s1.currentCustomers) parts.push(`- Current customers: ${s1.currentCustomers}`);
    parts.push('');
  }

  // Section 2: Product Deep Dive
  const s2 = getCompleted(sections, 2);
  if (s2) {
    parts.push('PRODUCT DETAILS:');
    Object.entries(s2).forEach(([key, val]) => {
      if (val && typeof val === 'string') parts.push(`- ${formatKey(key)}: ${val}`);
    });
    parts.push('');
  }

  // Section 3: Target Market
  const s3 = getCompleted(sections, 3);
  if (s3) {
    parts.push('TARGET MARKET:');
    Object.entries(s3).forEach(([key, val]) => {
      if (val && typeof val === 'string') parts.push(`- ${formatKey(key)}: ${val}`);
    });
    parts.push('');
  }

  // Section 4: Psychographics
  const s4 = getCompleted(sections, 4);
  if (s4) {
    parts.push('IDEAL CUSTOMER PSYCHOGRAPHICS:');
    Object.entries(s4).forEach(([key, val]) => {
      if (val && typeof val === 'string') parts.push(`- ${formatKey(key)}: ${val}`);
    });
    parts.push('');
  }

  // Section 5: Pain Points
  const s5 = getCompleted(sections, 5);
  if (s5) {
    parts.push('CUSTOMER PAIN POINTS:');
    Object.entries(s5).forEach(([key, val]) => {
      if (val && typeof val === 'string') parts.push(`- ${formatKey(key)}: ${val}`);
    });
    parts.push('');
  }

  // Section 6: Buying Behavior
  const s6 = getCompleted(sections, 6);
  if (s6) {
    parts.push('BUYING BEHAVIOR & TRIGGERS:');
    Object.entries(s6).forEach(([key, val]) => {
      if (val && typeof val === 'string') parts.push(`- ${formatKey(key)}: ${val}`);
    });
    parts.push('');
  }

  // Section 7: Decision Process
  const s7 = getCompleted(sections, 7);
  if (s7) {
    parts.push('DECISION PROCESS:');
    Object.entries(s7).forEach(([key, val]) => {
      if (val && typeof val === 'string') parts.push(`- ${formatKey(key)}: ${val}`);
    });
    parts.push('');
  }

  // Section 8: Competitive Landscape
  const s8 = getCompleted(sections, 8);
  if (s8) {
    parts.push('COMPETITIVE LANDSCAPE:');
    Object.entries(s8).forEach(([key, val]) => {
      if (val && typeof val === 'string') parts.push(`- ${formatKey(key)}: ${val}`);
    });
    parts.push('');
  }

  // Section 9: Messaging
  const s9 = getCompleted(sections, 9);
  if (s9) {
    parts.push('MESSAGING & VALUE PROPOSITION:');
    Object.entries(s9).forEach(([key, val]) => {
      if (val && typeof val === 'string') parts.push(`- ${formatKey(key)}: ${val}`);
    });
    parts.push('');
  }

  // Section 10: Behavioral Signals
  const s10 = getCompleted(sections, 10);
  if (s10) {
    parts.push('BEHAVIORAL SIGNALS:');
    Object.entries(s10).forEach(([key, val]) => {
      if (val && typeof val === 'string') parts.push(`- ${formatKey(key)}: ${val}`);
    });
    parts.push('');
  }

  parts.push('INSTRUCTION: Use the above RECON training data to make your context generation more specific to this user\'s business. Reference their product, competitive position, and ideal customer when relevant. Do NOT quote RECON data directly — integrate it naturally.');
  parts.push('--- END RECON DATA ---\n');

  return parts.join('\n');
}

function getCompleted(sections, sectionId) {
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

module.exports = { compileReconForPrompt };
