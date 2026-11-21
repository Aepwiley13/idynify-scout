/**
 * PersonHeader — a person's identity, drawn as a relationship card.
 *
 *   <PersonHeader person={model} />
 *
 * PRESENTATION ONLY. It draws a PersonHeaderModel (personHeaderModel.js) and nothing
 * else: it is handed no contact, no sticker registry, no service and no plan, imports
 * none of them, reads nothing and writes nothing. The same header can therefore be
 * drawn from Contact Hub today and from Scout later.
 *
 * WHAT IS ON IT, top to bottom and left to right:
 *   the photo (or the initials), with a quiet activity dot
 *   the name, then "Title · Organization", then the location, as text
 *   the primary phone and email as pills, and a button-sized link for each social profile
 *   the person's stickers, as soft pills (where stickers are available)
 * A part the model has nothing for is left out, and the layout closes up around it.
 *
 * NO DEAD CONTROLS. Everything here that can be pressed is a link that really goes
 * somewhere (tel:, mailto:, the profile), or an edit control the parent has made usable.
 * There is no photo, add-sticker or remove-sticker control yet, so none is drawn; the
 * contract's callbacks (personHeaderContract.js) arrive with the behaviour they belong to.
 * onContactAction is only told that a link was used.
 *
 * INLINE EDITING (H2-2). With actions.onEdit and an `editing` prop the name, title and
 * organization each get an edit button (44px to hit), which opens a box in place. The box
 * shows exactly `editing.active.value` and reports every change: the header keeps NO draft,
 * reads and writes nothing, and imports no service. Enter submits, Escape cancels, leaving
 * the box submits; each of those is reported ONCE (a leave after Enter or Escape, a held
 * Enter and an Enter inside an input method's composition are not a second submit). Why a
 * name was refused or a save failed is the parent's text, shown with aria-invalid and
 * aria-describedby and announced in a polite live region. Focus: after Enter, Escape, Try
 * again or Cancel it goes back to the line's edit button; after leaving the box it is NOT
 * moved (the person is going somewhere); a box that reopens by itself after a failure takes
 * focus only if the person is not using something else.
 *
 * LONG AND UNUSUAL TEXT. The model keeps every value complete; the stylesheet does the
 * fitting: words wrap anywhere they must, a name is clamped to three lines and the
 * subtitle to two, a pill ends in an ellipsis. Whatever is cut by the eye is whole for
 * a screen reader and for a hover: the full text is the element's own text, its title,
 * and (for a pill) its accessible name. Text direction follows the text (dir="auto").
 *
 * COLOUR. The card follows the app theme through its variables (src/index.css). The
 * purple accent comes from the design tokens (BRAND) and is mixed toward the theme's
 * own text colour, so it is deep on a light theme and light on a dark one; a sticker
 * keeps its own colour, in the same tint the existing sticker chips use.
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import { Camera, Facebook, Instagram, Linkedin, Mail, MapPin, MoreHorizontal, Pencil, Phone, Plus, X } from 'lucide-react';
import { BRAND } from '../../../theme/tokens';
import { hexOf, TINT_ALPHA, BORDER_ALPHA } from '../../stickers/stickerPalette';
import { EDIT_LABEL, editState, headerParts } from './personHeaderContract';
import './PersonHeader.css';

const SOCIAL_ICONS = Object.freeze({ linkedin: Linkedin, instagram: Instagram, facebook: Facebook });

// The identity accent, from the design tokens: this file holds the one place the header's brand colours are named.
const ACCENT = Object.freeze({
  '--ph-purple': BRAND.purple,
  '--ph-indigo': BRAND.indigo,
  '--ph-pink': BRAND.pink,
});

// A link is drawn only to an address of the kind it is for, whatever the model holds: a phone is tel:, an email is
// mailto:, a profile is https:. The model already makes only these; this is the component not trusting that alone.
const SAFE_HREF = Object.freeze({
  phone: /^tel:\+?\d{7,15}$/,
  email: /^mailto:[^\s,;?&#"'<>]+$/,
  social: /^https:\/\/[^\s"'<>]+$/,
});
const safe = (kind, href) => typeof href === 'string' && SAFE_HREF[kind].test(href);

const clampLevel = (level) => Math.min(6, Math.max(1, Number.isInteger(level) ? level : 2));

function Avatar({ person, onPhotoClick, photoButtonRef, photoEdit, photoEditButtonRef, compactHeader }) {
  const { initials, photoUrl } = person.avatar;
  // A photo that does not load falls back to the initials, for that address only.
  const [failedUrl, setFailedUrl] = useState(null);
  const showPhoto = Boolean(photoUrl) && failedUrl !== photoUrl;
  const { active } = person.activity;
  const photoAction = compactHeader && photoUrl && !showPhoto ? photoEdit?.onEdit : onPhotoClick;
  const showAddLabel = compactHeader && !showPhoto && typeof photoAction === 'function';
  const picture = (
    <span className="ph-avatar" aria-hidden="true">
      {showPhoto ? (
        <img
          className="ph-avatar-img"
          src={photoUrl}
          alt=""
          // A signed profile-picture address does not load when the page names itself as the referrer.
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(photoUrl)}
        />
      ) : (
        <>
          <span className="ph-avatar-initials" dir="auto">{initials}</span>
          {showAddLabel && <span className="ph-avatar-add-label">Add photo</span>}
        </>
      )}
    </span>
  );
  return (
    <div className="ph-avatar-wrap">
      {typeof photoAction === 'function' ? (
        // A button only when the parent can do something with a press: view the photo, or add one.
        <button
          type="button"
          ref={photoButtonRef}
          className={showAddLabel ? "ph-avatar-btn ph-avatar-btn--add" : "ph-avatar-btn"}
          aria-label={showPhoto ? `View photo of ${person.name}` : `Add photo for ${person.name}`}
          aria-haspopup={showPhoto ? 'dialog' : 'true'}
          onClick={photoAction}
        >
          {picture}
        </button>
      ) : picture}
      <span
        className={`ph-activity ph-activity--${active ? 'on' : 'off'}`}
        role="img"
        aria-label={active ? 'Active in the last 30 days' : 'No recent activity'}
        title={active ? 'Active in the last 30 days' : 'No recent activity'}
      />
      {!compactHeader && showPhoto && typeof photoEdit?.onEdit === 'function' ? (
        <button
          type="button"
          ref={photoEditButtonRef}
          className="ph-photo-edit"
          aria-label="Change photo"
          aria-haspopup="true"
          aria-busy={photoEdit.saving ? 'true' : undefined}
          onClick={photoEdit.onEdit}
        >
          {photoEdit.saving ? <span className="ph-spinner" aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />}
        </button>
      ) : null}
      {photoEdit?.panel ?? null}
    </div>
  );
}

function StickerPill({ sticker, onRemove }) {
  const hex = hexOf(sticker.color);
  const busy = sticker.busy === true;
  return (
    <li
      className="ph-sticker"
      style={{ '--ph-sticker-tint': `${hex}${TINT_ALPHA}`, '--ph-sticker-border': `${hex}${BORDER_ALPHA}`, '--ph-sticker-dot': hex }}
      title={sticker.name}
      aria-busy={busy ? 'true' : undefined}
    >
      {sticker.emoji
        ? <span className="ph-sticker-emoji" aria-hidden="true">{sticker.emoji}</span>
        : <span className="ph-sticker-dot" aria-hidden="true" />}
      <span className="ph-sticker-name" dir="auto">{sticker.name}</span>
      {onRemove ? (
        // 32px to see, 44px to hit (the ::after). Not available while this sticker is being added or removed.
        <button
          type="button"
          className="ph-sticker-remove"
          aria-label={`Remove sticker ${sticker.name}`}
          disabled={busy}
          onClick={() => onRemove({ id: sticker.id, name: sticker.name })}
        >
          {busy ? <span className="ph-spinner" aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
        </button>
      ) : busy ? <span className="ph-spinner" aria-hidden="true" /> : null}
    </li>
  );
}

// ─── Editing (H2-2): what the header draws when the parent has made editing usable ───

const FIELD_NAME = Object.freeze({ name: 'Name', title: 'Title', organization: 'Organization' });
/** An edit control the person pressed counts as "the person opened this" for this long (ms). */
const OPENED_BY_PERSON_MS = 1500;

/**
 * Where focus goes, and where it must not. Holds refs and flags only, never text.
 *   (the edit buttons and the box are found inside `root` by data-edit-trigger / data-edit-input)
 *   noteOpened       the person pressed an edit button: focus the box that opens
 *   returnTo         Enter, Escape, Try again or Cancel: put focus back on the button once the box has gone
 *   settled/…        the guard against a second submit from the same box
 */
function useEditFocus(edit, root) {
  const openedByPerson = useRef(null); // { field, at }
  const returnTo = useRef(null);
  const settled = useRef(false);
  const lastActive = useRef(null);
  const failureField = edit.failure?.field ?? null;
  const activeField = edit.active?.field ?? null;

  const trigger = (field) => root.current?.querySelector(`[data-edit-trigger="${field}"]`) ?? root.current?.querySelector('.ph-profile-menu-trigger');

  useEffect(() => {
    const was = lastActive.current;
    lastActive.current = activeField;
    if (activeField && was !== activeField) {
      settled.current = false;
      const mine = openedByPerson.current;
      openedByPerson.current = null;
      const byPerson = mine && mine.field === activeField && Date.now() - mine.at < OPENED_BY_PERSON_MS;
      const resting = document.activeElement;
      const idle = !resting || resting === document.body || resting === trigger(activeField);
      // A box the person asked for takes focus. A box that reopens by itself (a failed save) takes it only from nothing.
      const box = root.current?.querySelector('[data-edit-input]');
      if ((byPerson || (failureField === activeField && idle)) && box) {
        box.focus();
        // A box the person opened selects its text, to replace it. One that comes back by itself after a failed save
        // keeps the caret at the end, so the text they entered is not wiped by their next keystroke.
        if (byPerson) box.select?.();
        else box.setSelectionRange?.(box.value.length, box.value.length);
      }
    }
    if (returnTo.current) {
      const field = returnTo.current;
      returnTo.current = null;
      if (!activeField) trigger(field)?.focus();
    }
  });

  return {
    noteOpened: (field) => { openedByPerson.current = { field, at: Date.now() }; },
    returnTo: (field) => { returnTo.current = field; },
    settle: () => { settled.current = true; },
    unsettle: () => { settled.current = false; },
    isSettled: () => settled.current,
  };
}

function EditButton({ field, label, edit, refs, onEdit }) {
  const saving = edit.saving[field];
  return (
    <button
      type="button"
      className="ph-edit"
      data-edit-trigger={field}
      aria-label={label}
      aria-busy={saving ? 'true' : undefined}
      title={label}
      onClick={() => { refs.noteOpened(field); onEdit(field); }}
    >
      {saving ? <span className="ph-spinner" aria-hidden="true" /> : <Pencil size={16} aria-hidden="true" />}
    </button>
  );
}

function FieldMessage({ message }) {
  return <p className="ph-field-msg" data-kind="failure">{message}</p>;
}

function FieldEditor({ field, edit, refs }) {
  const { value } = edit.active;
  const message = edit.problem?.message || edit.failure?.field === field ? (edit.problem?.message ?? edit.failure.message) : '';
  const kind = edit.problem ? 'problem' : message ? 'failure' : null;
  const messageId = `ph-msg-${field}`;
  const keep = (event) => event.preventDefault(); // pressing Try again or Cancel must not blur the box first

  const submit = () => { refs.returnTo(field); refs.settle(); edit.onSubmit(); };
  const cancel = () => { refs.returnTo(field); refs.settle(); edit.onCancel(); };

  return (
    <div className={`ph-editor ph-editor--${field}`}>
      {/* The box, and beside it a Cancel that is always there: on a phone there is no Escape. Same row, so it adds no height. */}
      <div className="ph-editor-row">
        <input
          data-edit-input=""
          className={`ph-input ph-input--${field}`}
          type="text"
          value={value}
          dir="auto"
          aria-label={FIELD_NAME[field]}
          aria-invalid={message ? 'true' : 'false'}
          aria-describedby={message ? messageId : undefined}
          autoComplete="off"
          autoCapitalize={field === 'name' ? 'words' : 'sentences'}
          enterKeyHint="done"
          spellCheck={false}
          onChange={(event) => { refs.unsettle(); edit.onChange(event.target.value); }}
          onKeyDown={(event) => {
            if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              if (event.repeat) return;
              refs.returnTo(field);
              refs.settle();
              edit.onSubmit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancel();
            }
          }}
          onBlur={(event) => {
            if (refs.isSettled()) return;
            // Moving onto the editor's own Cancel or Try again is not leaving the editor.
            if (event.relatedTarget && event.currentTarget.closest('.ph-editor')?.contains(event.relatedTarget)) return;
            refs.settle();
            edit.onSubmit(); // leaving the box saves; focus is not moved (the person is going somewhere)
          }}
        />
        <button type="button" className="ph-editor-btn ph-editor-cancel" onMouseDown={keep} onClick={cancel}>Cancel</button>
      </div>
      {message ? (
        <div className="ph-editor-foot">
          <p id={messageId} className="ph-editor-msg" data-kind={kind}>{message}</p>
          {kind === 'failure' ? (
            <span className="ph-editor-actions">
              <button type="button" className="ph-editor-btn" onMouseDown={keep} onClick={submit}>Try again</button>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The title and the organization, each with its own edit control, an "Add" control when empty, or its editor. */
function SubtitleEditable({ person, edit, refs, onEdit, compactHeader }) {
  const part = (field, value) => {
    if (edit.active?.field === field) return <FieldEditor key={field} field={field} edit={edit} refs={refs} />;
    // A failed save with no box open is said beside its line, not inside it, so it cannot squeeze the line.
    const failed = edit.failure?.field === field ? <FieldMessage message={edit.failure.message} /> : null;
    if (value) {
      return (
        <Fragment key={field}>
          <span className="ph-subtitle-part ph-edit-part">
            <span className="ph-subtitle-text" dir="auto" title={value}>{value}</span>
            {edit.canEdit[field] && !compactHeader
              ? <EditButton field={field} label={`Edit ${EDIT_LABEL[field]}`} edit={edit} refs={refs} onEdit={onEdit} />
              : null}
          </span>
          {failed}
        </Fragment>
      );
    }
    if (!edit.canEdit[field] || compactHeader) return failed;
    return (
      <Fragment key={field}>
        <span className="ph-subtitle-part ph-edit-part">
          <button
            type="button"
            className="ph-add-field"
            data-edit-trigger={field}
            aria-label={`Add ${EDIT_LABEL[field]}`}
            aria-busy={edit.saving[field] ? 'true' : undefined}
            onClick={() => { refs.noteOpened(field); onEdit(field); }}
          >
            {edit.saving[field] ? <span className="ph-spinner" aria-hidden="true" /> : null}
            Add {EDIT_LABEL[field]}
          </button>
        </span>
        {failed}
      </Fragment>
    );
  };
  const title = part('title', person.title);
  const organization = part('organization', person.organization);
  // No visible " · " here: in a row that wraps it can be stranded at a line's end, and each value has its own pencil.
  const both = Boolean(person.title && person.organization) && edit.active?.field !== 'title' && edit.active?.field !== 'organization';
  return (
    <div className="ph-subtitle ph-subtitle--edit" dir="auto">
      {title}
      {both ? <span className="ph-sr">, </span> : null}
      {organization}
    </div>
  );
}

function ProfileMenu({ person, edit, refs, onEdit, photoEdit, photoEditButtonRef }) {
  const fields = Object.keys(EDIT_LABEL).filter((field) => edit.canEdit[field]);
  const changePhoto = person.avatar.photoUrl && photoEdit?.onEdit;
  if (!fields.length && !changePhoto) return null;

  function choose(event, action) {
    const menu = event.currentTarget.closest('details');
    menu.open = false;
    menu.querySelector('summary').focus();
    action();
  }

  return <details className="ph-profile-menu"
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
    }}
    onKeyDown={(event) => {
      if (event.key !== 'Escape' || !event.currentTarget.open) return;
      event.preventDefault();
      event.currentTarget.open = false;
      event.currentTarget.querySelector('summary').focus();
    }}>
    <summary className="ph-profile-menu-trigger" aria-label="Edit profile" ref={changePhoto ? photoEditButtonRef : undefined}>
      <MoreHorizontal size={20} aria-hidden="true" />
    </summary>
    <div className="ph-profile-menu-actions">
      {fields.map((field) => {
        const value = person[field];
        return <button type="button" key={field} aria-busy={edit.saving[field] || undefined}
          onClick={(event) => choose(event, () => { refs.noteOpened(field); onEdit(field); })}>
          {value || field === 'name' ? 'Edit' : 'Add'} {EDIT_LABEL[field]}
        </button>;
      })}
      {changePhoto && <button type="button" aria-busy={photoEdit.saving || undefined}
        onClick={(event) => choose(event, changePhoto)}>Change photo</button>}
    </div>
  </details>;
}

/**
 * @param {object} props
 * @param {import('./personHeaderModel.js').PersonHeaderModel} props.person
 * @param {number} [props.headingLevel]  the name's heading level, 1 to 6 (default 2)
 * @param {import('./personHeaderContract.js').PersonHeaderActions} [props.actions]  onContactAction, and onEdit (begin an edit) when editing is offered
 * @param {import('./personHeaderContract.js').PersonHeaderEditing} [props.editing]  the inline editing state, controlled by the parent
 */
export default function PersonHeader({
  person, headingLevel = 2, actions = undefined, editing = undefined,
  photoButtonRef = undefined, photoEdit = undefined, photoEditButtonRef = undefined,
  addStickerRef = undefined, addStickerOpen = false, addStickerPanel = null, compactHeader = false,
}) {
  const edit = editState(actions, editing);
  const root = useRef(null);
  const refs = useEditFocus(edit, root);
  if (!person) return null;
  const parts = headerParts(person, actions);
  const Heading = `h${clampLevel(headingLevel)}`;
  const notify = typeof actions?.onContactAction === 'function' ? actions.onContactAction : null;
  const subtitle = [person.title, person.organization].filter(Boolean);
  const phone = parts.phone && safe('phone', person.phone.href) ? person.phone : null;
  const email = parts.email && safe('email', person.email.href) ? person.email : null;
  const social = parts.social ? person.social.filter((link) => SOCIAL_ICONS[link.platform] && safe('social', link.url)) : [];
  const hasContacts = Boolean(phone || email || social.length > 0);
  const stickers = parts.stickers ? person.stickers : null;
  const heading = <Heading className="ph-name" dir="auto" title={person.name}>{person.name}</Heading>;
  const editable = edit.canEdit.title || edit.canEdit.organization || edit.active?.field === 'title' || edit.active?.field === 'organization';
  const showSubtitle = parts.subtitle || editable;

  const stickerPills = stickers?.map((sticker) => (
    <StickerPill key={sticker.id} sticker={sticker}
      onRemove={!compactHeader && parts.controls.removeSticker ? actions.onRemoveSticker : null} />
  ));
  // Keep the picker in its anchor, outside the mobile scrolling region.
  const addSticker = parts.addSticker && <>
    <button type="button" ref={addStickerRef} className="ph-add-sticker" aria-label="Add sticker"
      aria-haspopup="listbox" aria-expanded={addStickerOpen ? 'true' : 'false'} onClick={actions.onAddSticker}>
      <Plus size={14} aria-hidden="true" />
      <span>Add sticker</span>
    </button>
    {addStickerPanel}
  </>;

  return (
    <article ref={root} className="ph" aria-label={`Contact: ${person.name}`} style={ACCENT}>
      {/* data-layout says which of the two optional rows exist (c: ways to reach them, s: stickers), so the layout closes up around a missing one. */}
      <div className="ph-card" data-layout={`${hasContacts ? 'c1' : 'c0'}${stickers ? 's1' : 's0'}`}>
        <Avatar compactHeader={compactHeader} person={person} onPhotoClick={actions?.onPhotoClick} photoButtonRef={photoButtonRef} photoEdit={photoEdit} photoEditButtonRef={photoEditButtonRef} />

        <div className="ph-identity">
          {compactHeader && <ProfileMenu person={person} edit={edit} refs={refs} onEdit={actions?.onEdit}
            photoEdit={photoEdit} photoEditButtonRef={photoEditButtonRef} />}
          {edit.active?.field === 'name' ? (
            <FieldEditor field="name" edit={edit} refs={refs} />
          ) : edit.canEdit.name ? (
            <div className="ph-line ph-line--name">
              {heading}
              {!compactHeader && <EditButton field="name" label="Edit name" edit={edit} refs={refs} onEdit={actions.onEdit} />}
            </div>
          ) : heading}
          {edit.failure?.field === 'name' && edit.active?.field !== 'name' ? <FieldMessage message={edit.failure.message} /> : null}
          {showSubtitle ? (
            editable ? (
              <SubtitleEditable compactHeader={compactHeader} person={person} edit={edit} refs={refs} onEdit={actions.onEdit} />
            ) : parts.subtitle ? (
              <p className="ph-subtitle" dir="auto" title={subtitle.join(' · ')}>
                {subtitle.map((part, index) => (
                  <span key={index} className="ph-subtitle-part">
                    {index > 0 ? <span className="ph-sep" aria-hidden="true"> · </span> : null}
                    {index > 0 ? <span className="ph-sr">, </span> : null}
                    {part}
                  </span>
                ))}
              </p>
            ) : null
          ) : null}
          {parts.location ? (
            <p className="ph-location" dir="auto" title={person.location}>
              <MapPin size={15} aria-hidden="true" className="ph-location-icon" />
              <span className="ph-sr">Location: </span>
              <span className="ph-location-text">{person.location}</span>
            </p>
          ) : null}
        </div>

        {hasContacts ? (
          <ul className="ph-contacts" aria-label="Ways to reach them">
            {phone ? (
              <li className="ph-contact">
                <a
                  className="ph-pill"
                  href={phone.href}
                  title={phone.text}
                  aria-label={`Call ${phone.text}`}
                  onClick={notify ? () => notify('phone', {}) : undefined}
                >
                  <Phone size={16} aria-hidden="true" className="ph-pill-icon" />
                  <span className="ph-pill-text">{phone.text}</span>
                </a>
              </li>
            ) : null}
            {email ? (
              <li className="ph-contact">
                <a
                  className="ph-pill"
                  href={email.href}
                  title={email.address}
                  aria-label={`Email ${email.address}`}
                  onClick={notify ? () => notify('email', {}) : undefined}
                >
                  <Mail size={16} aria-hidden="true" className="ph-pill-icon" />
                  <span className="ph-pill-text">{email.address}</span>
                </a>
              </li>
            ) : null}
            {social.map((link) => {
              const Icon = SOCIAL_ICONS[link.platform];
              return (
                <li key={`${link.platform}:${link.handle}`} className="ph-contact ph-contact--social">
                  <a
                    className="ph-social"
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${link.label}: ${link.handle}`}
                    aria-label={`${link.label} profile of ${person.name} (opens in a new tab)`}
                    onClick={notify ? () => notify('social', { platform: link.platform }) : undefined}
                  >
                    <Icon size={18} aria-hidden="true" />
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}

        {stickers && (compactHeader ? (
          <div className="ph-sticker-strip" role="group" aria-label="Contact stickers">
            {stickerPills.length > 0 && <ul className="ph-sticker-scroll" aria-label="Stickers" tabIndex={0}>{stickerPills}</ul>}
            {addSticker && <div className="ph-add-sticker-item">{addSticker}</div>}
          </div>
        ) : (
          <ul className={`ph-stickers${parts.controls.addSticker || parts.controls.removeSticker ? ' ph-stickers--editable' : ''}`} aria-label="Stickers">
            {stickerPills}
            {addSticker && <li className="ph-add-sticker-item">{addSticker}</li>}
          </ul>
        ))}
      </div>
      {edit.anyEdit || edit.active ? (
        <p className="ph-sr" role="status" aria-live="polite" aria-atomic="true">{edit.message}</p>
      ) : null}
    </article>
  );
}
