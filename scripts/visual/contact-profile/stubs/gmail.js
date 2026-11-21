import { emailOf } from '../../../../src/utils/savedContactEmail';
import { setDoc } from './firestore';
import { fixture, log, wait } from './fixture';

const path = '/.netlify/functions/contact-hub-gmail';
const sender = 'review-sender@example.org';
const respond = (data, status = 200) => Promise.resolve(Response.json(data, { status }));

export function configureGmailFixture(contacts) {
  const connected = () => sessionStorage.getItem('fixture-gmail-connected') === '1';
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    if (input !== path) return originalFetch(input, options);
    const { action, uid, contactId, recipient, subject, requestId } = JSON.parse(options.body);
    const to = emailOf(contacts[contactId])?.address;
    if (fixture.readonly || uid !== 'u1' || !to) return respond({ error: 'read_only' }, 403);
    if (action === 'status') return respond({ connected: connected(), recipient: to, sender: connected() ? sender : null });
    if (action === 'connect') {
      const url = new URL(window.location.href);
      url.searchParams.set('contact', contactId);
      url.searchParams.set('compose', 'email');
      url.searchParams.set('gmail_connection', contactId);
      return respond({ url: url.href });
    }
    if (action === 'finish_connect') {
      sessionStorage.setItem('fixture-gmail-connected', '1');
      return respond({ status: 'connected' });
    }
    if (action !== 'send' || !connected() || recipient !== to) return respond({ error: 'recipient_changed' }, 409);
    const outcome = fixture.gmailOutcome;
    fixture.gmailOutcome = 'sent';
    const eventPath = `users/${uid}/contacts/${contactId}/timeline/${requestId}`;
    log({ kind: 'simulated email', path: eventPath, fields: to });
    await wait();
    if (outcome === 'retry') return respond({ status: 'rejected', reason: 'gmail_rejected' });
    if (outcome === 'unknown') return respond({ status: 'unknown', reason: 'send_unconfirmed' });
    if (outcome === 'quota') return respond({ error: 'app_limit' }, 429);
    if (outcome === 'gmailQuota') return respond({ status: 'rejected', reason: 'gmail_quota' });
    await setDoc({ path: eventPath }, {
      type: 'message_sent', actor: 'user', preview: subject, createdAt: new Date().toISOString(),
      metadata: { channel: 'email', source: 'contact_hub_manual' },
    });
    return respond({ status: 'sent' });
  };
}

export function openFixtureConsent(url) {
  const destination = new URL(url);
  if (destination.origin !== window.location.origin || destination.pathname !== window.location.pathname) {
    throw new Error('Fixture can only return to itself');
  }
  window.location.assign(destination);
}
