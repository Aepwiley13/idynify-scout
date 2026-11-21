# Desktop UI Polish #003 — Compact Navigation Labels (proposed)

**Status: proposed, not authorized.** Raised out of #002 and deferred
deliberately. Nothing here is scheduled.

## The limitation, accepted in #002

The collapsed sidebar is 64px. Its module labels were 7px — present, but below
the size at which text is read rather than recognised. #002 took them to the
approved 11px floor, which made them legible and made four of the nine
ellipsis where two did before:

| Rail label | Width needed at 11px | Available |
|---|---|---|
| REINFORCEMENTS | 104px | 53px |
| COMMAND CENTER | 110px | 53px |
| BASECAMP | 64px | 53px |
| FALLBACK | 59px | 53px |

#002 reclaimed what it could — the rail's side padding dropped from 10px to
3px in compact only, where it was spending a third of the rail on whitespace
either side of a centred glyph. That bought 6px per label. The remaining gap
is not a styling problem: **no legible size fits a fourteen-character word in
64px.**

### Why this was acceptable to ship

The full name is never the thing that is lost. Every compact item carries it
twice over, verified in `Sidebar.jsx`:

- `aria-label={dest.label}` — always the full locked label, so assistive
  technology is unaffected;
- `title={dest.label}` in compact — a hover tooltip for sighted users;
- the truncated span itself is `aria-hidden` in compact, so the short label is
  never the accessible name.

What is lost is glanceability for four of nine modules, for users who keep the
sidebar collapsed.

## Options, if this is ever picked up

1. **Shorter `railLabel` values** in `src/constants/navigationModel.js` —
   REINFORCEMENTS → REINFORCE or REINF, COMMAND CENTER → COMMAND. The real
   fix, and cheap. It is an **IA change, not a typography one**: the model is
   the single source of truth for what things are called, and
   `sidebarLockedIA.test.jsx` asserts against it. Needs a naming decision, not
   a CSS one.
2. **A wider compact rail** — 72–80px fits BASECAMP and FALLBACK outright.
   Costs content width on every screen and changes the `ShellContext` width
   contract that the content margin depends on.
3. **Icon-only compact mode**, names via tooltip alone. Removes the problem by
   removing the labels; a bigger interaction decision than it looks.
4. **Leave it.** The tooltip and aria-label already carry the names, and this
   only affects users who collapse the sidebar.

Option 1 is the recommendation if the item is taken up. Options 2 and 3 are
navigation changes and would not belong in a typography-shaped entry.

## Explicitly not in scope here

The 937 legacy typography violations the #002 ratchet records and forgives, the
1,918 legacy inline sizes outside Daily Discoveries, and the five
never-imported stylesheets. All were left alone on instruction and none of them
is a prerequisite for this.
