/**
 * ConnectedPersonHeader — the redesigned profile's header, connected to the contact system.
 *
 *   <StickersProvider uid={uid}>
 *     <ConnectedPersonHeader contact={contact} onPatch={(contactId, fields) => …} />
 *   </StickersProvider>
 *
 * THIN. It adds no editing, photo or sticker logic of its own. It calls the controllers that own them, and hands
 * PersonHeader (which only draws) what it needs:
 *   useContactIdentityEdit   name, title, organization: optimistic saves, field-only rollback, Cancel, retry
 *   useContactPhotoEdit      add, replace, remove the photo (one change at a time)
 *   useContactStickers       the SHARED sticker behaviour (add, remove, create, Undo, Retry, pending, the 50 limit)
 *   ContactIdentityViewer    the existing photo viewer
 *   StickerPicker            the existing picker
 * Persistence is the contact's own document (saveContactFields) and the sticker services; nothing else is written.
 *
 * ONE CALLBACK, ID-ADDRESSED. onPatch(contactId, fields) is told which contact and ONLY the fields that changed.
 * Contact Hub's updateContact merges a patch by id (`updateContact({ id, ...fields })`); a parent that stores
 * whatever it is given as "the contact on screen" (Scout's profile) must not be used with it.
 * onLateStickerChange(contactId, stickerId, op), optional, is told of a sticker change that finished after the
 * person had moved to another contact (the shared hook's onLateUpdate: only for the same account).
 *
 * ONE PER CONTACT. The inner component is keyed by contact id, so every piece of state (an open editor, a pending
 * sticker, an open panel) belongs to one contact, and a result that arrives late can never be applied to the next.
 *
 * PERMISSION. Editing needs a signed-in owner (not an impersonated session). Stickers need the page's provider to say
 * they are available and writable (it renders nothing otherwise, as the row does). The photo may always be viewed.
 */
import { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '../../../hooks/useIsMobile';
import PersonHeader from './PersonHeader';
import PhotoPanel from './PhotoPanel';
import { resolvePhotoOverride } from './contactPhotoOverride';
import { resolveContactPhotoSources } from '../../../utils/contactPhoto';
import { buildPersonHeaderModel } from './personHeaderModel';
import { EDIT_FIELDS } from './personHeaderContract';
import { useContactIdentityEdit } from './useContactIdentityEdit';
import { useContactPhotoEdit } from './useContactPhotoEdit';
import { identityFailureMessage, identityProblemMessage } from './profileMessages';
import ContactIdentityViewer from '../ContactIdentityViewer';
import StickerPicker from '../../stickers/StickerPicker';
import { useStickers } from '../../stickers/stickersRegistry';
import { useContactStickers } from '../../stickers/useContactStickers';

export default function ConnectedPersonHeader({ contact, onPatch, onLateStickerChange, headingLevel = 1, compactMobileHeader = false, photoEditor, onEmail }) {
  const stickers = useStickers();
  const isMobile = useIsMobile();
  if (!contact?.id) return null;
  return <Connected key={contact.id} contact={contact} onPatch={onPatch} onLateStickerChange={onLateStickerChange} headingLevel={headingLevel} compactHeader={compactMobileHeader && isMobile} stickers={stickers} photoEditor={photoEditor} onEmail={onEmail} />;
}

function Connected({ contact, onPatch, onLateStickerChange, headingLevel, compactHeader, stickers, photoEditor, onEmail }) {
  const edit = useContactIdentityEdit({ contact, onPatch });
  const photo = useContactPhotoEdit({ contact, onPatch, saveOverride: photoEditor?.saveOverride });

  // The shared sticker behaviour reports a whole contact; this parent takes id-addressed fields, so only what changed is sent.
  const latest = useRef(contact);
  useEffect(() => { latest.current = contact; }, [contact]);
  const st = useContactStickers({
    contact,
    stickers,
    onLateUpdate: onLateStickerChange,
    onUpdate: (next) => {
      const fields = {};
      for (const key of Object.keys(next)) if (next[key] !== latest.current[key]) fields[key] = next[key];
      if (Object.keys(fields).length > 0) onPatch?.(next.id, fields);
    },
  });
  const ready = stickers.ready;

  // The photo: viewing is for everyone; changing needs the photo hook's permission.
  const [viewerOpen, setViewerOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const returnFocus = useRef(false);
  const photoButtonRef = useRef(null);
  const photoEditButtonRef = useRef(null);
  // After the panel has closed by Save, Cancel or Escape, focus goes back to the control that opened it.
  useEffect(() => {
    if (!returnFocus.current || panelOpen) return;
    returnFocus.current = false;
    (photoEditButtonRef.current ?? photoButtonRef.current)?.focus();
  }, [panelOpen]);
  const closePanel = (withFocus) => { returnFocus.current = Boolean(withFocus); setPanelOpen(false); };

  const person = buildPersonHeaderModel(contact, { stickersById: null });
  const photoSources = photoEditor ? resolvePhotoOverride(contact) : undefined;
  const withStickers = {
    ...person,
    avatar: photoSources ? { ...person.avatar, photoUrl: photoSources.thumbnail } : person.avatar,
    stickers: ready ? st.chips.map(({ sticker, busy }) => ({ id: sticker.id, name: sticker.name, color: sticker.color, emoji: sticker.emoji ?? null, busy })) : null,
  };

  const editing = {
    editable: Object.fromEntries(EDIT_FIELDS.map((field) => [field, edit.editable(field)])),
    active: edit.editing,
    saving: Object.fromEntries(EDIT_FIELDS.map((field) => [field, edit.isSaving(field)])),
    problem: edit.problem ? { field: edit.problem.field, message: identityProblemMessage(edit.problem) } : null,
    failure: edit.error ? { field: edit.error.field, message: identityFailureMessage(edit.error) } : null,
    onChange: edit.setValue,
    onSubmit: edit.commit,
    onCancel: () => { edit.cancel(); edit.clearError(); },
  };

  const hasPhoto = photoSources ? Boolean(photoSources.full) : photo.hasPhoto;
  const canEditPhoto = photo.canEdit && (!photoEditor || Boolean(photoEditor.saveOverride));
  const canAddPhoto = canEditPhoto && !hasPhoto;
  const onPhotoClick = hasPhoto
    ? () => setViewerOpen(true)
    : canAddPhoto ? () => setPanelOpen((open) => !open) : undefined;

  const actions = {
    onEdit: edit.start,
    onPhotoClick,
    onEmail,
    onAddSticker: ready ? () => (st.open ? st.closePicker() : st.setOpen(true)) : undefined,
    onRemoveSticker: ready
      ? ({ id }) => { const chip = st.chips.find((c) => c.sticker.id === id); if (chip) st.change('remove', chip.sticker); }
      : undefined,
  };

  const Editor = photoEditor?.Editor;
  const panel = panelOpen && canEditPhoto ? (Editor ? (
    <Editor currentPhoto={photoSources.full} originalPhoto={resolveContactPhotoSources(contact).full} overrideKind={contact.photoOverride?.kind}
      saving={photo.saving} failure={photo.error} onSave={photo.setOverride} onClose={closePanel} clearError={photo.clearError} />
  ) : (
    <PhotoPanel
      hasPhoto={hasPhoto}
      saving={photo.saving}
      failure={photo.error}
      onSave={photo.setUrl}
      onRemove={photo.remove}
      onClose={closePanel}
    />
  )) : null;

  return (
    <>
      <PersonHeader
        person={withStickers}
        headingLevel={headingLevel}
        compactHeader={compactHeader}
        actions={actions}
        editing={editing}
        photoButtonRef={photoButtonRef}
        photoEdit={canEditPhoto && hasPhoto ? { onEdit: () => { photo.clearError(); setPanelOpen((open) => !open); }, saving: photo.saving, panel } : { panel }}
        photoEditButtonRef={photoEditButtonRef}
        addStickerRef={st.buttonRef}
        addStickerOpen={ready && st.open}
        addStickerPanel={ready && st.open ? (
          <StickerPicker
            stickers={st.active}
            assignedIds={st.assigned}
            pendingIds={st.pendingIds}
            recentIds={st.recentIds}
            atLimit={st.atLimit}
            onPick={st.pick}
            onCreate={st.create}
            onClose={st.closePicker}
            ignoreRef={st.buttonRef}
          />
        ) : null}
      />
      <ContactIdentityViewer contact={contact} photoSources={photoSources} open={viewerOpen && hasPhoto} onClose={() => setViewerOpen(false)} returnFocusRef={photoButtonRef} />
    </>
  );
}
