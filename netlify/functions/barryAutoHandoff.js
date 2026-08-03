import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './utils/logApiUsage.js';
import { db } from './firebase-admin.js';
import { APOLLO_ENDPOINTS, getApolloHeaders } from './utils/apolloConstants.js';
import { expandTitlesWithSynonyms } from './utils/titleSynonyms.js';

async function discoverContacts(organizationId, targetTitles) {
  if (!organizationId || !targetTitles?.length) return [];

  const expandedTitles = expandTitlesWithSynonyms(targetTitles);

  const response = await fetch(APOLLO_ENDPOINTS.PEOPLE_SEARCH, {
    method: 'POST',
    headers: getApolloHeaders(),
    body: JSON.stringify({
      organization_ids: [organizationId],
      person_titles: expandedTitles,
      page: 1,
      per_page: 3
    })
  });

  if (!response.ok) return [];
  const data = await response.json();
  return (data.people || []).slice(0, 3).map(p => ({
    name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    email: p.email,
    title: p.title,
    linkedin_url: p.linkedin_url,
    apollo_person_id: p.id,
    organization_id: organizationId
  }));
}

async function generateOutreachDraft(contact, company, icpProfile, claudeApiKey) {
  const anthropic = new Anthropic({ apiKey: claudeApiKey });

  const prompt = [
    'Generate a personalized cold outreach email for B2B sales.',
    '',
    `CONTACT: ${contact.name}, ${contact.title || 'Professional'} at ${company.name}`,
    `COMPANY: ${company.name} — ${company.industry || 'technology'}, ${company.employee_count || '?'} employees`,
    '',
    `SELLER VALUE PROP: ${icpProfile.valueProposition || 'We help businesses grow.'}`,
    `PAIN POINTS: ${(icpProfile.painPoints || []).join(', ') || 'Not specified'}`,
    '',
    'REQUIREMENTS:',
    '- Subject line: relevant, non-salesy, max 50 characters',
    '- Body: 4-5 sentences, conversational, genuine',
    '- Clear CTA: suggest a brief call',
    '- No buzzwords',
    '',
    'Format:',
    'SUBJECT: [subject]',
    'BODY:',
    '[email body]'
  ].join('\n');

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
    system: 'You are a B2B sales email writer. Write short, personalized outreach emails.'
  });

  const text = message.content[0]?.text || '';
  const subjectMatch = text.match(/SUBJECT:\s*(.+)/);
  const bodyMatch = text.match(/BODY:\s*([\s\S]+)/);

  return {
    subject: subjectMatch?.[1]?.trim() || 'Quick question',
    body: bodyMatch?.[1]?.trim() || text
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
    const { userId, authToken, companyId, companyData, icpId } = JSON.parse(event.body);

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

    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Claude API key not configured' }) };

    let company = companyData;
    if (!company && companyId) {
      const snap = await db.collection('users').doc(userId).collection('companies').doc(companyId).get();
      if (snap.exists) company = { id: snap.id, ...snap.data() };
    }
    if (!company) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Company not found' }) };

    let icpProfile = {};
    if (icpId) {
      const snap = await db.collection('users').doc(userId).collection('icpProfiles').doc(icpId).get();
      if (snap.exists) icpProfile = snap.data();
    } else {
      const snap = await db.collection('users').doc(userId).collection('companyProfile').doc('current').get();
      if (snap.exists) icpProfile = snap.data();
    }

    const targetTitles = icpProfile.targetTitles || [];
    const orgId = company.apollo_organization_id || company.organization_id;

    const contacts = await discoverContacts(orgId, targetTitles);
    const drafts = [];

    for (const contact of contacts) {
      const contactId = `contact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await db.collection('users').doc(userId).collection('contacts').doc(contactId).set({
        ...contact,
        company_id: companyId || company.id,
        company_name: company.name,
        lead_owner: userId,
        status: 'barry_staged',
        source: 'barry_auto_handoff',
        saved_at: new Date().toISOString()
      });

      const { subject, body } = await generateOutreachDraft(contact, company, icpProfile, claudeApiKey);
      const draftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const draft = {
        contactId,
        companyId: companyId || company.id,
        companyName: company.name,
        contactName: contact.name,
        contactEmail: contact.email,
        subject,
        body,
        originalBody: body,
        status: 'pending_review',
        barryConfidence: 'high',
        editDistance: 0,
        generatedAt: new Date().toISOString()
      };

      await db.collection('users').doc(userId).collection('barryDrafts').doc(draftId).set(draft);
      drafts.push({ draftId, ...draft });
    }

    await logApiUsage(userId, 'barryAutoHandoff', 'success', {
      metadata: { companyName: company.name, contactsFound: contacts.length, draftsGenerated: drafts.length }
    }).catch(() => {});

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, contacts: contacts.length, drafts })
    };

  } catch (error) {
    console.error('barryAutoHandoff error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
}
