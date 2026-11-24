import { stickerMembershipFields } from '../../../services/stickers/stickerCore';
import { useEffect, useId, useRef, useState } from 'react';
import { CalendarClock, Check, Clock3, Contact, LayoutGrid, Mail, MessageSquare, MoreHorizontal, NotebookPen, Pencil, Phone, Sparkles, Sticker } from 'lucide-react';
import ContactDetails from './ContactDetails';
import InteractionSheet from './InteractionSheet';
import ContactStickersRow from '../../../components/stickers/ContactStickersRow';
import { useStickers } from '../../../components/stickers/stickersRegistry';
import { appendContactNote } from '../../../services/contactNotes';
import { useT } from '../../../theme/ThemeContext';
import { activeStep, canWriteRelationship, isManualStep, relationshipHistory, stepVersion } from './relationship';
import { changeRelationshipNote, saveInteraction, saveRelationshipReminder, watchRelationship } from './relationshipStore';
import './ContactActionCenter.css';

const TABS = [['center', 'Action Center', LayoutGrid], ['activity', 'Activity', Clock3], ['emails', 'Emails', Mail], ['details', 'Details', Contact], ['stickers', 'Stickers', Sticker]];
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const historyIcons = { Note: NotebookPen, Call: Phone, Meeting: CalendarClock, Text: MessageSquare, 'Reminder completed': Check };
const localDate = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' });

function History({ rows, loading, error, empty, onRetry, onNote }) {
  return (
    <>
      {loading && <p role="status">Loading activity…</p>}
      {error && <p role="alert">Activity couldn’t be loaded. <button type="button" onClick={onRetry}>Try again</button></p>}
      {!loading && !error && rows.length === 0 && <p>{empty}</p>}
      {rows.length > 0 && (
        <ol className="ac-history">
          {rows.map((row) => {
            const Icon = historyIcons[row.label] || Clock3;
            return <li key={row.id}>
              <span className="ac-history-icon" data-kind={row.label} aria-hidden="true"><Icon size={16} /></span>
              <div><strong>{row.label}</strong>{!!row.time && <time dateTime={new Date(row.time).toISOString()}>{date.format(row.time)}</time>}
                {row.text && <p>{row.text}</p>}</div>
              {row.note && onNote && <details className="ac-menu">
                <summary aria-label="Note actions"><MoreHorizontal size={19} /></summary>
                <div>
                  <button type="button" onClick={(event) => { event.currentTarget.closest('details').open = false; onNote(row.note, false); }}>Edit note</button>
                  <button type="button" onClick={(event) => { event.currentTarget.closest('details').open = false; onNote(row.note, true); }}>Delete note</button>
                </div>
              </details>}
            </li>;
          })}
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
  const [dueTime, setDueTime] = useState('09:00');
  const [noteEdit, setNoteEdit] = useState(null);
  const [noteError, setNoteError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [feed, setFeed] = useState({ events: [], loading: true, error: false });
  const inFlight = useRef(false);
  const operation = useRef(null);
  const formRef = useRef(null);
  const noteRef = useRef(null);
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

  useEffect(() => { noteRef.current?.querySelector('textarea, button')?.focus(); }, [noteEdit?.note, noteEdit?.remove]);

  const rows = relationshipHistory(contact.notes, feed.events).filter((row) => scout || !row.isEmail || row.manualEmail);
  const feedProps = { onNote: canWrite ? (note, remove) => {
    setNoteError(false);
    setNoteEdit({ note, remove, content: note.content });
  } : undefined, loading: feed.loading, error: feed.error, onRetry: () => {
    setFeed((current) => ({ ...current, loading: true, error: false }));
    setAttempt((current) => current + 1);
  } };

  async function save(kind, options = {}) {
    if (!canWrite || inFlight.current || !canWriteRelationship(uid)) return;
    const text = (options.reschedule ? step?.action ?? '' : draft).trim();
    if (!text && !['done', 'dismiss'].includes(kind)) { setError('Enter something to save.'); return; }
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
        await saveInteraction(uid, contact.id, options.channel, text, id, options.occurredAt);
      } else {
        patch = await saveRelationshipReminder(uid, contact.id, { ...options, id, text, done: kind === 'done', dismiss: kind === 'dismiss' });
      }
      if (!canWriteRelationship(uid)) return;
      if (patch) onUpdate({ id: contact.id }, patch);
      operation.current = null;
      if (!['done', 'dismiss'].includes(kind) && !options.reschedule) setDraft('');
      setForm(null);
      setNotice({ note: 'Note added.', interaction: 'Update logged.', reminder: 'Reminder saved.', done: 'Reminder completed.', dismiss: 'Reminder canceled.' }[kind]);
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
    if (kind !== 'interaction' && !reschedule && !draft.trim()) { setError('Enter something to save.'); return; }
    setDue(reschedule && Number.isFinite(Date.parse(step.due_at)) ? localDate.format(new Date(step.due_at)) : '');
    setDueTime(reschedule && Number.isFinite(Date.parse(step.due_at))
      ? new Date(step.due_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '09:00');
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
        {tabs.map(([id, label, icon], index) => {
          const Icon = icon;
          return (
          <button key={id} id={tabId + id} type="button" role="tab" tabIndex={currentTab === id ? 0 : -1}
            aria-selected={currentTab === id} aria-controls={tabId + id + '-panel'}
              onKeyDown={(event) => tabKeys(event, index)} onClick={() => setTab(id)}><Icon size={17} aria-hidden="true" />{label}</button>
          );
        })}
      </div>

      <div id={tabId + currentTab + '-panel'} role="tabpanel" aria-labelledby={tabId + currentTab} tabIndex={0}>
        {currentTab === 'center' && (
          <div className="ac-layout">
            <div className="ac-main">
              <section className="ac-capture" aria-labelledby={tabId + '-capture'}>
                <h2 className="ph-sr" id={tabId + '-capture'}>Quick Capture</h2>
                {canWrite ? (
                  <>
                    <div className="ac-compose"><Pencil size={18} aria-hidden="true" /><textarea rows={1} aria-label="What would you like to remember or do?" placeholder="What would you like to remember or do?"
                      value={draft} maxLength={2000} disabled={busy}
                      onChange={(event) => { setDraft(event.target.value); setError(''); setNotice(''); }} /></div>
                    <div className="ac-actions ac-primary">
                      <button type="button" disabled={busy} onClick={() => save('note')}><NotebookPen size={16} /> Add note</button>
                      <button type="button" disabled={busy || Boolean(step && !manual)} onClick={() => openForm('reminder')}><CalendarClock size={16} /> Set reminder</button>
                      <button type="button" disabled={busy} onClick={() => openForm('interaction')}><MessageSquare size={16} /> Log update</button>
                    </div>
                    {form?.kind === 'interaction' && <InteractionSheet draft={draft} setDraft={(text) => { setDraft(text); setError(''); }}
                      busy={busy} error={error} onSave={(options) => save('interaction', options)}
                      onCancel={() => { setForm(null); setError(''); }} />}
                    {form?.kind === 'reminder' && <form ref={formRef} className="ac-form" onSubmit={(event) => {
                      event.preventDefault();
                      const selected = new Date(due + 'T' + dueTime);
                      if (Number.isFinite(selected.getTime())) save('reminder', { expected: form.expected, due: selected.toISOString(), reschedule: form.reschedule });
                    }}>
                      <label>Due date <input type="date" required value={due} disabled={busy} onChange={(event) => setDue(event.target.value)} /></label>
                      <label>Due time <input type="time" required value={dueTime} disabled={busy} onChange={(event) => setDueTime(event.target.value)} /></label>
                      {form.existing && <p>Confirm {form.reschedule ? 'a new date for the current reminder.' : 'replacing the text and date of the current reminder.'}</p>}
                      <div className="ac-actions"><button type="submit" disabled={busy}>{form.existing ? 'Confirm reminder change' : 'Save reminder'}</button>
                        <button type="button" disabled={busy} onClick={() => setForm(null)}>Cancel</button></div>
                    </form>}
                  </>
                ) : <p>This profile is read-only.</p>}
                {error && form?.kind !== 'interaction' && <p role="alert">{error}</p>}
                {notice && <p role="status">{notice}</p>}
              </section>

              <section className="ac-card ac-up-next" aria-labelledby={tabId + '-next'}>
                <h2 id={tabId + '-next'}><CalendarClock size={19} /> Up Next</h2>
                {step ? (
                  <>
                    <div className="ac-next">
                      <div><strong>{step.action || 'Existing follow-up'}</strong>
                        {Number.isFinite(Date.parse(step.due_at)) && <p>Due <time dateTime={step.due_at}>{dateTime.format(new Date(step.due_at))}</time></p>}
                      </div>
                      {canWrite && manual && <div className="ac-actions">
                        <details className="ac-menu"><summary aria-label="Reminder actions"><MoreHorizontal size={19} /></summary><div>
                          <button type="button" disabled={busy} onClick={(event) => { event.currentTarget.closest('details').open = false; openForm('reminder', true); }}>Reschedule</button>
                          <button type="button" disabled={busy} onClick={(event) => { event.currentTarget.closest('details').open = false; setForm({ kind: 'dismiss', expected: stepVersion(step) }); }}>Cancel reminder</button>
                        </div></details>
                        <button type="button" disabled={busy} onClick={() => save('done', { expected: stepVersion(step) })}><Check size={16} /> Done</button>
                      </div>}
                    </div>
                    {form?.kind === 'dismiss' && <div className="ac-form"><p>Cancel this reminder?</p>
                      <button type="button" disabled={busy} onClick={() => save('dismiss', { expected: form.expected })}>Confirm cancel</button>
                      <button type="button" disabled={busy} onClick={() => setForm(null)}>Keep reminder</button>
                    </div>}
                    {!manual && <p>Manage this existing next step in its original workflow.</p>}
                  </>
                ) : <p>No reminder set.</p>}
              </section>

              <section className="ac-card" aria-labelledby={tabId + '-recent'}>
                <div className="ac-section-title"><h2 id={tabId + '-recent'}>Recent Activity</h2>
                  <button type="button" onClick={() => { setTab('activity'); document.getElementById(tabId + 'activity')?.focus(); }}>View all</button></div>
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
        {currentTab === 'emails' && <section className="ac-card"><h2>Scout Emails</h2><History rows={rows.filter((row) => row.isEmail && !row.manualEmail)} empty="No email activity yet." {...feedProps} /></section>}
        {currentTab === 'details' && <ContactDetails contact={contact} uid={uid} canWrite={canWrite} onUpdate={onUpdate} />}
        {currentTab === 'stickers' && <section className="ac-card"><h2>Stickers</h2>
          {canWrite && stickers.ready ? <ContactStickersRow contact={contact} onUpdate={(next) => onUpdate({ id: contact.id }, stickerMembershipFields(next))}
            onLateUpdate={onLateStickerChange} /> : <p>Stickers are unavailable to edit in this session.</p>}
        </section>}
      </div>
      {noteEdit && canWrite && <section ref={noteRef} className="ac-card" aria-label={noteEdit.remove ? 'Delete note' : 'Edit note'}>
        <form className="ac-form" onSubmit={async (event) => {
          event.preventDefault();
          if (inFlight.current || !canWriteRelationship(uid) || (!noteEdit.remove && !noteEdit.content.trim())) return;
          inFlight.current = true;
          setBusy(true);
          setNoteError(false);
          try {
            const updated = await changeRelationshipNote(uid, contact.id, noteEdit.note, noteEdit.remove ? null : noteEdit.content.trim());
            if (canWriteRelationship(uid)) onUpdate({ id: contact.id }, (current) => ({
              notes: (current.notes ?? []).flatMap((note) => note.id === noteEdit.note.id ? updated ? [updated] : [] : [note]),
            }));
            setNoteEdit(null);
          } catch {
            setNoteError(true);
          } finally {
            inFlight.current = false;
            setBusy(false);
          }
        }}>
          {noteEdit.remove ? <p>Delete this note?</p> : <label>Note<textarea value={noteEdit.content} maxLength={2000} required
            onChange={(event) => setNoteEdit({ ...noteEdit, content: event.target.value })} /></label>}
          <button disabled={busy}>{noteEdit.remove ? 'Confirm delete' : 'Save note'}</button>
          <button type="button" disabled={busy} onClick={() => setNoteEdit(null)}>Cancel</button>
          {noteError && <p role="alert">The note couldn’t be saved. Refresh the profile if it changed elsewhere.</p>}
        </form>
      </section>}
    </section>
  );
}
