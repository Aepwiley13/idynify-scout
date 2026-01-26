const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
}

const db = admin.firestore();

// Terminal outcomes that lock the tracker
const TERMINAL_OUTCOMES = ['meeting_booked', 'opportunity_created'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { campaignId, contactId, outcome, idToken } = JSON.parse(event.body);

    // Verify Firebase auth token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    const campaignRef = db.collection(`users/${userId}/campaigns`).doc(campaignId);
    const campaignDoc = await campaignRef.get();

    if (!campaignDoc.exists) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Campaign not found' })
      };
    }

    const campaign = campaignDoc.data();
    const contact = campaign.contacts.find(c => c.contactId === contactId);

    if (!contact) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Contact not found in campaign' })
      };
    }

    // GUARDRAIL: Prevent changes to locked outcomes
    if (contact.outcomeLocked) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Outcome is locked',
          message: 'Terminal outcomes (meeting booked, opportunity created) cannot be changed'
        })
      };
    }

    // Fetch contact data
    const contactRef = db.collection(`users/${userId}/contacts`).doc(contactId);
    const contactDoc = await contactRef.get();
    const contactData = contactDoc.exists ? contactDoc.data() : {};

    // CRITICAL: Use campaign.reconSectionsUsed (what was actually used)
    // NOT globally completed RECON sections
    const reconSectionsUsed = campaign.reconSectionsUsed || {};

    // Fetch only the RECON sections that were used in this campaign
    const reconRef = db.collection(`dashboards/${userId}/modules`).doc('recon');
    const reconDoc = await reconRef.get();
    const reconOutputs = {};

    if (reconDoc.exists && reconDoc.data().sections) {
      const allReconSections = reconDoc.data().sections;

      // Only include sections that were actually used in the campaign
      for (const [sectionKey, wasUsed] of Object.entries(reconSectionsUsed)) {
        if (wasUsed && allReconSections[sectionKey]?.output) {
          reconOutputs[sectionKey] = allReconSections[sectionKey].output;
        }
      }
    }

    // Create learning record
    const learningData = {
      userId,
      campaignId,
      contactId,

      // Context used
      engagementIntent: campaign.engagementIntent || 'cold',
      weapon: campaign.weapon || 'email',
      reconSectionsUsed, // Exactly what was used in campaign
      reconOutputs, // Only outputs from used sections
      barryContextUsed: contactData.barryContext || {},
      templateUsed: campaign.templateUsed || null,

      // Contact context
      contactTitle: contactData.title || '',
      contactSeniority: contactData.seniority || '',
      contactDepartment: contactData.department || '',
      companyName: contactData.company_name || '',
      companyIndustry: contactData.company_industry || '',
      companySize: contactData.company_size || '',

      // Engagement data
      sentAt: contact.sentAt,
      subject: contact.subject,

      // Outcome
      outcome,
      outcomeMarkedAt: admin.firestore.FieldValue.serverTimestamp(),
      outcomeMethod: 'user',

      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Store learning
    await db.collection('learnings').add(learningData);

    // Check if this is a terminal outcome
    const isTerminal = TERMINAL_OUTCOMES.includes(outcome);

    // Update campaign contact
    const updatedContacts = campaign.contacts.map(c =>
      c.contactId === contactId
        ? {
            ...c,
            outcome,
            outcomeMarkedAt: admin.firestore.FieldValue.serverTimestamp(),
            outcomeLocked: isTerminal, // Lock if terminal
            outcomeLockedAt: isTerminal ? admin.firestore.FieldValue.serverTimestamp() : null
          }
        : c
    );

    await campaignRef.update({
      contacts: updatedContacts,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update contact record
    await contactRef.update({
      lastOutcome: outcome,
      lastEngagedAt: contact.sentAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Outcome tracked successfully',
        locked: isTerminal
      })
    };

  } catch (error) {
    console.error('Error tracking outcome:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to track outcome',
        details: error.message
      })
    };
  }
};
