# Mobile Interaction Map
**Team A | Idynify | Five journeys, tap by tap — pre-merge review artifact**

Every step below was walked against the code on `claude/team-a-kickoff-5zaxkj`,
not from memory. Where I could not verify something without a running
authenticated app on hardware, it says so.

**Seven findings came out of the walk. Four are defects.** They are collected at
the end; each is also flagged inline where it bites.

---

## The model being reviewed

```
HAMBURGER    = change the workspace   (move between modules)
BOTTOM BAR   = change the view        (inside the current workspace)
TOP BAR      = where you are          (+ search, notifications)
```

Two facts that shape every journey below:

**1. The hamburger navigates to bare module paths.** `/hunter`, not
`/hunter?tab=followup`. So returning to a module lands on its *default* section,
never the one you left. This is deliberate for entering a module and wrong for
returning to one — see Finding 2.

**2. Modules unmount when you leave them.** The shell, Barry and his thread
persist; the module's own state does not. Scroll position, filters, selections
and loaded lists are rebuilt on return. This is unchanged by the mobile work —
it is a property of routes swapping inside `<Outlet/>` — but it is what
"is state preserved?" actually means, so it is answered honestly in Journeys 2
and 3 rather than glossed.

---

## Journey 1 — Core daily flow

```
Mission Control
  [sees] pink module grid, Top Recommended Companies
         bottom bar: Scout · Hunter · Sniper · Basecamp · More   ← global fallback
  → taps ≡ (top left)
  → drawer slides in from the left: IDYNIFY, Mission Control,
    PIPELINE / RELATIONSHIPS / INTELLIGENCE, Command Center,
    Settings · Help, [AW] Aaron Wiley, Log out

Drawer
  → taps "Scout" (under PIPELINE)
  → drawer closes, lands on /scout
  [sees] top bar: ≡ · Scout · 🔍 · 🔔
         bottom bar: Daily · Saved · People · Scout+ · More
         "Daily" active, in Scout cyan

Scout · Daily
  → taps a contact card
```

**This is where the journey forks, and it should not.**

There are two different "open a contact" behaviours depending on which Scout
view you are in:

| From | What happens | URL |
|---|---|---|
| **People** (`AllLeads`) | opens an in-component panel; pushes a synthetic history entry so device Back closes it | stays `/scout?tab=all-leads` |
| Notifications, Barry history, Add Contact, Quick Engage, Reinforcements | route navigation | `/scout/contact/:id` |

**Daily Discoveries is a review queue, not a list of profiles** — it hands cards
to `DailyLeads`, which does not open contact profiles the way People does. So
the literal journey "Daily → open contact" does not exist today. The nearest
real path is **Daily → tap People in the bottom bar → tap a contact**, which is
one extra tap and is the flow the rest of this journey assumes.

→ **Finding 1** (two contact-open behaviours) and **Finding 5** (Daily has no
contact open) below.

```
Contact profile (full screen)
  [sees] the contact; bottom bar still visible underneath
  → scrolls to the Scout engagement panel
  → taps "Move to Hunter"
  → chooses a reason, optionally a note, confirms
```

**The user does not land in Hunter. They stay exactly where they are.**

`Move to Hunter` writes the stage change to Firestore and calls
`shell.announce(...)`. What appears is a card above the bottom bar:

```
✓ Sarah Chen moved to Hunter.
  Engage and follow up
  [Open Hunter →]   [Undo ↺]   [✕]
```

It sits at `bottom: 56px + safe-area + 0.75rem`, so it clears the bottom bar —
verified in CSS. Because it carries an Undo it does **not** auto-dismiss; the
12-second timer only applies to announcements without one.

**Is this right?** Yes, and it is the single most important interaction in the
product. The original audit's worst finding was that this action wrote the
stage and said nothing — same URL, same header, and a back button still reading
"Back to People". Not auto-navigating is deliberate: the user moved a contact,
they did not ask to leave. They are offered the destination and offered a way
back, and they choose.

```
  → taps "Open Hunter →"
  → lands on /hunter
  [sees] top bar: ≡ · Hunter · 🔍 · 🔔
         bottom bar: Blitz · All People · Companies · Follow Up · More
         "All People" active, in Hunter purple

Hunter · All People
  → taps "Start Cadence"
```

**Start Cadence is not navigation.** It toggles bulk-select mode in place: the
button becomes `Selecting (n)`, cards gain checkboxes, and a compose modal
follows. There is no route change, so there is nothing for Back to return
*from* except the modal.

```
  → after the cadence, taps device Back
  → returns to /hunter, All People, list rebuilt from scratch
```

**Is the ≡ tap obvious?** Yes — top-left hamburger is the most conventional
control on mobile.

**Would a new user know to tap it to change module?** Mostly. The risk is the
opposite direction: a user who learns modules live in ≡ may look there for
*sections* too. The module More sheet is titled with the module name and tinted
with its colour specifically so that mistake self-corrects in one glance.

**Does changing module feel intentional?** Yes — it takes a deliberate drawer
open, and the whole bottom bar visibly changes colour and contents on arrival.

---

## Journey 2 — Module switching, and the tap-count question

```
Hunter · Follow Up (working a contact)
  → taps ≡                      ......... tap 1
  → drawer opens, PIPELINE group visible with Scout · Hunter · Sniper
  → taps "Sniper"               ......... tap 2
  → drawer closes, lands on /sniper
  [sees] bottom bar: People · Companies · Pipeline · Targets · More
         "People" active, in Sniper cyan
```

### **Hunter → Sniper is TWO taps, not three.**

The brief asked whether it is three — `hamburger → Pipeline → Sniper`. It is
not. **`PIPELINE` is a label, not a control.** It is a muted small-caps heading,
not tappable, with no accordion to expand. There is a test asserting it is not a
`<button>` and has no button ancestor, precisely so nobody later "helpfully"
makes the groups collapsible and turns two taps into three.

**Is two the right friction level?** Yes, and here is the argument rather than
the assertion:

- **It is more than zero.** The old bar put every module one tap away from every
  screen, which is what made changing workspace feel accidental — a thumb
  resting at the bottom of the screen was always one twitch from leaving the
  module. Two taps with a deliberate drawer open cannot happen by accident.
- **It is not more than two.** Three would be a tax on a real workflow. Moving a
  contact through Scout → Hunter → Sniper is the product's core motion, not an
  edge case, and adding a step to it would be friction on the thing users are
  meant to do most.
- **The one-tap paths that matter still exist.** Stage transitions offer
  `Open Hunter →` directly in the announcement, which is one tap from the moment
  the user actually needs to cross. Deliberate ≠ slow when it counts.

Two taps to change workspace, one tap to change view. **Staying is the default;
leaving is deliberate.** That is the philosophy, and the implementation matches
it.

```
  → taps ≡, taps "Hunter"       ......... back to Hunter, 2 taps
  → lands on /hunter
  [sees] bottom bar: "All People" active — NOT "Follow Up"
```

### **Hunter state is not preserved. Two separate losses:**

1. **Which section you were in.** The hamburger links to `/hunter`, so you
   return to Hunter's default view. You left from Follow Up; you arrive at All
   People. → **Finding 2.**
2. **Everything inside the section.** `HunterMain` unmounted, so scroll
   position, filters and the loaded list are rebuilt.

Loss 1 is fixable and should be fixed — see Finding 2. Loss 2 is architectural
and is the same on desktop; changing it means keeping modules mounted, which is
a much larger decision than a navigation sprint should take.

---

## Journey 3 — Relationships work

```
Basecamp
  [sees] bottom bar: People · Companies · Engage · CSM     ← no More; all four fit
         "People" active, in Basecamp green
  → taps People, works a contact
  → taps ≡                      ......... tap 1
  → taps "Reinforcements" (under RELATIONSHIPS)  ......... tap 2
  → lands on /reinforcements
  [sees] bottom bar: Dashboard · Opportunities · Leaderboard · Nurture · More
         "Dashboard" active, in Reinforcements amber
```

**Does Basecamp state survive?** **No.** Same two losses as Journey 2:
`BasecampMain` unmounts, and returning via ≡ lands on `/basecamp` → People,
regardless of where you were.

Worth naming what *does* survive, because it is the point of the shell:
**Barry's thread and his context do.** He is mounted once and toggled with
`inert`, so a conversation started in Basecamp is still there in
Reinforcements, and `navigationContext` tells him you came from
`/basecamp?tab=people`. The chrome persists; the module does not.

**Note on Basecamp specifically:** it has exactly four sections, so its bar has
**no More cell**. That is deliberate — a More that opens an empty sheet is worse
than no More — and there is a test asserting Basecamp's bar is exactly four
cells.

---

## Journey 4 — Return to Mission Control

```
Any module
  → taps ≡                      ......... tap 1
  → "Mission Control" is the FIRST item, above every group,
    with a home icon and no group heading above it
  → taps it                     ......... tap 2
  → lands on /mission-control-v2
  [sees] bottom bar reverts to the global module list:
         Scout · Hunter · Sniper · Basecamp · More
```

**Is it always one tap from the hamburger?** **Yes — always, from every
module, with no scrolling.** It is the first row in the drawer, pinned above
PIPELINE, and it is reached identically from all nine destinations. Two taps
total from anywhere.

The bottom bar reverting to modules is the honest signal that you have left
module context: there is no "view" to switch here, so the bar offers the next
most useful thing. → See **Future UX** for what this becomes.

**One thing that is not obvious and should be on record:** the installed PWA's
`start_url` is `/scout?tab=daily-leads`, not Mission Control. Someone who adds
Idynify to their home screen opens into Scout every time. If Mission Control is
meant to be where the day starts, that manifest entry contradicts it. →
**Finding 4.**

---

## Journey 5 — Intelligence

```
Any module
  → taps ≡, taps "Recon" (the only item under INTELLIGENCE)
  → lands on /recon
  [sees] bottom bar: Overview · ICP · Messaging · Training · More
         "Overview" active, in Recon indigo

Recon · Overview
  → taps "ICP"
  → lands on /recon/icp-intelligence          ← a real route, not a ?tab=
  [sees] "ICP" active; Overview no longer lit
```

Recon is the one module that navigates by real path. The bottom bar resolves
its active item by **longest pathname match**, so `/recon/icp-intelligence` does
not also light Overview — whose path `/recon` is a prefix of every Recon route.
There is a test for exactly this.

```
  → taps Back
  → returns to /recon (Overview)
```

### **"Back" is doing more work here than the product provides.**

Recon's routes are real, so browser history is correct and Back genuinely
returns to Overview. The problem is **there is no Back control in the app.**
The mobile top bar is `≡ · module name · 🔍 · 🔔` — by design, and the design is
right. Back comes from the platform:

| Context | Back available? |
|---|---|
| Android browser | Yes — system back button |
| Android installed PWA | Yes — system back button |
| iOS Safari | Yes — edge-swipe |
| **iOS installed PWA (`display: standalone`)** | **Unreliable** |

The manifest declares `"display": "standalone"`. In standalone mode iOS removes
browser chrome, and edge-swipe back is inconsistent across iOS versions. **A
user who installs Idynify on an iPhone may have no way back from
`/recon/icp-intelligence` except tapping another bottom-bar item.**

In Recon that is survivable — every section is one tap away on the bar. It is
not survivable on a contact profile, which is a leaf with nothing on the bar
pointing back to it. The route-based contact panel does render its own `←`; the
`AllLeads` mobile panel relies on the synthetic history entry and therefore on
Back working. → **Finding 3.**

---

## Findings

### Defects

**1 — Two different "open a contact" behaviours.**
From Scout → People, tapping a card opens an in-component panel and pushes a
synthetic history entry; the URL stays `/scout?tab=all-leads`. From
notifications, Barry history, Add Contact, Quick Engage or Reinforcements, it
routes to `/scout/contact/:id`. Same user intent, two URL semantics, two back
behaviours. The route version is the correct one — it is linkable, survives
refresh, and Back closes it because closing *is* a navigation.
*Not caused by this sprint. Surfaced by walking it.*

**2 — The hamburger loses your section.**
It navigates to bare module paths, so returning to a module lands on its
default view rather than where you left. Leaving Hunter from Follow Up and
coming back puts you on All People. **Fixable cheaply:** remember the last
visited path per module and have the drawer navigate there instead of to
`dest.path`. Roughly the same shape as `sidebarMode` in `ShellContext` — a small
map, updated on navigation. Deliberately **not** done in this sprint: it changes
what a navigation control does, and this artifact exists to be reviewed before
anything else moves.

> **APPROVED SEMANTICS — restoration is session-scoped. Build to this.**
>
> Restoration applies **only while the current authenticated app session
> remains active.** A force-close and fresh PWA launch uses the configured
> `start_url` (today `/scout?tab=daily-leads`) and restores nothing.
>
> It must **never** reopen:
> - a contact leaf
> - a compose route
> - a modal
> - Quick Engage state
> - bulk-selection state
>
> Only a module's **section** is eligible — the `?tab=` or Recon path, nothing
> below it. In implementation terms: store per module, in memory on
> `ShellContext` (not `localStorage`, which survives a force-close and would
> violate the fresh-launch rule), and record a path only when it resolves to a
> bottom-bar item for that module. That last condition is what excludes every
> item on the never-reopen list without having to enumerate them — a contact
> leaf, a compose route and a modal are none of them a bottom-bar destination.
>
> **Today's behaviour already satisfies every "must never" above**, because
> nothing is restored at all. The rules are recorded here so the fix cannot
> quietly introduce what it is forbidden to.

**3 — No in-app Back, and iOS standalone may not provide one.**
See Journey 5. The top bar should stay four controls; the fix is not a global
back button. Leaf screens that can be reached without a bar item pointing back
to them need their own `←`. The route-based contact panel already has one; the
`AllLeads` mobile panel does not, and depends on device Back.

**4 — Bottom bar lights "Daily" on a contact profile.**
On `/scout/contact/:id` no bar item matches (the path has no `?tab=`), so the
"bare module URL" fallback fires and lights Scout's default section. The user is
looking at a contact and the bar says Daily. **Introduced by this sprint** —
the fallback should not apply on a nested route, only on the module root.

### Not defects, but worth recording

**5 — Daily Discoveries has no contact-open.**
It is a review queue handing out cards, not a list of profiles. The journey as
briefed does not exist; the real path is Daily → People → contact.

**6 — Start Cadence does not navigate.**
It toggles bulk-select in place and opens a modal, so there is no route to go
back from. This is fine, but it means "→ back → where are they?" has no
navigational answer: they are where they were.

**7 — PWA `start_url` is Scout, not Mission Control.**
The installed app opens into Scout. A product decision, not a bug — but it
contradicts "Mission Control decides what deserves attention", so it should be
decided rather than inherited.

---

## Future UX — Mission Control's bottom bar

**Recorded in `src/constants/mobileNavigation.js` as well as here, so it is not
rediscovered later.**

```
Priorities · Today · Pipeline · Activity · Barry
```

Five cells, not four-plus-More: there is no overflow, so nothing is hidden and
the fifth slot is free. Barry is a cell rather than a floating button because on
Mission Control he is a destination — the screen exists to decide what deserves
attention, and he is how you ask.

Today `MissionControlDashboardV2` is one scrolling dashboard: a module grid and
a "Top Recommended Companies" list. Nothing routes, nothing switches. Adding bar
cells that scroll to anchors would be navigation pretending sections exist, and
the bar would lie about where you are the moment the user scrolled. So Mission
Control falls through to the global module list until the content exists.

**When the sections are real:** add a `'mission-control'` entry to
`MODULE_BOTTOM_NAV` and the fallback stops applying. No other change is needed,
and the drift guard in `moduleMigration.test.jsx` picks it up automatically.

---

## Before merge

1. **Aaron reviews this map** — particularly Findings 2 and 4, which are the two
   that change how navigation behaves.
2. **Finding 4 should be fixed before merge.** It is small, it is mine, and it
   makes the bar say something untrue.
3. **Real-device verification** — see the checklist below. Everything in this
   document is Chromium at 390×844 with a stubbed viewport.
4. Then merge, and lock the shell.

---

## Real-device checklist

Run on an installed iPhone home-screen app (`display: standalone`). Three
things behave differently on hardware and none of them can be checked in
Chromium.

**1 — Safe-area insets.**
The bottom bar, the drawer footer, the module More sheet and the announcement
stack all use `env(safe-area-inset-bottom)`. A notched iPhone is the only way to
confirm they compose rather than double up. Check: nothing sits under the home
indicator; the drawer's Barry card clears the bar; an announcement clears both.

**2 — Fresh launch starts clean.**
Force-close and reopen the installed PWA → confirm it opens Scout Daily and does
not restore the previous contact leaf or transient workflow.

**3 — The iOS keyboard.**
It does not resize the viewport in standalone mode, so a fixed bottom bar can
end up above or behind it. Check: tap into search and into a note field, and
confirm the bar does not float mid-screen over the content.

**4 — iOS standalone Back.**
Finding 3 rests entirely on this. Open a contact from Scout → People, then try
to get back without using a bottom-bar item. If there is no way back, Finding 3
is confirmed and the leaf needs its own `←`.

**5 — The feel test.** Use it normally for a few minutes: move between Scout
sections, open and close a contact, launch Hunter, type into search, scroll a
long list, close the app, relaunch. It should read as:

> The hamburger changes the workspace.
> The bottom bar changes the view.
> Back exits detail work.
> A fresh launch starts clean.


---

## Deploy preview — what Aaron needs to run the checklist

**PR:** [#497](https://github.com/Aepwiley13/idynify-scout/pull/497)
**Commit under test:** the head of PR #497 — read it from the PR rather than
from here, so it cannot go stale if another commit lands.
**Preview URL:** `https://deploy-preview-497--idynify.netlify.app`

Netlify builds a deploy preview per PR at
`deploy-preview-<PR>--<site>.netlify.app`. The site is `idynify` — the same one
the PR's own "Header rules / Redirect rules / Pages changed" checks report
against, and those checks link to the exact deploy.

> **I could not load this URL to confirm it.** This environment's network policy
> denies outbound HTTPS to `netlify.app` (the proxy answers 403 to CONNECT), so
> everything in this section is read from configuration, not from a fetched
> page. **The Netlify check on the PR is authoritative** — open its deploy link
> and use the URL it reports.

### Deep links work

`netlify.toml` has the SPA fallback:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

So `/hunter`, `/recon/messaging` and `start_url` all resolve on a hard load.
Without this the PWA would fail on launch, since `start_url` is not `/`.

### Authentication — expected to work, and here is why

Sign-in is **email/password only**: `signInWithEmailAndPassword` in `Login.jsx`,
`createUserWithEmailAndPassword` in `Signup.jsx`. No Google, no popup, no
redirect.

That matters because Firebase's **authorized-domains** list gates OAuth
popup/redirect flows — it does not gate email/password. So a preview origin
does not need to be added to it. There is also **no App Check** anywhere in the
codebase, which would otherwise reject an unregistered domain.

*Stated from code, not from a completed sign-in* — I have no credentials and
cannot log in. If sign-in fails on the preview, the cause is almost certainly
neither of the above; check the browser console for the Firebase error code
before assuming it is a domain problem.

### ⚠️ The preview writes to the SAME Firestore as production

`src/firebase/config.js` hard-codes `projectId: "idynify-scout-dev"` with no
environment override. Every build — preview, production, local — uses that one
project.

**Hardware QA on this preview mutates real data.** Specifically:

- **Move to Hunter** genuinely moves the contact. The announcement's Undo
  restores the previous stage, so use it.
- **Start Cadence** can send real email. Do not complete a cadence during QA
  unless you intend the send.
- Contacts added via Scout+ are real contacts.

Journeys 1–5 can all be walked without an irreversible write, provided cadences
are not completed. Worth deciding separately whether preview builds should point
at a distinct Firebase project — that is a bigger question than this PR.

### Standalone PWA install — supported

`public/manifest.json` declares `"display": "standalone"`, `start_url:
/scout?tab=daily-leads`, portrait, with 192 and 512 icons. Netlify serves the
preview over HTTPS, which is the remaining install requirement. Add to Home
Screen from Safari on the preview URL and it installs as its own app.

**A preview install is a separate app from a production install** — different
origin, separate storage, separate service worker. It will not disturb an
existing production install, and both can coexist on the home screen.

### The service worker matters for checklist item 2

`public/sw.js` is registered on every load. It is **network-first for
navigation** and **cache-first for `/assets/`** (safe, since those filenames are
content-hashed), and it calls `skipWaiting()` + `clients.claim()` so a new
version takes over immediately rather than waiting for every tab to close.

Two consequences for QA:

1. **A stale build should not survive a relaunch.** If the preview ever looks
   like an older commit, force-close and relaunch once — that is the SW handing
   over, not a bug in the navigation.
2. **Offline navigation falls back to `caches.match('/')`.** If the device drops
   connection mid-test, a relaunch may land on `/` rather than `start_url`.
   That is the service worker, not the fresh-launch rule — retest item 2 with a
   connection.
