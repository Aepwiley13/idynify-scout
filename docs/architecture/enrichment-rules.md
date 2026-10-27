# Enrichment rules: Barry Enrich and Find LinkedIn

IDYNIFY has one set of rules for what enrichment may write onto a contact:

- **The rules:** `src/utils/contactProtection.js` (#737). They are pure.
- **Users:**
  - Barry Enrich: `netlify/functions/barryEnrich.js`.
  - Find LinkedIn's confirm: `src/components/capture/linkedinEnrichment.js`, which uses the same suggestion rules.
- **LinkedIn identity:** only through Find LinkedIn's confirm (#731/#732): `src/components/capture/linkedinConfirm.js`.

## Whose value wins

```
user-confirmed  >  card-observed or typed  >  verified enrichment  >  inferred
```

A value the contact already has stays. Enrichment fills only what is empty. Where a source disagrees with a value the contact has, that is a suggestion, never a write.

## Field by field

| Field | Contact has a value | Contact's is empty |
|---|---|---|
| name | kept | not filled by enrichment |
| email | kept | filled from an exact Apollo match, or from the contact's own `work_email`. An address found on the company website is only offered ("Use this email") |
| phones | every number kept, with its label | the provider's new numbers are added next to them (see below) |
| company | kept. A different one is shown for information only | filled, then linked through `ensureCompanyForContact`, which reuses a company with the same Apollo id, name or domain before creating one |
| website | kept (enrichment never writes `website`; a contact with one gets no `company_website`) | not filled |
| title | kept. A different one is offered ("Use this title") | filled |
| LinkedIn URL | kept | never written by enrichment: only through Find LinkedIn's confirm (see below) |
| headline, seniority, departments, photo, Twitter, Facebook, history, education | kept | filled |
| location (`location`, `city`, `state`, `country`) | kept if any is set | filled as one unit: the person's own location, else the company's as a whole fallback |
| `enrichment_provenance` | every existing entry kept (`user_confirmed`, `user_accepted` …) | each written field records its source |

Taking a suggestion writes the value and records `enrichment_provenance.<field>: 'user_accepted'`. Only a title, or an email while the contact has none, can be taken (`src/services/contactSuggestions.js`).

### Phones (`mergeFoundPhones`)

- **Existing numbers stay.** Every number the contact has stays, with its label.
- **New numbers.**
  - A provider number is added to `phones[]` only when the contact has no number that is the same, with or without a country code ("801-555-1234" and "+18015551234" are one number).
  - It is labelled by the provider's stated type (`labelSource: 'enrichment'`).
  - A type the provider does not state as the person's own (e.g. `work_hq`) is `unknown`. An unknown number never identifies the person.
- **Single fields:**
  - `phone_mobile`, `phone_direct`, `phone_work`, `phone_home` and `phone_normalized` keep their values; only empty ones are filled.
  - The number to call (`phone`) is set only on a contact that had no number at all.
- **Removed numbers:** a number the provider gave before and the user has since removed is not added back.
- **Re-runs:** running Enrich again adds nothing.

## LinkedIn: confirmed, never guessed

Barry Enrich never writes a LinkedIn URL, and never reads the record behind a profile it found by searching. This covers profiles from Apollo's people search, from Google, and the LinkedIn on an Apollo record matched by id.

1. **Offered:**
   - Barry returns them in `linkedinCandidates`.
   - They are ranked by Find LinkedIn's rules (`netlify/functions/utils/capture/linkedinCandidates.js`).
   - A profile that matches only the name is dropped when the contact gives more than a name.
2. **Shown:** the contact profile shows them in Find LinkedIn's own screen (`FindLinkedIn`, `context="profile"`), or its paste box when there are none. There is no other paste box: the old one, which wrote a pasted URL directly, is gone.
3. **Confirmed:** "This is Kristin", or a pasted link, runs Find LinkedIn's confirm (`linkedinConfirm.confirmLinkedIn`):
   - it is refused when the contact already has a different LinkedIn;
   - it is refused when another contact holds the profile, including older stored forms of its URL;
   - otherwise LinkedIn Link's exact lookup runs (`findContactByLinkedInUrl`), and the contact is filled only where empty.

Person details come only from an exact Apollo match: the contact's own Apollo id, or its own LinkedIn URL. A people-search result is a candidate and nothing else, so a namesake's email, photo or location never fills a contact.

## Logging

- **Barry Enrich:** log lines carry step names, statuses and counts only (no name, email, phone, company, title or URL). The usage record holds counts and the confidence level.
- **Shared helpers on its path:** Google Places, the LinkedIn photo search and the Apollo contact validator are values-free too.
- **Browser side:** the write step and the suggestion services log nothing.
