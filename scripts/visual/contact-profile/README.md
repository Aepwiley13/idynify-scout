# Contact Profile: the working demo (isolated)

The redesigned Contact Profile in a local browser page. Real components, made-up contacts, stand-in persistence.
Nothing here can reach Firebase, staging or production, and it does not touch Contact Hub, Scout or Billing.

## Open it

```
npx vite --config scripts/visual/contact-profile/vite.config.mjs
open http://127.0.0.1:5311/scripts/visual/contact-profile/profile.html
```

Port **5311** is private to this demo. Ports 8888 and 5199 belong to other teams and are not used.
Add `?theme=dark`, `?contact=morgan`, `?latency=2500`, `?readonly=1`, `?stickers=off` or `?stickers=readonly` to the address, or use the
controls at the top of the page. A reload resets every edit (they live in the page's memory). Every write the profile asks for is listed
at the bottom of the page.

## What is real, what is a stand-in

| Real | Stand-in (`stubs/`) |
|---|---|
| `ConnectedPersonHeader` and the controllers under it: `useContactIdentityEdit`, `useContactPhotoEdit`, the shared `useContactStickers` | `firebase/firestore` (writes are logged, take a moment, can be made to fail once) |
| `PersonHeader`, `PhotoPanel`, the existing `ContactIdentityViewer` and `StickerPicker` | the sticker services and the registry (in memory) |
| `IdentityCard variant="details"`: the existing email, phone and social editors | the signed-in account (and "admin viewing", read-only) |
| `StickersProvider`, `ThemeProvider`, `saveContactFields` (its checks run for real) | `peopleService`, `brigadeSystem`, `CompanyDetailModal` (not used by the details card) |

## Things to try

* **Identity:** Edit name / title / organization. Enter saves, Esc or Cancel cancels, leaving the box saves. Clear the name and press Enter.
  `lee` has a linked company (organization is read-only). `morgan` is a CSV import (shown by first and last name; saving writes `name` only).
* **Failures:** press *Fail next save*, then edit something: the text comes back with a message and *Try again*. *Fail next sticker change*: add a sticker, press *Retry*.
* **Photo:** click the photo (viewer); *Change photo* (replace by an https link, or remove, which asks once more); `avery` has none (click the photo to add one).
  New links must be https. The sample portraits are served locally over http, so they work offline; paste any https image link to replace one.
* **Details:** *add email*, *add phone*, the pencil on an existing entry: the existing editors, unchanged.
* **Stickers:** *Add sticker* opens the real picker (a popover on a desktop screen, a bottom sheet on a phone). Remove with the X, then *Undo*.
  Set *Save takes* to 2.5 s, add a sticker, switch contact, switch back: it landed on the right contact.
* **Sessions:** *admin viewing (read-only)*: nothing editable, the photo can still be viewed. *Stickers: not available / read-only*: no sticker area at all.

## Checking it

```
~/.nvm/versions/node/v22.23.4/bin/node scripts/visual/contact-profile/capture.mjs <output folder>
```

Drives the page in headless Chrome with real key and pointer events (light and dark, desktop and phone), intercepts every request, saves screenshots
and checks every flow above, plus touch targets, overflow and focus.

## Connecting it to the live Contact Hub (not done; needs approval)

Only `src/pages/ContactHub/HubPerson.jsx` changes. Today it draws `<IdentityCard variant="simple" onUpdate={updateContact}>` inside
the `StickersProvider` that `ContactHubMain` already provides. The change is:

```jsx
const { contacts, updateContact, applyStickerChange } = useOutletContext();
…
<ConnectedPersonHeader
  contact={contact}
  onPatch={(id, fields) => updateContact({ id, ...fields })}      // Hub's updateContact merges by id
  onLateStickerChange={applyStickerChange}                         // already in the outlet context
/>
<IdentityCard key={`card-${contact.id}`} contact={contact} onUpdate={updateContact} variant="details" />
```

* No rules change: the contact fields written (`name`, `title`, `company_name`, `photo_url`, `photo_source`, `emails`, phone fields) are ordinary
  owner writes to `users/{uid}/contacts/{id}`, the same ones IdentityCard makes today; stickers still go through the sticker services.
* `ContactHubMain` must pass its `uid` to `StickersProvider` as it does now; nothing else changes there.
* Do NOT pass `ConnectedPersonHeader` a parent that stores whatever it is given as "the contact on screen" (Scout's `ContactProfile.handleContactUpdate`
  does); `onPatch` is a partial, id-addressed patch. Scout is unchanged and would need its own id-checked adapter.
* Contact Hub's existing tests (`contactHubPage`, routes, workspace) must be rerun with the swap; the `StickyNotes` section is untouched.
