import { useEffect, useRef, useState } from 'react';
import { personName } from '../peopleRules';

const BLOCKERS = {
  private_photo_requires_transfer: 'Private photo provenance needs a supported transfer.',
  reminder_requires_transfer: 'Reminder or reminder queue data needs a supported transfer.',
  identity_not_verified: 'The available evidence cannot verify the identity match.',
  conflicting_identity: 'The authoritative identifiers differ.',
  email_permission_requires_review: 'Email permissions need verification.',
  unresolved_gmail_attempt: 'A Gmail send needs reconciliation.',
  previous_merge_requires_review: 'This contact already contains merged records.',
  unclassified_child_records: 'Some contact subcollections need a verified transfer.',
  unclassified_source_fields: 'Some contact fields have no verified transfer policy.',
  unsupported_contact_status: 'One contact is in an unsupported lifecycle state.',
  unsupported_worker_reference: 'Related worker records need review.',
  unsupported_outreach_scope: 'Existing outreach records need review.',
  unsupported_worker_history: 'Worker history needs a supported transfer.',
  plan_limit: 'The records exceed the supported atomic merge size.',
};

const message = (error) => ({
  preview_changed: 'The contacts or related records changed. Request a fresh preview.',
  execution_disabled: 'Merge execution is disabled in this environment.',
  rollback_changed: 'The records changed. Automatic rollback is unavailable.',
  rollback_expired: 'The seven-day rollback window has ended.',
})[error.message] ?? 'The operation could not be confirmed. You can retry.';

export default function TrustedMergeReview({ pair, request, onMerged, existingReceipt }) {
  const [survivor, setSurvivor] = useState('');
  const [choices, setChoices] = useState({});
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState(existingReceipt ?? null);
  const [rollbackPlan, setRollbackPlan] = useState(null);
  const [uncertain, setUncertain] = useState(false);
  const intent = useRef(null);
  const pending = useRef(false);
  const live = useRef(false);
  const [left, right] = pair?.contacts ?? [];
  const inputs = { survivorId: survivor, sourceId: survivor === left?.id ? right?.id : left?.id, choices };
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  async function run(task, mayCommit = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice('');
    try { await task(); } catch (error) {
      if (live.current) {
        setNotice(message(error));
        if (mayCommit) setUncertain(true);
      }
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }

  const call = (action, fields) => request(action, fields, () => live.current);
  function preview() {
    return run(async () => { const result = await call('preview', inputs); if (live.current) setPlan(result); });
  }
  function commit() {
    intent.current ??= { ...inputs, token: plan.token, operationId: crypto.randomUUID() };
    return run(async () => {
      const result = await call('commit', intent.current);
      if (live.current) {
        setReceipt(result.receipt);
        setUncertain(false);
      }
    }, true);
  }
  if (receipt) return <section>
    <h3>{receipt.status === 'rolled_back' ? 'Merge rolled back' : 'Contacts merged'}</h3>
    <p role="status">{notice || (receipt.status === 'merged' ? 'Rollback requires a fresh eligibility check.' : 'Both contacts were restored.')}</p>
    {receipt.status === 'merged' && (rollbackPlan
      ? <button type="button" disabled={busy} onClick={() => run(async () => {
        const result = await call('rollback', { operationId: receipt.operationId, token: rollbackPlan.token });
        if (live.current) setReceipt(result.receipt);
      })}>Confirm rollback</button>
      : <button type="button" disabled={busy} onClick={() => run(async () => {
        const result = await call('preview_rollback', { operationId: receipt.operationId });
        if (live.current) setRollbackPlan(result);
      })}>Check rollback eligibility</button>)}
    <button type="button" disabled={busy} onClick={onMerged}>Refresh My People</button>
  </section>;

  return <section>
    <h3>Trusted merge preview</h3>
    <p role="status">{notice}</p>
    <label>Surviving contact <select value={survivor} disabled={busy || uncertain} onChange={(event) => {
      setSurvivor(event.target.value); setChoices({}); setPlan(null); intent.current = null;
    }}>
      <option value="">Choose a contact</option>
      {pair.contacts.map((contact, index) => <option key={contact.id} value={contact.id}>{personName(contact)} (Contact {index + 1})</option>)}
    </select></label>
    {plan?.conflicts.map(({ key, options }) => <label key={key}>{key.replaceAll('_', ' ')} <select
      aria-label={`Resolve ${key.replaceAll('_', ' ')}`} value={choices[key] ?? ''} disabled={busy || uncertain}
      onChange={(event) => {
        setChoices((prior) => ({ ...prior, [key]: event.target.value === '' ? undefined : Number(event.target.value) }));
        setPlan((prior) => ({ ...prior, token: null }));
        intent.current = null;
      }}>
      <option value="">Choose a value</option>
      {options.map((option, index) => <option value={index} key={index}>{String(option)}</option>)}
    </select></label>)}
    {plan?.combined && <p>{plan.combined.name} · {plan.combined.emails.join(', ')} · {plan.combined.phones.join(', ')} · {plan.combined.notes} notes · {plan.activityCount} Activity records to copy</p>}
    {plan?.combined?.suppressedEmails?.length > 0 && <p>Existing email suppression stays in place for {plan.combined.suppressedEmails.join(', ')}.</p>}
    {plan?.blockers.length > 0 && <ul>{plan.blockers.map((reason) => <li key={reason}>{BLOCKERS[reason] ?? 'This data needs a verified transfer.'}</li>)}</ul>}
    <button type="button" disabled={busy || !survivor || uncertain} onClick={preview}>Verify merge preview</button>
    {plan?.token && <button type="button" disabled={busy} onClick={commit}>{uncertain ? 'Retry same merge' : 'Confirm merge'}</button>}
    {uncertain && <button type="button" disabled={busy} onClick={() => run(async () => {
      const result = await call('status', { operationId: intent.current.operationId });
      if (!live.current) return;
      if (result.receipt) setReceipt(result.receipt);
      else { setUncertain(false); intent.current = null; setPlan(null); }
    })}>Check merge status</button>}
  </section>;
}
