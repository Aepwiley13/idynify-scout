/**
 * useContactIdentityEdit — the controller behind the header's name, title and organization edits.
 *
 * Not connected to PersonHeader or any screen yet (H2-1). It owns the edit session (start, type, commit, cancel),
 * the optimistic update, the write, and the undoing of a failed write.
 *
 *   const edit = useContactIdentityEdit({ contact, onPatch });
 *
 * THE CALLBACK IS ID-ADDRESSED. onPatch(contactId, fields) is told which contact, and ONLY the fields that changed.
 * It is not onUpdate(wholeContact): a whole contact can carry stale copies of every other field (a sticker added a
 * moment ago) and, handed to a parent that keeps "the contact on screen", could show the wrong person. A parent
 * applies a patch by merging those fields into that contact (Contact Hub: updateContact({ id, ...fields })).
 *
 * UPDATE AND ROLLBACK
 *   - The new value is applied at once through onPatch (optimistic) and written with saveContactFields.
 *   - On failure ONLY that field goes back, to the last value known to be saved, and `error` says which field and why.
 *   - Per contact and field, the newest save decides. A failure of an older save never rolls back over a newer
 *     value; a failure of the newest goes back to the last value that was saved (not necessarily the original);
 *     saves that finish out of order cannot move that value backwards.
 *   - Different fields never touch each other. Different contacts never touch each other: every operation carries
 *     the contact id it began with, so a result that arrives after the person moved on is applied to that contact.
 *
 * EDIT SESSION. commit() saves once however many times it is called (Enter, then the blur that follows it); cancel()
 * ends the session so the blur that follows Escape saves nothing. A session belongs to one contact: moving to
 * another contact ends it without saving.
 *
 * ACCOUNT AND PERMISSION. The account the contact was shown under is remembered; every save compares it with the
 * live account (here and again at the write, in saveContactFields) and is refused, with nothing written, when there
 * is no user, the session is impersonated, or the account has changed. When a write fails after the account
 * changed, nothing is restored or reported: the other account's state is not touched.
 */
import { useEffect, useRef, useState } from 'react';
import { getEffectiveUser, useImpersonation } from '../../../context/ImpersonationContext';
import { saveContactFields } from '../../../services/contactFields';
import { STORE_FIELD, isEditable, planEdit, startValue } from './identityEditRules';

function liveAccount() {
  try {
    const user = getEffectiveUser();
    return { uid: user?.uid || null, impersonated: Boolean(user?._isImpersonated) };
  } catch {
    return { uid: null, impersonated: false };
  }
}

const refused = (reason) => ({ status: 'refused', reason });

export function useContactIdentityEdit({ contact, onPatch }) {
  const { isImpersonating } = useImpersonation();
  const contactId = typeof contact?.id === 'string' && contact.id !== '' ? contact.id : null;
  // The account this contact was shown under. Re-read when the contact changes (state set during render, which React allows).
  const [owner, setOwner] = useState(() => ({ contactId, uid: liveAccount().uid }));
  if (owner.contactId !== contactId) setOwner({ contactId, uid: liveAccount().uid });
  const ownerUid = owner.contactId === contactId ? owner.uid : liveAccount().uid;

  const [editingState, setEditingState] = useState(null); // { contactId, field, value }
  const [errorState, setErrorState] = useState(null); // { contactId, field, code }
  const [savingKeys, setSavingKeys] = useState(() => new Set());

  const latest = useRef(contact);
  const patchRef = useRef(onPatch);
  const session = useRef(null); // { contactId, field, value }: the synchronous guard behind commit/cancel
  const entries = useRef(new Map()); // `${contactId}:${storeField}` → { confirmed, confirmedSeq, seq, inflight }
  const mounted = useRef(true);
  useEffect(() => { latest.current = contact; }, [contact]);
  useEffect(() => { patchRef.current = onPatch; }, [onPatch]);
  useEffect(() => () => { mounted.current = false; }, []);

  const canEdit = Boolean(contactId) && typeof onPatch === 'function' && !isImpersonating
    && Boolean(ownerUid) && liveAccount().uid === ownerUid;
  const editable = (field) => canEdit && isEditable(contact, field);

  function start(field) {
    if (!editable(field)) return false;
    const value = startValue(contact, field);
    session.current = { contactId, field, value };
    setEditingState({ contactId, field, value });
    return true;
  }

  function setValue(value) {
    const s = session.current;
    if (!s) return;
    s.value = value;
    setEditingState({ contactId: s.contactId, field: s.field, value });
  }

  function cancel() {
    session.current = null;
    setEditingState(null);
  }

  function setSaving(key, on) {
    if (!mounted.current) return;
    setSavingKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });
  }

  async function run(field, raw, wantedContactId) {
    const current = latest.current;
    const patch = patchRef.current;
    if (!current?.id || typeof patch !== 'function') return refused('no_contact');
    if (wantedContactId && current.id !== wantedContactId) return refused('contact_changed');
    const account = liveAccount();
    if (!account.uid) return refused('no_user');
    if (account.impersonated) return refused('read_only');
    if (!ownerUid || account.uid !== ownerUid) return refused('account_changed');

    const plan = planEdit(current, field, raw);
    if (!plan.ok) return plan.reason === 'unchanged' ? { status: 'unchanged' } : refused(plan.reason);

    const id = current.id;
    const { storeField, value } = plan;
    const key = `${id}:${storeField}`;
    let entry = entries.current.get(key);
    if (!entry) {
      entry = { confirmed: plan.previous, confirmedSeq: 0, seq: 0, inflight: 0 };
      entries.current.set(key, entry);
    }
    const seq = (entry.seq += 1);
    entry.inflight += 1;

    if (mounted.current) setErrorState((prev) => (prev && prev.contactId === id && prev.field === field ? null : prev));
    setSaving(key, true);
    patch(id, { [storeField]: value });

    try {
      await saveContactFields(id, { [storeField]: value }, { expectUid: ownerUid });
      if (seq > entry.confirmedSeq) {
        entry.confirmed = value;
        entry.confirmedSeq = seq;
      }
      return { status: 'saved' };
    } catch (error) {
      const code = typeof error?.code === 'string' && error.code ? error.code : 'write_failed';
      console.warn('[contact-identity] save failed', { code });
      // Fail closed: if the account is no longer the one this edit began under, touch nothing.
      if (!ownerUid || liveAccount().uid !== ownerUid) return { status: 'failed', reason: code };
      // Only the newest save for this field may undo it, and only back to the last saved value.
      if (seq === entry.seq) {
        patchRef.current?.(id, { [storeField]: entry.confirmed });
        if (mounted.current) setErrorState({ contactId: id, field, code });
      }
      return { status: 'failed', reason: code };
    } finally {
      entry.inflight -= 1;
      if (entry.inflight === 0 && entries.current.get(key) === entry) entries.current.delete(key);
      setSaving(key, false);
    }
  }

  function save(field, raw) {
    return run(field, raw, null);
  }

  function commit() {
    const s = session.current;
    if (!s) return Promise.resolve({ status: 'ignored' });
    session.current = null;
    setEditingState(null);
    return run(s.field, s.value, s.contactId);
  }

  const editing = editingState && editingState.contactId === contactId
    ? { field: editingState.field, value: editingState.value }
    : null;
  const error = errorState && errorState.contactId === contactId
    ? { field: errorState.field, code: errorState.code }
    : null;
  const isSaving = (field) => savingKeys.has(`${contactId}:${STORE_FIELD[field]}`);

  return { canEdit, editable, editing, error, isSaving, start, setValue, cancel, commit, save, clearError: () => setErrorState(null) };
}

export default useContactIdentityEdit;
