import { admin, db } from './firebase-admin.js';

// Welcome Email for New Signups
// Sends personal welcome email from Aaron with getting started guide

/**
 * The Free plan's welcome (billing Phase 1a). A Free signup has no Scout access, so the Scout
 * walkthrough below would send them to a paid page; theirs points to their Contact Hub instead.
 * The public handler derives the plan and recipient from Firebase Auth and Firestore.
 * COPY FOR OWNER REVIEW before the Free plan launches.
 */
export function freeWelcomeEmail(baseUrl) {
  return {
    subject: 'Welcome to Idynify — your Contact Hub is ready',
    html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #374151; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
              <div style="background: #ffffff; padding: 32px 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                <p style="font-size: 16px; margin: 0 0 16px 0;">Hi — I'm Aaron, the founder of Idynify. Thanks for joining.</p>
                <p style="font-size: 16px; margin: 0 0 16px 0;">Your Contact Hub is ready. It's free: add the people you know, organize them with stickers, and keep notes on each of them. Your contacts stay yours.</p>
                <p style="font-size: 16px; margin: 0 0 24px 0;">When you want prospecting and outreach, Scout is one click away inside the app.</p>
                <div style="text-align: center; margin: 24px 0;">
                  <a href="${baseUrl}/contact-hub"
                     style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                    Open your Contact Hub
                  </a>
                </div>
                <p style="font-size: 14px; color: #6b7280; margin: 24px 0 0 0;">Reply to this email any time. It comes straight to me.</p>
              </div>
            </body>
          </html>
        `,
  };
}

const sendWelcomeEmail = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email, userId, plan } = JSON.parse(event.body);

    if (!email || !userId) {
      throw new Error('Email and userId are required');
    }

    const resendApiKey = process.env.RESEND_API_KEY;

    if (!resendApiKey) {
      console.error('❌ RESEND_API_KEY not configured');
      throw new Error('Email service not configured');
    }

    console.log('[welcome-email] Sending authenticated welcome email');

    // Send welcome email via Resend
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify(plan === 'free' ? {
        from: 'Aaron Wiley <aaron@idynify.com>',
        to: email,
        ...freeWelcomeEmail(process.env.URL),
      } : {
        from: 'Aaron Wiley <aaron@idynify.com>',
        to: email,
        subject: 'Hi — I\'m Aaron, the founder of Idynify 👋',
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #374151; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">

              <!-- Header -->
              <div style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 40px 30px; border-radius: 12px 12px 0 0; text-align: center;">
                <div style="font-size: 48px; margin-bottom: 10px;">🐻</div>
                <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">Welcome to Idynify</h1>
              </div>

              <!-- Content -->
              <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">

                <p style="font-size: 16px; color: #111827; margin: 0 0 20px 0;">
                  Hi —
                </p>

                <p style="font-size: 16px; color: #374151; margin: 0 0 20px 0;">
                  I built Idynify because prospecting shouldn't feel like busy work. It should feel focused, simple, and even a little fun. That's where Barry AI comes in — he does the heavy lifting so you can spend your time actually talking to the right people.
                </p>

                <p style="font-size: 16px; color: #374151; margin: 0 0 30px 0;">
                  Here's how to get started quickly:
                </p>

                <!-- Getting Started Steps -->
                <div style="background: #f9fafb; border-left: 4px solid #3b82f6; padding: 20px; margin-bottom: 30px; border-radius: 8px;">
                  <div style="margin-bottom: 15px;">
                    <strong style="color: #1e40af; font-size: 16px;">1️⃣ Start in Scout</strong>
                    <p style="margin: 5px 0 0 0; color: #6b7280; font-size: 15px;">
                      Scout finds companies for you daily. All you have to do is approve or reject them and pick the right contacts. That's it.
                    </p>
                  </div>

                  <div style="margin-bottom: 15px;">
                    <strong style="color: #1e40af; font-size: 16px;">2️⃣ Use Recon to make Barry smarter</strong>
                    <p style="margin: 5px 0 0 0; color: #6b7280; font-size: 15px;">
                      Recon helps train Barry AI so Scout gets better recommendations over time. You don't need to live there — just update it when things change.
                    </p>
                  </div>

                  <div style="margin-bottom: 0;">
                    <strong style="color: #1e40af; font-size: 16px;">3️⃣ Make it a daily habit</strong>
                    <p style="margin: 5px 0 0 0; color: #6b7280; font-size: 15px;">
                      A few minutes a day in Scout beats hours of manual prospecting.
                    </p>
                  </div>
                </div>

                <p style="font-size: 16px; color: #374151; margin: 0 0 30px 0;">
                  👉 Click below for a quick walkthrough of how Scout and Recon work together.
                </p>

                <!-- CTA Button -->
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${process.env.URL}/getting-started"
                     style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);">
                    See how Scout & Recon work
                  </a>
                </div>

                <p style="font-size: 16px; color: #374151; margin: 30px 0 10px 0;">
                  I'm excited to have you here.<br>
                  Let's build your pipeline the right way.
                </p>

                <p style="font-size: 16px; color: #111827; font-weight: 600; margin: 10px 0 0 0;">
                  — Aaron<br>
                  <span style="font-size: 14px; color: #6b7280; font-weight: 400;">Founder, Idynify</span>
                </p>

                <!-- Footer -->
                <div style="margin-top: 40px; padding-top: 30px; border-top: 1px solid #e5e7eb;">
                  <p style="font-size: 13px; color: #9ca3af; margin: 0; text-align: center;">
                    Idynify • AI-Powered Lead Generation<br>
                    Questions? Just reply to this email.
                  </p>
                </div>

              </div>

            </body>
          </html>
        `
      })
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error('❌ Email send failed:', errorText);
      throw new Error('Failed to send welcome email');
    }

    const result = await emailResponse.json();

    console.log('[welcome-email] Welcome email sent');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({
        success: true,
        message: 'Welcome email sent',
        emailId: result.id
      })
    };

  } catch (error) {
    console.error('💥 Error sending welcome email:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};


/**
 * Customer-facing entrypoint. The private renderer above is preserved for
 * compatibility with the existing paid and Free email layouts; it is never
 * exported as a public Netlify handler.
 *
 * Only the signed-in user's own Firebase Auth address can receive this
 * welcome. The client's email, uid, and plan fields are ignored.
 *
 * At most one send ATTEMPT per uid: a transaction claims welcomeEmailDeliveries
 * before Resend is called. On ambiguous provider failure we intentionally do
 * not auto-retry, because it could send twice. Owner-only recovery can be built
 * later if needed. No Firestore security-rule change is required: this new
 * top-level collection has no client allow rule (default deny).
 */
const json = (statusCode, data) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const authorization = event.headers?.authorization || event.headers?.Authorization || '';
  const token = /^Bearer (\S+)$/.exec(authorization)?.[1];
  if (!token) return json(401, { error: 'authentication_required' });

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch {
    return json(401, { error: 'invalid_authentication' });
  }
  if (!decoded?.uid) return json(401, { error: 'invalid_authentication' });

  let firebaseUser;
  let accountSnapshot;
  try {
    [firebaseUser, accountSnapshot] = await Promise.all([
      admin.auth().getUser(decoded.uid),
      db.collection('users').doc(decoded.uid).get(),
    ]);
  } catch {
    return json(503, { error: 'account_unavailable' });
  }
  const email = firebaseUser?.email;
  const account = accountSnapshot?.exists ? accountSnapshot.data() : null;
  if (typeof email !== 'string' || typeof account?.email !== 'string'
      || account.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    return json(403, { error: 'account_mismatch' });
  }
  const paidSignup = ['starter', 'pro'].includes(account.selectedTier)
    || ['starter', 'pro'].includes(account.subscriptionTier);
  const plan = paidSignup ? 'paid' : 'free';

  if (!process.env.RESEND_API_KEY) {
    return json(503, { error: 'welcome_email_unavailable' });
  }
  const claimRef = db.collection('welcomeEmailDeliveries').doc(decoded.uid);
  let claimed;
  try {
    claimed = await db.runTransaction(async (transaction) => {
      const prior = await transaction.get(claimRef);
      if (prior.exists) return false;
      transaction.create(claimRef, {
        uid: decoded.uid,
        email,
        plan,
        status: 'claimed',
        claimedAt: new Date().toISOString(),
      });
      return true;
    });
  } catch {
    return json(503, { error: 'welcome_email_unavailable' });
  }
  if (!claimed) return json(200, { success: true, alreadyRequested: true });

  let sendResult;
  try {
    sendResult = await sendWelcomeEmail({
      ...event,
      body: JSON.stringify({ email, userId: decoded.uid, plan }),
    });
  } catch (error) {
    console.error('[welcome-email] Provider request failed:', error?.message);
    sendResult = json(502, { error: 'welcome_email_delivery_failed' });
  }

  // Do not retry automatically if Resend failed or timed out: that might
  // send a duplicate welcome. The claim remains permanently occupied.
  try {
    await claimRef.set({
      status: sendResult.statusCode === 200 ? 'sent' : 'failed',
      finishedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (error) {
    console.error('[welcome-email] Could not update the send record:', error?.message);
  }
  return sendResult;
};
