import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { auth } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import ContactHubPhotoHeader from './ContactHubPhotoHeader';
import { useT } from '../../theme/ThemeContext';
import './ContactHubGmail.css';

const enabled = import.meta.env.VITE_CONTACT_HUB_GMAIL === 'on';
const feedback = {
  sending_disabled: 'Sending is disabled in this environment.',
  app_limit: 'You’ve reached the Contact Hub sending limit. Try again later.',
  gmail_quota: 'Gmail’s sending limit has been reached. Try again later.',
  gmail_rejected: 'Gmail declined this email. Review the message and try again.',
  connect_gmail: 'Your Gmail connection needs attention. Connect Gmail to continue.',
  recipient_changed: 'The saved email address changed. Reopen the composer to check the new address.',
  sender_changed: 'The connected Gmail account changed. Reopen the composer to check the sending address.',
  read_only: 'Sending is unavailable in this session.',
  missing_email: 'This contact no longer has a usable saved email address.',
  activity_unavailable: 'Email sent. The activity entry could not be saved.',
};
const uncertain = 'Gmail hasn’t confirmed the send. Check your Sent folder before starting another email.';

async function request(uid, contactId, action, fields, isActive) {
  const user = auth.currentUser;
  const permitted = () => {
    const effective = getEffectiveUser();
    return isActive() && user?.uid === uid && auth.currentUser === user
      && effective?.uid === uid && !effective._isImpersonated;
  };
  const assertOwner = () => {
    if (!permitted()) throw Object.assign(new Error('Account changed'), { code: 'read_only' });
  };
  assertOwner();
  const token = await user.getIdToken();
  assertOwner();
  let response;
  let result;
  try {
    response = await fetch('/.netlify/functions/contact-hub-gmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ uid, contactId, action, ...fields }),
    });
    result = await response.json();
  } catch {
    throw Object.assign(new Error('Gmail request interrupted'), { uncertain: action === 'send' });
  }
  assertOwner();
  if (!response.ok) {
    throw Object.assign(new Error('Gmail request failed'), { code: result.error, uncertain: response.status >= 500 });
  }
  return result;
}

function openGoogleConsent(url) {
  if (new URL(url).origin !== 'https://accounts.google.com') throw new Error('Unexpected Gmail URL');
  window.location.assign(url);
}

function Compose({ uid, contactId, onClose, failedConnection, completion, openConsent = openGoogleConsent }) {
  const T = useT();
  const storageKey = `contact-hub-gmail-pending:${JSON.stringify([uid, contactId])}`;
  const [needsReview, setNeedsReview] = useState(() => Boolean(sessionStorage.getItem(storageKey)));
  const [connection, setConnection] = useState(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState(failedConnection ? 'Gmail connection was interrupted. You can try again.' : '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const dialog = useRef(null);
  const inFlight = useRef(false);
  const active = useRef(false);

  useEffect(() => {
    active.current = true;
    dialog.current.showModal();
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    const permitted = () => active.current && current;
    const finish = completion ? request(uid, contactId, 'finish_connect', { completion }, permitted)
      .catch(() => { if (current) setNotice('The Gmail connection could not be completed in this session.'); }) : Promise.resolve();
    finish.then(() => request(uid, contactId, 'status', {}, permitted))
      .then((result) => { if (current) setConnection(result); })
      .catch((error) => { if (current) setNotice(feedback[error.code] || 'Gmail is temporarily unavailable.'); });
    return () => { current = false; };
  }, [uid, contactId, completion]);

  async function connect() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const { url } = await request(uid, contactId, 'connect', {}, () => active.current);
      openConsent(url);
    } catch (error) {
      if (active.current) {
        setNotice(feedback[error.code] || 'Could not start the Gmail connection.');
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  async function send(event) {
    event.preventDefault();
    if (inFlight.current || needsReview || sent || !connection?.connected || !subject.trim() || !message.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setNotice('');
    try {
      const requestId = crypto.randomUUID();
      sessionStorage.setItem(storageKey, requestId);
      const result = await request(uid, contactId, 'send', { requestId, recipient: connection.recipient, sender: connection.sender, subject, message }, () => active.current);
      if (result.status === 'sent' || result.status === 'rejected') sessionStorage.removeItem(storageKey);
      if (!active.current) return;
      if (result.status === 'sent') {
        setSent(true);
      } else if (result.status !== 'rejected') setNeedsReview(true);
      if (result.reason === 'connect_gmail') setConnection((previous) => ({ ...previous, connected: false }));
      setNotice(result.status === 'sent' ? feedback[result.reason] || 'Email sent.' : feedback[result.reason] || '');
    } catch (error) {
      if (error.uncertain || !active.current) {
        if (active.current) setNeedsReview(true);
      } else {
        sessionStorage.removeItem(storageKey);
        if (error.code === 'connect_gmail') setConnection((previous) => ({ ...previous, connected: false }));
        setNotice(feedback[error.code] || 'Email could not be sent. Try again.');
      }
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="hub-gmail-dialog" aria-labelledby="hub-gmail-title"
      style={{ '--hub-gmail-border': T.border, '--hub-gmail-background': T.cardBg, '--hub-gmail-text': T.text, '--hub-gmail-accent': T.accent }}
      onCancel={(event) => {
      event.preventDefault();
      if (!busy) onClose();
    }}>
      <form onSubmit={send}>
        <h2 id="hub-gmail-title">Email contact</h2>
        {connection?.recipient && <p>To {connection.recipient}</p>}
        {connection?.connected && connection.sender && <p>From {connection.sender}</p>}
        {connection?.connected && !sent && (
          <fieldset disabled={busy || needsReview}>
            <label>Subject<input required maxLength={160} value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
            <label>Message<textarea required rows={5} maxLength={20000} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
          </fieldset>
        )}
        <p role="status">{needsReview ? uncertain : notice}</p>
        <div className="hub-gmail-actions">
          <button type="button" disabled={busy} onClick={onClose}>{sent ? 'Close' : 'Cancel'}</button>
          {needsReview && <button type="button" onClick={() => {
            sessionStorage.removeItem(storageKey);
            setNeedsReview(false);
            setSubject('');
            setMessage('');
          }}>I checked Gmail Sent</button>}
          {!needsReview && connection && !connection.connected && <button type="button" disabled={busy} onClick={connect}>Connect Gmail</button>}
          {!needsReview && connection?.connected && !sent && <button type="submit" disabled={busy || !subject.trim() || !message.trim()}>{busy ? 'Sending…' : 'Send email'}</button>}
        </div>
      </form>
    </dialog>
  );
}

export default function ContactHubGmailHeader(props) {
  const { uid, contact, readOnly, openConsent, ...headerProps } = props;
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const available = enabled && Boolean(uid) && !readOnly;
  const returned = params.get('compose') === 'email';

  function close() {
    setOpen(false);
    if (returned) {
      const next = new URLSearchParams(params);
      next.delete('compose');
      next.delete('gmail');
      next.delete('gmail_connection');
      setParams(next, { replace: true });
    }
  }

  return (
    <>
      <ContactHubPhotoHeader {...headerProps} uid={uid} contact={contact} readOnly={readOnly} onEmail={available ? () => setOpen(true) : undefined} />
      {available && (open || returned) && <Compose uid={uid} contactId={contact.id} onClose={close} failedConnection={params.get('gmail') === 'failed'} completion={params.get('gmail_connection')} openConsent={openConsent} />}
    </>
  );
}
