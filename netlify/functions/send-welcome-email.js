// Welcome Email for New Signups
// Sends personal welcome email from Aaron with getting started guide

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email, userId } = JSON.parse(event.body);

    if (!email || !userId) {
      throw new Error('Email and userId are required');
    }

    const resendApiKey = process.env.RESEND_API_KEY;

    if (!resendApiKey) {
      console.error('❌ RESEND_API_KEY not configured');
      throw new Error('Email service not configured');
    }

    console.log(`📧 Sending welcome email to: ${email}`);

    // Send welcome email via Resend
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify({
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
                  <a href="https://app.idynify.com/getting-started"
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

    console.log(`✅ Welcome email sent successfully to ${email}`);

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
