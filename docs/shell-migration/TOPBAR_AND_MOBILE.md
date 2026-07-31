# Top Bar + Settings + Mobile Navigation
**Team A | Idynify | Enterprise-ready top bar, Settings into the shell, mobile drawer**

---

## Summary

| # | Change | Where |
|---|---|---|
| 1 | Email + Log out + Settings gear → one account menu | `UserMenu.jsx` (new) |
| 2 | Help → a real support mailto | `constants/support.js` (new) |
| 3 | Settings migrated into the shell | `UserSettings.jsx`, `App.jsx` |
| 4 | Theme has a home again — one-click light/dark | `useThemeToggle.js` (new) |
| 5 | Hamburger drawer gains Settings, Help and the account | `Sidebar.jsx` |
| 6 | More sheet: modules only, theme as a toggle | `MoreSheet.jsx` |
| 7 | Mobile top bar down to four controls | `MainLayout.css` |
| 8 | **Display name field** in Settings → Account | `UserSettings.jsx` |
| 9 | **`useUserPreference` crash path fixed** | `useUserPreference.js` |

**8 of 8 on the shell checklist.** Settings was the last screen in the product
still swapping the shell out for the old 60px rail.

---

## 1 — The account menu

Before: `aaron@utahadvocacycoalition.org` in a grey pill, a bordered **Log out**
button beside it, and a Settings gear beside that. Three controls, one of which
printed the user's email address across the top right of every screen in the
product.

After: **[AW] Aaron Wiley ▾**, with the email demoted into the dropdown, where
it identifies which account you are in — which matters on exactly the occasions
you open that menu, and never the rest of the time.

```
[Breadcrumb]                    🔍   🕐   🛟   [AW] Aaron Wiley ▾
                             search history help   account
```

The dropdown is a real `role="menu"`: Escape closes it and returns focus to the
trigger, clicking outside closes it, arrow keys move through the items and
Home/End jump to the ends. A menu that traps keyboard users is worse than no
menu.

### Where the name comes from

**Settings → Account now has a Display name field.** `users/{uid}.displayName`
is the canonical source; one input, one Save button. Everything else is
fallback, in descending order of how much it is really a name the user chose:

1. `displayName` — set by the user, in Settings → Account
2. `firstName` + `lastName` — sometimes filled by onboarding
3. `name` — legacy, written by older code paths
4. derived from the email — a convenience, not a claim about identity

The last resort derives rather than falling back to showing the address:
`aaron@idynify.com` → **Aaron**, `aaron.wiley@…` → **Aaron Wiley**. Leaving the
field blank is a supported state, not an error — it is what every existing user
is in today, and the field says so.

Firebase Auth's own `displayName` is deliberately **not** consulted. It is
unset for email/password signups, which is how everyone here signs up, and
reading it would put a second writable name in play with no way to reconcile
the two.

**One thing the field needed that was not obvious.** `App` reads `users/{uid}`
once, when auth resolves, and never again — so saving a name would not reach
the top bar until a reload. You would type your name, press Save, see "Saved",
and watch the corner keep calling you something else. `ShellContext` now
exposes `shellUser`, and Settings publishes the saved name to it. Display
concern only; Firestore stays the source of truth and the override never
writes.

Both Save buttons in the Account section also gained distinct accessible names
("Save display name", "Save booking link"). Two buttons labelled just "Save" on
one screen is ambiguous to a screen reader — and, as it happens, to a test.

---

## 2 — Help

The old top bar Help opened the Crisp widget if `window.$crisp` happened to be
loaded, and otherwise `mailto:support@idynify.com` — an address nothing
answers. So the fallback path silently went nowhere, which is what the brief
noticed.

One destination now, in `constants/support.js`. **Nothing else in the codebase
names a support address** — every surface calls `supportMailto()`, and there is
a test that fails if a second one appears.

```
mailto:aaron@idynify.com?subject=Idynify%20Support%20Request
```

An `<a href>` rather than a button — a real link the browser and OS both
understand, so it opens the mail client without depending on JS.

**The target is `support@idynify.com`, and it is not the default yet.** That
inbox is not live, and pointing help at an unmonitored address is worse than
pointing it at a monitored personal one — it is precisely the failure the old
Crisp fallback had. When Aaron confirms, flip `DEFAULT_SUPPORT_EMAIL` in
`constants/support.js`, or set `VITE_SUPPORT_EMAIL` to roll it out per
environment first. A test asserts the shipped value is still the monitored one,
so this cannot be forgotten quietly.

**One real duplicate was found and removed.** `CheckoutCancelPage` hard-coded
"Need help? Contact support@idynify.com" in prose — so a cancelled checkout,
the moment a customer is most likely to need a human, was pointing at an inbox
nobody reads. It now renders `SUPPORT_EMAIL` as a live mailto link.

---

## 3 — Settings into the shell

`UserSettings.jsx` was the last screen carrying its own application chrome: a
60px icon rail listing every module, a hand-built 190px sub-nav, a theme
picker, a user footer and its own BarryChat instance. Opening Settings from
anywhere replaced the whole shell — the wide sidebar vanished and the old
compact rail took its place. Same recipe as the seven module migrations.

Route moved into the `ShellRoute` group, mirrored in the rollback branch.

### The sub-nav — confirmed, keeping it

*Approved as built.* Contextual navigation inside a destination does not
compete with global navigation. Recorded here because the brief said otherwise
and the reasoning is worth keeping:

The brief says Settings **"does not need a sub-nav panel — it is a single
destination"**. It is a single destination, and it has always had a 190px
sub-nav panel with seven sections in it: Account, Security, Billing,
Integrations, Your Services, Hunter, Appearance.

The brief also says the existing sections stay exactly as they are. So the
panel stays, and renders through `ModuleSubNav` like every other module's:
deleting it would have removed seven sections, and hand-keeping it would have
left the one panel in the product that does not match the others — the exact
drift the shared component exists to prevent.

The sections gained short descriptions ("Password and two-factor", "Themes and
mission sounds"), because every other module's panel has them and Settings
would otherwise read differently.

Settings is **not** in the sidebar. It is reached from the account menu and the
mobile drawer, which is the brief's own alternative ("or a settings icon if
Settings lives in the user dropdown"). It is in `navigationModel` all the same,
so `resolveModule('/settings')` gives the breadcrumb a real answer — without
it, /settings fell through to the Mission Control fallback and the breadcrumb
read "Mission Control" while the user was plainly in Settings.

---

## 4 — Theme

Theme had no home in the global nav after it left the sidebar. It now has two,
for two different jobs:

- **One-click light ⇄ dark** — account menu, mobile drawer, More sheet.
- **The full set** (navy, sand, the Star Wars themes) — Settings → Appearance,
  unchanged.

`useThemeToggle()` is one hook rather than three copies of
`setThemeId(isLight ? 'mission' : 'workspace')`, and it labels the control with
**what tapping it does**, not what is currently on. The More sheet used to say
"Light Mode" while in light mode, which reads as a status.

---

## 5 — The mobile drawer

The hamburger already slid the sidebar in as a 260px drawer. What it lacked was
everything below the modules — and because the drawer has no top bar, mobile
was the one surface in the product with no route to Settings, support, or
logging out.

```
IDYNIFY                    ✕

Mission Control
Scout                          ← same component as the desktop sidebar,
Hunter                           so the order cannot drift
Sniper
Basecamp
Recon
Reinforcements
Fallback
Command Center
─────────────
⚙ Settings
🛟 Help
─────────────
[AW] Aaron Wiley
     aaron@idynify.com
→ Log out
```

Every element below the module list is `display: none` above 768px. **The
desktop sidebar is untouched.**

The close ✕ is mobile-only for the same reason: on desktop the sidebar is
always open, so a close control would have nothing to close. On mobile, a
drawer whose only exit is a tap on the sliver of page still showing beside it
is a drawer people get stuck in.

---

## 6 — The More sheet

Removed: **Game, Missions, Campaigns, Cadences.** Game is a Scout section;
Missions, Campaigns and Cadences are Command Center sections. A sheet titled
"All Modules" that mixes modules with four arbitrary sub-sections of two of
them teaches the wrong shape of the product — and it is the same list that has
to stay correct as sections move. All four are still reachable, one level in,
from the module that owns them.

The sheet is now: modules · separator · Settings + Theme · Log out, red and
full-width at the bottom, outside the tile grids so it is not one more thing to
navigate to.

---

## 7 — The mobile top bar

Was: ≡ · breadcrumb · search · notifications · session history · settings gear
— six controls on a 360px screen.

Now: **≡ · module name · 🔍 · 🔔.** Session history, help and the account menu
carry a `topbar-desktop-only` class; everything under the account menu is in
the drawer and the More sheet.

---

## What did NOT change

Bottom nav (Scout · Hunter · Sniper · Basecamp · More), the mobile horizontal
tab bars inside modules, the desktop sidebar, the desktop sub-nav panels, the
Barry card, and all module content. There is a test asserting the bottom nav is
still exactly those five.

---

## Verification

**552 tests, 547 passing.** Four new suites and one repair:

- `topBarUserMenu.test.jsx` (16) — identity resolution (displayName wins over
  everything; a blank one falls through rather than rendering a nameless menu),
  the dropdown's contents, keyboard behaviour, and that the top bar shows a
  name and not an address. Also asserts the shipped support address is the
  monitored one, and **greps the whole component and page tree for a second
  hard-coded `@idynify.com` address** — "not duplicated across components" as a
  test rather than a promise.
- `settingsDisplayName.test.jsx` (8) — the field is in Account, says what blank
  means, trims, writes `users/{uid}.displayName`, loads back, keeps Save
  disabled until something changed, and **reaches the top bar without a
  reload**.
- `mobileNavigation.test.jsx` (13) — the drawer lists every module in sidebar
  order, reaches Settings/Help/Log out, and closes on tap; the More sheet holds
  modules only; the bottom nav is unchanged.
- `moduleMigration.test.jsx` — Settings added as the eighth row, inheriting the
  whole eight-assertion checklist (**64 tests**).
- `shellPersistence.test.jsx` — the journey now ends
  … → Command Center → **Settings** → Mission Control, still asserting a shell
  mount count of exactly **1**. Twelve transitions across every screen in the
  product; pre-migration this mounted the shell 13 times.

**`hunterSoundHaptics.test.jsx`: five specs that never actually ran.** They
rendered `<UserSettings />` bare, which threw before reaching a single
assertion — first on `useLocation()` outside a Router, then on
`window.matchMedia`, which jsdom does not implement and the file never stubbed.
Five green-looking specs that only ever asserted the component crashes. They
now render the component the way it is used — inside a Router and a
ThemeProvider, at desktop width, on the Hunter section where the Mission sounds
toggle actually lives — and pass.

One assertion in the migration checklist was narrowed. "Renders no
settings, home or user-footer controls" searched the whole container for the
signed-in email; Settings' Account section legitimately **displays** the email
as content. It is now scoped to the sub-nav panel, which is where every
module's deleted user footer printed it. A container-wide query cannot tell
"chrome we removed" from "the field the screen exists to show".

The 5 remaining failures are pre-existing and unrelated — `HunterContactCard`
(date-fns) and `ReconSectionEditor` (4) — confirmed identical on `HEAD`.

Build passes. Lint at or below baseline on every file touched.

---

## Fixed since first review

**`useUserPreference` no longer has a crash path.** It calls `doc(db, …)`
inside an effect, and `doc()` throws **synchronously** — before the promise its
`.catch` is attached to exists — so the rejection escaped, React unwound the
tree, and any screen using a preference went blank. It took Settings down
whole. Now the `doc()` call is guarded on its own: a misconfigured Firestore is
a **configuration** failure, so it is logged as an error and named as such
rather than folded into the "could not load" warning, and the hook still
returns its default so a preference is never worth a blank page. The error is
logged, not swallowed. Loading is finished via the promise rather than in the
effect body, so the fix does not itself cascade a render.

---

## Carried forward

**Logo assets** are still absent — the wordmark, mark and Barry avatar all
render fallbacks. Unchanged from the previous PRs, still not shippable
branding.

**Mobile module chrome is still per module.** Each keeps its own top bar and
horizontal tab strip, which the brief confirms is correct for mobile. What is
not reconciled is that some of those top bars carry their own theme picker and
settings button, now duplicating the drawer. Worth one pass, not eight.

**`support@idynify.com` is not live.** One line in `constants/support.js` when
it is. Tracked by a test so it cannot go quiet.

---

## The shell is closed

The navigation is done. Hunter migrates on the same pattern, and after that the
global shell stops changing unless real users in real sessions show real
confusion — not instinct, not another audit. Evidence.

Every part of this that matters long-term is the contract, not the chrome.
`navigationContext` — `current_module`, `current_entity_id`,
`current_pipeline_stage`, `source_route`, `navigation_history` — already
publishes on every navigation and already renders into Barry's system prompt.
The navigation's job from here is to keep that contract accurate so Barry never
loses the user. Hunter's migration is the first link that matters: it is where
Barry learns that a prospect crossed from discovery into active engagement, who
made that call, and what the context was.
