import { useEffect, useRef, useState } from 'react';
import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import ConnectedPersonHeader from '../../components/contacts/personHeader/ConnectedPersonHeader';
import ContactPhotoEditor from '../../components/contacts/personHeader/ContactPhotoEditor';

const enabled = import.meta.env.VITE_CONTACT_HUB_PHOTO_OVERRIDES === 'on';
const mayWrite = (uid) => {
  const effective = getEffectiveUser();
  return Boolean(uid && auth.currentUser?.uid === uid && effective?.uid === uid && !effective._isImpersonated);
};
const markerFor = (override) => override === null ? null : override.kind === 'hidden' ? 'hidden' : 'custom';
const codeFor = { read_only: 'permission-denied', sign_in: 'permission-denied', photo_changed: 'photo_changed' };

export default function ContactHubPhotoHeader({ uid, readOnly, contact, onPatch, onLateStickerChange }) {
  const [photo, setPhoto] = useState({ status: 'loading', override: null, version: null });
  const active = useRef(true);
  const hasAccess = enabled && !readOnly && mayWrite(uid);

  useEffect(() => {
    active.current = true;
    if (hasAccess) {
      getDocFromServer(doc(db, 'users', uid, 'contacts', contact.id, 'private', 'photo'))
        .then((snapshot) => {
          if (!active.current || !mayWrite(uid)) return;
          const data = snapshot.data();
          setPhoto({
            status: 'ready',
            override: data ?? null,
            version: data ? `${data.updatedAt.seconds}:${data.updatedAt.nanoseconds}` : null,
          });
        })
        .catch(() => { if (active.current) setPhoto({ status: 'unavailable', override: null, version: null }); });
    }
    return () => { active.current = false; };
  }, [hasAccess, uid, contact.id]);

  async function saveOverride(id, { photoOverride }, { expectUid }) {
    const assertOwner = () => {
      if (!hasAccess || expectUid !== uid || !mayWrite(uid)) throw Object.assign(new Error('Account changed'), { code: 'permission-denied' });
    };
    assertOwner();
    const token = await auth.currentUser.getIdToken();
    assertOwner();
    const response = await fetch('/.netlify/functions/contact-photo-write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ uid, contactId: id, photo: photoOverride, expectedVersion: photo.version }),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error('Photo save failed'), { code: codeFor[result.error] ?? 'unavailable' });
    assertOwner();
    if (active.current) setPhoto((current) => ({ ...current, version: result.version }));
    // Publish to the list only after the trusted writer has committed.
    onPatch(id, { contact_hub_photo: markerFor(photoOverride) });
  }

  function patchHeader(id, fields) {
    if (Object.hasOwn(fields, 'photoOverride')) {
      if (active.current && mayWrite(uid)) setPhoto((current) => ({ ...current, override: fields.photoOverride }));
    } else onPatch(id, fields);
  }

  const ready = hasAccess && photo.status === 'ready';
  const photoEditor = ready ? { Editor: ContactPhotoEditor, saveOverride }
    : enabled || contact.contact_hub_photo ? {} : undefined;
  const shown = ready ? { ...contact, photoOverride: photo.override, contact_hub_photo: markerFor(photo.override) } : contact;
  return <ConnectedPersonHeader compactMobileHeader contact={shown} photoEditor={photoEditor}
    onPatch={patchHeader} onLateStickerChange={onLateStickerChange} />;
}
