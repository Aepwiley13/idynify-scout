# SMS / Text Message Setup Guide

## Overview
The Hunter Weapon Room now includes **Text Message** as an available weapon. This feature uses Twilio for SMS delivery.

## Current Status
✅ **Built:**
- TextWeapon UI component (complete 5-step flow)
- Contact filtering (only shows contacts with phone numbers)
- AI message generation optimized for SMS (160-306 character limits)
- Character count display
- Campaign creation for SMS

⏳ **Requires Setup:**
- Twilio account configuration
- SMS sending function
- Webhook for delivery status

---

## What You Need to Complete SMS Integration

### 1. Twilio Account Setup

**Create Twilio Account:**
1. Go to [twilio.com/try-twilio](https://www.twilio.com/try-twilio)
2. Sign up for free account (includes trial credits)
3. Verify your identity

**Purchase a Phone Number:**
1. Go to Phone Numbers → Buy a Number
2. Select a number with SMS capabilities
3. Cost: ~$1/month + $0.0075 per SMS sent

**Get Credentials:**
- Account SID: `ACxxxxxxxxxxxxx`
- Auth Token: `xxxxxxxxxxxxx`
- Phone Number: `+1234567890`

---

### 2. Store Twilio Credentials in Firestore

**Document Path:**
```
/users/{userId}/integrations/twilio
```

**Document Structure:**
```json
{
  "status": "connected",
  "accountSid": "ACxxxxxxxxxxxxx",
  "authToken": "xxxxxxxxxxxxx",  // Encrypt in production!
  "phoneNumber": "+1234567890",
  "connectedAt": "2024-01-15T10:30:00Z"
}
```

**Security Note:** In production, encrypt auth tokens or use a secrets manager.

---

### 3. Create Send SMS Function

**File:** `/netlify/functions/send-text-message.js`

**Required Logic:**
```javascript
const twilio = require('twilio');

exports.handler = async (event) => {
  // 1. Verify user auth
  // 2. Fetch user's Twilio credentials from Firestore
  // 3. Initialize Twilio client
  const client = twilio(accountSid, authToken);

  // 4. Send SMS
  const message = await client.messages.create({
    body: smsBody,
    from: twilioPhoneNumber,
    to: recipientPhone
  });

  // 5. Update campaign status in Firestore
  // 6. Return success
};
```

**Dependencies:**
```bash
npm install twilio
```

---

### 4. Update CampaignDetail.jsx for SMS

**Add SMS Send Support:**
- Current: Only handles email sending
- Needed: Detect `campaign.weapon === 'text'` and call send-text-message function
- Display phone numbers instead of emails

---

### 5. SMS Delivery Webhooks (Optional but Recommended)

**Twilio Webhook Setup:**
1. Go to Twilio Console → Phone Numbers → Your Number
2. Set "A Message Comes In" webhook to:
   ```
   https://your-site.netlify.app/.netlify/functions/twilio-webhook
   ```
3. Method: HTTP POST

**Create Webhook Handler:**
```javascript
// /netlify/functions/twilio-webhook.js
exports.handler = async (event) => {
  const { MessageSid, MessageStatus, To, From } = event.body;

  // Update campaign contact status:
  // - 'delivered' = successfully delivered
  // - 'failed' = delivery failed
  // - 'undelivered' = carrier rejected

  // Find campaign & update contact status in Firestore
};
```

---

## Environment Variables Needed

Add to Netlify:
```bash
# Not needed if storing per-user in Firestore
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890
```

---

## Cost Estimation

**Twilio Pricing:**
- Phone Number: $1.00/month
- SMS Sent (US): $0.0075 per message
- SMS Received: $0.0075 per message

**Example:**
- 1,000 SMS sent = $7.50
- Monthly phone rental = $1.00
- **Total: $8.50/month** for 1,000 outbound texts

---

## Testing Checklist

**Before Launch:**
- [ ] Twilio account created
- [ ] Phone number purchased
- [ ] Credentials stored in Firestore
- [ ] send-text-message function created
- [ ] CampaignDetail updated for SMS
- [ ] Test message sent successfully
- [ ] Delivery status webhook working
- [ ] Character limits enforced (160/306)
- [ ] Phone number validation working

---

## Current User Experience

**What Works Now:**
1. User clicks Text Message weapon
2. Selects contacts (filtered to those with phone numbers)
3. Sets engagement intent
4. AI generates optimized SMS messages (< 160 chars)
5. User reviews and edits
6. Campaign is created in Firestore

**What Happens When User Tries to Send:**
- Campaign is saved as "draft"
- User goes to CampaignDetail page
- **Needs:** "Send" button for SMS (currently only email send is implemented)

---

## Next Steps

1. **Immediate:**
   - Set up Twilio account
   - Store credentials in Firestore for your user
   - Create `send-text-message.js` function

2. **Short Term:**
   - Update CampaignDetail.jsx to handle SMS sending
   - Add delivery webhooks

3. **Future:**
   - SMS templates
   - MMS support (images)
   - Two-way SMS conversations
   - Opt-out management (REQUIRED for compliance)
   - TCPA compliance features

---

## Compliance Notes

**IMPORTANT:** SMS requires consent!

**Legal Requirements:**
- Recipients must opt-in to receive texts
- Must provide opt-out mechanism (reply STOP)
- Must identify sender
- Must comply with TCPA regulations

**Recommended Approach:**
- Only text contacts who have consented
- Include opt-out language: "Reply STOP to unsubscribe"
- Implement automated STOP handling
- Log all consent records

---

## Questions?

Contact support or reference:
- [Twilio Documentation](https://www.twilio.com/docs/sms)
- [TCPA Compliance Guide](https://www.twilio.com/docs/glossary/what-is-tcpa)
