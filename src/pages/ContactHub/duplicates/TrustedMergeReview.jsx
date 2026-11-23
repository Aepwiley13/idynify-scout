import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, CircleAlert, LockKeyhole } from 'lucide-react';
import { personName } from '../peopleRules';

const BLOCKERS = {
  private_photo_requires_transfer: 'A private photo cannot be moved safely yet. Keep these contacts separate for now.',
  reminder_requires_transfer: 'A reminder could not be carried over safely. Keep these contacts separate for now.',
  identity_not_verified: 'There is not enough matching information to confirm these records belong to the same person.',
  conflicting_identity: 'The contacts have different verified identity details. Review them before continuing.',
  email_permission_requires_review: 'Email permissions need a closer review. No email permission will be added by merging.',
  unresolved_gmail_attempt: 'A recent email send still needs to be checked. Try again after it has been reconciled.',
  previous_merge_requires_review: 'One contact already includes merged records. It needs a separate review first.',
  unclassified_child_records: 'Some saved contact history cannot be moved safely yet.',
  unclassified_source_fields: 'Some imported information cannot be moved safely yet.',
  unsupported_contact_status: 'One contact is not active and cannot be merged safely.',
  unsupported_worker_reference: 'A background contact update is still being resolved.',
  unsupported_outreach_scope: 'An existing outreach item needs review before these contacts can be combined.',
  unsupported_worker_history: 'Some background update history cannot be moved safely yet.',
  plan_limit: 'There is too much saved history to combine safely in one operation.',
  sticker_limit: 'The combined contact would exceed the 50-sticker limit.',
  affiliation_limit: 'These contacts have more roles than can be safely combined at once.',
  invalid_affiliations: 'Some role or organization details need correction before they can be combined.',
  invalid_email_fact: 'One contact has an email address that needs correction first.',
  timeline_collision: 'Some activity records could not be combined without a conflict.',
};

const FIELD_LABELS = {
  name: 'Name', first_name: 'First name', last_name: 'Last name', title: 'Job title', job_title: 'Job title',
  company_name: 'Organization', company_id: 'Company record', city: 'City', state: 'State', country: 'Country',
  location: 'Location', address: 'Address', linkedin_url: 'LinkedIn profile', apollo_person_id: 'External ID',
  original_photo: 'Original photo', primary_email: 'Primary email', primary_phone: 'Primary phone',
};

const friendlyField = (key) => FIELD_LABELS[key] ?? key.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
const printable = (value) => {
  if (value === null || value === undefined || value === '') return 'No value';
  if (Array.isArray(value)) return value.filter(Boolean).join(' · ') || 'No value';
  if (typeof value === 'object') return value.value ?? value.name ?? value.label ?? 'Saved value';
  return String(value);
};
const personLabel = (contact) => personName(contact) || 'Unnamed contact';
const operationMessage = (error) => ({
  preview_changed: 'The contact details changed while you were reviewing. Start the review again to refresh it.',
  execution_disabled: 'Merging is not available in this environment.',
  rollback_changed: 'The contacts changed after the merge. Automatic recovery is no longer available.',
  rollback_expired: 'The recovery period has ended.',
  merge_blocked: 'These contacts cannot be combined safely right now. Review the reasons below.',
})[error?.message] ?? 'We could not confirm that action. You can safely check the status or try again.';

function BlockerList({ blockers }) {
  if (!blockers?.length) return null;
  return (
    <div className="hub-merge-blockers" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      <div><strong>Keep these contacts separate for now</strong>
        <ul>{blockers.map((reason) => <li key={reason}>{BLOCKERS[reason] ?? 'Some saved information needs a safety review first.'}</li>)}</ul>
      </div>
    </div>
  );
}

function StepHeading({ number, title, description }) {
  return <header className="hub-merge-step-heading">
    <span className="hub-merge-step-number" aria-hidden="true">{number}</span>
    <div><h3>{title}</h3><p>{description}</p></div>
  </header>;
}

function PreservationSummary({ plan, survivorName, stickers }) {
  const combined = plan?.combined;
  return <>
    <dl className="hub-merge-summary">
      <div><dt>Name</dt><dd>{combined?.name || survivorName}</dd></div>
      <div><dt>Email addresses</dt><dd>{combined?.emails?.length ? <ul>{combined.emails.map((item, index) => <li key={`${item.value}:${index}`}>{item.value}{item.label ? ` · ${item.label}` : ''}{item.primary ? ' · Primary' : ''}</li>)}</ul> : 'None saved'}</dd></div>
      <div><dt>Phone numbers</dt><dd>{combined?.phones?.length ? <ul>{combined.phones.map((item, index) => <li key={`${item.normalized ?? item.value}:${item.label}:${index}`}>{item.value}{item.extension ? ` x${item.extension}` : ''} · {item.label}{item.labelSource ? ` (${item.labelSource})` : ''}{item.primary ? ' · Primary' : ''}</li>)}</ul> : 'None saved'}</dd></div>
      <div><dt>Affiliations</dt><dd>{combined?.affiliations?.length ? <ul>{combined.affiliations.map((item, index) => <li key={`${item.id}:${index}`}>{[item.title, item.organization_name].filter(Boolean).join(' · ')}{item.primary ? ' · Primary' : ''}{item.status === 'former' ? ' · Former' : ''}</li>)}</ul> : 'None saved'}</dd></div>
      <div><dt>Notes</dt><dd>{combined?.notes?.length ? <ul>{combined.notes.map((item, index) => <li key={`${item.id ?? 'note'}:${index}`}>{item.content ?? item.text ?? 'Saved note'}</li>)}</ul> : 'None saved'}</dd></div>
      <div><dt>Activity</dt><dd>{plan?.activityCount ? `${plan.activityCount} activity records will be retained` : 'No activity records to transfer'}</dd></div>
      <div><dt>Stickers</dt><dd>{combined?.stickers?.length ? <ul>{combined.stickers.map((item) => <li key={item.id}>{stickers?.[item.id]?.name ?? stickers?.get?.(item.id)?.name ?? item.name ?? item.id}{item.assignment?.assigned_by ? ` · assigned by ${item.assignment.assigned_by}` : ''}</li>)}</ul> : 'None saved'}</dd></div>
      <div><dt>Source history</dt><dd>{combined?.sourceHistory?.length ? <ul>{combined.sourceHistory.map((entry) => <li key={entry.contact_id}>
        {entry.contact_id}: {[entry.source, entry.added_from, entry.source_detail, entry.identity_source, ...(entry.identity_sources ?? [])].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(' · ') || 'Origin record retained'}
      </li>)}</ul> : (combined?.sources?.join(', ') || 'No source history saved')}</dd></div>
      {combined?.suppressedEmails?.length > 0 && <div className="hub-merge-summary__restriction">
        <dt>Existing email opt-outs</dt><dd>Will remain in place for {combined.suppressedEmails.join(', ')}</dd>
      </div>}
    </dl>
    <section className="hub-merge-preserves" aria-label="Other information to preserve">
      <h4>Other saved information stays with the contact</h4>
      <p>Notes and activity history, stickers and who assigned them, reminders, photo choices and original sources, company links, imported identifiers, and existing email restrictions.</p>
      <p className="hub-merge-no-consent"><LockKeyhole size={15} aria-hidden="true" /> Merging does not add email consent.</p>
    </section>
  </>;
}

export default function TrustedMergeReview({ pair, request, comparison, stickers, onCancel, onComplete, onBusyChange, onDraftChange, existingReceipt }) {
  const stepTitleId = useId();
  const [step, setStep] = useState(1);
  const [survivor, setSurvivor] = useState('');
  const [choices, setChoices] = useState({});
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState(existingReceipt ?? null);
  const [rollbackPlan, setRollbackPlan] = useState(null);
  const [uncertain, setUncertain] = useState(false);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [needsIdentityConfirmation, setNeedsIdentityConfirmation] = useState(false);
  const [hasConflictingIdentity, setHasConflictingIdentity] = useState(false);
  const intent = useRef(null);
  const attestationOperationId = useRef(null);
  const pending = useRef(false);
  const live = useRef(false);
  const contacts = pair?.contacts ?? [];
  const survivorContact = contacts.find((contact) => contact.id === survivor);
  const sourceContact = contacts.find((contact) => contact.id !== survivor);
  const inputs = { survivorId: survivor, sourceId: sourceContact?.id, choices, identityConfirmed,
    ...(identityConfirmed ? { operationId: attestationOperationId.current } : {}) };
  const hasChoices = Boolean(survivor || Object.keys(choices).length);

  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { onDraftChange?.(hasChoices && !receipt); }, [hasChoices, onDraftChange, receipt]);

  async function run(task, mayCommit = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setNotice('');
    try { await task(); } catch (error) {
      if (live.current) {
        setNotice(operationMessage(error));
        if (mayCommit) setUncertain(true);
      }
    } finally {
      pending.current = false;
      onBusyChange?.(false);
      if (live.current) setBusy(false);
    }
  }

  const call = (action, fields) => request(action, fields, () => live.current);
  function chooseSurvivor(id) {
    setSurvivor(id);
    setChoices({});
    setPlan(null);
    setNotice('');
    setStep(1);
    intent.current = null;
    attestationOperationId.current = null;
    setIdentityConfirmed(false);
    setNeedsIdentityConfirmation(false);
    setHasConflictingIdentity(false);
  }
  function chooseConflict(key, value) {
    setChoices((previous) => ({ ...previous, [key]: value }));
    setPlan((previous) => previous ? { ...previous, token: null } : previous);
    setStep(2);
    intent.current = null;
    setNotice('');
  }
  function loadConflicts() {
    if (!survivor) return;
    return run(async () => {
      const result = await call('preview', { ...inputs, choices: {} });
      if (!live.current) return;
      setPlan(result);
      setNeedsIdentityConfirmation(result.blockers?.includes('identity_not_verified') ?? false);
      setHasConflictingIdentity(result.blockers?.includes('conflicting_identity') ?? false);
      if (!result.blockers?.length) setStep(2);
    });
  }
  function reviewCombined() {
    const unresolved = (plan?.conflicts ?? []).some(({ key }) => !Number.isInteger(choices[key]));
    if (unresolved) { setNotice('Choose one value for each highlighted difference to continue.'); return; }
    return run(async () => {
      const result = await call('preview', { ...inputs, choices });
      if (!live.current) return;
      setPlan(result);
      setNeedsIdentityConfirmation(result.blockers?.includes('identity_not_verified') ?? false);
      setHasConflictingIdentity(result.blockers?.includes('conflicting_identity') ?? false);
      if (!result.blockers?.length && result.token) setStep(3);
    });
  }
  function commit() {
    if (!plan?.token || uncertain || !survivor) return;
    intent.current ??= { ...inputs, token: plan.token, operationId: attestationOperationId.current ?? crypto.randomUUID() };
    return run(async () => {
      const result = await call('commit', intent.current);
      if (live.current) { setReceipt(result.receipt); setUncertain(false); }
    }, true);
  }

  if (receipt) return <section className="hub-merge-receipt" aria-labelledby={stepTitleId}>
    <div className="hub-merge-success-icon"><Check size={22} aria-hidden="true" /></div>
    <h3 id={stepTitleId}>{receipt.status === 'rolled_back' ? 'Merge rolled back' : 'Contacts merged'}</h3>
    <p role="status">{notice || (receipt.status === 'merged'
      ? 'The contacts are combined. You can check whether a safe recovery is still available.'
      : 'Both contacts were restored. Any changes made after the merge were preserved.')}</p>
    {receipt.status === 'merged' && (rollbackPlan
      ? <button type="button" className="hub-merge-button hub-merge-button--primary" disabled={busy} onClick={() => run(async () => {
        const result = await call('rollback', { operationId: receipt.operationId, token: rollbackPlan.token });
        if (live.current) setReceipt(result.receipt);
      })}>Confirm recovery</button>
      : <button type="button" className="hub-merge-button hub-merge-button--secondary" disabled={busy} onClick={() => run(async () => {
        const result = await call('preview_rollback', { operationId: receipt.operationId });
        if (live.current) setRollbackPlan(result);
      })}>Check recovery options</button>)}
    {rollbackPlan && receipt.status === 'merged' && <p className="hub-merge-note">Recovery is available only if the records have not changed and no outside action would be undone.</p>}
    <footer className="hub-merge-footer">
      <span />
      <button type="button" className="hub-merge-button hub-merge-button--primary" disabled={busy} onClick={onComplete}>Return to My People</button>
    </footer>
  </section>;

  const conflictCount = plan?.conflicts?.length ?? 0;
  const resolvedCount = (plan?.conflicts ?? []).filter(({ key }) => Number.isInteger(choices[key])).length;
  const survivorName = survivorContact ? personLabel(survivorContact) : '';

  return <section className="hub-merge-wizard" aria-labelledby={stepTitleId}>
    <div className="hub-merge-progress" aria-label={`Step ${step} of 3`}>
      {[['Compare contacts', 1], ['Resolve differences', 2], ['Review and confirm', 3]].map(([label, number]) => (
        <div key={number} className={`hub-merge-progress-step${step === number ? ' is-current' : ''}${step > number ? ' is-complete' : ''}`} aria-current={step === number ? 'step' : undefined}>
          <span>{step > number ? <Check size={14} aria-hidden="true" /> : number}</span><small>{label}</small>
        </div>
      ))}
    </div>

    <div className="hub-merge-step" key={step}>
      {step === 1 && <>
        <StepHeading number="1" title="Compare contacts" description="Check the matching details, then choose which contact should remain." />
        {comparison}
        <fieldset className="hub-merge-survivor">
          <legend>Choose the contact to keep</legend>
          {contacts.map((contact) => <label key={contact.id} className={`hub-merge-choice${survivor === contact.id ? ' is-selected' : ''}`}>
            <input type="radio" name={`survivor-${pair.id}`} value={contact.id} checked={survivor === contact.id} disabled={busy || uncertain} onChange={() => chooseSurvivor(contact.id)} />
            <span><strong>{personLabel(contact)}</strong><small>{contact.company_name || contact.company || 'No organization saved'}</small></span>
            {survivor === contact.id && <span className="hub-merge-keep-badge">Will remain</span>}
          </label>)}
        </fieldset>
        {needsIdentityConfirmation && !hasConflictingIdentity && <label className="hub-merge-identity-confirmation">
          <input type="checkbox" checked={identityConfirmed} disabled={busy || uncertain} onChange={(event) => {
            const confirmed = event.target.checked;
            setIdentityConfirmed(confirmed);
            attestationOperationId.current = confirmed ? crypto.randomUUID() : null;
            intent.current = null;
            setPlan(null);
          }} />
          <span><strong>I know these records are the same person.</strong><small>This confirmation is recorded with this merge. Differences in verified identifiers still block the merge.</small></span>
        </label>}
        <BlockerList blockers={plan?.blockers} />
      </>}

      {step === 2 && <>
        <StepHeading number="2" title="Resolve differences" description="Choose a value only where the contacts disagree. Each choice shows where it came from." />
        {conflictCount === 0 ? <p className="hub-merge-no-conflicts">No conflicting details need a choice.</p> : (
          <div className="hub-merge-conflicts" aria-label="Conflicting information">
                {plan.conflicts.map(({ key, options }) => <fieldset key={key} className="hub-merge-conflict">
              <legend>{friendlyField(key)}</legend>
              <div className="hub-merge-conflict-options">
                {options.map((option, index) => {
                  const origin = key === 'primary_email'
                    ? contacts.filter((contact) => (contact.emails ?? []).some((item) => (typeof item === 'string' ? item : item.value)?.toLowerCase() === String(option).toLowerCase()) || [contact.email, contact.work_email, contact.email_address].some((value) => value?.toLowerCase() === String(option).toLowerCase()))
                    : key === 'primary_phone'
                      ? contacts.filter((contact) => contact.phones?.some((item) => item.value === option) || contact.phone === option || [contact.phone_mobile, contact.phone_direct, contact.phone_work, contact.phone_home].includes(option))
                      : [index === 0 ? survivorContact : sourceContact];
                  return <label key={`${key}-${index}`} className={`hub-merge-choice${choices[key] === index ? ' is-selected' : ''}`}>
                    <input type="radio" name={`conflict-${pair.id}-${key}`} value={index} checked={choices[key] === index} disabled={busy || uncertain} onChange={() => chooseConflict(key, index)} />
                    <span><strong>{printable(option)}</strong><small>{origin.length > 0 ? `From ${origin.map(personLabel).join(' and ')}` : 'Saved contact information'}{origin.some((contact) => contact.id === survivor) ? ' · includes the contact that will remain' : ' · information will be retained'}</small></span>
                  </label>;
                })}
              </div>
            </fieldset>)}
          </div>
        )}
        <p className="hub-merge-note">Information that is not in conflict will be combined automatically. Existing email opt-outs stay in place.</p>
        <BlockerList blockers={plan?.blockers} />
      </>}

      {step === 3 && <>
        <StepHeading number="3" title="Review the combined contact" description="Check what will remain before you confirm the merge." />
        <div className="hub-merge-survivor-summary"><span>Contact that will remain</span><strong>{survivorName}</strong></div>
        <PreservationSummary plan={plan} survivorName={survivorName} stickers={stickers} />
        <BlockerList blockers={plan?.blockers} />
        <p className="hub-merge-note">The other contact will be retired and its profile will point to the contact you selected. Recovery is conditional and will be checked after the merge.</p>
      </>}
    </div>

    {notice && <p className="hub-merge-notice" role="alert">{notice}</p>}
    {uncertain && <button type="button" className="hub-merge-button hub-merge-button--secondary" disabled={busy} onClick={() => run(async () => {
      const result = await call('status', { operationId: intent.current.operationId });
      if (!live.current) return;
      if (result.receipt) setReceipt(result.receipt);
      else { setUncertain(false); intent.current = null; setPlan(null); setStep(1); }
    })}>Check merge status</button>}

    <footer className="hub-merge-footer">
      <div className="hub-merge-footer-start">
        {step > 1 && <button type="button" className="hub-merge-button hub-merge-button--secondary" disabled={busy || uncertain} onClick={() => setStep(step - 1)}>
          <ArrowLeft size={16} aria-hidden="true" />Back
        </button>}
        <button type="button" className="hub-merge-button hub-merge-button--quiet" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      {step === 1 && <button type="button" className="hub-merge-button hub-merge-button--primary" disabled={busy || uncertain || !survivor || Boolean(plan?.blockers?.length)} onClick={loadConflicts}>
        Continue<ChevronRight size={16} aria-hidden="true" />
      </button>}
      {step === 2 && <button type="button" className="hub-merge-button hub-merge-button--primary" disabled={busy || uncertain || resolvedCount !== conflictCount || Boolean(plan?.blockers?.length)} onClick={reviewCombined}>
        Review combined contact<ChevronRight size={16} aria-hidden="true" />
      </button>}
      {step === 3 && <button type="button" className="hub-merge-button hub-merge-button--primary" disabled={busy || uncertain || !plan?.token || Boolean(plan?.blockers?.length)} onClick={commit}>
        {busy ? 'Merging…' : 'Merge contacts'}
      </button>}
    </footer>
  </section>;
}
