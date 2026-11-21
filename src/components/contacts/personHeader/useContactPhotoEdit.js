/**
 * useContactPhotoEdit — adding, replacing and removing a contact's photo from the header.
 *
 *   const photo = useContactPhotoEdit({ contact, onPatch });
 *
 * The same rules as the identity hook, for the one photo field the contact already has:
 *   - ID-ADDRESSED, FIELD-LEVEL. onPatch(contactId, fields) is told which contact and only the fields that changed
 *     (photo_url, and photo_source when a new address is set). Never a whole contact.
 *   - OPTIMISTIC, THEN SAVED. The change shows at once; saveContactFields writes it. On failure ONLY those fields go
 *     back to what they were, and `error` says why (a code, never the address).
 *   - ONE CHANGE AT A TIME. While one is in flight another is refused ('busy'), not queued, so the order of results
 *     can never matter and a stale failure can never undo a newer change.
 *   - FAIL CLOSED FOR THE ACCOUNT. Refused, with nothing written, with no user, an impersonated session, or an
 *     account other than the one the contact was shown under (compared with the live account here and again at the
 *     write). After the account changed nothing is restored or reported.
 *
 * It holds no draft: the address being typed lives in the panel that asks for it.
 */
import { useEffect, useRef, useState } from 'react';
import { getEffectiveUser, useImpersonation } from '../../../context/ImpersonationContext';
import { saveContactFields } from '../../../services/contactFields';
import { hasRealContactPhoto } from '../../../utils/contactPhoto';
import { planPhotoOverride, resolvePhotoOverride } from './contactPhotoOverride';
import { planPhotoRemove, planPhotoSet } from './photoEditRules';

function liveAccount() {
  try {
    const user = getEffectiveUser();
    return { uid: user?.uid || null, impersonated: Boolean(user?._isImpersonated) };
  } catch {
    return { uid: null, impersonated: false };
  }
}

const refused = (reason) => ({ status: 'refused', reason });

export function useContactPhotoEdit({ contact, onPatch, saveOverride }) {
  const { isImpersonating } = useImpersonation();
  const contactId = typeof contact?.id === 'string' && contact.id !== '' ? contact.id : null;
  const [owner, setOwner] = useState(() => ({ contactId, uid: liveAccount().uid }));
  if (owner.contactId !== contactId) setOwner({ contactId, uid: liveAccount().uid });
  const ownerUid = owner.contactId === contactId ? owner.uid : liveAccount().uid;

  const [savingId, setSavingId] = useState(null);
  const [errorState, setErrorState] = useState(null); // { contactId, code }
  const latest = useRef(contact);
  const patchRef = useRef(onPatch);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { latest.current = contact; }, [contact]);
  useEffect(() => { patchRef.current = onPatch; }, [onPatch]);
  useEffect(() => () => { mounted.current = false; }, []);

  const canEdit = Boolean(contactId) && typeof onPatch === 'function' && !isImpersonating
    && Boolean(ownerUid) && liveAccount().uid === ownerUid;

  async function run(plan, save = saveContactFields) {
    const current = latest.current;
    const patch = patchRef.current;
    if (!current?.id || typeof patch !== 'function') return refused('no_contact');
    const account = liveAccount();
    if (!account.uid) return refused('no_user');
    if (account.impersonated || isImpersonating) return refused('read_only');
    if (!ownerUid || account.uid !== ownerUid) return refused('account_changed');
    if (inFlight.current) return refused('busy');
    const planned = plan(current);
    if (!planned.ok) return planned.reason === 'unchanged' ? { status: 'unchanged' } : refused(planned.reason);

    const id = current.id;
    inFlight.current = true;
    if (mounted.current) { setSavingId(id); setErrorState(null); }
    patch(id, planned.patch);
    try {
      await save(id, planned.patch, { expectUid: ownerUid });
      return { status: 'saved' };
    } catch (error) {
      const code = typeof error?.code === 'string' && error.code ? error.code : 'write_failed';
      console.warn('[contact-photo] save failed', { code });
      // Fail closed: if the account is no longer the one this began under, touch nothing.
      if (!ownerUid || liveAccount().uid !== ownerUid) return { status: 'failed', reason: code };
      // Put back only the fields this change touched, on the contact it was for.
      const back = Object.fromEntries(Object.keys(planned.patch).map((key) => [key, planned.previous[key]]));
      patchRef.current?.(id, back);
      if (mounted.current) setErrorState({ contactId: id, code });
      return { status: 'failed', reason: code };
    } finally {
      inFlight.current = false;
      if (mounted.current) setSavingId(null);
    }
  }

  return {
    canEdit,
    hasPhoto: saveOverride ? Boolean(resolvePhotoOverride(contact).full) : hasRealContactPhoto(contact),
    setOverride: saveOverride ? (value) => run((c) => planPhotoOverride(c, value), saveOverride) : undefined,
    saving: savingId !== null && savingId === contactId,
    error: errorState && errorState.contactId === contactId ? { code: errorState.code } : null,
    setUrl: (raw) => run((c) => planPhotoSet(c, raw)),
    remove: () => run((c) => planPhotoRemove(c)),
    clearError: () => setErrorState(null),
  };
}

export default useContactPhotoEdit;
