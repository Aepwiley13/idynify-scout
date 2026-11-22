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

## Action Center fixture

Start Vite with `--config scripts/visual/contact-profile/vite.config.mjs --configLoader runner --strictPort` and open the same profile URL with `?action=1`. The fixture opens on Action Center with a Free session. Use the fixture controls to change contact, simulate a failed save or a read-only session, or switch to Scout. `?action=1&contact=morgan` shows a protected legacy next step.

The fixture uses the real UI and an in-memory Firestore stand-in. It resets on reload. Scout’s Barry button shows a local handoff so the fixture can demonstrate explicit activation without contacting a service.

With the fixture running, capture desktop and mobile screenshots and an interaction report:

```sh
node scripts/visual/contact-profile/capture.mjs /tmp/action-center-review --action
```

## Contact photo upload fixture

Open `profile.html?action=1&photo=1` on the same fixture server. On mobile, choose **Edit profile → Change photo**. Tap empty initials to add a first photo. The fixture supports camera and library input, crop, preview, mocked Save, removal and restoration. Use the existing **Fail next save** and **read-only** fixture controls to exercise those states. Reloading clears the private overrides.

Run the browser checks and capture the photo screens with:

```sh
node scripts/visual/contact-profile/capture.mjs /tmp/contact-photo-review --photo
```

The camera-check path supplies a local JPEG through Chrome's chooser interception. Test the physical camera on a phone separately.

### Trusted photo persistence rollout

The fixture above uses in-memory photo overrides. Contact Hub's real adapter and trusted writer are off by default. A verified staging integration uses `VITE_CONTACT_HUB_PHOTO_OVERRIDES=on` for the client, `CONTACT_PHOTO_WRITES=on` for the function, and the reviewed local rules and index exemption. Keep the flags off until contact and account deletion paths are integrated with trusted cleanup. The local rules reject client deletion of a contact with an override to protect the private document. Existing Admin SDK deletion and account-purge paths, which bypass rules, need verified cleanup before enrollment.

The profile lazily reads a single private override. My People rows, cards and tables use the display marker returned by the normal contacts query. They show initials for hidden and custom photos, so they neither display an older imported picture in its place nor download full-size JPEGs. Sticker Wall tiles are sticker summaries. Contact Hub's Details uses the profile editor, and Scout's legacy URL editor remains on its existing path.

The local emulator suite is `scripts/rules-check/contact-photo.mjs` under the existing rules-check dependencies. It checks owner isolation, overlapping rule matches, the bulk-delete guard, atomic trusted cleanup, concurrent saves, and a recursive purge fixture. The purge fixture exercises Firestore cleanup separately from any deployed account-deletion workflow.

#### Photo staging requirements

- Keep both photo flags off until trusted individual contact deletion, bulk deletion, and account deletion remove private photo documents. Verify all three workflows using real staging data.
- Test taking and saving a photo on a physical mobile device, including returning from the camera and cancelling.
- Verify real staging writes, reloads, owner isolation, read-only and impersonation rejection, and concurrent deletion. Fixture and emulator results are local evidence.
- Add lightweight thumbnails in a future pass for custom photos in My People and contact cards. The current list projection can show initials without fetching each private JPEG.

### Contact Hub manual Gmail staging

See the [unified staging acceptance plan](../../../docs/contact-hub/CONTACT_HUB_STAGING_ACCEPTANCE.md) for the Gmail browser fixture and full rollout checklist.

The Contact Hub composer is off by default. An isolated staging setup uses `VITE_CONTACT_HUB_GMAIL=on` in the frontend and `CONTACT_HUB_GMAIL=on` for the functions. Leave `CONTACT_HUB_GMAIL_SEND` off or unset for connection-only staging QA. Use a dedicated Google OAuth client for new Contact Hub connections through `CONTACT_HUB_GMAIL_CLIENT_ID`, `CONTACT_HUB_GMAIL_CLIENT_SECRET`, and `CONTACT_HUB_GMAIL_REDIRECT_URI`. Register the exact HTTPS `/.netlify/functions/contact-hub-gmail-callback` URL. Configure consent for Gmail send and email identity scopes, and verify Google consent and OAuth publishing requirements for the rollout audience. Previously connected Scout Gmail accounts use their original credentials and client to refresh. New Contact Hub connections grant send-only Gmail access and are stored separately.

Test real Free and Scout staging accounts with a controlled recipient. Verify connect, cancel, return to the same contact, account switch, expired or revoked permission, actual delivery, the shared activity entry, and unchanged Scout contact state. Test the client and function flags together. The server requires an authenticated owner, confirms the sender and saved recipient at reservation, and rejects impersonation. No credits or AI are involved.

The trusted function reserves one send attempt per request ID. It limits attempts to five per UTC minute and thirty per UTC day per IDYNIFY account. Google applies its own sending limits. An unconfirmed Gmail response requires checking Gmail Sent before trying a new message. A confirmed send with a failed activity write is shown as sent with a warning. Neither case automatically retries Gmail.

The new top-level collections are server-only under the current rules. Before any enrollment, set retention for expired OAuth records (`contact_hub_gmail_oauth.expiresAt`), integrate removal of private connection and send-ledger documents with account deletion, and review an account-level disconnect and revocation path for the new OAuth client. Send reservations and quota records incur Firestore transaction reads and writes. The relationship timeline stores the subject and Gmail message ID for confirmed sends. The message body is sent to Gmail and is not persisted by the Contact Hub function.

## My People duplicate review fixture

Start the fixture with its usual config on a separate port. Existing QA
servers can keep running.

```sh
VITE_CONTACT_HUB_GMAIL=off VITE_CONTACT_HUB_PHOTO_OVERRIDES=off VITE_CONTACT_HUB_DELETE=off \
  node node_modules/vite/bin/vite.js --config scripts/visual/contact-profile/vite.config.mjs \
  --configLoader runner --host 127.0.0.1 --port 5317 --strictPort
```

Open `http://127.0.0.1:5317/scripts/visual/contact-profile/profile.html?duplicates=1`
and choose **Review duplicates (2)**. The fixture supplies an exact match
with conflicting job titles and a similar-name match. Add `&scout=1`,
`&readonly=1`, or `&theme=dark` to exercise those views.

```sh
node scripts/visual/contact-profile/capture.mjs /tmp/idynify-duplicate-review-browser --duplicates
```
