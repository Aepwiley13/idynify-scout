import { useEffect, useId, useRef, useState } from 'react';
import { CalendarClock, Check, Clock3, MessageSquare, NotebookPen, Sparkles } from 'lucide-react';
import IdentityCard from '../../../components/contacts/IdentityCard';
import StickyNotes from '../../../components/contacts/StickyNotes';
import ContactStickersRow from '../../../components/stickers/ContactStickersRow';
import { useStickers } from '../../../components/stickers/stickersRegistry';
import { appendContactNote } from '../../../services/contactNotes';
import { useT } from '../../../theme/ThemeContext';
import { activeStep, canWriteRelationship, INTERACTIONS, isManualStep, relationshipHistory, stepVersion } from './relationship';
import { saveInteraction, saveRelationshipReminder, watchRelationship } from './relationshipStore';
import './ContactActionCenter.css';

const TABS = [['center', 'Action Center'], ['activity', 'Activity'], ['emails', 'Emails'], ['details', 'Details'], ['stickers', 'Stickers']];
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const localDate = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' });

function History({ rows, loading, error, empty, onRetry }) {
  return (
    <>
      {loading && <p role="status">Loading activity…</p>}
      {error && <p role="alert">Activity couldn’t be loaded. <button type="button" onClick={onRetry}>Try again</button></p>}
      {!loading && !error && rows.length === 0 && <p>{empty}</p>}
      {rows.length > 0 && (
        <ol className="ac-history">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="ac-history-icon" aria-hidden="true"><Clock3 size={15} /></span>
              <div><strong>{row.label}</strong>{row.text && <p>{row.text}</p>}</div>
              {!!row.time && <time dateTime={new Date(row.time).toISOString()}>{date.format(row.time)}</time>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export default function ContactActionCenter({ uid, contact, readOnly, scout, openBarry, onUpdate, onLateStickerChange }) {
  const theme = useT();
  const stickers = useStickers();
  const tabId = useId();
  const [tab, setTab] = useState('center');
  const [draft, setDraft] = useState('');
  const [form, setForm] = useState(null);
  const [due, setDue] = useState('');
  const [channel, setChannel] = useState('call');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [feed, setFeed] = useState({ events: [], loading: true, error: false });
  const inFlight = useRef(false);
  const operation = useRef(null);
  const formRef = useRef(null);
  const canWrite = !readOnly && Boolean(uid);
  const step = activeStep(contact);
  const manual = isManualStep(step);
  const currentTab = tab === 'emails' && !scout ? 'center' : tab;

  useEffect(() => {
    if (!uid) return undefined;
    let live = true;
    const fail = () => { if (live) setFeed((current) => ({ ...current, loading: false, error: true })); };
    let stop;
    try {
      stop = watchRelationship(uid, contact.id,
        (events) => { if (live) setFeed({ events, loading: false, error: false }); },
        fail);
    } catch {
      fail();
    }
    return () => { live = false; stop?.(); };
  }, [uid, contact.id, attempt]);

  useEffect(() => { formRef.current?.querySelector('input, select')?.focus(); }, [form]);

  const rows = relationshipHistory(contact.notes, feed.events).filter((row) => scout || !row.isEmail);
  const feedProps = { loading: feed.loading, error: feed.error, onRetry: () => {
    setFeed((current) => ({ ...current, loading: true, error: false }));
    setAttempt((current) => current + 1);
  } };

  async function save(kind, options = {}) {
    if (!canWrite || inFlight.current || !canWriteRelationship(uid)) return;
    const text = (options.reschedule ? step?.action ?? '' : draft).trim();
    if (!text && kind !== 'done') { setError('Enter something to save.'); return; }
    const signature = JSON.stringify([kind, text, options]);
    if (operation.current?.signature !== signature) {
      operation.current = { signature, id: globalThis.crypto.randomUUID(), at: new Date().toISOString() };
    }
    const { id, at } = operation.current;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let patch;
      if (kind === 'note') {
        const note = { id, content: text, created_at: at, updated_at: at };
        await appendContactNote(uid, contact.id, note);
        patch = (current) => {
          const notes = Array.isArray(current.notes) ? current.notes : [];
          return notes.some((entry) => entry.id === id) ? {} : { notes: [...notes, note] };
        };
      } else if (kind === 'interaction') {
        await saveInteraction(uid, contact.id, options.channel, text, id);
      } else {
        patch = await saveRelationshipReminder(uid, contact.id, { ...options, id, text, done: kind === 'done' });
      }
      if (!canWriteRelationship(uid)) return;
      if (patch) onUpdate({ id: contact.id }, patch);
      operation.current = null;
      if (kind !== 'done' && !options.reschedule) setDraft('');
      setForm(null);
      setNotice({ note: 'Note added.', interaction: 'Update logged.', reminder: 'Reminder saved.', done: 'Reminder completed.' }[kind]);
    } catch (failure) {
      if (failure.message === 'step_changed' && canWriteRelationship(uid)) {
        onUpdate({ id: contact.id }, failure.current);
        setForm(null);
        setError('The next step changed. Review Up Next before trying again.');
      } else {
        setError('Couldn’t save. Try again.');
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function openForm(kind, reschedule = false) {
    setError('');
    setNotice('');
    if (!reschedule && !draft.trim()) { setError('Enter something to save.'); return; }
    setDue(reschedule && Number.isFinite(Date.parse(step.due_at)) ? localDate.format(new Date(step.due_at)) : '');
    setForm({ kind, expected: stepVersion(step), existing: Boolean(step), reschedule });
  }

  const tabs = TABS.filter(([id]) => id !== 'emails' || scout);
  function tabKeys(event, index) {
    const target = { ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const [id] = tabs[target];
    setTab(id);
    event.currentTarget.parentElement.children[target]?.focus();
  }

  const guidance = step
    ? 'Review the next step before reaching out again.'
    : rows.length ? 'Use your recent activity to decide whether to follow up.'
      : 'Start with a note about how you know this person, or set a reminder to check in.';

  return (
    <section className="ac" aria-label="Relationship workspace" style={{
      '--ac-text': theme.text, '--ac-muted': theme.textMuted, '--ac-border': theme.border,
      '--ac-card': theme.cardBg, '--ac-accent': theme.accent,
    }}>
      <div className="ac-tabs" role="tablist" aria-label="Profile tabs">
        {tabs.map(([id, label], index) => (
          <button key={id} id={tabId + id} type="button" role="tab" tabIndex={currentTab === id ? 0 : -1}
            aria-selected={currentTab === id} aria-controls={tabId + id + '-panel'}
            onKeyDown={(event) => tabKeys(event, index)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      <div id={tabId + currentTab + '-panel'} role="tabpanel" aria-labelledby={tabId + currentTab} tabIndex={0}>
        {currentTab === 'center' && (
          <div className="ac-layout">
            <div className="ac-main">
              <section className="ac-card" aria-labelledby={tabId + '-capture'}>
                <h2 id={tabId + '-capture'}>Quick Capture</h2>
                {canWrite ? (
                  <>
                    <textarea aria-label="What would you like to remember or do?" placeholder="What would you like to remember or do?"
                      value={draft} maxLength={2000} disabled={busy}
                      onChange={(event) => { setDraft(event.target.value); setError(''); setNotice(''); }} />
                    <div className="ac-actions">
                      <button type="button" disabled={busy} onClick={() => save('note')}><NotebookPen size={16} /> Add note</button>
                      <button type="button" disabled={busy || Boolean(step && !manual)} onClick={() => openForm('reminder')}><CalendarClock size={16} /> Set reminder</button>
                      <button type="button" disabled={busy} onClick={() => openForm('interaction')}><MessageSquare size={16} /> Log update</button>
                    </div>
                    {form && (
                      <form ref={formRef} className="ac-form" onSubmit={(event) => {
                        event.preventDefault();
                        if (form.kind === 'interaction') save('interaction', { channel });
                        else {
                          const selected = new Date(due + 'T09:00:00');
                          if (Number.isFinite(selected.getTime())) save('reminder', { expected: form.expected, due: selected.toISOString(), reschedule: form.reschedule });
                        }
                      }}>
                        {form.kind === 'interaction' ? (
                          <label>Interaction type <select value={channel} disabled={busy} onChange={(event) => setChannel(event.target.value)}>
                            {Object.entries(INTERACTIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                          </select></label>
                        ) : (
                          <label>Due date <input type="date" required value={due} disabled={busy} onChange={(event) => setDue(event.target.value)} /></label>
                        )}
                        {form.kind === 'reminder' && form.existing && <p>{form.reschedule
                          ? 'Confirm a new date for the current reminder.'
                          : 'Confirm replacing the text and date of the current reminder.'}</p>}
                        <div className="ac-actions">
                          <button type="submit" disabled={busy}>{form.kind === 'interaction' ? 'Save update' : form.existing ? 'Confirm reminder change' : 'Save reminder'}</button>
                          <button type="button" disabled={busy} onClick={() => setForm(null)}>Cancel</button>
                        </div>
                      </form>
                    )}
                  </>
                ) : <p>This profile is read-only.</p>}
                {error && <p role="alert">{error}</p>}
                {notice && <p role="status">{notice}</p>}
              </section>

              <section className="ac-card" aria-labelledby={tabId + '-next'}>
                <h2 id={tabId + '-next'}><CalendarClock size={19} /> Up Next</h2>
                {step ? (
                  <>
                    <div className="ac-next">
                      <div><strong>{step.action || 'Existing follow-up'}</strong>
                        {Number.isFinite(Date.parse(step.due_at)) && <p>Due <time dateTime={step.due_at}>{date.format(new Date(step.due_at))}</time></p>}
                      </div>
                      {canWrite && manual && <div className="ac-actions">
                        <button type="button" disabled={busy} onClick={() => openForm('reminder', true)}>Reschedule</button>
                        <button type="button" disabled={busy} onClick={() => save('done', { expected: stepVersion(step) })}><Check size={16} /> Done</button>
                      </div>}
                    </div>
                    {!manual && <p>Manage this existing next step in its original workflow.</p>}
                  </>
                ) : <p>No reminder set.</p>}
              </section>

              <section className="ac-card" aria-labelledby={tabId + '-recent'}>
                <div className="ac-section-title"><h2 id={tabId + '-recent'}>Recent Activity</h2>
                  <button type="button" onClick={() => { setTab('activity'); document.getElementById(tabId + 'activity')?.focus(); }}>View activity</button></div>
                <History rows={rows.slice(0, 4)} empty="Notes and logged interactions will appear here." {...feedProps} />
              </section>
            </div>
            <aside className="ac-card ac-barry" aria-label="Barry">
              <h2><Sparkles size={20} /> Barry</h2>
              <p>{guidance}</p>
              {scout && openBarry && <button type="button" onClick={(event) => openBarry({ returnFocusTo: event.currentTarget })}>Open Barry</button>}
            </aside>
          </div>
        )}
        {currentTab === 'activity' && <section className="ac-card"><h2>Activity</h2><History rows={rows} empty="No activity yet." {...feedProps} /></section>}
        {currentTab === 'emails' && <section className="ac-card"><h2>Scout Emails</h2><History rows={rows.filter((row) => row.isEmail)} empty="No email activity yet." {...feedProps} /></section>}
        {currentTab === 'details' && <>
          <IdentityCard contact={contact} variant="details" readOnly={!canWrite} onUpdate={onUpdate} />
          {canWrite && <section className="hub-card hub-notes" aria-label="Notes" style={{ background: theme.cardBg }}><StickyNotes contact={contact} onUpdate={(next) => {
            if (canWriteRelationship(uid)) onUpdate({ id: contact.id }, { notes: next.notes });
          }} /></section>}
        </>}
        {currentTab === 'stickers' && <section className="ac-card"><h2>Stickers</h2>
          {canWrite && stickers.ready ? <ContactStickersRow contact={contact} onUpdate={(next) => onUpdate({ id: contact.id }, { sticker_ids: next.sticker_ids })}
            onLateUpdate={onLateStickerChange} /> : <p>Stickers are unavailable to edit in this session.</p>}
        </section>}
      </div>
    </section>
  );
}
