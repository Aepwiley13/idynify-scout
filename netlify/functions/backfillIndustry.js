import { db, admin } from './firebase-admin.js';
import { verifyAuthToken } from './utils/verifyAuthToken.js';
import { FieldValue } from 'firebase-admin/firestore';

const POISON_LOWER = new Set(['unknown', 'unknown industry', 'not specified', 'n/a', 'null']);

function isPoisonIndustry(value) {
  if (!value || typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return POISON_LOWER.has(trimmed.toLowerCase());
}

function buildBarryIntel(company, icpProfile) {
  const name = company.name || 'This company';
  const industry = company.industry || 'this sector';
  const currentYear = new Date().getFullYear();

  let summary = `${name} is a ${industry} company`;

  if (company.founded_year) {
    const age = currentYear - company.founded_year;
    summary += `, founded in ${company.founded_year} (${age}y old)`;
  }

  if (company.revenue && company.revenue !== 'null') {
    summary += ` with ${company.revenue} in revenue`;
  }

  summary += '.';

  if (icpProfile) {
    const icpHints = [];
    if (icpProfile.targetTitles?.length > 0) {
      icpHints.push(`targeting ${icpProfile.targetTitles.slice(0, 2).join(' / ')}`);
    }
    if (icpProfile.companySizes?.length > 0) {
      icpHints.push(`${icpProfile.companySizes[0]} employees`);
    }
    if (icpHints.length > 0) {
      summary += ` Matches your ICP criteria: ${icpHints.join(', ')}.`;
    }
  }

  return summary;
}

async function loadActiveIcpProfile(userId) {
  const icpSnap = await db.collection('users').doc(userId).collection('icpProfiles').get();
  const profiles = icpSnap.docs.map(d => d.data());
  return profiles.find(p => p.isActive) || profiles[0] || null;
}

async function backfillUser(userId, icpProfile, dryRun) {
  const companiesRef = db.collection('users').doc(userId).collection('companies');
  const snapshot = await companiesRef.get();

  const icpFirstIndustry = icpProfile?.industries?.[0] || null;
  const results = {
    total: 0,
    poisoned: 0,
    enriched: 0,
    cleared: 0,
    fabricatedMatch: 0,
    barryRegenerated: 0,
    samples: [],
  };

  const batches = [db.batch()];
  let batchIdx = 0;
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    results.total++;
    const data = doc.data();
    const currentIndustry = data.industry;

    if (icpFirstIndustry && currentIndustry === icpFirstIndustry) {
      results.fabricatedMatch++;
    }

    if (!isPoisonIndustry(currentIndustry)) continue;

    results.poisoned++;
    const enrichedIndustry = data.apolloEnrichment?.snapshot?.industry;
    const newIndustry = (enrichedIndustry && !isPoisonIndustry(enrichedIndustry))
      ? enrichedIndustry
      : null;

    const update = {};
    if (newIndustry) {
      update.industry = newIndustry;
      results.enriched++;
    } else {
      update.industry = FieldValue.delete();
      results.cleared++;
    }

    const updatedCompany = { ...data, industry: newIndustry };
    update.barry_intel = buildBarryIntel(updatedCompany, icpProfile);
    results.barryRegenerated++;

    if (results.samples.length < 5) {
      results.samples.push({
        id: doc.id,
        name: data.name,
        was: currentIndustry || '(empty)',
        now: newIndustry || '(deleted)',
        barryUpdated: true,
      });
    }

    if (!dryRun) {
      if (batchCount >= 400) {
        batches.push(db.batch());
        batchIdx++;
        batchCount = 0;
      }
      batches[batchIdx].update(doc.ref, update);
      batchCount++;
    }
  }

  if (!dryRun) {
    for (const b of batches) {
      await b.commit();
    }
  }

  return results;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { userId, authToken, allUsers, adminKey, dryRun = true } = JSON.parse(event.body);

    if (allUsers) {
      const expectedKey = process.env.ADMIN_BACKFILL_KEY;
      if (!expectedKey || adminKey !== expectedKey) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Invalid or missing admin key' }) };
      }

      const usersSnap = await db.collection('users').get();
      const totals = { users: 0, total: 0, poisoned: 0, enriched: 0, cleared: 0, fabricatedMatch: 0, barryRegenerated: 0 };
      const perUser = [];

      for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        const icpProfile = await loadActiveIcpProfile(uid);
        const r = await backfillUser(uid, icpProfile, dryRun);

        totals.users++;
        totals.total += r.total;
        totals.poisoned += r.poisoned;
        totals.enriched += r.enriched;
        totals.cleared += r.cleared;
        totals.fabricatedMatch += r.fabricatedMatch;
        totals.barryRegenerated += r.barryRegenerated;

        if (r.poisoned > 0 || r.fabricatedMatch > 0) {
          perUser.push({ userId: uid.slice(0, 8) + '...', ...r, samples: r.samples.slice(0, 3) });
        }
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: true,
          dryRun,
          ...totals,
          perUser: perUser.slice(0, 20),
          message: dryRun
            ? `Dry run across ${totals.users} users: ${totals.poisoned} poisoned, ${totals.enriched} enrichable, ${totals.cleared} to clear, ${totals.fabricatedMatch} fabricated matches, ${totals.barryRegenerated} barry_intel to regenerate.`
            : `Backfill complete across ${totals.users} users: ${totals.enriched} enriched, ${totals.cleared} cleared, ${totals.barryRegenerated} barry_intel regenerated.`,
        }),
      };
    }

    if (!userId || !authToken) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Provide userId/authToken or allUsers/adminKey' }) };
    }

    await verifyAuthToken(authToken, userId);
    const icpProfile = await loadActiveIcpProfile(userId);
    const results = await backfillUser(userId, icpProfile, dryRun);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        dryRun,
        ...results,
        message: dryRun
          ? `Dry run: ${results.poisoned} of ${results.total} need fixing. ${results.enriched} enrichable, ${results.cleared} to clear. ${results.barryRegenerated} barry_intel to regenerate. ${results.fabricatedMatch} fabricated matches flagged.`
          : `Backfill complete: ${results.enriched} enriched, ${results.cleared} cleared, ${results.barryRegenerated} barry_intel regenerated.`,
      }),
    };
  } catch (error) {
    console.error('Backfill error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
