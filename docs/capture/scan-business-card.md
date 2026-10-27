# Scan Business Card (Scout+)

The internal capture flow, from the Scout+ card to a saved contact:

```
Scout+ → Scan Business Card → Take / Upload photo → read → Review → Continue (match) → Add Person → contact profile
```

## Who sees it

The card opens the flow only when `captureConfig` says capture is on for the signed-in account. Today that is the capture mode `internal`: admins and super admins, through the existing admin checks. Everyone else sees the "Coming soon" card, which is not a control. So does an admin viewing as another user, and anyone while the answer is loading. The flow is not deep-linkable. Deploy previews keep capture pinned off (`netlify.toml`), so previews show "Coming soon" too.

Turning it on and off is the same switch as the Capture Lab (docs/capture/capture-mode.md). No deploy is needed.

## The flow

| Step | What runs | Writes |
|---|---|---|
| Photo | `prepareCardImage` on the device, with the blur, glare and darkness check (Use anyway / Retake) | Nothing |
| Read | `captureExtract`, as the signed-in user, one scan (`operationId`) per photo, retried as the same scan only when the endpoint says so | The existing values-free operation record only |
| Review | A list of people (one per card today). Name, title, company, email, LinkedIn and website are editable. Phones use the profile's phone editor | Nothing |
| Match | `previewCapturePerson` (`src/components/capture/captureSave.js`): the person through the shared resolver, the company through `resolveCompany` | Nothing |
| Save | `saveCapturePerson`: the write guard, the company resolver and the user-added contact builder | The contact, and its company when one is linked or created |
| After | The saved contact's profile (`/contact/:id`) | |

## Phone types

The type of each number is what the card printed before it, through the approved table in `src/utils/phoneLabels.js`. For example, `Main` → Main, `Direct`/`D` → Direct, `Mobile`/`M`/`Cell`/`C` → Mobile, `Office`/`O`/`Work`/`W` → Work, `Fax`/`F` → Fax, and `Tel`/`T`/`Phone`/`P`/`Ph` → Type not set.

With no printed word, only the extractor's mobile, direct or fax is kept. Its `office` is Type not set, never a guess. The user can change any type before saving. Capture's extraction is unchanged.

## Matching

| Person | Meaning | Save |
|---|---|---|
| New person | Nothing matched | Creates the contact |
| Already in IDYNIFY | An exact match on email, LinkedIn or a mobile, direct or home number | Updates that contact |
| Possible match | Same name and company as a saved contact | The user answers: same person (update) or different (add new) |
| Needs review | Two saved contacts share the email (or other identifier) | Not saved; change the detail or merge those contacts first |

Only a mobile, direct or home number can match a person (ADR-002). A main, work, fax or unset line never does, so two coworkers who share a main line stay two people.

| Company | Meaning | Save |
|---|---|---|
| Existing company | Matched by name (or by website when no name was printed) | Linked; a pending company is accepted, as every add path does |
| Possible match | Same website or email domain, different printed name | Linked by default, or "Don't link a company" |
| New company | No match, and a name was printed | Created with `name_source: user` |
| No company | No name printed and no existing company at that website | None created: a company is never named from a domain here |

An existing person keeps the company they already have. No company phone number is written.

## What a save writes

**A new person** goes to `users/{uid}/contacts/<operationId>_p<n>`. The document holds:
- the reviewed name, title, email, LinkedIn and website, plus `company`, `company_name` and `company_id`;
- the typed `phones[]` and the single phone fields derived from it (`phone`, `phone_mobile`, `phone_direct`, `phone_work`, `phone_home`);
- `phone_normalized`, from a mobile, direct or home number only;
- the identity and status fields from the write guard;
- `source` and `addedFrom` set to `business_card` (distinct from the legacy scanner's "Scanned Business Card"), `identity_sources: ['business_card']`, and `capture_operation_id`.

**An existing person** is updated additively:
- identifiers the record lacks are filled in (the shared `mergeIdentifiers`);
- the title and website are filled in only where empty;
- numbers the record doesn't already have are added to its phone list.

Nothing the record already holds is overwritten.

**A company**, when one is linked, is promoted or created as described in the company table above.

Nothing is written to `capture_operations` from the browser; Firestore rules forbid it.

## Retries never duplicate

A new person's document ID comes from the capture (`<operationId>_p<n>`). It is created in a transaction only if it does not exist yet, so a retry, a second tap or a reload of the same scan returns the same contact. Updating an existing person is additive, so repeating it writes nothing new. A company created on a failed first attempt is found again and linked.

The `_p<n>` suffix is the person's position in the capture. A capture is a source, not a person: one capture may yield several contacts later.

## Save looks again

Save resolves the person again. If the match changed since it was shown (for example, the person was added meanwhile), save writes nothing and the new match is shown to confirm.

## Logging

The flow sends no card value to any server log, and none to the browser console. The shared matchers' console lines carry codes and record IDs only: the match signal, the source, contact and company IDs, and an error's field and code. Their in-memory resolution log, used by tests and never printed, still holds the identifiers.

## Reloads and connection loss

- **New person.** The create is a Firestore transaction. It needs a connection and is either committed or not, so a reload cannot leave it queued or half-written.
- **Existing person.** The update is a single additive write. With the app's offline persistence, a pending update survives a reload and is sent later; applying it late is harmless.
- **Company.** It is linked or created before the person. A reload between the two leaves the company in place, and the next save of that card finds it and links it.
- **After a reload.** The scan on screen is gone, so scanning the card again starts a new scan. An exact identifier (email, LinkedIn, a mobile, direct or home number) brings back "Already in IDYNIFY", and saving writes nothing new. A card with only a name and company brings the saved person back as a possible match to confirm.

## Find LinkedIn (after Add Person)

```
Add Person → "{name} added. Find their LinkedIn and complete the profile?" → Find LinkedIn | Skip
           → the likely profiles (at most three), each with why it matched
           → "This is {first name}" (or paste their LinkedIn link)
           → "LinkedIn added", what it filled in, and any title that differs from the card's
```

Saving never waits on this. The person is saved first, from the card, and Skip opens their profile. A person who already has a LinkedIn URL goes straight to their profile without being asked.

**`captureLinkedIn`** (read-only) finds the profiles:

```
POST /.netlify/functions/captureLinkedIn
Authorization: Bearer <Firebase ID token>
{ "userId": "<uid>", "person": { "name", "company", "title", "domain", "email", "location" } }

200 { "candidates": [{ "linkedinUrl", "name", "headline", "company", "location", "photoUrl",
                       "sources": ["apollo", "search"], "strength": "strong", "reasons": ["name", "company"] }] }
```

- **Who may call it:** the same as `captureExtract`. It is the token's own user only, and only where the capture mode covers them (404 `capture_disabled` otherwise).
- **What it searches with:** the saved contact's own details. The domain comes from the website, or else a work email; never a free-mail one.
- **Where it looks.** It uses two existing sources. Either may be missing or fail, and the other still answers; 503 `unavailable` only when every source that ran failed, or none is configured.
  - **Apollo people match** (`APOLLO_API_KEY`): the name with the email, company and domain, giving at most one person record with a LinkedIn URL.
  - **Google Custom Search** (`linkedinSearch.searchLinkedInCandidates`, the helper Barry's enrichment uses). The name is paired with the company, then the domain, then the title. The name alone is searched only when the card has nothing else. It runs at most two searches.
- **Cost per search:** one Apollo match and up to two Google queries.
- **How profiles are ranked** (`utils/capture/linkedinCandidates.js`):

  | Strength | Evidence |
  |---|---|
  | Strong match | the whole name, and the company or its website |
  | Good match | the whole name, and the title or the location |
  | Possible match | the whole name only. Offered only when the card gives nothing else; otherwise a profile that matches only the name is someone else with the same name |

  A profile without every part of the name is never offered. Apollo's record and Google's result for the same profile are one candidate, and Apollo's details win.
- **Logging:** it logs through `captureLog` only (outcome, counts, source names). The usage record holds the same counts and source names. No name, email, company, title or URL is logged or stored.

Finding profiles writes nothing.

### Confirming a profile

Nothing is attached until the user taps **This is {first name}** on one profile, or pastes a profile link (`linkedin.com/in/…`; anything else is refused). Then `linkedinConfirm.confirmLinkedIn` runs, in the browser, as the signed-in user:

1. **The contact still has no LinkedIn**, or already has this one (a repeat is harmless). A contact that has a different one is left alone.
2. **No other contact has this profile.** The shared identity resolver decides, the one every save uses. If another contact has it, nothing is written and the screen offers both people.
3. **The profile's details** come from LinkedIn Link's exact lookup (`findContactByLinkedInUrl`: Apollo's record for exactly this URL). If it has no record, or fails, the URL is still linked and the screen says no more details were available.
4. **One update to that contact** (`linkedinEnrichment.enrichmentFromProfile`, pure):

   | Field | Written when |
   |---|---|
   | `linkedin_url` (`https://www.linkedin.com/in/<id>`), `linkedin_url_normalized`, `linkedin_confirmed_at` | always: the user's confirmation |
   | `title`, `headline`, `seniority`, `departments` | the contact's own is empty |
   | `location`, `city`, `state`, `country` | the contact has none of the four (location is filled as one, never mixed) |
   | `photo_url` (`photo_source: 'linkedin'`) | the contact has no real photo |
   | `apollo_person_id` | the contact has none, and no other contact holds it |
   | `last_enriched_at` | the profile's details were loaded |
   | `enrichment_provenance` | merged: `linkedin_url: 'user_confirmed'`, each filled field `'apollo_match'` |

   Never written: name, email, phones, company, website, notes, status.

**Whose value wins:** user-confirmed, then card-observed, then verified enrichment, then inferred. So where LinkedIn disagrees with the card, the card's value stays:

- **A different title** is shown beside the card's with **Use LinkedIn's title**. Taking it writes `title` and `enrichment_provenance.title: 'user_accepted'`.
- **A different company** is shown for information only. Changing the company means changing which company the person belongs to, which this step does not do.

The profile then shows the new details where it already shows them: the photo, title and LinkedIn link on the card, and the headline, location and LinkedIn link in the details drawer. The enrichment panel's sources name the user for what they confirmed or chose.

**Logging:** the screen and `linkedinConfirm` log nothing. `findContactByLinkedInUrl` now logs only that a lookup ran and whether it found someone; its usage record no longer holds the URL or the name, and an Apollo error log shows the URL as `(redacted)`.

**The same rules everywhere:** Barry's **Enrich** button on the profile follows these rules too, and offers the LinkedIn profiles it finds through this same confirm. See `docs/architecture/enrichment-rules.md`.

**Not covered yet:** Instagram, Facebook and other social profiles.
