import { db, admin } from './firebase-admin.js';
import { verifyAuthToken } from './utils/verifyAuthToken.js';
import { FieldValue } from 'firebase-admin/firestore';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { userId, authToken, dryRun = true } = JSON.parse(event.body);
    if (!userId || !authToken) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId or authToken' }) };
    }

    await verifyAuthToken(authToken, userId);

    const companiesRef = db.collection('users').doc(userId).collection('companies');
    const snapshot = await companiesRef.get();

    const poisonValues = ['Unknown', 'Unknown Industry', 'unknown', 'null'];
    const results = { total: 0, affected: 0, enrichable: 0, cleared: 0, samples: [] };

    const batch = db.batch();
    let batchCount = 0;

    for (const doc of snapshot.docs) {
      results.total++;
      const data = doc.data();
      const currentIndustry = data.industry;

      if (!currentIndustry || poisonValues.includes(currentIndustry)) {
        results.affected++;
        const enrichedIndustry = data.apolloEnrichment?.snapshot?.industry;

        const update = {};
        if (enrichedIndustry) {
          update.industry = enrichedIndustry;
          results.enrichable++;
        } else {
          update.industry = FieldValue.delete();
          results.cleared++;
        }

        if (results.samples.length < 10) {
          results.samples.push({
            id: doc.id,
            name: data.name,
            was: currentIndustry || '(empty)',
            now: enrichedIndustry || '(deleted)',
          });
        }

        if (!dryRun) {
          batch.update(doc.ref, update);
          batchCount++;
          if (batchCount >= 400) {
            await batch.commit();
            batchCount = 0;
          }
        }
      }
    }

    if (!dryRun && batchCount > 0) {
      await batch.commit();
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        dryRun,
        ...results,
        message: dryRun
          ? `Dry run: ${results.affected} of ${results.total} companies have bad industry data. ${results.enrichable} can be fixed from enrichment, ${results.cleared} will be cleared.`
          : `Backfill complete: fixed ${results.enrichable}, cleared ${results.cleared} of ${results.affected} affected records.`,
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
