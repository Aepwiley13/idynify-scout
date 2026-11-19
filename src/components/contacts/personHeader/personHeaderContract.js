/**
 * personHeaderContract — what the PersonHeader component will be given, and what it may do with it.
 *
 * H1-A defines the contract only: there is no component yet. It is the agreement the component
 * (H1-B), Contact Hub (H4) and, later, Scout are all built against.
 *
 * PROPS
 *
 *   <PersonHeader person={model} actions={actions} />
 *
 *   person   REQUIRED  a PersonHeaderModel (personHeaderModel.js). The header draws this and
 *                      nothing else: it is given no contact, reads no service and knows no plan.
 *   actions  OPTIONAL  callbacks the PARENT supplies for behaviour the parent owns (below). The
 *                      header never writes, saves, navigates or asks who is signed in.
 *
 * THE RULE FOR ACTIONS: a control is drawn only when it can do something.
 *
 *   no onEdit            no edit affordance on the name, title or organization
 *   no onPhotoClick      the photo is a picture, not a button
 *   no onAddSticker      no "Add sticker" control
 *   no onRemoveSticker   sticker pills have no remove control
 *   no onContactAction   nothing extra happens when a pill is used
 *
 * The phone, email and social pills are LINKS (tel:, mailto:, https:), so they work without any
 * callback and are drawn whenever the model has a safe link for them. onContactAction is only
 * a notification that one was used (for a parent that wants to know); it never replaces the link.
 * A missing model value draws nothing: no empty pill, no placeholder, no dead control.
 *
 * Nothing here imports React, Firebase, a service, a route, a plan or a Scout or Contact Hub
 * component, and a test holds it to that.
 *
 * @typedef {object} PersonHeaderActions
 * @property {(field: 'name'|'title'|'organization') => void} [onEdit]
 *           the person asked to edit one of the identity lines; the parent shows its editor
 * @property {() => void} [onPhotoClick]
 *           the person pressed the photo (the parent opens a viewer, or a menu)
 * @property {() => void} [onAddSticker]
 *           the person pressed "Add sticker" (the parent opens its picker; the header draws no picker)
 * @property {(sticker: { id: string, name: string }) => void} [onRemoveSticker]
 *           the person asked to remove one sticker (the parent confirms, writes and offers undo)
 * @property {(kind: 'phone'|'email'|'social', detail: { platform?: string }) => void} [onContactAction]
 *           a contact pill was used; the link itself has already done its work
 *
 * EDITING (H2-2). The header can draw an inline editor for the name, the title and the organization. It draws
 * ONLY what it is handed and keeps no draft of its own: the text in the box is `active.value`, always.
 *
 * @typedef {object} PersonHeaderEditing
 * @property {{ name?: boolean, title?: boolean, organization?: boolean }} [editable]
 *           which lines may be edited right now. A line with no `true` here has no edit control (a read-only
 *           session, or an organization that belongs to a linked company). Needs actions.onEdit too.
 * @property {{ field: 'name'|'title'|'organization', value: string }|null} [active]
 *           the open editor and its text
 * @property {{ name?: boolean, title?: boolean, organization?: boolean }} [saving]
 *           a save is in progress for that line (the new value is already shown)
 * @property {{ field: string, message: string }|null} [problem]
 *           the open editor's text was refused, and why, in words (the editor stays open)
 * @property {{ field: string, message: string }|null} [failure]
 *           a save failed, and why, in words (the editor has the text back)
 * @property {(value: string) => void} [onChange]   the text changed
 * @property {() => (void|Promise<unknown>)} [onSubmit]   Enter, or the editor lost focus, or "Try again"
 * @property {() => void} [onCancel]   Escape, or "Cancel"
 *
 * The words are the parent's. Why a name was refused, or a save failed, is decided by the controller, which
 * hands over text; the header only shows it. The editor is drawn only with all three handlers.
 *
 * @typedef {object} PersonHeaderProps
 * @property {import('./personHeaderModel.js').PersonHeaderModel} person
 * @property {PersonHeaderActions} [actions]
 * @property {PersonHeaderEditing} [editing]
 */

/** The callbacks a parent may supply, by name. Anything else in `actions` is ignored. */
export const PERSON_HEADER_ACTIONS = Object.freeze([
  'onEdit',
  'onPhotoClick',
  'onAddSticker',
  'onRemoveSticker',
  'onContactAction',
]);

/**
 * Which controls the header may draw, given the callbacks it was handed. A control needs a real
 * function: anything else (undefined, null, a string, an object) means "no".
 *
 * @param {PersonHeaderActions|null|undefined} actions
 * @returns {Readonly<{ edit: boolean, photo: boolean, addSticker: boolean, removeSticker: boolean, contactAction: boolean }>}
 */
export function availableControls(actions) {
  const has = (name) => actions !== null && typeof actions === 'object' && typeof actions[name] === 'function';
  return Object.freeze({
    edit: has('onEdit'),
    photo: has('onPhotoClick'),
    addSticker: has('onAddSticker'),
    removeSticker: has('onRemoveSticker'),
    contactAction: has('onContactAction'),
  });
}

/**
 * What the header has to draw, from the model alone: which of its parts exist. A part with
 * nothing to show is left out, so the layout can collapse around it. Pure, and the same answer
 * for the same model.
 *
 * @param {import('./personHeaderModel.js').PersonHeaderModel} person
 * @param {PersonHeaderActions|null|undefined} [actions]
 */
export function headerParts(person, actions) {
  const controls = availableControls(actions);
  const stickers = person?.stickers ?? null;
  return Object.freeze({
    subtitle: Boolean(person?.title || person?.organization),
    location: Boolean(person?.location),
    phone: Boolean(person?.phone),
    email: Boolean(person?.email),
    social: Array.isArray(person?.social) && person.social.length > 0,
    // The sticker area exists only where stickers are available (stickers is not null) and there is
    // something to show: pills, or a way to add one.
    stickers: stickers !== null && (stickers.length > 0 || controls.addSticker),
    addSticker: stickers !== null && controls.addSticker,
    controls,
  });
}

// ─── Editing ─────────────────────────────────────────────────────────────────

/** The lines that can be edited, and what each is called. */
export const EDIT_FIELDS = Object.freeze(['name', 'title', 'organization']);
export const EDIT_LABEL = Object.freeze({ name: 'name', title: 'title', organization: 'organization' });

const messageOf = (item) => (item && typeof item.message === 'string' && item.message.trim() !== '' ? item.message : '');

/**
 * What the header may draw for editing, from the callbacks and the editing state it was handed. Pure.
 *
 *   canEdit  a control for each line: needs actions.onEdit AND editing.editable[line] === true
 *   active   the open editor, only for a line that may be edited and only when all three handlers exist
 *   problem  the refusal to show (for the open editor only)
 *   failure  the failed save to show (for a line that may be edited, whether or not its editor is open)
 *   saving   which lines are saving (only lines that may be edited)
 *   message  one sentence for a polite live region: the refusal, else the failure, else "Saving …"
 *
 * Anything missing or malformed means "no": a control never appears without a way to use it.
 *
 * @param {PersonHeaderActions|null|undefined} actions
 * @param {PersonHeaderEditing|null|undefined} editing
 */
export function editState(actions, editing) {
  const controls = availableControls(actions);
  const e = editing !== null && typeof editing === 'object' ? editing : {};
  const canEdit = Object.freeze(Object.fromEntries(EDIT_FIELDS.map((f) => [f, controls.edit && e.editable?.[f] === true])));
  const handlers = typeof e.onChange === 'function' && typeof e.onSubmit === 'function' && typeof e.onCancel === 'function';
  const a = e.active;
  const active = handlers && a && EDIT_FIELDS.includes(a.field) && canEdit[a.field] && typeof a.value === 'string'
    ? Object.freeze({ field: a.field, value: a.value })
    : null;
  const problem = active && e.problem?.field === active.field && messageOf(e.problem)
    ? Object.freeze({ field: active.field, message: messageOf(e.problem) })
    : null;
  const failure = e.failure && EDIT_FIELDS.includes(e.failure.field) && canEdit[e.failure.field] && messageOf(e.failure)
    ? Object.freeze({ field: e.failure.field, message: messageOf(e.failure) })
    : null;
  const saving = Object.freeze(Object.fromEntries(EDIT_FIELDS.map((f) => [f, canEdit[f] && e.saving?.[f] === true])));
  const savingField = EDIT_FIELDS.find((f) => saving[f]);
  const message = problem?.message || failure?.message || (savingField ? `Saving ${EDIT_LABEL[savingField]}…` : '');
  return Object.freeze({
    canEdit,
    anyEdit: EDIT_FIELDS.some((f) => canEdit[f]),
    active,
    problem,
    failure,
    saving,
    message,
    onChange: handlers ? e.onChange : null,
    onSubmit: handlers ? e.onSubmit : null,
    onCancel: handlers ? e.onCancel : null,
  });
}
