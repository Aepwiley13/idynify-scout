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
 * @typedef {object} PersonHeaderProps
 * @property {import('./personHeaderModel.js').PersonHeaderModel} person
 * @property {PersonHeaderActions} [actions]
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
