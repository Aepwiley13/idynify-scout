/**
 * Industry Population Probe — READ-ONLY
 *
 * Queries all company records across all users to produce:
 * 1. Total company documents
 * 2. Full distribution of current industry values
 * 3. Count where industry === 'Unknown' (visible-breakage bucket)
 * 4. Count where industry matches the owning user's ICP first industry (fabricated-match bucket)
 * 5. Revenue/Founded population rates
 * 6. The current Forbes record as reference fixture
 *
 * Requires: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 * Or: FIREBASE_SERVICE_ACCOUNT_PATH (path to a JSON key file)
 *
 * Usage: node scripts/industryProbe.mjs
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize from env vars or service account file
let credential;
if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  const fs = await import('fs');
  const keyFile = JSON.parse(fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
  credential = cert(keyFile);
} else {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKey) {
    console.error('Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY');
    process.exit(1);
  }
  credential = cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey,
  });
}

initializeApp({ credential });
const db = getFirestore();

const POISON_VALUES = new Set(['Unknown', 'Unknown Industry', 'unknown', 'unknown industry', 'null']);

async function runProbe() {
  console.log('=== Industry Population Probe (READ-ONLY) ===\n');

  // Step 1: Get all users
  const usersSnap = await db.collection('users').get();
  const userIds = usersSnap.docs.map(d => d.id);
  console.log(`Users: ${userIds.length}\n`);

  // Step 2: Load each user's ICP first industry
  const userIcpFirstIndustry = {};
  for (const userId of userIds) {
    const icpSnap = await db.collection('users').doc(userId).collection('icpProfiles').get();
    const profiles = icpSnap.docs.map(d => d.data());
    const active = profiles.find(p => p.isActive) || profiles[0];
    userIcpFirstIndustry[userId] = active?.industries?.[0] || null;
  }

  // Step 3: Scan all companies across all users
  let totalDocs = 0;
  const industryDistribution = {};
  let unknownCount = 0;
  let fabricatedMatchCount = 0;
  let nullOrMissing = 0;
  let hasRevenue = 0;
  let hasFounded = 0;
  let hasEnrichedIndustry = 0;
  let forbesRecord = null;

  for (const userId of userIds) {
    const companiesSnap = await db.collection('users').doc(userId).collection('companies').get();
    const icpFirst = userIcpFirstIndustry[userId];

    for (const doc of companiesSnap.docs) {
      totalDocs++;
      const data = doc.data();
      const industry = data.industry;

      // Distribution
      const bucket = industry || '(null/missing)';
      industryDistribution[bucket] = (industryDistribution[bucket] || 0) + 1;

      // Visible breakage
      if (industry && POISON_VALUES.has(industry)) {
        unknownCount++;
      }

      // Null/missing
      if (!industry) {
        nullOrMissing++;
      }

      // Fabricated match: industry equals user's ICP first industry
      if (icpFirst && industry === icpFirst) {
        fabricatedMatchCount++;
      }

      // Revenue/Founded population
      if (data.revenue && data.revenue !== '' && data.revenue !== 'null') hasRevenue++;
      if (data.founded_year && data.founded_year !== 0) hasFounded++;

      // Enriched industry available but not promoted
      if (data.apolloEnrichment?.snapshot?.industry) hasEnrichedIndustry++;

      // Forbes fixture
      if (data.name && data.name.toLowerCase().includes('forbes') && !forbesRecord) {
        forbesRecord = {
          userId: userId.slice(0, 8) + '...',
          docId: doc.id,
          name: data.name,
          industry: data.industry,
          revenue: data.revenue,
          founded_year: data.founded_year,
          enrichedIndustry: data.apolloEnrichment?.snapshot?.industry || null,
          barry_intel: data.barry_intel?.slice(0, 120) || null,
          status: data.status,
          icpId: data.icpId,
        };
      }
    }
  }

  // Sort distribution by count descending
  const sortedDist = Object.entries(industryDistribution)
    .sort((a, b) => b[1] - a[1]);

  // Output
  console.log(`--- TOTALS ---`);
  console.log(`Total company documents: ${totalDocs}`);
  console.log(`With revenue: ${hasRevenue} (${(hasRevenue/totalDocs*100).toFixed(1)}%)`);
  console.log(`With founded_year: ${hasFounded} (${(hasFounded/totalDocs*100).toFixed(1)}%)`);
  console.log(`With enriched industry (in apolloEnrichment): ${hasEnrichedIndustry}`);
  console.log();

  console.log(`--- INDUSTRY BREAKDOWN ---`);
  console.log(`Null/missing industry: ${nullOrMissing}`);
  console.log(`Poison values ('Unknown' etc): ${unknownCount}`);
  console.log(`Matches user's ICP first industry (fabricated-match bucket): ${fabricatedMatchCount}`);
  console.log();

  console.log(`--- FULL INDUSTRY DISTRIBUTION (top 30) ---`);
  for (const [value, count] of sortedDist.slice(0, 30)) {
    const pct = (count / totalDocs * 100).toFixed(1);
    const flags = [];
    if (POISON_VALUES.has(value)) flags.push('POISON');
    console.log(`  ${count.toString().padStart(6)} (${pct.padStart(5)}%)  ${value}${flags.length ? '  ← ' + flags.join(', ') : ''}`);
  }
  if (sortedDist.length > 30) {
    console.log(`  ... and ${sortedDist.length - 30} more distinct values`);
  }
  console.log();

  console.log(`--- FORBES REFERENCE FIXTURE ---`);
  if (forbesRecord) {
    console.log(JSON.stringify(forbesRecord, null, 2));
  } else {
    console.log('Forbes record not found');
  }

  console.log('\n--- SUMMARY FOR BACKFILL STRATEGY ---');
  console.log(`Records needing action: ${unknownCount + nullOrMissing} (${unknownCount} poison + ${nullOrMissing} null)`);
  console.log(`Of those, ${hasEnrichedIndustry} have enriched industry available to promote`);
  console.log(`Fabricated-match bucket (industry === user's ICP[0]): ${fabricatedMatchCount} — these need re-enrichment, not mechanical null`);
}

runProbe().catch(err => {
  console.error('Probe failed:', err.message);
  process.exit(1);
});
